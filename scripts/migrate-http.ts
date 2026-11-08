import { readFile, readdir } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { splitSQL } from './split-sql';
const connection = process.env.DATABASE_URL_UNPOOLED;
if (!connection) throw Error('DATABASE_URL_UNPOOLED wajib.');
const sql = neon(connection);
await sql.query(
  'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
);
const applied = await sql.query('SELECT name FROM schema_migrations');
for (const file of (await readdir(new URL('../migrations/', import.meta.url)))
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  if (applied.some((r) => r.name === file)) continue;
  const source = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8');
  const statements = splitSQL(source);
  await sql.transaction([
    ...statements.map((statement) => sql.query(statement)),
    sql.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]),
  ]);
  console.log('Migrasi HTTP: ' + file + ' (' + statements.length + ' statement, atomik)');
}
