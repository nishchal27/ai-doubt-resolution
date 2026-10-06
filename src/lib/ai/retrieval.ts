import { generateEmbedding, EMBEDDING_DIM } from './embeddings';
import { prisma } from '../prisma';

export type RetrievedChunk = {
  id: string;
  lessonId: string;
  content: string;
  chunkIndex: number;
  sourceReference: string | null;
  metadata: any;
  distance: number;
};

const DEFAULT_LIMIT = 5;

// Distance threshold (lower means more similar when using pgvector distance operator)
const DISTANCE_THRESHOLD = Number(process.env.VECTOR_DISTANCE_THRESHOLD ?? '0.3');

export async function retrieveRelevantChunks({
  lessonId,
  query,
  limit = DEFAULT_LIMIT,
}: {
  lessonId: string;
  query: string;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  if (!lessonId) throw new Error('lessonId is required');
  if (!query || !query.toString().trim()) throw new Error('query is empty');

  const qEmbedding = await generateEmbedding(query);
  if (!qEmbedding || qEmbedding.length !== EMBEDDING_DIM) {
    throw new Error('Unexpected embedding dimension for query');
  }

  // Prepare vector literal for parameterized query
  const vectorString = '[' + qEmbedding.join(',') + ']';

  // Perform lesson-scoped pgvector similarity search. We use the pgvector distance operator (<=>)
  // and return the distance value so callers can apply a threshold.
  const rows: any[] = await prisma.$queryRaw`
    SELECT id, "lessonId", content, "chunkIndex", "sourceReference", metadata,
           (embedding <=> ${vectorString}::vector) AS distance
    FROM "ContentChunk"
    WHERE "lessonId" = ${lessonId}
    ORDER BY distance ASC
    LIMIT ${limit}`;

  const results: RetrievedChunk[] = rows
    .map((r) => ({
      id: r.id,
      lessonId: r.lessonId,
      content: r.content,
      chunkIndex: r.chunkIndex,
      sourceReference: r.sourceReference,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : r.metadata,
      distance: Number(r.distance),
    }))
    .filter((r) => !Number.isNaN(r.distance) && r.distance <= DISTANCE_THRESHOLD);

  return results;
}
