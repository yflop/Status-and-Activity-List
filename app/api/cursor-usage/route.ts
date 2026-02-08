import { NextResponse } from 'next/server';

const CURSOR_API_BASE = 'https://api.cursor.com';

// In-memory cache
let cachedResult: { tokens: number; linesOfCode: number; fetchedAt: number } | null = null;
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours
const TOKEN_BASELINE = 21_000_000_000; // Add 21B to token count

function getBasicAuth(): string {
  const key = process.env.CURSOR_API_KEY;
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Daily Usage (for lines of code) ---

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

// --- Usage Events (for tokens) ---

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
  startDate: number,
  endDate: number,
  page: number,
  pageSize: number,
  retries = 2
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

// Fetch all token usage for a 30-day period
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

    // Small delay between pages to respect rate limits
    await sleep(500);
  }

  return totalTokens;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fresh = searchParams.get('fresh');

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ tokens: TOKEN_BASELINE, linesOfCode: 0 });
  }

  // Return cached data unless ?fresh=1
  if (!fresh && cachedResult && Date.now() - cachedResult.fetchedAt < CACHE_DURATION) {
    return NextResponse.json(cachedResult);
  }

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const lookback = 270 * 24 * 60 * 60 * 1000; // 9 months (data starts ~May 2025)

  // Build 30-day ranges
  const ranges: { startMs: number; endMs: number }[] = [];
  let cursor = now - lookback;
  while (cursor < now) {
    const end = Math.min(cursor + thirtyDays, now);
    ranges.push({ startMs: cursor, endMs: end });
    cursor = end;
  }

  let totalLinesOfCode = 0;
  let totalTokens = 0;

  // Fetch lines and tokens concurrently per batch
  for (let i = 0; i < ranges.length; i += 3) {
    const batch = ranges.slice(i, i + 3);

    // Fetch lines of code (3 parallel)
    const lineResults = await Promise.all(
      batch.map(r => fetchDailyUsage(r.startMs, r.endMs))
    );
    for (const dayList of lineResults) {
      for (const day of dayList) {
        totalLinesOfCode += (day.totalLinesAdded || 0);
      }
    }

    // Brief gap then fetch tokens
    await sleep(1500);

    // Fetch tokens sequentially per range (each may need multiple pages)
    for (const range of batch) {
      const tokens = await fetchTokensForPeriod(range.startMs, range.endMs);
      totalTokens += tokens;
    }

    // Delay between batches to respect rate limits
    if (i + 3 < ranges.length) {
      await sleep(1500);
    }
  }

  const result = {
    tokens: totalTokens + TOKEN_BASELINE,
    linesOfCode: totalLinesOfCode,
    fetchedAt: Date.now(),
  };

  cachedResult = result;
  return NextResponse.json(result);
}
