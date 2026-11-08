import { it, expect } from 'vitest';
import { splitSQL } from '../scripts/split-sql';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
it('preserves dollar-quoted procedural bodies', () => {
  expect(
    splitSQL(
      'CREATE FUNCTION f() RETURNS void AS $f$ BEGIN PERFORM 1; PERFORM 2; END; $f$ LANGUAGE plpgsql; SELECT 3;',
    ),
  ).toHaveLength(2);
});
it('preserves quoted semicolons and nested comments', () => {
  const s =
    "SELECT 'it''s;valid', \"semi;colon\"; /* outer; /* inner; */ */ SELECT 2; -- trailing comment\n";
  expect(splitSQL(s).filter((x) => !x.startsWith('--'))).toHaveLength(2);
});
it('rejects incomplete SQL', () => {
  expect(() => splitSQL("SELECT 'unfinished;")).toThrow('unterminated');
});
it('every split migration statement is valid in PostgreSQL', async () => {
  const db = new PGlite();
  await db.waitReady;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const statements = splitSQL(
        await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'),
      );
      for (const statement of statements) await db.query(statement);
    }
    const r = await db.query<{ n: number }>(
      "SELECT count(*)::integer n FROM information_schema.tables WHERE table_schema='public'",
    );
    expect(r.rows[0].n).toBeGreaterThan(30);
  } finally {
    await db.close();
  }
}, 60000);
