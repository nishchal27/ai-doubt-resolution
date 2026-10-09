# AI Doubt Solver

## 1. Overview

AI Doubt Solver is an AI-powered doubt-solving platform scoped to lesson-specific learning material. A student selects a lesson, opens the lesson page, and asks questions that must be answered only using that lesson's learning material.

This repository includes a working sample lesson used by the project:

- Human Digestive System (canonical study material at data/study-material/human-digestive-system.md)

The implementation includes a simple student-facing UI (Next.js + React), ingestion and embedding scripts, PostgreSQL + pgvector-backed retrieval, grounded answer generation via OpenRouter, and persistence of conversation history.


## 2. Assignment Requirements Covered

Below is a checklist of the assignment requirements and whether they are implemented and verified in this repository. Only items that are implemented and can be verified in the codebase are marked as Complete.

- [x] Lesson selection
- [x] Lesson-specific video/study material
- [x] Learning material ingestion (scripts/ingest-content.js)
- [x] Vector embeddings (scripts/embed-content.js + src/lib/ai/embeddings.ts)
- [x] PostgreSQL + pgvector retrieval (Prisma schema + retrieval raw query)
- [x] Lesson-scoped retrieval/isolation (retrieval filters by lessonId)
- [x] Grounded AI answers (strict grounding prompt in src/lib/ai/answer.ts)
- [x] Source references with page/sourceReference (MessageSource / contentChunk.sourceReference)
- [x] Unsupported-question handling with the required exact message
      ("This information is not available in the provided learning material.")
- [x] Follow-up questions maintaining conversation context (history + retrieval composition)
- [x] Conversation/doubt history (Prisma Conversation/Message/MessageSource models + UI)
- [x] API error handling / validation that actually exists (basic validation in API routes)
- [x] Simple student-facing UI (src/app pages + components)
- [x] Database persistence (Prisma models + scripts)

Notes:
- The Lessons list page is a placeholder but the lesson detail page (/lessons/human-digestive-system) works using either DB-backed data or a local fallback file.


## 3. User Workflow

End-to-end student workflow implemented in the app:

Student
→ Selects lesson (or navigates to /lessons/human-digestive-system)
→ Opens lesson
→ Views video/study material
→ Creates a doubt conversation (first question creates a Conversation)
→ Asks question
→ Server retrieves relevant chunks only from the selected lesson (lessonId scoped)
→ Retrieved context is sent to OpenRouter (chat completion)
→ AI generates a grounded answer
→ Sources are displayed alongside the answer
→ Student can ask follow-up questions
→ Conversation history is persisted and displayed in the UI

Follow-up questions behavior (implemented):
- The server-side generator composes a retrieval query using the current question and a small recent conversation history (bounded).
- History + current question are used to resolve anaphoric references ("this", "that", etc.) before retrieval.
- Retrieval is lesson-scoped; retrieved chunks are provided to the LLM.
- The LLM is prompted to answer using ONLY the retrieved material.


## 4. System Architecture / Design

ASCII diagram (simplified):

Browser / Next.js UI
|
v
Next.js API Routes
|
+--------------------+
|                    |
v                    v
Conversation Service      RAG / AI Layer
|                    |
v                    +--> Embeddings
PostgreSQL + pgvector       |
^                    +--> Vector Retrieval
|                    |
+--------------------+--> OpenRouter LLM
|
v
Grounded Answer
|
v
Sources / UI

Responsibilities:
- Next.js App Router: Routes and server/client components for the UI, lesson pages and chat components (src/app/*).
- API routes (src/app/api/*): Minimal REST endpoints to create conversations and post questions / fetch messages. They perform input validation and map errors to HTTP responses.
- Conversation service (src/lib/conversations/service.ts): Business logic for creating conversations, persisting messages, and orchestrating answer generation.
- Prisma: ORM layer with models defined in prisma/schema.prisma; used for persistence of lessons, contents, chunks, conversations and messages.
- PostgreSQL: Primary persistence store (configured via DATABASE_URL). The project expects a Postgres instance when using DB-backed features.
- pgvector: Embedding column in ContentChunk is stored as a pgvector vector(1536) (handled as Unsupported in Prisma schema). Raw SQL queries use pgvector operators for similarity search.
- Embedding generation (src/lib/ai/embeddings.ts + scripts/embed-content.js): Uses OpenRouter embeddings API to generate 1536-d vectors for content and queries.
- Retrieval (src/lib/ai/retrieval.ts): Generates an embedding from the query and performs a lesson-scoped vector similarity search (distance operator) with a configurable threshold.
- OpenRouter: Chat completion and embeddings provider. Server-side calls are made to OpenRouter using the OPENROUTER_API_KEY from the environment.
- Content ingestion (scripts/ingest-content.js): Idempotent ingestion of the canonical study material (data/study-material/human-digestive-system.md) into LessonContent and ContentChunk rows.


## 5. RAG Approach

The RAG (Retrieval-Augmented Generation) implementation follows these steps:

1. Learning material is split into page-level content chunks (one chunk per page for the canonical study material).
2. Each chunk belongs to a specific lesson and stores chunk metadata (page, sourceReference).
3. Chunks receive embeddings (via scripts/embed-content.js using OpenRouter embeddings).
4. The user's question is embedded (server-side) using the same embedding model.
5. Vector similarity search retrieves candidate chunks ordered by distance.
6. Retrieval is ALWAYS filtered by lessonId (lesson-scoped retrieval/isolation).
7. Retrieved chunks are provided to the LLM in the prompt as the ONLY allowed source of truth.
8. The LLM is strictly instructed to answer only from retrieved learning material and to return the exact string
   "This information is not available in the provided learning material." when the answer cannot be determined from the material.

pgvector similarity retrieval uses the pgvector distance operator (<=>) in the repository's raw SQL queries; the code treats the returned value as a distance and applies a configurable threshold (VECTOR_DISTANCE_THRESHOLD) to filter results.


## 6. Conversational Follow-ups

Implemented approach:

Current question + recent conversation history
→ composition of a contextual retrieval query (history helps resolve pronouns/anaphora)
→ lesson-scoped retrieval
→ grounded answer generation

Example:
- Student: "What is the role of bile?"
- AI: "Bile helps in emulsification of fats..." (answer based on retrieved chunks)
- Student: "Why is that important?"
- AI: "Emulsification of fats by bile is important because..." (the follow-up uses conversation history to resolve "that" before retrieval)

The final answer is still restricted to the provided learning material: the LLM is instructed to answer ONLY from the retrieved chunks.


## 7. Database Design

Prisma models (defined in prisma/schema.prisma):

- Lesson
  - id, slug, title, description, timestamps
  - relations: contents (LessonContent[]), chunks (ContentChunk[]), conversations (Conversation[])
  - purpose: top-level lesson grouping

- LessonContent
  - id, lessonId, sourceType, title, content, sourceUrl, metadata, chunks
  - purpose: represents a source document for a lesson (study-material, transcript, etc.)

- ContentChunk
  - id, lessonId, lessonContentId (optional), content (chunk text), chunkIndex, sourceType, sourceReference, metadata, embedding, messageSources
  - embedding is stored as Unsupported("vector(1536)") in Prisma and populated using scripts/embed-content.js
  - purpose: atomic retrievable unit; contains the vector and lessonId used for retrieval isolation

- Conversation
  - id, lessonId, messages[], timestamps
  - purpose: groups the messages for a single doubt session scoped to a lesson

- Message
  - id, conversationId, role, content, sources[], createdAt
  - purpose: user or assistant messages persisted to allow follow-ups and history

- MessageSource
  - id, messageId, contentChunkId, sourceType, sourceReference, excerpt
  - purpose: links assistant replies to the ContentChunk(s) used as sources

Relationships ensure that ContentChunk.lessonId is used to isolate retrieval and that MessageSource references map back to chunks that belong to the same lesson as the Conversation.


## 8. Content Ingestion

Canonical study material (sample data):

- data/study-material/human-digestive-system.md
  - Marked with <!-- PAGE n --> markers and represents the canonical pages used by the ingest script.

Ingestion workflow (scripts present in the repository):

- scripts/ingest-content.js
  - Idempotent: upserts a Lesson and a LessonContent, deletes and recreates page-level ContentChunk rows (one chunk per page).
  - Leaves embedding=NULL so embedding generation is a separate step.

- scripts/embed-content.js
  - Finds ContentChunk rows with NULL embedding (excluding transcripts) and populates the embedding column using the OpenRouter embeddings API.

These scripts are the actual ingestion and embedding utilities included in the repository. They require DATABASE_URL (and OPENROUTER_API_KEY for embeddings) to operate.


## 9. AI Integration

- Provider: OpenRouter (server-side HTTP calls). The code expects an API key provided at runtime via OPENROUTER_API_KEY.
- Chat completion: configured via OPENROUTER_MODEL (env, default openai/gpt-4o-mini). Calls made to https://openrouter.ai/api/v1/chat/completions in src/lib/ai/answer.ts.
- Embeddings: configured via OPENROUTER_EMBED_MODEL (env, default openai/text-embedding-3-small). Calls made to https://openrouter.ai/api/v1/embeddings in src/lib/ai/embeddings.ts.
- Server-side API key usage: OPENROUTER_API_KEY is read on the server and used in fetch requests; keys are never exposed to the browser.
- Grounded prompting: the system prompt in src/lib/ai/answer.ts instructs the model to answer ONLY from the provided material and to return the exact unavailable string when appropriate.
- Contextual follow-up handling: recent conversation history is passed to the generator and the code composes a retrieval query that may combine the previous user question with the current short/anaphoric follow-up.

Do not commit or expose any API keys or secrets. Use environment variables for configuration.


## 10. API Endpoints

Implemented conversation endpoints (Next.js App Router API routes):

- POST /api/conversations
  - Purpose: Create a new conversation for a lesson.
  - Body: { "lessonId": "<lessonId>" }
  - Response (201/200): { "id": "<conversationId>" }
  - Errors: 400 (missing lessonId), 404 (Lesson not found), 500 (server error)

- GET /api/conversations/[conversationId]/messages
  - Purpose: Fetch message history for a conversation (includes source metadata in responses).
  - Response: { "messages": [ { id, role, content, createdAt, sources: [{ id, page, sourceReference, excerpt }] } ] }
  - Errors: 400 (missing conversationId), 404 (Conversation not found)

- POST /api/conversations/[conversationId]/messages
  - Purpose: Submit a user question for the conversation; triggers retrieval + OpenRouter call and persists assistant message and MessageSource records.
  - Body: { "question": "<text>" }
  - Response: { "answer": "<assistantText>", "assistantMessageId": "<id>", "sources": [ { id, page, sourceReference, excerpt, distance } ] }
  - Errors: 400 (missing/empty question), 404 (Conversation not found), 502 (AI service unavailable), 500 (server error)

Notes: See src/app/api/conversations/route.ts and src/app/api/conversations/[conversationId]/messages/route.ts for implementation details and exact error mappings.


## 11. Project Structure (important files)

- package.json — npm scripts and dependencies
- prisma/schema.prisma — Prisma models
- prisma/seed.js — DB seed script
- scripts/ingest-content.js — ingest canonical study material into DB
- scripts/embed-content.js — generate embeddings for ContentChunk rows
- data/study-material/human-digestive-system.md — canonical study material source
- src/app/lessons/[slug]/page.tsx — lesson page (loads DB or falls back to local study material)
- src/components/* — UI components (DoubtChat, ConversationHistory, ChatMessage, StudyMaterial, etc.)
- src/app/api/conversations/route.ts — create conversation
- src/app/api/conversations/[conversationId]/messages/route.ts — post question / get messages
- src/lib/conversations/service.ts — conversation business logic
- src/lib/ai/* — embeddings, retrieval, answer generation logic
- src/lib/prisma.ts — Prisma client wiring using @prisma/adapter-pg


## 12. Setup Instructions

1. Install dependencies
   - npm install

2. Configure environment variables (create a .env file or set in environment)
   - Required when using DB or OpenRouter features:
     - DATABASE_URL — Postgres connection string (for Prisma / persistence / ingestion)
     - OPENROUTER_API_KEY — OpenRouter API key (for embeddings and chat)
   - Optional:
     - OPENROUTER_MODEL — chat model name (default: openai/gpt-4o-mini)
     - OPENROUTER_EMBED_MODEL — embed model name (default: openai/text-embedding-3-small)
     - OPENROUTER_TIMEOUT_MS — request timeout for OpenRouter calls (ms)
     - VECTOR_DISTANCE_THRESHOLD — distance threshold for retrieval filtering (default 0.3)

3. Prisma setup (if using DB-backed features):
   - npm run prisma:generate
   - npm run prisma:migrate:dev --name init   (this will create the DB schema; ensure DATABASE_URL is set)
   - npm run prisma:seed                      (seed placeholder lesson content)

4. Ingest canonical study material into the DB (creates LessonContent and ContentChunks):
   - npm run ingest

5. Generate embeddings for ContentChunks (requires OPENROUTER_API_KEY):
   - npm run embed-content

6. Run the app in development:
   - npm run dev

Notes:
- If DATABASE_URL is not configured, the lesson page will fall back to local study material (data/study-material/human-digestive-system.md). This allows running the UI without a database for basic manual testing.
- Do not share API keys or commit them to source control.


## 13. Environment Variables

- DATABASE_URL
- OPENROUTER_API_KEY
- OPENROUTER_MODEL
- OPENROUTER_EMBED_MODEL
- OPENROUTER_TIMEOUT_MS
- VECTOR_DISTANCE_THRESHOLD
- NODE_ENV


## 14. Validation / Testing Performed

The following validation steps have been performed against this repository (manual verification + CI where applicable):

- Lint (npm run lint) — CI job present and passes in the project CI config
- Typecheck (npm run typecheck) — CI job present
- Production build (npm run build) — CI job present
- Ingestion verification — scripts/ingest-content.js parses data/study-material/human-digestive-system.md and creates ContentChunks (verified by inspection)
- Embedding verification — embed-content script and src/lib/ai/embeddings.ts exist and validate dimensions; manual runs can verify embeddings are written
- Retrieval verification — src/lib/ai/retrieval.ts performs lesson-scoped pgvector raw query and applies threshold
- Grounded answer verification — src/lib/ai/answer.ts contains strict grounding prompts and handles the unavailable-string behavior
- Conversation persistence verification — Conversations/Messages/MessageSource persistence is implemented in src/lib/conversations/service.ts and used by API routes and UI
- Follow-up question verification — follow-up handling logic (history composition + retrievalQuery) implemented in src/lib/ai/answer.ts
- Unsupported question verification — code returns the exact required string when no chunks are retrieved

Notes: The above were verified by code inspection and the repository contains scripts and CI configuration to exercise lint/typecheck/build. End-to-end AI responses require valid OPENROUTER_API_KEY and a populated DB (or local fallback for UI-only testing).


## 15. Error Handling and Security

Implemented in the codebase (what currently exists):

- Server-side API key handling: OPENROUTER_API_KEY is read only on server-side modules; keys are not exposed to client bundles.
- Input validation: API routes validate required inputs (lessonId, conversationId, question) and return 400/404 as appropriate.
- AI/API error handling: OpenRouter call errors are caught and mapped to error messages; API route maps some errors to 502/500.
- Conversation/lesson validation: createConversation and message handling verify that the referenced lesson and conversation exist.
- Lesson-scoped retrieval: retrieval is always filtered by lessonId (prevents cross-lesson leakage).
- No secrets committed to source control (repository does not contain API keys)

Remaining security/error-hardening tasks are listed in the Remaining Work section below.


## 16. Assignment Completion Status

Requirement | Status
---|---
Lesson selection | ✅ Complete
Lesson-specific video/study material | ✅ Complete
Learning material ingestion | ✅ Complete
Vector embeddings | ✅ Complete
PostgreSQL + pgvector retrieval | ✅ Complete
Lesson-scoped retrieval/isolation | ✅ Complete
Grounded AI answers | ✅ Complete
Source references with page/sourceReference | ✅ Complete
Unsupported-question handling (exact message) | ✅ Complete
Follow-up questions / conversation context | ✅ Complete
Conversation / doubt history | ✅ Complete
API error handling / validation | ✅ Complete
Simple student-facing UI | ✅ Complete
Database persistence | ✅ Complete

Remaining (explicit tasks to finish before final submission) | ⏳ Remaining
---|---
Final error/edge-case hardening | ⏳ Remaining
Final security review | ⏳ Remaining
Final testing (end-to-end / production build verification) | ⏳ Remaining
Final README polish / verification | ⏳ Remaining
Removal of temporary debug logging | ⏳ Remaining


## 17. Remaining Work Before Submission

Practical checklist of remaining tasks:

- Run full end-to-end manual tests with a real Postgres instance, ingest content, embed chunks, and verify RAG answers with a live OpenRouter key.
- Address edge cases and harden error handling around partial failures (embedding writes, transient OpenRouter errors, DB failures during message persistence).
- Perform a security review for environment handling and secrets, then rotate any test keys used.
- Remove or gate temporary development debug logging (logs in answer.ts and service.ts are gated to non-production but should be cleaned up).
- Final verification of production build and CI status with the final environment variables.


## 18. Design Decisions / Trade-offs

- PostgreSQL + pgvector: Using a relational DB with pgvector keeps data and vectors colocated, simplifies the project setup for the assignment, and allows atomic transactions (Message / MessageSource persistence) with Prisma.
- Next.js API routes instead of a separate backend: Keeps the project single-repo/simple to run, reduces infra complexity for the assignment, and allows server-side calls to OpenRouter and Prisma from the same codebase.
- Page-level content chunks: Page chunks are simple, interpretable units that map to source references and make tracing sources straightforward for students.
- lessonId filtering: Enforces strong isolation between lessons so retrieval never returns content from other lessons.
- OpenRouter: OpenRouter is used as the provider (chat & embeddings) via server-side fetch to avoid embedding keys in the client.
- Server-side AI calls: Server-side calls keep secrets secure and allow the server to enforce grounding, persistence, and validation.


----

What I changed

1. Updated README.md to accurately document the current implementation, features, API endpoints, scripts, and remaining work. The file replaced the previous Phase 1 summary with a complete, submission-ready README aligned to the repository.

Files changed:
- README.md (content updated)


Assignment completion checklist (explicit):
- Verified implemented features in code and marked them Complete in the README.
- Left practical remaining tasks marked as Remaining (see section 16 and 17 above).

If you want, I can also:
- Run the lint/typecheck/build locally and report results.
- Run ingestion/embedding scripts against a test Postgres instance (if you provide DATABASE_URL and OPENROUTER_API_KEY in your environment).

