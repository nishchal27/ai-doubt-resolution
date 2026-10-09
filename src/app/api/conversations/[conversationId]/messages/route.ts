import { NextResponse } from 'next/server';
import { getConversationMessages, answerConversationMessage, getConversation } from '@/lib/conversations/service';

export async function GET(req: Request, { params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  if (!conversationId) return NextResponse.json({ message: 'conversationId required' }, { status: 400 });

  // Extract lessonId from query param to enforce lesson-scoped retrieval
  let url: URL;
  try {
    url = new URL(req.url);
  } catch (e) {
    url = new URL(req.headers.get('x-forwarded-host') ? `https://${req.headers.get('x-forwarded-host')}` : 'http://localhost');
  }
  const lessonId = url.searchParams.get('lessonId') || undefined;

  try {
    // If lessonId provided, ensure conversation belongs to that lesson
    if (lessonId) {
      const conv = await getConversation(conversationId);
      console.log('[chat-debug] GET messages validation conversationId=', conversationId, 'lessonIdParam=', lessonId, 'convLessonId=', conv?.lessonId ?? null);
      if (!conv || conv.lessonId !== lessonId) {
        console.log('[chat-debug] GET messages validation failed');
        return NextResponse.json({ message: 'Conversation not found' }, { status: 404 });
      }
    }

    const messages = await getConversationMessages(conversationId);
    console.log('[chat-debug] GET messages returning count=', messages?.length ?? null);
    // getConversationMessages now returns a sanitized shape: id, role, content, createdAt, sources
    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error('GET messages error', err?.message || err);
    const msg = String(err?.message || '');
    if (msg.includes('Conversation not found')) return NextResponse.json({ message: 'Conversation not found' }, { status: 404 });
    if (msg.includes('Database error')) return NextResponse.json({ message: 'Database error' }, { status: 500 });
    return NextResponse.json({ message: 'Unable to fetch messages' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  if (!conversationId) return NextResponse.json({ message: 'conversationId required' }, { status: 400 });
  // Parse JSON safely
  let body: any;
  try {
    body = await req.json();
  } catch (err: any) {
    console.error('POST message error parsing JSON');
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  // Extract lessonId from query param to enforce conversation scoping
  let url: URL;
  try {
    url = new URL(req.url);
  } catch (e) {
    url = new URL(req.headers.get('x-forwarded-host') ? `https://${req.headers.get('x-forwarded-host')}` : 'http://localhost');
  }
  const lessonId = url.searchParams.get('lessonId') || undefined;

  try {
    const question = body?.question?.toString();
    if (!question || !question.toString().trim()) return NextResponse.json({ message: 'question is required' }, { status: 400 });

    // If lessonId present, ensure conversation belongs to the same lesson
    if (lessonId) {
      const conv = await getConversation(conversationId);
      if (!conv || conv.lessonId !== lessonId) {
        return NextResponse.json({ message: 'Conversation not found' }, { status: 404 });
      }
    }

    const result = await answerConversationMessage({ conversationId, question });

    // Return answer and sources in a safe shape (strip any provider/internal fields)
    const safeSources = (result.sources || []).map((s: any) => ({ id: s.id, page: s.page ?? null, sourceReference: s.sourceReference ?? null, excerpt: s.excerpt ?? null }));

    return NextResponse.json({ answer: result.answer, assistantMessageId: result.assistantMessageId, sources: safeSources });
  } catch (err: any) {
    console.error('POST message error', err?.message || err);
    // Map known text to 400/404/502
    const msg = String(err?.message || '');
    if (msg.includes('Conversation not found')) return NextResponse.json({ message: 'Conversation not found' }, { status: 404 });
    if (msg.includes('question is empty') || msg.includes('Question is empty')) return NextResponse.json({ message: 'question is required' }, { status: 400 });
    if (msg.includes('OpenRouter')) return NextResponse.json({ message: 'AI service unavailable' }, { status: 502 });
    if (msg.includes('Database error')) return NextResponse.json({ message: 'Database error' }, { status: 500 });

    return NextResponse.json({ message: 'Unable to generate answer' }, { status: 500 });
  }
}