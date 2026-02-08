import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

const CURSOR_API_BASE = 'https://api.cursor.com';
const TOKEN_BASELINE = 21_000_000_000;
const BLOB_NAME = 'cursor-usage.json';
const LOCAL_DATA_FILE = path.join(process.cwd(), 'data', 'cursor-usage.json');
const REFRESH_INTERVAL = 60 * 60 * 1000; // Refresh from Cursor API every 1 hour

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// In-memory cache for the stored result
let memoryCache: { tokens: number; linesOfCode: number; fetchedAt: number } | null = null;

// Track if a background refresh is in progress
let refreshInProgress = false;

// --- Storage helpers ---

interface UsageData {
  tokens: number;
  linesOfCode: number;
  fetchedAt: number;
}

async function readUsage(): Promise<UsageData | null> {
  if (memoryCache) return memoryCache;

  try {
    if (isProduction) {
      const { blobs } = await list({ prefix: BLOB_NAME });
      const blob = blobs.find(b => b.pathname === BLOB_NAME);
      if (blob) {
        const res = await fetch(blob.url, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          memoryCache = data;
          return data;
        }
      }
    } else {
      const raw = await fs.readFile(LOCAL_DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      memoryCache = data;
      return data;
    }
  } catch {
    // No stored data yet
  }
  return null;
}

async function writeUsage(data: UsageData): Promise<void> {
  memoryCache = data;

  try {
    if (isProduction) {
      await put(BLOB_NAME, JSON.stringify(data), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    } else {
      const dir = path.dirname(LOCAL_DATA_FILE);
      try { await fs.access(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
      await fs.writeFile(LOCAL_DATA_FILE, JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('Failed to write usage data:', error);
  }
}

// --- Cursor API helpers ---

function getBasicAuth(): string {
  const key = process.env.CURSOR_API_KEY;
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface DayUsage {
  totalLinesAdded: number;
  [key: string]: unknown;
}

async function fetchDailyUsage(startDate: number, endDate: number, retries = 2): Promise<DayUsage[]> {
  try {
    const res = await fetch(`${CURSOR_API_BASE}/teams/daily-usage-data`, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ startDate, endDate }),
    });
    if (res.status === 429 && retries > 0) {
      await sleep(5000);
      return fetchDailyUsage(startDate, endDate, retries - 1);
    }
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } catch {
    return [];
  }
}

interface UsageEvent {
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalCents: number;
  };
  [key: string]: unknown;
}

interface UsageEventsResponse {
  totalUsageEventsCount: number;
  pagination: {
    numPages: number;
    currentPage: number;
    pageSize: number;
    hasNextPage: boolean;
  };
  usageEvents: UsageEvent[];
}

async function fetchUsageEventsPage(
  startDate: number, endDate: number,
  page: number, pageSize: number, retries = 2
): Promise<UsageEventsResponse | null> {
  try {
    const res = await fetch(`${CURSOR_API_BASE}/teams/filtered-usage-events`, {
      method: 'POST',
      headers: {
        'Authorization': getBasicAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ startDate, endDate, page, pageSize }),
    });
    if (res.status === 429 && retries > 0) {
      await sleep(5000);
      return fetchUsageEventsPage(startDate, endDate, page, pageSize, retries - 1);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTokensForPeriod(startDate: number, endDate: number): Promise<number> {
  let totalTokens = 0;
  let page = 1;
  const pageSize = 500;

  while (true) {
    const result = await fetchUsageEventsPage(startDate, endDate, page, pageSize);
    if (!result || !result.usageEvents) break;
    for (const event of result.usageEvents) {
      if (event.tokenUsage) {
        totalTokens += (event.tokenUsage.inputTokens || 0);
        totalTokens += (event.tokenUsage.outputTokens || 0);
      }
    }
    if (!result.pagination.hasNextPage) break;
    page++;
    await sleep(500);
  }
  return totalTokens;
}

// --- Background refresh: heavy Cursor API fetch ---

async function refreshFromCursorAPI(): Promise<void> {
  if (refreshInProgress) return;
  if (!process.env.CURSOR_API_KEY) return;

  refreshInProgress = true;

  try {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const lookback = 270 * 24 * 60 * 60 * 1000;

    const ranges: { startMs: number; endMs: number }[] = [];
    let cursor = now - lookback;
    while (cursor < now) {
      const end = Math.min(cursor + thirtyDays, now);
      ranges.push({ startMs: cursor, endMs: end });
      cursor = end;
    }

    let totalLinesOfCode = 0;
    let totalTokens = 0;

    for (let i = 0; i < ranges.length; i += 3) {
      const batch = ranges.slice(i, i + 3);

      const lineResults = await Promise.all(
        batch.map(r => fetchDailyUsage(r.startMs, r.endMs))
      );
      for (const dayList of lineResults) {
        for (const day of dayList) {
          totalLinesOfCode += (day.totalLinesAdded || 0);
        }
      }

      await sleep(1500);

      for (const range of batch) {
        const tokens = await fetchTokensForPeriod(range.startMs, range.endMs);
        totalTokens += tokens;
      }

      if (i + 3 < ranges.length) await sleep(1500);
    }

    const result: UsageData = {
      tokens: totalTokens + TOKEN_BASELINE,
      linesOfCode: totalLinesOfCode,
      fetchedAt: Date.now(),
    };

    await writeUsage(result);
  } catch (error) {
    console.error('Background refresh failed:', error);
  } finally {
    refreshInProgress = false;
  }
}

// --- GET endpoint: instant read from storage ---

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fresh = searchParams.get('fresh');

  // Read stored data (Blob in prod, local file in dev)
  const stored = await readUsage();

  if (stored && !fresh) {
    // If data is stale, trigger background refresh (non-blocking)
    if (Date.now() - stored.fetchedAt > REFRESH_INTERVAL) {
      refreshFromCursorAPI(); // fire-and-forget
    }
    return NextResponse.json(stored);
  }

  // No stored data yet — try a synchronous fetch if we have an API key
  if (process.env.CURSOR_API_KEY) {
    // For first-time setup: do the heavy fetch synchronously
    if (fresh || !stored) {
      await refreshFromCursorAPI();
      const result = await readUsage();
      if (result) return NextResponse.json(result);
    }
  }

  // Fallback: return baseline
  return NextResponse.json({ tokens: TOKEN_BASELINE, linesOfCode: 0, fetchedAt: 0 });
}
