import { pool } from '../src/lib/db';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const result = await pool.query(
  "SELECT 'conversation' AS kind,id,data FROM conversations UNION ALL SELECT 'ticket',id,data FROM tickets ORDER BY kind,id",
);
const hash = createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
mkdirSync('work', { recursive: true });
if (process.argv[2] === 'save')
  writeFileSync('work/persistence.json', JSON.stringify({ hash, count: result.rowCount }));
else {
  const previous = JSON.parse(readFileSync('work/persistence.json', 'utf8'));
  if (previous.hash !== hash) throw new Error('Persistência divergente');
  console.log(
    'Persistência após reinício confirmada: ' + result.rowCount + ' registros idênticos.',
  );
}
await pool.end();
