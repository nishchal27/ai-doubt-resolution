import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-12">
      <h1 className="text-3xl font-extrabold mb-4">Page not found</h1>
      <p className="text-slate-700 mb-6">The page you're looking for does not exist.</p>
      <Link href="/" className="inline-block rounded-md bg-slate-900 text-white px-4 py-2 text-sm hover:opacity-90">
        Go home
      </Link>
    </div>
  );
}
