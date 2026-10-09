'use client';
import React, { useEffect, useState } from 'react';
import ChatMessage from './chat-message';

export default function ConversationHistory({ conversationId, lessonId }: { conversationId: string | null, lessonId: string }) {
  const [messages, setMessages] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[chat-debug] ConversationHistory mount/prop change conversationId=', conversationId, 'lessonId=', lessonId);
    if (!conversationId) return;
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages?lessonId=${encodeURIComponent(lessonId)}`);
        console.log('[chat-debug] ConversationHistory fetch status', res.status);
        if (!res.ok) throw new Error('Failed to load messages');
        const data = await res.json();
        console.log('[chat-debug] ConversationHistory fetched messages count=', data?.messages?.length ?? null);
        if (!mounted) return;
        setMessages(data.messages || []);
      } catch (err: any) {
        console.error('[chat-debug] ConversationHistory load error', err?.message || err);
        setError('Unable to load conversation history.');
      } finally {
        setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 5000); // poll for updates
    return () => { mounted = false; clearInterval(iv); };
  }, [conversationId, lessonId]);

  if (!conversationId) return <div className="text-sm text-slate-600">No conversation selected.</div>;
  if (loading && !messages) return <div className="text-sm text-slate-600">Loading conversation...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!messages || messages.length === 0) return <div className="text-sm text-slate-600">No messages yet. Ask a question to start the conversation.</div>;

  return (
    <div>
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
    </div>
  );
}