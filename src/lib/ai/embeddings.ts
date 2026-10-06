import { config } from 'dotenv';
config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const _OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const OPENROUTER_EMBED_MODEL = _OPENROUTER_EMBED_MODEL.startsWith('openai/') ? _OPENROUTER_EMBED_MODEL : `openai/${_OPENROUTER_EMBED_MODEL}`;
export const EMBEDDING_DIM = 1536; // expected dimension in DB (vector(1536))

if (!OPENROUTER_API_KEY) {
  // Do not throw on import; allow scripts to check and fail with clearer message.
  // However we still export generateEmbedding which will error if key is missing.
}

export class EmbeddingError extends Error {}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || !text.toString().trim()) {
    throw new EmbeddingError('Input text is empty');
  }

  if (!OPENROUTER_API_KEY) {
    throw new EmbeddingError('OpenRouter API key not configured (OPENROUTER_API_KEY)');
  }

  const url = 'https://openrouter.ai/api/v1/embeddings';
  const body = {
    model: OPENROUTER_EMBED_MODEL,
    input: text,
  } as any;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw new EmbeddingError('Network error while calling embedding provider: ' + String(err?.message || err));
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new EmbeddingError(`Embedding API returned HTTP ${res.status}: ${txt}`);
  }

  const data = await res.json().catch((e) => {
    throw new EmbeddingError('Invalid JSON response from embedding API: ' + String(e?.message || e));
  });

  // OpenRouter embeddings response shape is similar to OpenAI: { data: [{ embedding: [...] }], ... }
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new EmbeddingError('Embedding API returned unexpected shape');
  }

  if (embedding.length !== EMBEDDING_DIM) {
    throw new EmbeddingError(`Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${embedding.length}`);
  }

  // Ensure numbers
  const vector = embedding.map((n: any) => Number(n));
  if (vector.some((n) => Number.isNaN(n))) {
    throw new EmbeddingError('Embedding contained non-numeric values');
  }

  return vector;
}
