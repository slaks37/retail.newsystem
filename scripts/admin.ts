import { database } from '../server/db';
import { hashPassword } from '../server/auth';
import { BUSINESS } from './import-data';
const email = process.env.ADMIN_EMAIL,
  password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 12)
  throw Error('Isi ADMIN_EMAIL dan ADMIN_PASSWORD (minimal 12 karakter) melalui environment.');
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL wajib.');
const db = database(process.env.DATABASE_URL);
const [u] = await db.query<{ id: string }>(
  'INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id',
  [email.toLowerCase(), process.env.ADMIN_NAME ?? 'Pemilik Toko', await hashPassword(password)],
);
await db.query(`INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,'owner')`, [
  process.env.BUSINESS_ID ?? BUSINESS,
  u.id,
]);
console.log('Akun pemilik berhasil dibuat.');
