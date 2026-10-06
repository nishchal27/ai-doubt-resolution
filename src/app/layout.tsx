import React from 'react';
import Link from 'next/link';
import '../styles/globals.css';

export const metadata = {
  title: 'AI Doubt Solver',
  description: 'A lesson-specific AI-powered doubt solver (foundation)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body className="min-h-screen bg-gray-50 text-slate-900 antialiased">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <header className="py-6 flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold">
              AI Doubt Solver
            </Link>
            <nav className="space-x-4 text-sm text-slate-700">
              <Link href="/lessons" className="hover:underline">
                Lessons
              </Link>
            </nav>
          </header>

          <main className="pb-12">{children}</main>

          <footer className="py-8 text-center text-sm text-slate-500">
            © {new Date().getFullYear()} AI Doubt Solver — Foundation
          </footer>
        </div>
      </body>
    </html>
  );
}
