import { PGlite } from '@electric-sql/pglite';
import { serve } from '@hono/node-server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { app } from '../server/index';
import { migrate } from './migrate';
import { hashPassword } from '../server/auth';
import { BUSINESS, LOCATION, importData } from './import-data';
import type { DB } from '../server/db';
await mkdir('work', { recursive: true });
const pg = new PGlite('work/local-db-v3');
await pg.waitReady;
const db: DB = {
  query: async <T>(sql: string, params: unknown[] = []) => {
    if (params.length) return (await pg.query<T>(sql, params)).rows;
    const result = await pg.exec(sql);
    return (result.at(-1)?.rows ?? []) as T[];
  },
};
await migrate(db);
await db.query('INSERT INTO businesses(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
  BUSINESS,
  'Toko Sumber Jago',
]);
await db.query(
  'INSERT INTO locations(id,business_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
  [LOCATION, BUSINESS, 'Gudang Utama'],
);
const [user] = await db.query('SELECT id FROM users LIMIT 1');
if (!user) {
  const password = randomBytes(18).toString('base64url');
  const [created] = await db.query<{ id: string }>(
    'INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id',
    ['pemilik@newsystem.local', 'Pemilik Toko', await hashPassword(password)],
  );
  await db.query(
    `INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,'owner')`,
    [BUSINESS, created.id],
  );
  await writeFile(
    'work/local-login.json',
    JSON.stringify({ email: 'pemilik@newsystem.local', password }, null, 2),
    { mode: 0o600 },
  );
  console.log('Kredensial lokal tersimpan di work/local-login.json');
}
await importData(db);
let secret;
try {
  secret = await readFile('work/session-secret', 'utf8');
} catch {
  secret = randomBytes(32).toString('hex');
  await writeFile('work/session-secret', secret, { mode: 0o600 });
}
serve({
  fetch: (request) =>
    app.fetch(request, {
      LOCAL_DB: db,
      DATABASE_URL: '',
      BUSINESS_ID: BUSINESS,
      SESSION_SECRET: secret,
      APP_ORIGIN: 'http://localhost:5173',
    }),
  hostname: '127.0.0.1',
  port: 8788,
});
console.log('API lokal: http://127.0.0.1:8788 · PostgreSQL lokal PGlite (khusus development)');
