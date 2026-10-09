# DEVELOPMENT.md — Developer guide for AI Doubt Solver

This developer guide explains how the project is organized, how requests flow through the system, and where to make changes for common maintenance tasks. It is written for a developer who will run, maintain, or extend the project.

Note: this document is based on a code inspection of the repository. It does not assume a running Postgres instance or active OpenRouter credentials. Follow the Quick start section in the repository README to run the application locally.

Contents
- Development environment and setup
- Application architecture and request lifecycle
- File-by-file explanation of important modules
- Database models and relationships
- Content ingestion workflow
- Embedding generation workflow
- Retrieval algorithm and lesson isolation
- Prompt construction and grounded generation
- Follow-up question handling
- Conversation persistence and source storage
- API route behavior and error handling
- Environment configuration and secret management
- Debugging common failures
- Development commands
- Manual smoke-testing checklist
- Known limitations and safe future improvements


## Development environment and setup

Prerequisites
- Node.js (recommended >= 18)
- PostgreSQL when using DB-backed features (tests, ingestion, embedding persistence)

Repository prerequisites
- Clone the repository and install dependencies:
  - npm install

- Ensure Prisma client is available (the repository contains a postinstall hook that runs `prisma generate` during npm install). If you need to run manually:
  - npm run prisma:generate

Environment variables
- Create a .env file or export environment variables required by scripts and server code. See README for the full list.

Optional: Local DB setup
- Use a local Postgres instance and set DATABASE_URL accordingly. Then run:
  - npm run prisma:migrate:dev --name init
  - npm run prisma:seed (optional)


## Application architecture and request lifecycle

High-level components
- Browser UI (Next.js app/router components) — React components under src/app and src/components.
- API routes (Next.js App Router server functions) — src/app/api/*
- Conversation service — src/lib/conversations/service.ts: central business logic for creating conversations, persisting messages and sources, orchestrating retrieval and AI calls.
- AI modules — src/lib/ai/*: embeddings.ts, retrieval.ts, answer.ts. These implement embedding generation, vector retrieval, and prompt construction + OpenRouter calls.
- Prisma client wiring — src/lib/prisma.ts.
- Database — Postgres with pgvector extension (ContentChunk.embedding stored as vector(1536)).

Request lifecycle (POST /api/conversations/[conversationId]/messages)
1. Client posts { question } to /api/conversations/{conversationId}/messages with optional query param lessonId to enforce lesson scoping.
2. Route validates inputs and delegates to conversation service (answerConversationMessage).
3. Service loads the conversation, fetches bounded recent history, persists the user message, and calls generateAnswer.
4. generateAnswer embeds the retrieval query, does a lesson-scoped pgvector similarity search, filters by threshold, builds the grounded prompt, and calls OpenRouter chat completion.
5. Service persists the assistant message and MessageSource rows linking to ContentChunk IDs returned by the RAG step.
6. Route returns the assistant text and sources to client.

Note: content chunk embeddings are expected to be present for retrieval; ingestion and embedding scripts produce those vectors outside of the per-request flow.


## File-by-file (important files)

- src/app/api/conversations/route.ts — POST route to create a Conversation. Validates lessonId in request body and returns conversation id. Calls createConversation in the service.

- src/app/api/conversations/[conversationId]/messages/route.ts — GET to fetch messages (optionally validated against lessonId) and POST to submit question which triggers retrieval + OpenRouter and message persistence. Implements error mapping for common situations.

- src/lib/conversations/service.ts — Business logic:
  - createConversation(lessonId)
  - getConversation(conversationId)
  - listConversations(lessonId)
  - addMessage(conversationId, role, content, sources?) — create message and write optional sources in transaction
  - getConversationMessages(conversationId) — returns messages and safe sources after lesson scoping
  - answerConversationMessage({ conversationId, question }) — orchestrates history load, persisting user message, calling generateAnswer, persisting assistant message and sources

- src/lib/ai/embeddings.ts — generateEmbedding(text) calls OpenRouter embeddings endpoint. Validates API key and embedding dimension (EMBEDDING_DIM = 1536).

- src/lib/ai/retrieval.ts — retrieveRelevantChunks({ lessonId, query, limit }):
  - generates query embedding, constructs a vector literal, and issues a prisma.$queryRaw raw SQL query selecting chunk fields and (embedding <=> vector) AS distance from ContentChunk where lessonId = ... ORDER BY distance ASC LIMIT ...
  - maps results to RetrievedChunk and filters by numeric distance <= DISTANCE_THRESHOLD (default 0.3 via environment variable).

- src/lib/ai/answer.ts — generateAnswer({ lessonId, question, history, limit }):
  - validates question and lessonId
  - detects follow-up/anaphora and composes retrievalQuery
  - calls retrieveRelevantChunks
  - if no chunks, returns the exact unavailable-string
  - builds strict messages prompt including system prompt, optional history block, user question, and Retrieved material block (includes id, page, sourceReference, excerpt)
  - calls OpenRouter chat completion with configured model and returns answer text and sources

- src/lib/prisma.ts — Prisma client wiring using @prisma/client and @prisma/adapter-pg adapter. The project declares a global var to reuse client in dev to avoid connection exhaustion. (Note: small ESLint suppression was added to the global declaration to avoid no-unused-vars warnings.)

- scripts/ingest-content.js — ingestion script (entry point: node scripts/ingest-content.js). Idempotently upserts lesson, LessonContent, and writes ContentChunk rows split by page markers.

- scripts/embed-content.js — script (node scripts/embed-content.js) that finds ContentChunks with NULL embedding and calls generateEmbedding to populate embedding column (writes to DB). Requires OPENROUTER_API_KEY.

- prisma/schema.prisma — data model used by Prisma. ContentChunk.embedding is defined as Unsupported("vector(1536)").

- src/components/doubt-chat.tsx — client component that manages conversationId state for a lesson, persists conversationId in localStorage scoped to lesson, attempts to restore it on mount by calling GET messages with lessonId, and provides UX for composing questions.

- src/components/conversation-history.tsx — client component that fetches messages for a conversation and polls every 5s.


## Database models and relationships

(See prisma/schema.prisma) — summary:
- Lesson 1 <-> N LessonContent
- Lesson 1 <-> N ContentChunk (top-level lessonId on ContentChunk)
- Lesson 1 <-> N Conversation
- Conversation 1 <-> N Message
- Message 1 <-> N MessageSource
- MessageSource -> ContentChunk (references contentChunkId)

Important implementation notes
- ContentChunk.embedding uses Unsupported("vector(1536)") in Prisma because Prisma does not yet provide a native pgvector type. The repository relies on raw SQL for similarity search.
- MessageSource and other relations enforce that sources attached to a message belong to the same lesson as the conversation — service code filters/sanitizes accordingly.


## Content ingestion workflow

1. scripts/ingest-content.js reads data/study-material/human-digestive-system.md (or other files) and splits into pages using <!-- PAGE n --> markers.
2. It upserts a Lesson and a LessonContent record, then writes ContentChunk rows (one row per page) with metadata (page) and embedding left null.
3. The ingestion script is idempotent: it recreates chunk rows for a given LessonContent to keep chunk indexes consistent.

Where to add new lessons
- Add a lesson file under data/study-material with <!-- PAGE n --> markers, then run scripts/ingest-content.js with DATABASE_URL set. The script will create the Lesson and LessonContent and populate ContentChunk rows.


## Embedding generation workflow

- Embeddings are generated by scripts/embed-content.js which finds ContentChunk rows with NULL embedding and calls src/lib/ai/embeddings.generateEmbedding(text) to produce a 1536-d vector.
- The script writes the vector into the embedding column (pgvector vector(1536)).

To regenerate embeddings for a lesson or all chunks
- Run: npm run embed-content (ensure OPENROUTER_API_KEY and DATABASE_URL are set). If you need to force re-embedding, remove embeddings (careful with production data) or modify the script to operate on the desired set.


## Retrieval algorithm and lesson isolation

- Query embedding is computed per-request using the same embedding model.
- retrieveRelevantChunks uses prisma.$queryRaw with a vector literal and the pgvector <=> operator to compute distance. It filters by lessonId in the WHERE clause and orders by distance ASC.
- After the DB returns rows, the code filters client-side by DISTANCE_THRESHOLD (VECTOR_DISTANCE_THRESHOLD env, default 0.3).

Why lesson isolation
- Filtering by lessonId ensures no cross-lesson leakage and makes the assistant's answers provably grounded in the lesson's material.


## Prompt construction and grounded generation

- The system prompt instructs the model to answer using ONLY the provided retrieved material and to return the exact string "This information is not available in the provided learning material." if the answer is not present.
- Retrieved chunks are formatted into context blocks containing id, page, sourceReference and a truncated excerpt.
- Conversation history (bounded number of recent messages) is provided as a system-level block when available so the model can resolve follow-up references; even after resolving references, the final answer must be grounded in the provided chunks.

Editing prompts
- Prompts are constructed in src/lib/ai/answer.ts (buildMessages). Make careful, minimal edits to avoid introducing ambiguity that could encourage hallucinations.


## Follow-up question handling

- The code attempts to detect follow-ups (isFollowUpQuestion) on heuristics: demonstrative pronouns, short questions, or starters like "why" / "how" without specific nouns.
- If a follow-up is detected and recent history exists, the retrieval query is composed as: "<previous user question> <current short follow-up>" to increase retrieval effectiveness.
- History passed to the model does NOT include the current user message (service persists the user message before generating the answer but fetches recent history before persisting the current message).


## Conversation persistence and source storage

- When a user posts a question, the service persists the user message (Message role 'user').
- After generating an answer, the service persists an assistant Message and creates MessageSource records linking to ContentChunk IDs. The service validates chunk ownership (chunk.lessonId === conversation.lessonId) before creating MessageSource records to avoid cross-lesson attachments.
- getConversationMessages returns a sanitized message shape that includes sources mapped to page and excerpt.


## API route behavior and error handling

- Routes live in src/app/api and return NextResponse JSON. They perform input validation and map known text into status codes:
  - Missing parameters -> 400
  - Not found (Lesson/Conversation) -> 404
  - OpenRouter errors -> mapped to 502 (where appropriate)
  - Other DB errors -> 500

- The POST /messages route accepts query param lessonId to enforce that conversation belongs to the same lesson. The GET messages route uses the same lessonId param for validation when present.


## Environment configuration and secret management

Use environment variables (do not commit secrets):
- DATABASE_URL (Postgres connection string)
- OPENROUTER_API_KEY (OpenRouter auth key)
- OPENROUTER_MODEL (chat model override)
- OPENROUTER_EMBED_MODEL (embedding model override)
- VECTOR_DISTANCE_THRESHOLD (retrieval filter threshold)
- OPENROUTER_TIMEOUT_MS (request timeout)

Secrets are used only server-side; the code reads OPENROUTER_API_KEY in server modules and never exposes it to client bundles.


## Debugging common failures

1. Prisma / build errors about client missing
- Ensure prisma generate has run (npm run prisma:generate). Package.json includes a postinstall hook to generate the client during npm install.

2. Embedding dimension mismatch
- src/lib/ai/embeddings.ts expects 1536-d vectors. If provider returns a different size, the embedding generator will throw. Verify OPENROUTER_EMBED_MODEL matches a 1536-d model (default: text-embedding-3-small).

3. Retrieval returns no chunks
- Check that ContentChunk.embedding values are populated in DB and that the vectors were generated with the same dimension.
- Confirm VECTOR_DISTANCE_THRESHOLD is set appropriately (default 0.3). Lower thresholds require closer matches.

4. OpenRouter API errors (timeouts, rate limits)
- OPENROUTER_TIMEOUT_MS controls the request timeout. The code maps 429 to a 502-level error message.
- For transient network issues, add retries in src/lib/ai/embeddings.ts and src/lib/ai/answer.ts if desired.

5. Conversation restore or localStorage issues
- The UI attempts to restore a conversation id stored in localStorage by calling GET /messages?lessonId=<lessonId>. If the server responds non-OK, the UI removes the stored id. Check browser console logs (chat-debug) for more details.

6. Prisma raw query errors for vector literal
- retrieveRelevantChunks constructs a vector literal string and passes it to prisma.$queryRaw. Ensure your Postgres + pgvector setup accepts casting the literal to vector (vector(1536)).


## Development commands (from package.json)

- npm run dev — Next.js dev server
- npm run build — production build
- npm run start — start built app
- npm run lint — run ESLint
- npm run typecheck — tsc --noEmit
- npm run prisma:generate — prisma generate
- npm run prisma:migrate:dev --name init — apply migrations (development)
- npm run prisma:seed — seed DB
- npm run ingest — node scripts/ingest-content.js (ingest study material)
- npm run embed-content — node scripts/embed-content.js (generate embeddings for chunks)


## Manual smoke-testing checklist

First-time setup (fresh DB)
- Set DATABASE_URL and OPENROUTER_API_KEY (for embeddings/chat)
- npm install
- npm run prisma:generate
- npm run prisma:migrate:dev --name init
- npm run prisma:seed (optional)
- npm run ingest
- npm run embed-content
- npm run dev

Manual verification steps
- Open lesson page /lessons/human-digestive-system and confirm study material displays.
- Open the doubt chat, ask a question relevant to the lesson and verify the assistant returns grounded answer with source references.
- Ask an unsupported question (outside lesson) and verify assistant returns exactly: "This information is not available in the provided learning material.".
- Ask a short follow-up (e.g., "Why is that important?") and verify follow-up resolution uses history and remains grounded.
- Refresh the browser and verify conversation restoration (localStorage) behavior; inspect console logs for chat-debug messages.


## Where to make changes for common tasks

- Add a new lesson
  - Add a new file with <!-- PAGE n --> markers under data/study-material.
  - Run npm run ingest to create Lesson/LessonContent/ContentChunk rows.
  - Run npm run embed-content to generate embeddings for new chunks.

- Update learning material
  - Modify data/study-material file and re-run npm run ingest (ingest script recreates chunk rows for the content).
  - Re-run npm run embed-content if chunk text changed and you want updated embeddings.

- Regenerate embeddings
  - npm run embed-content (requires OPENROUTER_API_KEY).
  - If you only want to re-embed specific chunks, modify scripts/embed-content.js to target a lessonId or chunkId filter.

- Change the chat model
  - Set OPENROUTER_MODEL to a different model name. This is read in src/lib/ai/answer.ts. Ensure compatibility with message format.

- Change the embedding model
  - Set OPENROUTER_EMBED_MODEL to the desired model. Ensure EMBEDDING_DIM in src/lib/ai/embeddings.ts matches the model's output dimension. By default EMBEDDING_DIM = 1536.

- Debug missing source attachments
  - Check logs and the service flow in src/lib/conversations/service.ts where MessageSource rows are created. The service validates chunk existence and lesson ownership and will fail if a chunk id is invalid.

- Investigate conversation restoration failures after refresh
  - UI: src/components/doubt-chat.tsx attempts to restore conversationId from localStorage and validates by calling GET messages with lessonId param.
  - Server: GET /messages validates that conversation belongs to lesson when lessonId query param provided.
  - Inspect browser console (chat-debug) logs and server logs (API route error logs) to trace which validation failed.


## Known limitations and safe future improvements

- Conversation restoration after browser refresh: implemented in UI but not exhaustively validated across environments and deployments. Race conditions or storage inconsistencies could cause failures — further testing and robust handling (e.g., server-side recent-conversation queries for a user session) would improve reliability.

- No automated integration tests. Add end-to-end tests that exercise ingestion -> embedding -> retrieval -> generation flows using a test DB and stubbed OpenRouter responses.

- Embedding generation and OpenRouter calls have no retry/backoff logic; adding retries for transient network errors would make ingestion and runtime more robust.

- The pgvector embedding column is handled as Unsupported in Prisma. If/when Prisma adds native pgvector support, migrate to typed field to improve type safety and reduce raw SQL usage.

- The retrieval threshold is a single global cutoff. Consider exposing per-lesson or per-query scoring strategies or performing reranking in application logic.


## Appendix: quick reference locations

- Ingestion: scripts/ingest-content.js
- Embeddings: scripts/embed-content.js, src/lib/ai/embeddings.ts
- Retrieval: src/lib/ai/retrieval.ts
- Prompt & generation: src/lib/ai/answer.ts
- Conversations: src/lib/conversations/service.ts
- API routes: src/app/api/conversations/route.ts and src/app/api/conversations/[conversationId]/messages/route.ts
- UI: src/components/doubt-chat.tsx, src/components/conversation-history.tsx, src/components/chat-message.tsx
- Prisma schema: prisma/schema.prisma


If you need any of the following, I can add them next:
- Concrete example queries and expected retrieval outputs for the sample lesson
- A small integration test scaffold using a local Postgres test container
- A migration plan to move to typed pgvector support when Prisma provides it

