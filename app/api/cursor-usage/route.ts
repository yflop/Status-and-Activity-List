import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

const TOKEN_BASELINE = 21_000_000_000;
const BLOB_NAME = 'cursor-usage.json';
const LOCAL_DATA_FILE = path.join(process.cwd(), 'data', 'cursor-usage.json');

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// In-memory cache (refreshed from Blob/file)
let memoryCache: { tokens: number; linesOfCode: number; fetchedAt: number } | null = null;
let memoryCacheAt = 0;
const MEMORY_CACHE_TTL = 30_000; // Re-read from storage every 30s

async function readUsage(): Promise<{ tokens: number; linesOfCode: number; fetchedAt: number } | null> {
  // Return memory cache if fresh
  if (memoryCache && Date.now() - memoryCacheAt < MEMORY_CACHE_TTL) {
    return memoryCache;
  }

  try {
    if (isProduction) {
      const { blobs } = await list({ prefix: BLOB_NAME });
      const blob = blobs.find(b => b.pathname === BLOB_NAME);
      if (blob) {
        const res = await fetch(blob.url, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          memoryCache = data;
          memoryCacheAt = Date.now();
          return data;
        }
      }
    } else {
      const raw = await fs.readFile(LOCAL_DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      memoryCache = data;
      memoryCacheAt = Date.now();
      return data;
    }
  } catch {
    // No stored data
  }
  return null;
}

// GET: instant read from Blob/file — no heavy Cursor API calls
export async function GET() {
  const stored = await readUsage();

  if (stored) {
    return NextResponse.json(stored);
  }

  // Fallback if no data has been written yet
  return NextResponse.json({ tokens: TOKEN_BASELINE, linesOfCode: 0, fetchedAt: 0 });
}
