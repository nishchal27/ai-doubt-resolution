'use client';
import React from 'react';
import SourceReference from './source-reference';

export default function ChatMessage({ message }: { message: any }) {
  const isUser = message.role === 'user';
  return (
    <div className={`mb-4 ${isUser ? 'text-right' : 'text-left'}`}>
      <div className={`${isUser ? 'inline-block bg-sky-100 text-sky-900' : 'inline-block bg-slate-100 text-slate-900'} p-3 rounded-md max-w-full` }>
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        {!isUser && message.sources && message.sources.length ? (
          <div className="mt-2">
            {message.sources.map((s: any) => (
              <SourceReference key={s.id} source={{ page: s.page, sourceReference: s.sourceReference, excerpt: s.excerpt }} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="text-xs text-slate-500 mt-1">{new Date(message.createdAt).toLocaleString()}</div>
    </div>
  );
}