import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DB } from '../server/db';
import { migrate } from '../scripts/migrate';
import { importData } from '../scripts/import-data';
import { analyze } from '../server/analytics';
import { app } from '../server/index';
import { hashPassword, verifyPassword } from '../server/auth';
let pg: PGlite;
let db: DB;
let b: string, loc: string, owner: string, cashier: string, supplier: string;
const id = () => crypto.randomUUID();
const query = <T = Record<string, unknown>>(s: string, p: unknown[] = []) => db.query<T>(s, p);
const post = async (
  type: string,
  lines: unknown[],
  extra: Record<string, unknown> = {},
  actor = owner,
) => {
  const body = {
    type,
    location_id: loc,
    reference: 'TEST-' + id(),
    idempotency_key: id(),
    reason: 'Pengujian ledger',
    lines,
    ...extra,
  };
  const [r] = await query<{ result: Record<string, unknown> }>(
    'SELECT post_operation($1,$2,$3::jsonb) result',
    [b, actor, JSON.stringify(body)],
  );
  return { result: r.result, body };
};
async function product(stock = 0) {
  const [p] = await query<{ id: string }>(
    'INSERT INTO products(business_id,sku,name,base_unit,purchase_cost,selling_price) VALUES($1,$2,$3,$4,100,150) RETURNING id',
    [b, 'SKU-' + id(), 'Produk uji', 'PCS'],
  );
  if (stock)
    await post('OPENING_BALANCE', [
      { product_id: p.id, quantity: stock, unit: 'PCS', unit_price: 100 },
    ]);
  return p.id;
}
const line = (p: string, q = 1, price = 150) => ({
  product_id: p,
  quantity: q,
  unit: 'PCS',
  unit_price: price,
});
async function balance(p: string) {
  return (
    (
      await query<{ quantity: string }>(
        'SELECT quantity FROM inventory_balances WHERE business_id=$1 AND location_id=$2 AND product_id=$3',
        [b, loc, p],
      )
    )[0]?.quantity ?? '0'
  );
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  db = {
    query: async <T>(text: string, params: unknown[] = []) =>
      params.length
        ? (await pg.query<T>(text, params)).rows
        : ((await pg.exec(text)).at(-1)!.rows as T[]),
  };
  await migrate(db);
  b = id();
  loc = id();
  owner = id();
  cashier = id();
  supplier = id();
  await query('INSERT INTO businesses(id,name) VALUES($1,$2)', [b, 'Test Business']);
  await query('INSERT INTO locations(id,business_id,name) VALUES($1,$2,$3)', [loc, b, 'Utama']);
  for (const [uid, role] of [
    [owner, 'owner'],
    [cashier, 'cashier'],
  ]) {
    await query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
      uid,
      uid + '@test.local',
      role,
      await hashPassword('test-password-long'),
    ]);
    await query('INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,$3)', [
      b,
      uid,
      role,
    ]);
  }
  await query('INSERT INTO suppliers(id,business_id,name) VALUES($1,$2,$3)', [
    supplier,
    b,
    'Supplier Uji',
  ]);
}, 60000);
afterAll(async () => {
  await pg.close();
});
describe.sequential('Batas transaksi PostgreSQL', () => {
  it('saldo awal dan kasir mengubah ledger sekali', async () => {
    const p = await product(10);
    const { result, body } = await post('SALE', [line(p, 2)], {
      payment_method: 'cash',
      tendered: 500,
    });
    expect(Number(await balance(p))).toBe(8);
    const replay = await query<{ r: Record<string, unknown> }>(
      'SELECT post_operation($1,$2,$3::jsonb) r',
      [b, owner, JSON.stringify(body)],
    );
    expect(replay[0].r.replayed).toBe(true);
    expect(Number(await balance(p))).toBe(8);
    expect(result.total).toBe(300);
  });
  it('menolak penggunaan ulang kunci dengan isi berbeda', async () => {
    const p = await product(4);
    const { body } = await post('SALE', [line(p)], { payment_method: 'cash', tendered: 150 });
    await expect(
      query('SELECT post_operation($1,$2,$3::jsonb)', [
        b,
        owner,
        JSON.stringify({ ...body, discount: 1 }),
      ]),
    ).rejects.toThrow('data berbeda');
  });
  it('rollback seluruh keranjang jika satu produk kurang stok', async () => {
    const p = await product(3),
      q = await product(1);
    const before = await query('SELECT id FROM sales WHERE business_id=$1', [b]);
    await expect(
      post('SALE', [line(p, 2), line(q, 4)], { payment_method: 'cash', tendered: 1000 }),
    ).rejects.toThrow('Stok tidak cukup');
    expect(Number(await balance(p))).toBe(3);
    expect((await query('SELECT id FROM sales WHERE business_id=$1', [b])).length).toBe(
      before.length,
    );
  });
  it('mencegah saldo awal ganda meskipun kuncinya berbeda', async () => {
    const p = await product(2);
    await expect(post('OPENING_BALANCE', [line(p, 3, 100)])).rejects.toThrow('sudah tercatat');
  });
  it('penerimaan kedua menambah stok produk yang sama', async () => {
    const p = await product(10);
    for (let i = 0; i < 2; i++)
      await post('PURCHASE_RECEIPT', [{ ...line(p, 2, 100), received_quantity: 2 }], {
        supplier_id: supplier,
        invoice_number: 'INV-' + id(),
        invoice_date: '2026-11-08',
        printed_total: 200,
      });
    expect(Number(await balance(p))).toBe(14);
    const [r] = await query<{ n: string }>('SELECT count(*) n FROM products WHERE id=$1', [p]);
    expect(Number(r.n)).toBe(1);
  });
  it('memisahkan jumlah nota, fisik dan rusak serta memblokir pembayaran', async () => {
    const p = await product();
    const { result } = await post(
      'PURCHASE_RECEIPT',
      [{ ...line(p, 10, 100), received_quantity: 8, damaged_quantity: 1 }],
      {
        supplier_id: supplier,
        invoice_number: 'PART-' + id(),
        invoice_date: '2026-11-08',
        due_date: '2026-12-08',
        printed_total: 1000,
      },
    );
    expect(Number(await balance(p))).toBe(7);
    const [inv] = await query<{ status: string; total: string }>(
      'SELECT status,total FROM supplier_invoices WHERE id=$1',
      [result.invoice_id],
    );
    expect(inv.status).toBe('blocked');
    expect(Number(inv.total)).toBe(1000);
    await expect(
      post('PAYMENT', [], {
        invoice_id: result.invoice_id,
        amount: 100,
        method: 'cash',
        proof_reference: 'BUKTI-1',
      }),
    ).rejects.toThrow('belum disetujui');
  });
  it('menolak konversi kemasan yang belum dikonfirmasi', async () => {
    const p = await product();
    await expect(
      post('PURCHASE_RECEIPT', [{ ...line(p, 2, 2400), unit: 'DUS', received_quantity: 2 }], {
        supplier_id: supplier,
        invoice_number: id(),
        invoice_date: '2026-11-08',
      }),
    ).rejects.toThrow('Konversi satuan');
    await query(
      'INSERT INTO product_unit_conversions(business_id,product_id,unit,multiplier) VALUES($1,$2,$3,24)',
      [b, p, 'DUS'],
    );
    await post('PURCHASE_RECEIPT', [{ ...line(p, 2, 2400), unit: 'DUS', received_quantity: 2 }], {
      supplier_id: supplier,
      invoice_number: id(),
      invoice_date: '2026-11-08',
    });
    expect(Number(await balance(p))).toBe(48);
  });
  it('total nota yang tidak cocok tidak mengubah stok', async () => {
    const p = await product(3);
    await expect(
      post('PURCHASE_RECEIPT', [{ ...line(p, 2, 100), received_quantity: 2 }], {
        supplier_id: supplier,
        invoice_number: id(),
        invoice_date: '2026-11-08',
        printed_total: 999,
      }),
    ).rejects.toThrow('Total nota tidak sesuai');
    expect(Number(await balance(p))).toBe(3);
  });
  it('pembayaran sebagian dapat diulang tanpa duplikasi', async () => {
    const p = await product();
    const { result } = await post(
      'PURCHASE_RECEIPT',
      [{ ...line(p, 3, 100), received_quantity: 3 }],
      { supplier_id: supplier, invoice_number: id(), invoice_date: '2026-11-08' },
    );
    const { body } = await post('PAYMENT', [], {
      invoice_id: result.invoice_id,
      amount: 100,
      method: 'transfer',
      proof_reference: 'TRANSFER-TEST',
    });
    await query('SELECT post_operation($1,$2,$3::jsonb)', [b, owner, JSON.stringify(body)]);
    const [inv] = await query<{ paid_amount: string }>(
      'SELECT paid_amount FROM supplier_invoices WHERE id=$1',
      [result.invoice_id],
    );
    expect(Number(inv.paid_amount)).toBe(100);
    await expect(
      post('PAYMENT', [], {
        invoice_id: result.invoice_id,
        amount: 201,
        method: 'cash',
        proof_reference: 'T-2',
      }),
    ).rejects.toThrow('pembayaran tidak valid');
  });
  it('kasir tidak boleh mengubah saldo awal', async () => {
    const p = await product();
    await expect(post('OPENING_BALANCE', [line(p)], {}, cashier)).rejects.toThrow(
      'Akses transaksi',
    );
  });
  it('retur tidak boleh melebihi transaksi asal', async () => {
    const p = await product(5);
    const { result } = await post('SALE', [line(p, 2)], { payment_method: 'cash', tendered: 300 });
    await post('CUSTOMER_RETURN', [line(p, 1)], { original_operation_id: result.id });
    expect(Number(await balance(p))).toBe(4);
    await expect(
      post('CUSTOMER_RETURN', [line(p, 2)], { original_operation_id: result.id }),
    ).rejects.toThrow('melebihi');
  });
  it('ledger tidak bisa diedit', async () => {
    await expect(
      query(
        'UPDATE inventory_movements SET quantity=100 WHERE id=(SELECT min(id) FROM inventory_movements)',
      ),
    ).rejects.toThrow('Riwayat tidak dapat diubah');
  });
  it('menolak produk lintas bisnis', async () => {
    const foreign = id();
    await query('INSERT INTO businesses(id,name) VALUES($1,$2)', [foreign, 'Other']);
    const [p] = await query<{ id: string }>(
      'INSERT INTO products(business_id,sku,name,base_unit) VALUES($1,$2,$3,$4) RETURNING id',
      [foreign, id(), 'Foreign', 'PCS'],
    );
    await expect(post('OPENING_BALANCE', [line(p.id)])).rejects.toThrow('Produk tidak ditemukan');
  });
  it('impor sumber idempoten dan tidak membuat saldo/hutang historis', async () => {
    const other = id();
    await query('INSERT INTO businesses(id,name) VALUES($1,$2)', [other, 'Import Test']);
    await importData(db, other, new URL('./fixtures', import.meta.url).pathname);
    const repeated = await importData(db, other, new URL('./fixtures', import.meta.url).pathname);
    expect(repeated.alreadyImported).toBe(true);
    const [r] = await query<{ p: string; s: string; v: string }>(
      `SELECT (SELECT count(*) FROM products WHERE business_id=$1) p,(SELECT count(*) FROM source_records WHERE business_id=$1) s,(SELECT count(*) FROM inventory_movements WHERE business_id=$1) v`,
      [other],
    );
    expect(Number(r.p)).toBeGreaterThanOrEqual(1);
    expect(Number(r.s)).toBe(5);
    expect(Number(r.v)).toBe(0);
  });
  it('analisis menyimpan tag dan dapat dijalankan ulang', async () => {
    const result = await analyze(db, b, owner);
    expect(result.coverage.products).toBeGreaterThan(0);
    const again = await analyze(db, b, owner);
    const [count] = await query<{ n: string }>(
      `SELECT count(*) n FROM tags WHERE business_id=$1 AND source='rule'`,
      [b],
    );
    expect(Number(count.n)).toBeGreaterThanOrEqual(again.insights.length);
  });
  it('API menolak tanpa sesi dan menolak cross-origin', async () => {
    const env = {
      LOCAL_DB: db,
      DATABASE_URL: '',
      SESSION_SECRET: 'test-secret-never-deploy',
      BUSINESS_ID: b,
      APP_ORIGIN: 'http://localhost:5173',
    };
    const a = await app.request('http://localhost:5173/api/snapshot', {}, env);
    expect(a.status).toBe(401);
    const c = await app.request(
      'http://localhost:5173/api/login',
      {
        method: 'POST',
        headers: { Origin: 'https://malicious.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: owner + '@test.local', password: 'test-password-long' }),
      },
      env,
    );
    expect(c.status).toBe(403);
  });
  it('opname memasukkan jumlah fisik, termasuk nol, secara atomik', async () => {
    const p = await product(10);
    await post('STOCK_ADJUSTMENT', [{ ...line(p), counted_quantity: 6 }]);
    expect(Number(await balance(p))).toBe(6);
    await post('STOCK_ADJUSTMENT', [{ ...line(p), counted_quantity: 0 }]);
    expect(Number(await balance(p))).toBe(0);
  });
  it('biaya header dialokasikan ke modal barang', async () => {
    const p = await product();
    const { result } = await post(
      'PURCHASE_RECEIPT',
      [{ ...line(p, 10, 100), received_quantity: 10 }],
      {
        supplier_id: supplier,
        invoice_number: id(),
        invoice_date: '2026-11-08',
        discount: 100,
        tax: 50,
        rounding: -1,
        printed_total: 949,
      },
    );
    expect(result.total).toBe(949);
    const [r] = await query<{ average_cost: string }>(
      'SELECT average_cost FROM inventory_balances WHERE business_id=$1 AND product_id=$2',
      [b, p],
    );
    expect(Number(r.average_cost)).toBe(94.9);
  });
  it('dokumen identik tidak dapat dibukukan dengan nomor nota lain', async () => {
    const p = await product();
    const hash = id();
    await post('PURCHASE_RECEIPT', [{ ...line(p, 1, 100), received_quantity: 1 }], {
      supplier_id: supplier,
      invoice_number: id(),
      invoice_date: '2026-11-08',
      document_hash: hash,
    });
    await expect(
      post('PURCHASE_RECEIPT', [{ ...line(p, 1, 100), received_quantity: 1 }], {
        supplier_id: supplier,
        invoice_number: id(),
        invoice_date: '2026-11-08',
        document_hash: hash,
      }),
    ).rejects.toThrow();
    expect(Number(await balance(p))).toBe(1);
  });
  it('penerimaan lebih besar dari sisa PO memblokir nota', async () => {
    const p = await product();
    const [po] = await query<{ id: string }>(
      'INSERT INTO purchase_orders(business_id,supplier_id,reference) VALUES($1,$2,$3) RETURNING id',
      [b, supplier, id()],
    );
    await query(
      'INSERT INTO purchase_order_lines(business_id,order_id,product_id,quantity,unit,unit_price) VALUES($1,$2,$3,2,$4,100)',
      [b, po.id, p, 'PCS'],
    );
    const { result } = await post(
      'PURCHASE_RECEIPT',
      [{ ...line(p, 3, 100), received_quantity: 3 }],
      { supplier_id: supplier, invoice_number: id(), invoice_date: '2026-11-08', order_id: po.id },
    );
    const [r] = await query<{ status: string }>(
      'SELECT status FROM supplier_invoices WHERE id=$1',
      [result.invoice_id],
    );
    expect(r.status).toBe('blocked');
  });
  it('transfer mengurangi gudang asal dan menambah gudang tujuan bersama', async () => {
    const p = await product(5),
      target = id();
    await query('INSERT INTO locations(id,business_id,name) VALUES($1,$2,$3)', [
      target,
      b,
      'Cabang Uji',
    ]);
    await post('TRANSFER', [line(p, 2)], { target_location_id: target });
    expect(Number(await balance(p))).toBe(3);
    const [r] = await query<{ quantity: string }>(
      'SELECT quantity FROM inventory_balances WHERE business_id=$1 AND location_id=$2 AND product_id=$3',
      [b, target, p],
    );
    expect(Number(r.quantity)).toBe(2);
  });
  it('SKU dengan perbedaan kapital tidak membuat produk ganda', async () => {
    const sku = 'UNIK-' + id();
    await query('INSERT INTO products(business_id,sku,name,base_unit) VALUES($1,$2,$3,$4)', [
      b,
      sku,
      'Produk A',
      'PCS',
    ]);
    await expect(
      query('INSERT INTO products(business_id,sku,name,base_unit) VALUES($1,$2,$3,$4)', [
        b,
        sku.toLowerCase(),
        'Produk B',
        'PCS',
      ]),
    ).rejects.toThrow();
  });
  it('impor katalog memperbarui SKU lama tanpa mengubah saldo', async () => {
    const p = await product(7);
    const [r] = await query<{ sku: string }>('SELECT sku FROM products WHERE id=$1', [p]);
    const payload = [
      {
        sku: r.sku,
        name: 'Nama diperbarui',
        barcode: null,
        base_unit: 'PCS',
        purchase_cost: 120,
        selling_price: 180,
        min_stock: 2,
        active: true,
        pieces_per_base: 1,
      },
    ];
    await query('SELECT import_catalog($1,$2,$3::jsonb)', [b, owner, JSON.stringify(payload)]);
    expect(Number(await balance(p))).toBe(7);
    const [price] = await query<{ selling_price: string }>(
      'SELECT selling_price FROM products WHERE id=$1',
      [p],
    );
    expect(Number(price.selling_price)).toBe(180);
  });
  it('kesalahan satu baris CSV membatalkan seluruh impor', async () => {
    const barcode = 'BAR-' + id();
    const payload = [
      {
        sku: id(),
        name: 'A',
        barcode,
        base_unit: 'PCS',
        purchase_cost: 1,
        selling_price: 2,
        min_stock: 0,
        active: true,
      },
      {
        sku: id(),
        name: 'B',
        barcode,
        base_unit: 'PCS',
        purchase_cost: 1,
        selling_price: 2,
        min_stock: 0,
        active: true,
      },
    ];
    await expect(
      query('SELECT import_catalog($1,$2,$3::jsonb)', [b, owner, JSON.stringify(payload)]),
    ).rejects.toThrow();
    const [r] = await query<{ n: string }>(
      'SELECT count(*) n FROM products WHERE business_id=$1 AND barcode=$2',
      [b, barcode],
    );
    expect(Number(r.n)).toBe(0);
  });
  it('persetujuan selisih dan pelunasan tercatat dengan bukti', async () => {
    const p = await product();
    const { result } = await post(
      'PURCHASE_RECEIPT',
      [{ ...line(p, 2, 100), received_quantity: 1 }],
      { supplier_id: supplier, invoice_number: id(), invoice_date: '2026-11-08' },
    );
    await query('SELECT approve_invoice($1,$2,$3,$4)', [
      b,
      owner,
      result.invoice_id,
      'Supplier mengonfirmasi pengiriman sisa terpisah.',
    ]);
    await post('PAYMENT', [], {
      invoice_id: result.invoice_id,
      amount: 200,
      method: 'cash',
      proof_reference: 'BUKTI-LUNAS',
    });
    const [r] = await query<{ status: string; paid_amount: string }>(
      'SELECT status,paid_amount FROM supplier_invoices WHERE id=$1',
      [result.invoice_id],
    );
    expect(r.status).toBe('paid');
    expect(Number(r.paid_amount)).toBe(200);
  });
  it('aktivasi pemilik mengatur password sekali tanpa membuka sesi anonim', async () => {
    const token = 'ab'.repeat(32),
      tokenHash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      )
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    await query(
      "INSERT INTO account_setup_tokens(business_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [b, owner, tokenHash],
    );
    const env = {
      LOCAL_DB: db,
      DATABASE_URL: '',
      SESSION_SECRET: 'test-only-secret',
      BUSINESS_ID: b,
      APP_ORIGIN: 'http://localhost:5173',
    };
    const request = () =>
      app.request(
        'http://localhost:5173/api/setup',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password: 'password-new-owner-strong' }),
        },
        env,
      );
    const response = await request();
    expect(response.status).toBe(200);
    expect((await request()).status).toBe(400);
    const [u] = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id=$1',
      [owner],
    );
    expect(await verifyPassword('password-new-owner-strong', u.password_hash)).toBe(true);
  });
  it('tautan aktivasi kedaluwarsa ditolak', async () => {
    const token = 'cd'.repeat(32),
      hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      )
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    await query(
      "INSERT INTO account_setup_tokens(business_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()-interval '1 hour')",
      [b, owner, hash],
    );
    const response = await app.request(
      'http://localhost:5173/api/setup',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'valid-strong-password' }),
      },
      {
        LOCAL_DB: db,
        DATABASE_URL: '',
        SESSION_SECRET: 'test',
        BUSINESS_ID: b,
        APP_ORIGIN: 'http://localhost:5173',
      },
    );
    expect(response.status).toBe(400);
  });
  it('tag fakta transaksi langsung tercatat tanpa menunggu analisis', async () => {
    const p = await product(2);
    const { result } = await post('SALE', [line(p, 1)], { payment_method: 'cash', tendered: 150 });
    const [t] = await query<{ tag: string }>(
      "SELECT tag FROM tags WHERE business_id=$1 AND entity_type='operation' AND entity_id=$2 AND source='rule'",
      [b, result.id],
    );
    expect(t.tag).toBe('TRANSAKSI_SALE');
  });
});
