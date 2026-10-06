const { Client } = require('pg');
require('dotenv').config();
(async ()=>{
  try {
    const rawUrl = process.env.DATABASE_URL;
    const connString = rawUrl.includes(':6543') ? rawUrl.replace(':6543', ':5432') : rawUrl;
    const client = new Client({ connectionString: connString, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const res = await client.query("SELECT id, slug, title, description FROM \"Lesson\" WHERE slug = 'human-digestive-system' LIMIT 1");
    console.log('Lesson found:', res.rows.length > 0);
    if (res.rows.length > 0) console.log(res.rows[0]);
    const res2 = await client.query("SELECT id, \"sourceType\", title FROM \"LessonContent\" WHERE \"lessonId\" = $1", [res.rows[0]?.id]);
    console.log('LessonContent count:', res2.rows.length);
    if (res2.rows.length) console.log(res2.rows);
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
