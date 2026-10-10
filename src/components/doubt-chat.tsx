'use client';
import React, { useState, useRef, useEffect } from 'react';
import ConversationHistory from './conversation-history';

export default function DoubtChat({ lessonId }: { lessonId: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  // explicit initialization flag to avoid races with localStorage persistence
  const [isConversationInitialized, setIsConversationInitialized] = useState(false);

  // Local storage key scoped to lesson
  const storageKey = `conversationId:${lessonId}`;

  // On mount (initialization cycle) read localStorage exactly once and validate the stored id.
  useEffect(() => {
    let mounted = true;

    async function initializeFromStorage() {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
        // If nothing stored, mark initialization complete and do nothing
        if (!stored) {
          if (mounted) setIsConversationInitialized(true);
          return;
        }

        // Validate the stored conversation belongs to this lesson using the lesson-scoped GET endpoint
        let res: Response | null = null;
        try {
          res = await fetch(`/api/conversations/${stored}/messages?lessonId=${encodeURIComponent(lessonId)}`);
        } catch (err) {
          // Network/transient error: do not remove stored id; leave it for future attempts
          if (mounted) setIsConversationInitialized(true);
          return;
        }

        if (!mounted) return;

        if (res.ok) {
          // Valid conversation id, adopt into state
          setConversationId(stored);
        } else if (res.status === 404) {
          // Definitive not-found / mismatch: remove persisted id
          try { window.localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
        } else {
          // Other HTTP errors treated as transient: do not remove stored id
        }
      } finally {
        if (mounted) setIsConversationInitialized(true);
      }
    }

    initializeFromStorage();

    return () => { mounted = false; };
  // run only once per lessonId (initialization cycle)
  }, [lessonId, storageKey]);

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<any | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  async function ensureConversation() {
    if (!isConversationInitialized) {
      // Prevent creating new conversation while initialization is pending
      throw new Error('Initialization pending');
    }

    if (conversationId) return conversationId;
    
    const res = await fetch('/api/conversations', { method: 'POST', body: JSON.stringify({ lessonId }), headers: { 'Content-Type': 'application/json' } });
    
    if (!res.ok) {
      setError('Unable to start a conversation.');
      throw new Error('Conversation creation failed');
    }
    const data = await res.json();
    
    setConversationId(data.id);
    // Persist active conversation id scoped to lesson
    try { window.localStorage.setItem(storageKey, data.id);  } catch (e) { /* ignore storage errors */ }
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
  // Only run after initialization is complete to avoid overwriting/clearing a stored id during restore
  useEffect(() => {
    if (!isConversationInitialized) return;
    try {
      if (conversationId) {
        window.localStorage.setItem(storageKey, conversationId);
      } else {
        // Do not proactively remove the key here. Removal is handled explicitly only when a definitive not-found is observed.
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [conversationId, storageKey, isConversationInitialized]);

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
          {/* Only render ConversationHistory after initialization completes to avoid showing empty-state during restore */}
          {isConversationInitialized ? (
            <ConversationHistory conversationId={conversationId} lessonId={lessonId} />
          ) : (
            <div className="text-sm text-slate-600">Restoring conversation...</div>
          )}

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
                <button type="submit" disabled={loading || !isConversationInitialized} className="px-4 py-2 bg-sky-600 text-white rounded-md disabled:opacity-50">
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