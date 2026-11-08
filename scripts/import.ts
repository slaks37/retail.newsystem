import { database } from '../server/db';
import { BUSINESS, LOCATION, importData } from './import-data';
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL belum diisi.');
const db = database(process.env.DATABASE_URL);
await db.query('INSERT INTO businesses(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
  BUSINESS,
  'Toko Sumber Jago',
]);
await db.query(
  'INSERT INTO locations(id,business_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
  [LOCATION, BUSINESS, 'Gudang Utama'],
);
console.log(JSON.stringify(await importData(db), null, 2));
