import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

export interface Priority {
  id: string;
  label: string;
  tag: string;           // Public-facing category
  risk: 1 | 2 | 3;       // 1=low, 2=medium, 3=high
  urgency: 1 | 2 | 3;
  importance: 1 | 2 | 3;
}

const BLOB_NAME = 'priorities.json';
const LOCAL_DATA_FILE = path.join(process.cwd(), 'data', 'priorities.json');

// Check if we're in production (Vercel) or local development
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

async function readPrioritiesLocal(): Promise<Priority[]> {
  try {
    const data = await fs.readFile(LOCAL_DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writePrioritiesLocal(priorities: Priority[]): Promise<void> {
  const dir = path.dirname(LOCAL_DATA_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(LOCAL_DATA_FILE, JSON.stringify(priorities, null, 2));
}

async function readPrioritiesBlob(): Promise<Priority[]> {
  try {
    // List blobs to find our file
    const { blobs } = await list({ prefix: BLOB_NAME });
    const blob = blobs.find(b => b.pathname === BLOB_NAME);
    
    if (blob) {
      const response = await fetch(blob.url, { cache: 'no-store' });
      if (response.ok) {
        return await response.json();
      }
    }
    return [];
  } catch (error) {
    console.error('Error reading blob:', error);
    return [];
  }
}

async function writePrioritiesBlob(priorities: Priority[]): Promise<void> {
  await put(BLOB_NAME, JSON.stringify(priorities, null, 2), {
    access: 'public',
    addRandomSuffix: false,
  });
}

async function readPriorities(): Promise<Priority[]> {
  if (isProduction) {
    return readPrioritiesBlob();
  }
  return readPrioritiesLocal();
}

async function writePriorities(priorities: Priority[]): Promise<void> {
  if (isProduction) {
    await writePrioritiesBlob(priorities);
  } else {
    await writePrioritiesLocal(priorities);
  }
}

// GET - Fetch priorities (strips private labels for unauthenticated requests)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;
  const isAuthenticated = password && authHeader === `Bearer ${password}`;
  
  try {
    const priorities = await readPriorities();
    
    if (isAuthenticated) {
      // Authenticated: return full data including private labels
      return NextResponse.json(priorities);
    } else {
      // Public: strip private labels, only return tag and metrics
      const publicPriorities = priorities.map(({ id, tag, risk, urgency, importance }) => ({
        id,
        tag,
        risk,
        urgency,
        importance,
        // No label field - private data stays on server
      }));
      return NextResponse.json(publicPriorities);
    }
  } catch (error) {
    console.error('Error reading priorities:', error);
    return NextResponse.json([], { status: 200 });
  }
}

// POST - Protected endpoint to update priorities
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;
  
  if (!password) {
    return NextResponse.json(
      { error: 'Server not configured for editing' },
      { status: 500 }
    );
  }
  
  if (authHeader !== `Bearer ${password}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const priorities: Priority[] = await request.json();
    await writePriorities(priorities);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving priorities:', error);
    return NextResponse.json(
      { error: 'Failed to save priorities', details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE - Protected endpoint to delete a priority
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;
  
  if (!password) {
    return NextResponse.json(
      { error: 'Server not configured for editing' },
      { status: 500 }
    );
  }
  
  if (authHeader !== `Bearer ${password}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const { id } = await request.json();
    const priorities = await readPriorities();
    const filtered = priorities.filter(p => p.id !== id);
    await writePriorities(filtered);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting priority:', error);
    return NextResponse.json(
      { error: 'Failed to delete priority' },
      { status: 500 }
    );
  }
}
