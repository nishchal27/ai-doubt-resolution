import { NextResponse } from 'next/server';
import { getConversationMessages, answerConversationMessage } from '@/lib/conversations/service';

export async function GET(req: Request, { params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  if (!conversationId) return NextResponse.json({ message: 'conversationId required' }, { status: 400 });
  try {
    const messages = await getConversationMessages(conversationId);
    // Map messages to a safe shape
    const safe = messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, sources: m.sources.map((s: any) => ({ id: s.id, page: s.contentChunk?.metadata?.page ?? s.contentChunk?.chunkIndex ?? null, sourceReference: s.sourceReference, excerpt: s.excerpt })) }));
    return NextResponse.json({ messages: safe });
  } catch (err: any) {
    console.error('GET messages error', err);
    return NextResponse.json({ message: 'Conversation not found' }, { status: 404 });
  }
}

export async function POST(req: Request, { params }: { params: { conversationId: string } }) {
  const { conversationId } = params;
  if (!conversationId) return NextResponse.json({ message: 'conversationId required' }, { status: 400 });
  try {
    const body = await req.json();
    const question = body?.question;
    if (!question || !question.toString().trim()) return NextResponse.json({ message: 'question is required' }, { status: 400 });

    const result = await answerConversationMessage({ conversationId, question });

    // Return answer and sources in a safe shape
    return NextResponse.json({ answer: result.answer, assistantMessageId: result.assistantMessageId, sources: result.sources });
  } catch (err: any) {
    console.error('POST message error', err?.message || err);
    // Map known text to 400/404/502
    const msg = String(err?.message || '');
    if (msg.includes('Conversation not found')) return NextResponse.json({ message: 'Conversation not found' }, { status: 404 });
    if (msg.includes('question is empty') || msg.includes('Question is empty')) return NextResponse.json({ message: 'question is required' }, { status: 400 });
    if (msg.includes('OpenRouter')) return NextResponse.json({ message: 'AI service unavailable' }, { status: 502 });

    return NextResponse.json({ message: 'Unable to generate answer' }, { status: 500 });
  }
}