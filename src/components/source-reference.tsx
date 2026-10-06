'use client';
import React from 'react';

export default function SourceReference({ source }: { source: { page?: number | string | null; sourceReference?: string | null; excerpt?: string | null } }) {
  return (
    <div className="mt-2 border-l-4 border-slate-200 bg-slate-50 p-3 rounded-md">
      <div className="text-xs text-slate-600">Source{source.page ? ` — page ${source.page}` : ''}{source.sourceReference ? ` • ${source.sourceReference}` : ''}</div>
      {source.excerpt ? <div className="mt-1 text-sm text-slate-700">"{source.excerpt}"</div> : null}
    </div>
  );
}