import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { BUSINESS } from './import-data';
if (!process.env.DATABASE_URL || !process.env.ADMIN_EMAIL || !process.env.APP_ORIGIN)
  throw Error('DATABASE_URL, ADMIN_EMAIL, dan APP_ORIGIN wajib diisi melalui environment privat.');
const origin = new URL(process.env.APP_ORIGIN);
if (origin.protocol !== 'https:' && origin.hostname !== 'localhost')
  throw Error('Aktivasi memerlukan HTTPS.');
const sql = neon(process.env.DATABASE_URL),
  b = process.env.BUSINESS_ID ?? BUSINESS;
const [owner] = await sql.query(
  "SELECT u.id FROM users u JOIN business_memberships m ON m.user_id=u.id WHERE m.business_id=$1 AND lower(u.email)=$2 AND m.role='owner' AND u.active",
  [b, process.env.ADMIN_EMAIL.toLowerCase()],
);
if (!owner) throw Error('Akun pemilik tidak ditemukan.');
const token = randomBytes(32).toString('hex'),
  hash = createHash('sha256').update(token).digest('hex');
const [, rows] = await sql.transaction([
  sql.query(
    'UPDATE account_setup_tokens SET expires_at=least(expires_at,now()) WHERE business_id=$1 AND user_id=$2 AND used_at IS NULL',
    [b, owner.id],
  ),
  sql.query(
    "INSERT INTO account_setup_tokens(business_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '48 hours') RETURNING expires_at",
    [b, owner.id, hash],
  ),
]);
await mkdir('work', { recursive: true });
await writeFile(
  'work/owner-activation.local.json',
  JSON.stringify(
    {
      url: origin.origin + '/#activate=' + token,
      email: process.env.ADMIN_EMAIL,
      expiresAt: rows[0].expires_at,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  'Tautan sekali pakai tersimpan privat di work/owner-activation.local.json. Tautan lama yang belum dipakai telah kedaluwarsa.',
);
