import { NextRequest, NextResponse } from 'next/server';

// POST - Verify password
export async function POST(request: NextRequest) {
  const password = process.env.EDIT_PASSWORD;
  
  if (!password) {
    return NextResponse.json(
      { error: 'Server not configured for editing' },
      { status: 500 }
    );
  }
  
  try {
    const { password: inputPassword } = await request.json();
    
    if (inputPassword === password) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
