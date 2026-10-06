/* scripts/diag-openrouter.js

Diagnostics for OpenRouter embedding requests without printing the API key.
- Prints whether OPENROUTER_API_KEY is present (yes/no)
- Prints OPENROUTER_EMBED_MODEL value
- Attempts a minimal embedding request for the text 'diagnostic' and prints error details if any

Usage: node scripts/diag-openrouter.js
*/

const dotenv = require('dotenv');
dotenv.config();

const fetch = global.fetch || require('node-fetch');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const _OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const OPENROUTER_EMBED_MODEL = _OPENROUTER_EMBED_MODEL.startsWith('openai/') ? _OPENROUTER_EMBED_MODEL : `openai/${_OPENROUTER_EMBED_MODEL}`;
const URL = 'https://openrouter.ai/api/v1/embeddings';

(async function main() {
  console.log('OPENROUTER_API_KEY configured:', !!OPENROUTER_API_KEY);
  console.log('OPENROUTER_EMBED_MODEL:', OPENROUTER_EMBED_MODEL);
  console.log('Endpoint URL:', URL);

  if (!OPENROUTER_API_KEY) {
    console.error('No OPENROUTER_API_KEY — cannot perform live embedding test.');
    process.exit(1);
  }

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({ model: OPENROUTER_EMBED_MODEL, input: 'diagnostic' }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<no response body>');
      console.error(`Embedding API HTTP ${res.status}: ${text}`);
      process.exit(1);
    }

    const data = await res.json().catch((e) => { throw new Error('Invalid JSON response'); });
    console.log('Embedding response keys:', Object.keys(data));
    const emb = data?.data?.[0]?.embedding;
    if (!Array.isArray(emb)) {
      console.error('Embedding missing or not an array in response');
      process.exit(1);
    }
    console.log('Embedding length:', emb.length);
    console.log('Diagnostic embedding received successfully (not printed)');
  } catch (err) {
    console.error('Fetch error:', err?.message || err);
    process.exit(1);
  }
})();
