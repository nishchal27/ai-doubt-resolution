-- Prisma Migrations: init
-- This migration enables the pgvector extension and creates the full application schema
-- (tables, foreign keys, indexes, and a vector(1536) column for embeddings).

CREATE EXTENSION IF NOT EXISTS vector;

-- Lessons table
CREATE TABLE IF NOT EXISTS "Lesson" (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- LessonContent table
CREATE TABLE IF NOT EXISTS "LessonContent" (
  id text PRIMARY KEY,
  "lessonId" text NOT NULL,
  "sourceType" text NOT NULL,
  title text,
  content text NOT NULL,
  "sourceUrl" text,
  metadata jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_lessoncontent_lesson FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lessoncontent_lessonId ON "LessonContent" ("lessonId");

-- ContentChunk table (embedding uses pgvector vector(1536))
CREATE TABLE IF NOT EXISTS "ContentChunk" (
  id text PRIMARY KEY,
  "lessonId" text NOT NULL,
  "lessonContentId" text,
  content text NOT NULL,
  "chunkIndex" integer NOT NULL,
  "sourceType" text NOT NULL,
  "sourceReference" text,
  metadata jsonb,
  embedding vector(1536),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_contentchunk_lesson FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON DELETE CASCADE,
  CONSTRAINT fk_contentchunk_lessoncontent FOREIGN KEY ("lessonContentId") REFERENCES "LessonContent"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_contentchunk_lessonId ON "ContentChunk" ("lessonId");
CREATE INDEX IF NOT EXISTS idx_contentchunk_lessonContentId ON "ContentChunk" ("lessonContentId");

-- Conversation table
CREATE TABLE IF NOT EXISTS "Conversation" (
  id text PRIMARY KEY,
  "lessonId" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_conversation_lesson FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversation_lessonId ON "Conversation" ("lessonId");

-- Message table
CREATE TABLE IF NOT EXISTS "Message" (
  id text PRIMARY KEY,
  "conversationId" text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_message_conversation FOREIGN KEY ("conversationId") REFERENCES "Conversation"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_conversationId ON "Message" ("conversationId");

-- MessageSource table
CREATE TABLE IF NOT EXISTS "MessageSource" (
  id text PRIMARY KEY,
  "messageId" text NOT NULL,
  "contentChunkId" text NOT NULL,
  "sourceType" text NOT NULL,
  "sourceReference" text,
  excerpt text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_messagesource_message FOREIGN KEY ("messageId") REFERENCES "Message"(id) ON DELETE CASCADE,
  CONSTRAINT fk_messagesource_contentchunk FOREIGN KEY ("contentChunkId") REFERENCES "ContentChunk"(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_messagesource_messageId ON "MessageSource" ("messageId");
CREATE INDEX IF NOT EXISTS idx_messagesource_contentChunkId ON "MessageSource" ("contentChunkId");
