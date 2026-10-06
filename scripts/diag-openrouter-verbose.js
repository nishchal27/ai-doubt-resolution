const dotenv = require('dotenv');
dotenv.config();

const fetch = global.fetch || require('node-fetch');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const URL = 'https://openrouter.ai/api/v1/embeddings';

(async function main() {
  console.log('OPENROUTER_API_KEY present:', !!OPENROUTER_API_KEY);
  if (!OPENROUTER_API_KEY) process.exit(1);

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({ model: OPENROUTER_EMBED_MODEL, input: 'diagnostic' }),
    });
    console.log('HTTP status:', res.status);
    const text = await res.text().catch(() => '<no body>');
    console.log('Response body (first 1000 chars):', text.slice(0, 1000));
  } catch (err) {
    console.error('Fetch error name:', err?.name);
    console.error('Fetch error code:', err?.code);
    console.error('Fetch error message:', err?.message);
    console.error('Fetch error stack:', err?.stack);
    process.exit(1);
  }
})();
