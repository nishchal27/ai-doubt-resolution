const { Client } = require('pg');
require('dotenv').config();
(async ()=>{
  try {
    const rawUrl = process.env.DATABASE_URL;
    const connString = rawUrl.includes(':6543') ? rawUrl.replace(':6543', ':5432') : rawUrl;
    const client = new Client({ connectionString: connString, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const lessonRes = await client.query("SELECT id FROM \"Lesson\" WHERE slug = 'human-digestive-system' LIMIT 1");
    const lessonId = lessonRes.rows[0]?.id;
    const res = await client.query("SELECT COUNT(*) as cnt FROM \"ContentChunk\" WHERE \"lessonId\" = $1", [lessonId]);
    console.log('ContentChunk count for lesson:', res.rows[0].cnt);

    const res2 = await client.query("SELECT id, \"chunkIndex\", \"sourceReference\" FROM \"ContentChunk\" WHERE \"lessonId\" = $1 ORDER BY \"chunkIndex\"", [lessonId]);
    console.log('Chunks:', res2.rows);

    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
