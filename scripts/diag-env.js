const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

function present(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name) ? true : false;
}

console.log('OPENROUTER_API_KEY set:', !!process.env.OPENROUTER_API_KEY);
console.log('OPENROUTER_EMBED_MODEL:', process.env.OPENROUTER_EMBED_MODEL || '(default)');
console.log('OPENROUTER_MODEL:', process.env.OPENROUTER_MODEL || '(default)');
console.log('VECTOR_DISTANCE_THRESHOLD:', process.env.VECTOR_DISTANCE_THRESHOLD ?? '(default 0.3)');
console.log('OPENROUTER_TIMEOUT_MS:', process.env.OPENROUTER_TIMEOUT_MS ?? '(default 20000)');
