import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { DB } from '../server/db';
export const BUSINESS = '00000000-0000-4000-8000-000000000001';
export const LOCATION = '00000000-0000-4000-8000-000000000002';
export async function importData(db: DB, b = BUSINESS, directory = process.env.SOURCE_DATA_DIR) {
  const files = await Promise.all(
    [0, 1, 2].map(
      async (i) =>
        JSON.parse(
          await readFile(
            directory
              ? resolve(directory, `source-${i}.json`)
              : new URL(`../data/source-${i}.json`, import.meta.url),
            'utf8',
          ),
        ) as { values: unknown[][] },
    ),
  );
  const rows = files.map((f) =>
    f.values.map((data, i) => ({ row: i + 1, data })).filter((x) => typeof x.data[0] === 'number'),
  );
  const [master, log, invoices] = rows;
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const [exists] = await db.query(
    'SELECT id FROM source_imports WHERE business_id=$1 AND source_hash=$2',
    [b, hash],
  );
  if (exists) return { alreadyImported: true };
  const masterSku = new Set(master.map((x) => String(x.data[1])));
  const sourceSku = new Set(log.map((x) => String(x.data[5])));
  const logTotal = log.reduce((s, x) => s + Number(x.data[12]), 0),
    invoiceTotal = invoices.reduce((s, x) => s + Number(x.data[7]), 0);
  const discrepancies = invoices
    .map((x) => {
      const a = x.data;
      const matching = log.filter((t) => t.data[2] === a[4] && t.data[13] === a[8]);
      const lineTotal = matching.reduce((s, t) => s + Number(t.data[12]), 0);
      return {
        invoice: a[4],
        supplier: a[3],
        sourceRow: x.row,
        reference: a[8],
        invoiceTotal: Number(a[7]),
        lineTotal,
        difference: lineTotal - Number(a[7]),
      };
    })
    .filter((x) => x.difference !== 0);
  const report = {
    masterProducts: master.length,
    historicalLines: log.length,
    invoices: invoices.length,
    masterQuantity: master.reduce((s, x) => s + Number(x.data[8]), 0),
    historicalQuantity: log.reduce((s, x) => s + Number(x.data[7]) - Number(x.data[8]), 0),
    masterValuation: master.reduce((s, x) => s + Number(x.data[12]), 0),
    logTotal,
    invoiceTotal,
    valueDifference: logTotal - invoiceTotal,
    extraSkus: [...sourceSku].filter((s) => !masterSku.has(s)),
    discrepancies,
    warnings: [
      'Saldo awal belum dibukukan: perlu konfirmasi pengguna.',
      'Histori mutasi dan nota diarsipkan sebagai data belum terverifikasi, bukan stok masuk baru.',
      'Harga jual, barcode, batas stok dan konversi kemasan tidak tersedia di sumber.',
      'Nama supplier berbeda tidak digabung otomatis.',
      'Nama file gambar adalah referensi, bukan arsip gambar yang sudah diunggah.',
    ],
    sourceUrl: process.env.SOURCE_SHEET_URL ?? null,
    fetchedAt: '2026-11-08',
  };
  const payload = {
    master,
    log,
    invoices,
    report,
    hash,
    sourceId: process.env.SOURCE_SHEET_ID ?? null,
  };
  // Single stored procedure transaction. Rollback on any invalid source row.
  const [r] = await db.query('SELECT import_source($1,$2::jsonb) result', [
    b,
    JSON.stringify(payload),
  ]);
  return r;
}
