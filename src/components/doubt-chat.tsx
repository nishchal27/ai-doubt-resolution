'use client';
import React, { useState, useRef, useEffect } from 'react';
import ConversationHistory from './conversation-history';

export default function DoubtChat({ lessonId }: { lessonId: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Local storage key scoped to lesson
  const storageKey = `conversationId:${lessonId}`;

  // On mount (or when lessonId changes), attempt to restore a persisted conversation id for this lesson
  useEffect(() => {
    let mounted = true;
    async function restore() {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
        console.log('[chat-debug] restore attempt, storageKey=', storageKey, ' storedId=', stored ?? null);
        if (!stored) return;
        // Verify the stored conversation belongs to this lesson by attempting to load its messages with lessonId param
        const res = await fetch(`/api/conversations/${stored}/messages?lessonId=${encodeURIComponent(lessonId)}`);
        console.log('[chat-debug] restore GET status', res.status);
        if (!mounted) return;
        if (res.ok) {
          try {
            const data = await res.json().catch(() => null);
            const count = data?.messages?.length ?? null;
            console.log('[chat-debug] restore GET messages count=', count);
          } catch (e) {
            console.log('[chat-debug] restore GET parse error');
          }
          setConversationId(stored);
          console.log('[chat-debug] restored conversationId set in state=', stored);
        } else {
          // Invalid or mismatched conversation - remove from storage
          console.log('[chat-debug] stored conversation invalid for this lesson, removing');
          try { window.localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        // On network or other errors, leave state alone (do not clear storage) so user can retry
        console.error('[chat-debug] failed to restore conversation', e);
      }
    }
    restore();
    return () => { mounted = false; };
  }, [lessonId, storageKey]);

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<any | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  async function ensureConversation() {
    if (conversationId) return conversationId;
    console.log('[chat-debug] ensureConversation: no conversationId, creating new for lesson', lessonId);
    const res = await fetch('/api/conversations', { method: 'POST', body: JSON.stringify({ lessonId }), headers: { 'Content-Type': 'application/json' } });
    console.log('[chat-debug] ensureConversation create status', res.status);
    if (!res.ok) {
      setError('Unable to start a conversation.');
      throw new Error('Conversation creation failed');
    }
    const data = await res.json();
    console.log('[chat-debug] ensureConversation created id=', data.id);
    setConversationId(data.id);
    // Persist active conversation id scoped to lesson
    try { window.localStorage.setItem(storageKey, data.id); console.log('[chat-debug] stored conversationId in localStorage', storageKey, data.id); } catch (e) { console.log('[chat-debug] failed to write localStorage', e); }
    return data.id;
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!question.trim()) {
      setError('Please enter a question.');
      return;
    }
    setLoading(true);
    try {
      const convId = await ensureConversation();
      const res = await fetch(`/api/conversations/${convId}/messages?lessonId=${encodeURIComponent(lessonId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      if (!res.ok) {
        if (res.status === 400) {
          const j = await res.json().catch(() => ({}));
          setError(j?.message || 'Bad request');
        } else if (res.status === 404) {
          setError('Conversation not found. Please refresh and try again.');
        } else {
          setError('Failed to get an answer from the AI service.');
        }
        setLoading(false);
        return;
      }
      const data = await res.json();
      setLastAnswer(data.answer ?? null);
      setQuestion('');

      // focus composer after submit
      if (textareaRef.current) textareaRef.current.focus();
    } catch (err) {
      setError('Network error while sending your question.');
      if (textareaRef.current) textareaRef.current.focus();
    } finally {
      setLoading(false);
    }
  }

  // Persist conversationId to localStorage whenever it changes (scoped to lesson)
  useEffect(() => {
    try {
      if (conversationId) {
        window.localStorage.setItem(storageKey, conversationId);
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [conversationId, storageKey]);

  // When conversation history updates, scroll the history container to bottom so latest messages are visible above composer.
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [lastAnswer, conversationId]);

  return (
    <section aria-labelledby="ask-doubt" className="mb-6">
      <h2 id="ask-doubt" className="text-lg font-semibold mb-2">Ask a Doubt</h2>

      <div className="bg-white p-3 rounded-md max-h-[60vh] flex flex-col">
        <h3 className="text-sm font-medium mb-2">Conversation History</h3>

        <div ref={historyRef} className="flex-grow overflow-auto flex flex-col">
          <ConversationHistory conversationId={conversationId} lessonId={lessonId} />

          {lastAnswer ? (
            <div className="mt-2 mb-2">
              <h3 className="text-sm font-medium">Latest Answer</h3>
              <div className="mt-2 bg-white p-3 rounded-md shadow-sm">
                <div className="whitespace-pre-wrap text-slate-800">{lastAnswer}</div>
              </div>
            </div>
      ) : null}

          {/* Composer placed inside the scrollable history container so scrolling to bottom shows composer */}
          <div className="mt-2">
            <form onSubmit={handleSubmit} className="bg-white pt-2">
              <label htmlFor="question" className="sr-only">Your question</label>
              <textarea
                id="question"
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Type your question about this lesson..."
                className="w-full p-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-400"
                rows={3}
                disabled={loading}
              />
              {error ? <div className="text-sm text-red-600 mt-2">{error}</div> : null}
              <div className="mt-2 flex items-center gap-2">
                <button type="submit" disabled={loading} className="px-4 py-2 bg-sky-600 text-white rounded-md disabled:opacity-50">
                  {loading ? 'Asking...' : 'Ask'}
                </button>
                <button type="button" onClick={() => { setQuestion(''); setError(null); if (textareaRef.current) textareaRef.current.focus(); }} className="px-3 py-2 border rounded-md">
                  Clear
                </button>
                {conversationId ? <div className="ml-auto text-xs text-slate-500">Conversation: {conversationId}</div> : null}
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}