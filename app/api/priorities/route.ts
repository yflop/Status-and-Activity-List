import { NextRequest, NextResponse } from 'next/server';
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

const DATA_FILE = path.join(process.cwd(), 'data', 'priorities.json');

async function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify([], null, 2));
  }
}

async function readPriorities(): Promise<Priority[]> {
  await ensureDataFile();
  const data = await fs.readFile(DATA_FILE, 'utf-8');
  return JSON.parse(data);
}

async function writePriorities(priorities: Priority[]): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(priorities, null, 2));
}

// GET - Fetch priorities (strips private labels for unauthenticated requests)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;
  const isAuthenticated = password && authHeader === `Bearer ${password}`;
  
  console.log('GET /api/priorities - Auth header:', authHeader ? 'present' : 'missing');
  console.log('GET /api/priorities - Password env:', password ? 'set' : 'NOT SET');
  console.log('GET /api/priorities - Is authenticated:', isAuthenticated);
  
  try {
    const priorities = await readPriorities();
    
    if (isAuthenticated) {
      // Authenticated: return full data including private labels
      console.log('Returning WITH labels');
      return NextResponse.json(priorities);
    } else {
      // Public: strip private labels, only return tag and metrics
      console.log('Returning WITHOUT labels');
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
      { error: 'Failed to save priorities' },
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
