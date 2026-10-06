import { NextResponse } from 'next/server';
import { createConversation } from '@/lib/conversations/service';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const lessonId = body?.lessonId;
    if (!lessonId) {
      return NextResponse.json({ message: 'lessonId is required' }, { status: 400 });
    }

    // createConversation will validate lesson existence using the DB layer.
    const conv = await createConversation(lessonId);
    return NextResponse.json({ id: conv.id });
  } catch (err: any) {
    console.error('API /api/conversations error', err?.message || err);
    const msg = String(err?.message || '');
    if (msg.includes('Lesson not found')) return NextResponse.json({ message: 'Lesson not found' }, { status: 404 });
    return NextResponse.json({ message: 'Unable to create conversation' }, { status: 500 });
  }
}