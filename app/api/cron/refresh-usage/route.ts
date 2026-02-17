import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

const CURSOR_API_BASE = 'https://api.cursor.com';
const TOKEN_BASELINE = 21_000_000_000;
const BLOB_NAME = 'cursor-usage.json';
const LOCAL_DATA_FILE = path.join(process.cwd(), 'data', 'cursor-usage.json');

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

function getBasicAuth(): string {
  const key = process.env.CURSOR_API_KEY;
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Cursor API helpers ---

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

// --- Anthropic Usage API ---

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';

interface AnthropicUsageBucketResult {
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  output_tokens: number;
  [key: string]: unknown;
}

interface AnthropicUsageBucket {
  starting_at: string;
  ending_at: string;
  results: AnthropicUsageBucketResult[];
}

interface AnthropicUsageReport {
  data: AnthropicUsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

async function fetchAnthropicUsage(startMs: number, endMs: number): Promise<number> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) return 0;

  let totalTokens = 0;
  const startISO = new Date(startMs).toISOString();
  const endISO = new Date(endMs).toISOString();
  let page: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      starting_at: startISO,
      ending_at: endISO,
      bucket_width: '1d',
      limit: '31',
    });
    if (page) params.set('page', page);

    try {
      const res = await fetch(
        `${ANTHROPIC_API_BASE}/v1/organizations/usage_report/messages?${params}`,
        {
          headers: {
            'anthropic-version': '2023-06-01',
            'x-api-key': adminKey,
          },
        }
      );

      if (res.status === 429) {
        await sleep(5000);
        continue;
      }
      if (!res.ok) break;

      const report: AnthropicUsageReport = await res.json();

      for (const bucket of report.data) {
        for (const r of bucket.results) {
          totalTokens += (r.uncached_input_tokens || 0);
          totalTokens += (r.cache_read_input_tokens || 0);
          totalTokens += (r.cache_creation?.ephemeral_5m_input_tokens || 0);
          totalTokens += (r.cache_creation?.ephemeral_1h_input_tokens || 0);
          totalTokens += (r.output_tokens || 0);
        }
      }

      if (!report.has_more) break;
      page = report.next_page ?? undefined;
      await sleep(500);
    } catch {
      break;
    }
  }

  return totalTokens;
}

// Fetch Anthropic usage in 31-day chunks across the lookback period
async function fetchAllAnthropicTokens(lookbackMs: number): Promise<number> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) return 0;

  const now = Date.now();
  const chunkMs = 31 * 24 * 60 * 60 * 1000;
  let totalTokens = 0;
  let cursor = now - lookbackMs;

  while (cursor < now) {
    const end = Math.min(cursor + chunkMs, now);
    const tokens = await fetchAnthropicUsage(cursor, end);
    totalTokens += tokens;
    cursor = end;
    await sleep(500);
  }

  return totalTokens;
}

// --- Storage ---

interface UsageData {
  tokens: number;
  linesOfCode: number;
  fetchedAt: number;
}

async function writeUsage(data: UsageData): Promise<void> {
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

// --- Cron handler ---

export async function GET(request: Request) {
  // Verify cron secret in production (if CRON_SECRET is set)
  const cronSecret = process.env.CRON_SECRET;
  if (isProduction && cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!process.env.CURSOR_API_KEY) {
    return NextResponse.json({ error: 'No CURSOR_API_KEY' }, { status: 500 });
  }

  try {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const lookback = 365 * 24 * 60 * 60 * 1000; // 1 year

    const ranges: { startMs: number; endMs: number }[] = [];
    let cursor = now - lookback;
    while (cursor < now) {
      const end = Math.min(cursor + thirtyDays, now);
      ranges.push({ startMs: cursor, endMs: end });
      cursor = end;
    }

    // Fetch Anthropic usage in parallel with Cursor usage
    const anthropicPromise = fetchAllAnthropicTokens(lookback);

    let totalLinesOfCode = 0;
    let cursorTokens = 0;

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
        cursorTokens += tokens;
      }

      if (i + 3 < ranges.length) await sleep(1500);
    }

    const anthropicTokens = await anthropicPromise;
    const totalTokens = cursorTokens + anthropicTokens;

    const result: UsageData = {
      tokens: totalTokens + TOKEN_BASELINE,
      linesOfCode: totalLinesOfCode,
      fetchedAt: Date.now(),
    };

    await writeUsage(result);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Cron refresh failed:', error);
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}

// Max duration for Vercel Pro (cron can take a while with pagination)
export const maxDuration = 60;
