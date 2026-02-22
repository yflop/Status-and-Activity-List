import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

interface FlowTask {
  id: string;
  label: string;
  difficulty: 1 | 2 | 3;
}

interface FlowCompletion {
  difficulty: 1 | 2 | 3;
  completedAt: number;
}

const TASKS_BLOB = 'flowkeeper.json';
const COMPLETIONS_BLOB = 'flow-completions.json';
const LOCAL_TASKS = path.join(process.cwd(), 'data', 'flowkeeper.json');
const LOCAL_COMPLETIONS = path.join(process.cwd(), 'data', 'flow-completions.json');

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

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

// POST — auth required: complete a task (remove from list, add completion record)
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;

  if (!password) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  if (authHeader !== `Bearer ${password}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await request.json();

    const tasks: FlowTask[] = isProduction
      ? await readBlob(TASKS_BLOB, [])
      : await readLocal(LOCAL_TASKS, []);

    const task = tasks.find(t => t.id === id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const remaining = tasks.filter(t => t.id !== id);
    const completions: FlowCompletion[] = isProduction
      ? await readBlob(COMPLETIONS_BLOB, [])
      : await readLocal(LOCAL_COMPLETIONS, []);

    completions.push({ difficulty: task.difficulty, completedAt: Date.now() });

    if (isProduction) {
      await Promise.all([writeBlob(TASKS_BLOB, remaining), writeBlob(COMPLETIONS_BLOB, completions)]);
    } else {
      await Promise.all([writeLocal(LOCAL_TASKS, remaining), writeLocal(LOCAL_COMPLETIONS, completions)]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error completing flowkeeper task:', error);
    return NextResponse.json({ error: 'Failed to complete task' }, { status: 500 });
  }
}
