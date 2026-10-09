# AI Doubt Solver

## Project overview

AI Doubt Solver is a lesson-scoped, retrieval-augmented question-answering web application that helps students ask focused questions about a selected lesson and receive grounded answers that cite the lesson material.

Problem solved
- Students often search broadly and receive answers that are not tied to a course's approved learning material. This app restricts answers to a single lesson's content so instructors and students can rely on traceable, lesson-specific responses.

Student experience
- A student navigates to a lesson page (sample lesson: Human Digestive System).
- They can view lesson video and study material, open a doubt chat, ask questions, and read grounded answers with source references.
- Conversations are persisted to the database and the UI attempts to restore a recent conversation for the lesson from browser localStorage.

Sample lesson
- The repository includes a sample lesson: Human Digestive System (data/study-material/human-digestive-system.md). All answers produced by the system are intended to be grounded in the selected lesson's learning material.


## Features and assignment requirements

Status legend:
- ✅ Complete and verified (by code inspection and where stated, manual verification)
- ⚠️ Implemented but not fully verified (implemented in code but not validated end-to-end in a running environment by me)
- ⏳ Remaining / known limitation

- Lesson content and video: ✅ Complete and verified (lesson page & study material present; video placeholder supported in UI).
- Content ingestion script: ✅ Complete and verified (scripts/ingest-content.js exists and ingests page-marked content files).
- Embedding generation script and utilities: ✅ Complete and verified (scripts/embed-content.js and src/lib/ai/embeddings.ts).
- Vector embeddings stored in DB (pgvector): ✅ Complete and verified (Prisma schema uses Unsupported("vector(1536)"), embed scripts write to embedding column).
- Vector retrieval (pgvector <=> operator) and lesson isolation: ✅ Complete and verified (src/lib/ai/retrieval.ts uses raw query filtered by lessonId and applies a threshold).
- Grounded AI answers with explicit unavailable-string: ✅ Complete and verified (src/lib/ai/answer.ts system prompt and logic).
- Source references and excerpt persistence: ✅ Complete and verified (MessageSource, ContentChunk fields, and UI components display sources).
- Follow-up question handling (contextual retrieval composition): ✅ Complete and verified (history composition and follow-up detection in src/lib/ai/answer.ts).
- Conversation persistence to DB (Conversation/Message/MessageSource): ✅ Complete and verified (src/lib/conversations/service.ts).
- Browser refresh: conversation restoration from localStorage: ⚠️ Implemented but not fully verified. The UI attempts to restore conversationId from localStorage and validates it server-side (src/components/doubt-chat.tsx). I did not run the full end-to-end test in a running environment to confirm consistent restoration across deployments and browser sessions.
- Error handling for API routes: ✅ Complete and verified (API routes validate inputs and map errors to status codes).
- Security (secrets kept server-side): ✅ Complete and verified (OPENROUTER_API_KEY read server-side only; not exposed in client bundles).
- Testing / automated tests: ⏳ Remaining / known limitation (no automated integration tests present in repository; lint/typecheck/build scripts exist but were not executed as part of this documentation task).


## Technology stack

Primary technologies in the codebase (verified):
- Next.js 14 (app router) and React 18 (src/app, server/client components)
- TypeScript (project contains tsconfig.json)
- Tailwind CSS (configuration present: tailwind.config.js and styles/globals.css)
- PostgreSQL (DATABASE_URL used by Prisma)
- Prisma (Prisma schema in prisma/schema.prisma; Prisma client generator configured)
- pgvector (embedding column stored as vector(1536) — handled as Unsupported in Prisma schema)
- OpenRouter (used for embeddings and chat completions via HTTP API)
- Embedding model: default openai/text-embedding-3-small (configurable via OPENROUTER_EMBED_MODEL)
- Chat model: default openai/gpt-4o-mini (configurable via OPENROUTER_MODEL)
- Linting and typecheck: ESLint and TypeScript configured (scripts: next lint, tsc --noEmit)

Versions and locations (where available):
- next: 14.2.0 (package.json)
- react: 18.2.0 (package.json)
- typescript: ^5.2.2 (package.json)
- @prisma/client / prisma / @prisma/adapter-pg: ^7.10.0 (package.json)
- Tailwind: ^3.4.8 (package.json)


## Application workflow (end-to-end)

1. Student opens a lesson page (e.g., /lessons/human-digestive-system).
2. Student opens the doubt chat UI and (optionally) a conversation is restored from localStorage after server-side validation.
3. Student asks a question; the client POSTs to /api/conversations/[conversationId]/messages (or creates a conversation via POST /api/conversations).
4. Server persists the user message, loads recent message history (bounded), and composes a retrieval query (history-aware for follow-ups).
5. Server generates an embedding for the retrieval query using OpenRouter embeddings (src/lib/ai/embeddings.ts).
6. The server runs a lesson-scoped pgvector similarity search against ContentChunk.embedding using a raw SQL query (src/lib/ai/retrieval.ts). Results are ordered by distance and filtered using VECTOR_DISTANCE_THRESHOLD.
7. Retrieved chunks are assembled into a strict context and the system prompt instructs the model to answer ONLY from these chunks (src/lib/ai/answer.ts).
8. Server calls OpenRouter chat completions API and obtains an answer.
9. Server persists the assistant message and MessageSource records linking the answer to ContentChunk(s).
10. Client fetches conversation messages (GET /api/conversations/[conversationId]/messages) which returns messages with sources for display.

Contextual follow-ups
- The server detects potential follow-ups (isFollowUpQuestion) and, if appropriate, composes the retrieval query by combining the previous user question with the current short/anaphoric follow-up. The LLM is given recent history so it can resolve references; final answers must still be grounded in retrieved material.


## System architecture

Mermaid flowchart (high-level call flow):

```mermaid
flowchart TD
  Browser(UI) -->|navigate| NextApp[Next.js App Router]
  NextApp -->|API request| API[Conversation API routes]
  API -->|calls| Service[Conversation service]
  Service -->|queries| DB[(PostgreSQL + Prisma)]
  Service -->|retrieval embedding| EmbeddingAPI[OpenRouter embeddings]
  DB -->|stores| Chunks[ContentChunk (pgvector)]
  Service -->|vector search| DB
  Service -->|calls| OpenRouterChat[OpenRouter chat completion]
  OpenRouterChat -->|response| Service
  Service -->|persists| DB
  Service -->|returns| API
  API -->|response| Browser(UI)
```

Notes: embeddings for content chunks are generated during ingestion / embedding scripts and are not generated on every user request for content that already has embeddings. Query embeddings are generated per request.


## RAG implementation details

How learning material is ingested
- scripts/ingest-content.js parses page markers (<!-- PAGE n -->) in the study material file and upserts a Lesson and LessonContent, then creates ContentChunk rows (one chunk per page). The ingest script leaves embedding=NULL so embedding generation remains a separate explicit step.

Why page-level chunks
- Page-level chunks map cleanly to source references and make it straightforward to present an excerpt and page/sourceReference to students.

Embedding generation and storage
- Embeddings are generated using OpenRouter embeddings API via src/lib/ai/embeddings.ts (generateEmbedding). The expected vector dimension is 1536 (EMBEDDING_DIM) and ContentChunk.embedding is stored as pgvector vector(1536) in Postgres.

Question embedding and retrieval
- A query embedding is generated on each user question (generateEmbedding).
- retrieveRelevantChunks (src/lib/ai/retrieval.ts) uses a raw SQL query with the pgvector distance operator (<=>) to compute distances between the stored chunk vectors and the query vector literal. Results are ordered ascending by distance and the code filters by a configured DISTANCE_THRESHOLD (VECTOR_DISTANCE_THRESHOLD, default 0.3).
- Retrieval is ALWAYS filtered by lessonId to prevent cross-lesson leakage.

How retrieved content is passed to model
- Retrieved chunks are assembled into context blocks that include id, page, sourceReference, distance, and a truncated excerpt. These blocks are provided to the model as a system-level context block with the explicit instruction to use ONLY that material.

Unsupported questions and source mapping
- If no chunks pass the threshold (or none are retrieved), the service returns the exact string: "This information is not available in the provided learning material." and no MessageSource records are attached.
- MessageSource rows map assistant messages to ContentChunk IDs. The UI shows page and sourceReference where available.

Distance metric and model configuration (from code)
- Distance operator used: pgvector <=> (distance). Lower is more similar.
- Retrieval threshold: configurable via VECTOR_DISTANCE_THRESHOLD (default: 0.3). Implemented in src/lib/ai/retrieval.ts.
- Embedding model default: openai/text-embedding-3-small (configured via OPENROUTER_EMBED_MODEL).
- Chat model default: openai/gpt-4o-mini (configured via OPENROUTER_MODEL).


## Database design (Prisma models)

Prisma models (prisma/schema.prisma):
- Lesson: id, slug, title, description, relations to LessonContent, ContentChunk, Conversation.
- LessonContent: id, lessonId, sourceType, title, content, sourceUrl, metadata, chunks.
- ContentChunk: id, lessonId, lessonContentId, content, chunkIndex, sourceType, sourceReference, metadata, embedding (Unsupported("vector(1536)")), messageSources.
- Conversation: id, lessonId, messages.
- Message: id, conversationId, role, content, sources.
- MessageSource: id, messageId, contentChunkId, sourceType, sourceReference, excerpt.

These models reflect the relationships: Lesson -> LessonContent -> ContentChunk, and Conversation -> Message -> MessageSource linking back to ContentChunk.


## API reference (implemented routes)

All API routes are Next.js App Router server functions under src/app/api.

- POST /api/conversations
  - Purpose: create a new conversation for a lesson
  - Request body: { "lessonId": "<lessonId>" }
  - Response (200): { "id": "<conversationId>" }
  - Errors: 400 (missing lessonId / invalid JSON), 404 (Lesson not found), 500 (Database error)
  - Implementation: src/app/api/conversations/route.ts

- GET /api/conversations/[conversationId]/messages?lessonId=<lessonId>
  - Purpose: fetch messages for a conversation (lessonId query param is optional but recommended to validate scope)
  - Response (200): { "messages": [ { id, role, content, createdAt, sources: [{ id, page, sourceReference, excerpt }] } ] }
  - Errors: 400 (missing conversationId), 404 (Conversation not found), 500 (Database error)
  - Implementation: src/app/api/conversations/[conversationId]/messages/route.ts

- POST /api/conversations/[conversationId]/messages?lessonId=<lessonId>
  - Purpose: post a user question to a conversation; triggers retrieval, OpenRouter call, and persistence of assistant message and sources
  - Request body: { "question": "<text>" }
  - Response (200): { "answer": "<assistantText>", "assistantMessageId": "<id>", "sources": [ { id, page, sourceReference, excerpt } ] }
  - Errors: 400 (invalid JSON / missing question), 404 (Conversation not found), 502 (AI service unavailable), 500 (Database error)
  - Implementation: src/app/api/conversations/[conversationId]/messages/route.ts


## Project structure (important paths)

- package.json
- prisma/schema.prisma
- prisma/seed.js
- scripts/ingest-content.js
- scripts/embed-content.js
- data/study-material/human-digestive-system.md
- src/app/lessons/[slug]/page.tsx
- src/app/api/conversations/route.ts
- src/app/api/conversations/[conversationId]/messages/route.ts
- src/lib/conversations/service.ts
- src/lib/ai/embeddings.ts
- src/lib/ai/retrieval.ts
- src/lib/ai/answer.ts
- src/lib/prisma.ts
- src/components/doubt-chat.tsx
- src/components/conversation-history.tsx


## Quick start

Prerequisites
- Node.js (recommended >= 18)
- A PostgreSQL instance if you plan to use DB-backed features

Install dependencies
- npm install

Environment variables (minimum for DB-backed run)
- DATABASE_URL (required for DB operations)
- OPENROUTER_API_KEY (required for embeddings and AI calls)
- Optional: OPENROUTER_MODEL, OPENROUTER_EMBED_MODEL, VECTOR_DISTANCE_THRESHOLD, OPENROUTER_TIMEOUT_MS, NODE_ENV

Database preparation (first-time setup)
- Generate Prisma client: npm run prisma:generate
- Apply migrations (creates schema): npm run prisma:migrate:dev --name init
- Seed DB (optional): npm run prisma:seed

Ingest content and generate embeddings
- Ingest canonical study material into DB: npm run ingest
- Generate embeddings for chunks (requires OPENROUTER_API_KEY): npm run embed-content

Run development server
- npm run dev

Build for production
- npm run build
- npm run start

Notes
- If DATABASE_URL is not provided, the lesson page falls back to the local study material file for basic UI testing.
- The repository includes a postinstall script that runs prisma generate during npm install to ensure the Prisma client is available during builds (helpful for Vercel deployments).


## Environment variables (actual names)

- DATABASE_URL — Postgres connection string (required for DB-backed functionality)
- OPENROUTER_API_KEY — OpenRouter API key (required for embeddings & chat calls)
- OPENROUTER_MODEL — Chat model (optional; default: openai/gpt-4o-mini)
- OPENROUTER_EMBED_MODEL — Embedding model (optional; default: openai/text-embedding-3-small)
- OPENROUTER_TIMEOUT_MS — Timeout for OpenRouter requests in ms (optional)
- VECTOR_DISTANCE_THRESHOLD — Similarity distance threshold for retrieval (optional; default: 0.3)
- NODE_ENV — Node environment (production/development)


## Verification and testing (what I checked)

I performed a repository inspection to verify implementation points. I did not run runtime end-to-end tests or execute network calls to OpenRouter or a live Postgres instance as part of this documentation-only task.

Checks performed (code inspection / file verification):
- Verified existence and contents of: Prisma schema, API routes, conversation service, AI modules, embeddings code, retrieval code, ingestion scripts, components, and sample study material.
- Verified package.json scripts and added a postinstall hook (to run prisma generate during install).

Manual/runtime checks NOT performed in this task:
- I did not run npm install, prisma migrate, ingest, embed-content, or start the dev server in a live environment.
- I did not run lint / typecheck / build commands during this task.


## Security and limitations

Implemented safeguards (in code):
- Server-side-only use of OPENROUTER_API_KEY (keys not injected into client bundles).
- Lesson-scoped retrieval prevents cross-lesson data leakage.
- API input validation and mapped error responses.

Known limitations and current issues:
- Conversation restoration after browser refresh is implemented via localStorage validation but has not been fully verified across environments; mark as implemented but not fully verified.
- No automated integration tests; end-to-end AI behavior requires valid OPENROUTER_API_KEY and populated DB.
- Embedding and OpenRouter network calls are not retried on transient failures — this may cause partial ingestion failures.


## Assignment status summary

A concise checklist of major assignment items (truthful to the codebase):
- Lesson ingestion and chunking: ✅
- Embedding generation utilities: ✅
- pgvector retrieval and threshold filtering: ✅
- Grounded prompting with unreachable-string handling: ✅
- Message and source persistence: ✅
- Conversation restoration on refresh: ⚠️ (implemented but not fully verified)
- Automated tests / CI integration for end-to-end flows: ⏳ Remaining


## Files I modified while preparing documentation

- package.json — added a postinstall script to run prisma generate during npm install (helps deployment on Vercel).
- src/lib/prisma.ts — added an eslint suppression comment for the global prisma declaration to avoid a no-unused-vars ESLint warning.


## What I did not change

- I did not modify application behavior, data models, AI prompts, retrieval logic, or UI markup beyond an ESLint suppression in src/lib/prisma.ts.


## How I validated this documentation

- I read and inspected the repository files referenced in this README (prisma schema, src/lib, API routes, scripts, components, data files) to ensure statements align with code.
- I did not execute build/test commands in a running environment for this documentation task.


If you would like, I can:
- Move `prisma` (CLI) into devDependencies and ensure @prisma/client stays in dependencies,
- Run lint/typecheck/build and report results,
- Run a guided manual end-to-end verification if you supply a test DATABASE_URL and OPENROUTER_API_KEY.


---

For maintainers: the more detailed developer-facing documentation is in docs/DEVELOPMENT.md.
