import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

export interface FlowTask {
  id: string;
  label: string;
  difficulty: 1 | 2 | 3;
}

export interface FlowCompletion {
  difficulty: 1 | 2 | 3;
  completedAt: number;
}

const TASKS_BLOB = 'flowkeeper.json';
const COMPLETIONS_BLOB = 'flow-completions.json';
const LOCAL_TASKS = path.join(process.cwd(), 'data', 'flowkeeper.json');
const LOCAL_COMPLETIONS = path.join(process.cwd(), 'data', 'flow-completions.json');

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

const DIFFICULTY_HOURS: Record<1 | 2 | 3, number> = { 1: 4, 2: 8, 3: 12 };

// --- Storage helpers ---

async function readLocal<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeLocal(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  try { await fs.access(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function readBlob<T>(blobName: string, fallback: T): Promise<T> {
  try {
    const { blobs } = await list({ prefix: blobName });
    const blob = blobs.find(b => b.pathname === blobName);
    if (blob) {
      const res = await fetch(blob.url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function writeBlob(blobName: string, data: unknown): Promise<void> {
  await put(blobName, JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function readTasks(): Promise<FlowTask[]> {
  return isProduction ? readBlob(TASKS_BLOB, []) : readLocal(LOCAL_TASKS, []);
}

async function writeTasks(tasks: FlowTask[]): Promise<void> {
  if (isProduction) await writeBlob(TASKS_BLOB, tasks);
  else await writeLocal(LOCAL_TASKS, tasks);
}

async function readCompletions(): Promise<FlowCompletion[]> {
  return isProduction ? readBlob(COMPLETIONS_BLOB, []) : readLocal(LOCAL_COMPLETIONS, []);
}

export async function writeCompletions(completions: FlowCompletion[]): Promise<void> {
  if (isProduction) await writeBlob(COMPLETIONS_BLOB, completions);
  else await writeLocal(LOCAL_COMPLETIONS, completions);
}

const SEVEN_DAYS = 7 * 24 * 3600_000;

function pruneExpired(completions: FlowCompletion[]): FlowCompletion[] {
  const now = Date.now();
  return completions.filter(c => now - c.completedAt < SEVEN_DAYS);
}

// GET — public: returns tasks + active completions
export async function GET() {
  try {
    const [tasks, rawCompletions] = await Promise.all([readTasks(), readCompletions()]);
    const completions = pruneExpired(rawCompletions);

    if (completions.length !== rawCompletions.length) {
      writeCompletions(completions).catch(() => {});
    }

    return NextResponse.json({ tasks, completions });
  } catch (error) {
    console.error('Error reading flowkeeper:', error);
    return NextResponse.json({ tasks: [], completions: [] });
  }
}

// POST — auth required: replace full task list
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;

  if (!password) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  if (authHeader !== `Bearer ${password}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const tasks: FlowTask[] = await request.json();
    await writeTasks(tasks);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving flowkeeper tasks:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

// DELETE — auth required: remove a task by id
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;

  if (!password) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  if (authHeader !== `Bearer ${password}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await request.json();
    const tasks = await readTasks();
    await writeTasks(tasks.filter(t => t.id !== id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting flowkeeper task:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
