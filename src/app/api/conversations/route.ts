import { NextResponse } from 'next/server';
import { createConversation } from '@/lib/conversations/service';

export async function POST(req: Request) {
  // Parse body safely and reject malformed JSON
  let body: any;
  try {
    body = await req.json();
  } catch (err: any) {
    console.error('API /api/conversations error parsing JSON');
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const lessonId = body?.lessonId?.toString().trim();
    if (!lessonId) {
      return NextResponse.json({ message: 'lessonId is required' }, { status: 400 });
    }

    // createConversation will validate lesson existence using the DB layer.
    const conv = await createConversation(lessonId);
    return NextResponse.json({ id: conv.id });
  } catch (err: any) {
    // Server-side logging (do not expose stack or internals to clients)
    console.error('API /api/conversations error', err?.message || err);
    const msg = String(err?.message || '');
    if (msg.includes('Lesson not found')) return NextResponse.json({ message: 'Lesson not found' }, { status: 404 });
    if (msg.includes('Database error')) return NextResponse.json({ message: 'Database error' }, { status: 500 });
    return NextResponse.json({ message: 'Unable to create conversation' }, { status: 500 });
  }
}