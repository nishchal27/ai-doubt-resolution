# AI Doubt Solver — Phase 1 (Foundation)

This repository contains the Phase 1 foundation for the AI Doubt Solver project.

Current state (truthful):

- Next.js App Router + TypeScript (strict mode enabled)
- Tailwind CSS configured
- ESLint configured with Next recommended rules
- Placeholder routes:
  - / (home)
  - /lessons (placeholder list)
  - /lessons/[slug] (placeholder detail page)
- Root-level not-found and error handling foundations
- .env.example present
- .gitignore present and ignores node_modules, .next, env files
- GitHub Actions CI workflow added (runs lint, typecheck, build)
- package.json scripts: dev, build, start, lint, typecheck

What is NOT included (intentionally, Phase 1):

- No database, Prisma, or PostgreSQL
- No vector DB / pgvector
- No OpenRouter / OpenAI integration
- No embeddings, RAG, chat, or ingestion logic
- No UI component library

How to validate locally:

1. Install dependencies: npm install
2. Run development server: npm run dev
3. Run lint: npm run lint
4. Run typecheck: npm run typecheck
5. Build: npm run build

Notes:
- Keep secrets out of the repo. Use .env.local for local environment variables.
- This README reflects the current project state (Phase 1) and will be updated as further phases are implemented.
