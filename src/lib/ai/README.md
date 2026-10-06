Embedding utilities for Phase 4

- generateEmbedding(text): server-side function that calls OpenRouter embeddings endpoint.
- EMBEDDING_DIM: expected embedding length (1536) to match database vector(1536).

Environment variables:
- OPENROUTER_API_KEY: required
- OPENROUTER_EMBED_MODEL: optional (default: text-embedding-3-small)
- VECTOR_DISTANCE_THRESHOLD: optional threshold used by retrieval (default: 0.3)

Notes:
- This module intentionally keeps provider-specific code isolated so retrieval logic can remain provider-agnostic.
