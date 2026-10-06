const { Client } = require('pg');
require('dotenv').config();
(async ()=>{
  try {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      console.error('DATABASE_URL not set in environment.');
      process.exit(1);
    }
    const connString = rawUrl.includes(':6543') ? rawUrl.replace(':6543', ':5432') : rawUrl;
    const client = new Client({ connectionString: connString, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const r1 = await client.query("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS has_vector");
    const r2 = await client.query("SELECT to_regclass('\"Lesson\"') IS NOT NULL AS has_lesson");
    const r3 = await client.query("SELECT to_regclass('\"LessonContent\"') IS NOT NULL AS has_lessoncontent");
    const r4 = await client.query("SELECT to_regclass('\"ContentChunk\"') IS NOT NULL AS has_contentchunk");
    const r5 = await client.query("SELECT data_type, udt_name FROM information_schema.columns WHERE table_name='ContentChunk' AND column_name='embedding'");
    const r6 = await client.query("SELECT format_type(a.atttypid, a.atttypmod) AS col_type FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid WHERE c.relname='ContentChunk' AND a.attname='embedding' LIMIT 1");

    console.log('vector_extension:', !!r1.rows[0].has_vector);
    console.log('Lesson_table:', !!r2.rows[0].has_lesson);
    console.log('LessonContent_table:', !!r3.rows[0].has_lessoncontent);
    console.log('ContentChunk_table:', !!r4.rows[0].has_contentchunk);
    console.log('ContentChunk_embedding_udt_name:', r5.rows[0] ? r5.rows[0].udt_name : null);
    console.log('ContentChunk_embedding_column_definition:', r6.rows[0] ? r6.rows[0].col_type : null);

    const fkChecks = {};
    const fks = [
      {tbl: 'LessonContent', col: 'lessonId'},
      {tbl: 'ContentChunk', col: 'lessonId'},
      {tbl: 'ContentChunk', col: 'lessonContentId'},
      {tbl: 'Conversation', col: 'lessonId'},
      {tbl: 'Message', col: 'conversationId'},
      {tbl: 'MessageSource', col: 'messageId'},
      {tbl: 'MessageSource', col: 'contentChunkId'},
    ];
    for (const fk of fks) {
      const res = await client.query(`SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints t ON k.constraint_name = t.constraint_name WHERE k.table_name = $1 AND k.column_name = $2 AND t.constraint_type = 'FOREIGN KEY' LIMIT 1`, [fk.tbl, fk.col]);
      fkChecks[`${fk.tbl}.${fk.col}`] = res.rowCount > 0;
    }
    console.log('foreign_keys:', fkChecks);

    // Check indexes existence for lessonId and lessonContentId on ContentChunk and conversationId on Message
    const idxChecks = {};
    const idxs = [
      {tbl: 'LessonContent', col: 'lessonId'},
      {tbl: 'ContentChunk', col: 'lessonId'},
      {tbl: 'ContentChunk', col: 'lessonContentId'},
      {tbl: 'Conversation', col: 'lessonId'},
      {tbl: 'Message', col: 'conversationId'},
      {tbl: 'MessageSource', col: 'contentChunkId'},
    ];
    for (const idx of idxs) {
      const res = await client.query("SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexdef ILIKE '%' || $2 || '%' LIMIT 1", [idx.tbl, idx.col]);
      idxChecks[`${idx.tbl}.${idx.col}`] = res.rowCount > 0;
    }
    console.log('indexes:', idxChecks);

    await client.end();
  } catch (e) {
    console.error('DB check error:', e.message);
    process.exit(1);
  }
})();
