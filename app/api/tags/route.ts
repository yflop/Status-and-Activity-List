import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export interface Tag {
  value: string;
  label: string;
}

const DATA_FILE = path.join(process.cwd(), 'data', 'tags.json');

// Default tags
const DEFAULT_TAGS: Tag[] = [
  // Documentation & Communication
  { value: 'docs-general', label: 'Documentation & Reporting' },
  { value: 'docs-design', label: 'Solution Design' },
  { value: 'communications', label: 'Communications' },
  { value: 'emails', label: 'Catching Up on Messages' },
  
  // Programming
  { value: 'prog-bugfix', label: 'Programming - Bug Fixes' },
  { value: 'prog-features', label: 'Programming - New Features' },
  { value: 'prog-newapp', label: 'Programming - New Project' },
  { value: 'prog-refactor', label: 'Programming - Refactoring' },
  { value: 'prog-review', label: 'Code Review' },
  
  // Meetings & Collaboration
  { value: 'meetings', label: 'Meetings & Calls' },
  { value: 'planning', label: 'Planning & Strategy' },
  { value: 'review', label: 'Review & Feedback' },
  
  // Research & Learning
  { value: 'research', label: 'Research & Analysis' },
  { value: 'learning', label: 'Learning & Development' },
  
  // Admin & Personal
  { value: 'admin-work', label: 'Administrative Tasks' },
  { value: 'admin-personal', label: 'Personal Admin' },
  { value: 'scheduling', label: 'Scheduling & Coordination' },
  { value: 'errands', label: 'Errands' },
  { value: 'health', label: 'Health & Wellness' },
  
  // Projects
  { value: 'side-project', label: 'Side Project' },
  { value: 'creative', label: 'Creative Work' },
  
  // Catch-all
  { value: 'misc', label: 'Miscellaneous' },
];

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
    await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_TAGS, null, 2));
  }
}

async function readTags(): Promise<Tag[]> {
  await ensureDataFile();
  const data = await fs.readFile(DATA_FILE, 'utf-8');
  return JSON.parse(data);
}

async function writeTags(tags: Tag[]): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(tags, null, 2));
}

// GET - Public endpoint to fetch tags
export async function GET() {
  try {
    const tags = await readTags();
    return NextResponse.json(tags);
  } catch (error) {
    console.error('Error reading tags:', error);
    return NextResponse.json(DEFAULT_TAGS, { status: 200 });
  }
}

// POST - Protected endpoint to add a new tag
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;
  
  if (!password || authHeader !== `Bearer ${password}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const { value, label } = await request.json();
    
    if (!value || !label) {
      return NextResponse.json({ error: 'Value and label required' }, { status: 400 });
    }
    
    const tags = await readTags();
    
    // Check for duplicate value
    if (tags.some(t => t.value === value)) {
      return NextResponse.json({ error: 'Tag already exists' }, { status: 400 });
    }
    
    tags.push({ value, label });
    await writeTags(tags);
    
    return NextResponse.json({ success: true, tags });
  } catch (error) {
    console.error('Error adding tag:', error);
    return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 });
  }
}

// DELETE - Protected endpoint to remove a tag
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const password = process.env.EDIT_PASSWORD;
  
  if (!password || authHeader !== `Bearer ${password}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const { value } = await request.json();
    const tags = await readTags();
    const filtered = tags.filter(t => t.value !== value);
    
    if (filtered.length === tags.length) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    
    await writeTags(filtered);
    return NextResponse.json({ success: true, tags: filtered });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}
