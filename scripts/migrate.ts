import { readFile, readdir } from 'node:fs/promises';
import type { DB } from '../server/db';
import pg from 'pg';
export async function migrate(db: DB) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (applied.some((x) => x.name === file)) continue;
    const sql = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
    console.log('Migrasi: ' + file);
  }
}
// HTTP queries cannot keep session transactions; the CLI uses one atomic SQL batch per migration.
export async function migratePostgres(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate({
      query: async <T>(text: string, params: unknown[] = []) => {
        const result = await client.query(text, params);
        const last = Array.isArray(result) ? result.at(-1)! : result;
        return last.rows as T[];
      },
    });
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith('/migrate.ts')) {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url)
    throw Error(
      'DATABASE_URL_UNPOOLED wajib. Jalankan node --env-file=.env.local --import tsx scripts/migrate.ts',
    );
  await migratePostgres(url);
}
