import { prisma } from '../prisma';
import { generateAnswer, ConversationMessage, AnswerResult } from '../ai/answer';

const MAX_HISTORY_MESSAGES = 6; // bounded history to pass to generator

export type ConversationSummary = {
  id: string;
  lessonId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Helper to detect application-level errors we want to propagate to the API layer as-is
function isAppError(err: any) {
  if (!err || !err.message) return false;
  const msg = String(err.message || '').toLowerCase();
  const safeSubstrings = [
    'not found',
    'required',
    'empty',
    'mismatch',
    'attempted to attach',
    'referenced content chunk',
    'question is empty',
    'failed to persist user message',
    'failed to generate answer',
    'openrouter',
  ];
  return safeSubstrings.some((s) => msg.includes(s));
}

export async function createConversation(lessonId: string) {
  if (!lessonId) throw new Error('lessonId is required');
  // Verify lesson exists
  let lesson;
  try {
    lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
  if (!lesson) throw new Error('Lesson not found');

  try {
    const conv = await prisma.conversation.create({ data: { lessonId } });
    return conv;
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
}

export async function getConversation(conversationId: string) {
  if (!conversationId) throw new Error('conversationId is required');
  let conv;
  try {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
  if (!conv) throw new Error('Conversation not found');
  return conv;
}

export async function listConversations(lessonId: string) {
  if (!lessonId) throw new Error('lessonId is required');
  try {
    const convs = await prisma.conversation.findMany({ where: { lessonId }, orderBy: { updatedAt: 'desc' } });
    return convs as ConversationSummary[];
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  sources?: Array<{
    contentChunkId: string;
    sourceType: string;
    sourceReference?: string | null;
    excerpt?: string | null;
  }>
) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!content || !content.toString().trim()) throw new Error('content is empty');

  // Verify conversation exists
  let conv;
  try {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
  if (!conv) throw new Error('Conversation not found');

  // Create message and optional sources in a transaction
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const message = await tx.message.create({ data: { conversationId, role, content } });

      if (role === 'assistant' && sources && sources.length) {
        for (const s of sources) {
          // Ensure the contentChunk belongs to the same lesson
          const chunk = await tx.contentChunk.findUnique({ where: { id: s.contentChunkId } });
          if (!chunk) throw new Error('Referenced content chunk not found: ' + s.contentChunkId);
          if (chunk.lessonId !== conv.lessonId) throw new Error('Content chunk lesson mismatch');

          await tx.messageSource.create({
            data: {
              messageId: message.id,
              contentChunkId: s.contentChunkId,
              sourceType: s.sourceType || 'unknown',
              sourceReference: s.sourceReference ?? null,
              excerpt: s.excerpt ?? null,
            },
          });
        }
      }

      return message;
    });

  return result;
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
}

export async function getConversationMessages(conversationId: string) {
  if (!conversationId) throw new Error('conversationId is required');
  // Verify conversation exists
  let conv;
  try {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
  if (!conv) throw new Error('Conversation not found');

  // Only select the minimal contentChunk fields needed and ensure lesson isolation
  let messages;
  try {
    messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { sources: { include: { contentChunk: { select: { id: true, lessonId: true, chunkIndex: true, metadata: true, sourceReference: true } } } } },
    });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }

  // Enforce lesson scoping: strip any sources that do not belong to the conversation's lesson (defense-in-depth)
  const sanitized = messages.map((m: any) => {
    const safeSources = (m.sources || []).filter((s: any) => s.contentChunk && s.contentChunk.lessonId === conv.lessonId).map((s: any) => ({
      id: s.id,
      page: s.contentChunk?.metadata?.page ?? s.contentChunk?.chunkIndex ?? null,
      sourceReference: s.sourceReference,
      excerpt: s.excerpt,
    }));

    return {
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      sources: safeSources,
    };
  });

  return sanitized;
}

export async function answerConversationMessage({ conversationId, question }: { conversationId: string; question: string; }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!question || !question.toString().trim()) throw new Error('question is empty');

  // Load conversation and lesson
  let conv;
  try {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
  if (!conv) throw new Error('Conversation not found');
  const lessonId = conv.lessonId;

  // Load bounded history (most recent messages) BEFORE saving the current user message.
  // This ensures the history passed to the answer generator does NOT include the current question.
  let recentMessages;
  try {
    recentMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }

  // Convert to history format for generateAnswer (reverse to chronological)
  const history: ConversationMessage[] = recentMessages.reverse().map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  // Now persist the current user message so we keep conversation state consistent.
  let userMessage;
  try {
    userMessage = await prisma.message.create({ data: { conversationId, role: 'user', content: question } });
  } catch (err: any) {
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }

  // Development logging: show which user message will be used for follow-up composition (most recent prior user)
  try {
    if (process.env.NODE_ENV !== 'production') {
      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      console.log('[DEV] answerConversationMessage — question:', question);
      console.log('[DEV] answerConversationMessage — most recent prior user message:', lastUser?.content ?? null);
    }
  } catch (e) {
    // ignore logging errors
  }

  // Call phase 5 generateAnswer with lesson-scoped retrieval and history (history does NOT include current question)
  let answerResult: AnswerResult;
  try {
    answerResult = await generateAnswer({ lessonId, question, history, limit: 6 });
  } catch (err: any) {
    // Cleanup: remove user message to avoid half-created state
    try {
      await prisma.message.delete({ where: { id: userMessage.id } });
    } catch (e) {
      // ignored
    }
    // Propagate safe error or generic
    if (isAppError(err)) throw err;
    throw new Error('Failed to generate answer');
  }

  // Persist assistant message and sources
  try {
    const assistant = await prisma.$transaction(async (tx: any) => {
      const assistantMessage = await tx.message.create({ data: { conversationId, role: 'assistant', content: answerResult.answer } });

      // If answerResult indicates unavailable, do not create sources
      if (answerResult.answer === 'This information is not available in the provided learning material.') {
        return assistantMessage;
      }

      // Create MessageSource records from answerResult.sources
      if (answerResult.sources && answerResult.sources.length) {
        for (const s of answerResult.sources) {
          // Validate chunk belongs to same lesson
          const chunk = await tx.contentChunk.findUnique({ where: { id: s.id } });
          if (!chunk) {
            // skip silently or throw — choose to throw to avoid inconsistent state
            throw new Error('Referenced content chunk not found when saving sources');
          }
          if (chunk.lessonId !== lessonId) {
            throw new Error('Attempted to attach source from a different lesson');
          }

          await tx.messageSource.create({
            data: {
              messageId: assistantMessage.id,
              contentChunkId: s.id,
              sourceType: chunk.sourceType || 'unknown',
              sourceReference: s.sourceReference ?? null,
              excerpt: s.excerpt ?? null,
            },
          });
        }
      }

      return assistantMessage;
    });

    return { answer: answerResult.answer, assistantMessageId: assistant.id, sources: answerResult.sources };
  } catch (err: any) {
    // On DB failure, attempt to rollback assistant creation; we cannot rollback external API call
    if (isAppError(err)) throw err;
    throw new Error('Database error');
  }
}

export default {
  createConversation,
  getConversation,
  listConversations,
  addMessage,
  getConversationMessages,
  answerConversationMessage,
};
