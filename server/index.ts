import type configuration from '../cloudflare.config';
import type { InferEnv, UnwrapConfig } from 'cf/config';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { database, type DB } from './db';
import {
  verifyPassword,
  hashPassword,
  passwordVersion,
  readSession,
  signSession,
  type Session,
} from './auth';
import { analyze } from './analytics';
type RuntimeBindings = InferEnv<UnwrapConfig<typeof configuration.worker>>;
type Env = Omit<RuntimeBindings, 'ASSETS'> & {
  ASSETS?: RuntimeBindings['ASSETS'];
  APP_ORIGIN?: string;
  LOCAL_DB?: DB;
};

type AppEnv = { Bindings: Env; Variables: { db: DB; user: Session } };
export const app = new Hono<AppEnv>();
const uuid = z.string().uuid();
const finite = z.coerce.number().finite();
const number = finite.min(0).max(1e12);
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Permintaan terlalu besar.' }, 413),
  }),
);
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(self), microphone=()');
  if (c.req.path.startsWith('/api')) c.header('Cache-Control', 'no-store');
  else
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
});
app.use('/api/*', async (c, next) => {
  if (!c.env.LOCAL_DB && (!c.env.DATABASE_URL || !c.env.SESSION_SECRET || !c.env.BUSINESS_ID))
    return c.json({ error: 'Database dan autentikasi belum dikonfigurasi.' }, 503);
  c.set('db', c.env.LOCAL_DB ?? database(c.env.DATABASE_URL));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    const expected = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
    if (!origin || origin !== expected)
      return c.json({ error: 'Asal permintaan tidak diizinkan.' }, 403);
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: 'Gunakan JSON.' }, 415);
  }
  if (c.req.path === '/api/login') return next();
  const session = await readSession(
    getCookie(c, 'ns_session') ?? '',
    c.env.SESSION_SECRET,
    c.get('db'),
  );
  if (!session || session.businessId !== c.env.BUSINESS_ID)
    return c.json({ error: 'Silakan masuk kembali.' }, 401);
  c.set('user', session);
  await next();
});
function requireRole(role: string, action: string) {
  const allow: Record<string, string[]> = {
    owner: ['read', 'catalog', 'purchase', 'receive', 'sell', 'pay', 'adjust', 'settings'],
    manager: ['read', 'catalog', 'purchase', 'receive', 'sell', 'pay', 'adjust'],
    warehouse: ['read', 'receive'],
    cashier: ['read', 'sell'],
  };
  if (!allow[role]?.includes(action)) throw new Error('FORBIDDEN');
}
function context(c: { get: (key: 'user') => Session }) {
  const u = c.get('user');
  return { b: u.businessId, u };
}
app.post('/api/login', async (c) => {
  const input = z
    .object({ email: z.email().max(200), password: z.string().min(1).max(200) })
    .parse(await c.req.json());
  const db = c.get('db');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      input.email.toLowerCase() + ':' + (c.req.header('CF-Connecting-IP') ?? 'local'),
    ),
  );
  const key = Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const [attempt] = await db.query<{ attempts: number }>(
    `INSERT INTO login_attempts(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts`,
    [key],
  );
  if (attempt.attempts > 10)
    return c.json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' }, 429);
  const [user] = await db.query<{
    id: string;
    email: string;
    name: string;
    password_hash: string;
    role: string;
  }>(
    `SELECT u.id,u.email,u.name,u.password_hash,m.role FROM users u JOIN business_memberships m ON m.user_id=u.id WHERE lower(u.email)=$1 AND u.active AND m.business_id=$2`,
    [input.email.toLowerCase(), c.env.BUSINESS_ID],
  );
  if (!user || !(await verifyPassword(input.password, user.password_hash)))
    return c.json({ error: 'Email atau kata sandi salah.' }, 401);
  const session: Session = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    businessId: c.env.BUSINESS_ID,
    expires: Date.now() + 8 * 3600e3,
    passwordVersion: await passwordVersion(user.password_hash),
  };
  setCookie(c, 'ns_session', await signSession(session, c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 3600,
  });
  return c.json({ ok: true });
});
app.post('/api/logout', (c) => {
  deleteCookie(c, 'ns_session', { path: '/' });
  return c.json({ ok: true });
});
app.post('/api/password', async (c) => {
  const { u } = context(c);
  const x = z
    .object({ current: z.string(), password: z.string().min(12).max(200) })
    .parse(await c.req.json());
  const db = c.get('db');
  const [row] = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id=$1',
    [u.id],
  );
  if (!(await verifyPassword(x.current, row.password_hash)))
    return c.json({ error: 'Kata sandi saat ini salah.' }, 400);
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
    await hashPassword(x.password),
    u.id,
  ]);
  deleteCookie(c, 'ns_session', { path: '/' });
  return c.json({ ok: true });
});
app.get('/api/snapshot', async (c) => {
  const { b, u } = context(c),
    db = c.get('db');
  const queries = {
    business: db.query('SELECT id,name FROM businesses WHERE id=$1', [b]),
    balances: db.query(
      `SELECT i.product_id,i.location_id,i.quantity,i.average_cost,p.sku,p.name,p.base_unit,l.name location FROM inventory_balances i JOIN products p ON p.id=i.product_id JOIN locations l ON l.id=i.location_id WHERE i.business_id=$1 ORDER BY l.name,p.name LIMIT 10000`,
      [b],
    ),
    products: db.query(
      `SELECT p.id,p.sku,p.barcode,p.name,p.base_unit,p.purchase_cost,p.pieces_per_base,p.selling_price,p.min_stock,p.stock_verified,p.active,c.name category,coalesce(b.qty,0) quantity,coalesce(b.cost,p.purchase_cost) average_cost FROM products p LEFT JOIN product_categories c ON c.id=p.category_id LEFT JOIN (SELECT product_id,sum(quantity) qty,sum(quantity*average_cost)/NULLIF(sum(quantity),0) cost FROM inventory_balances WHERE business_id=$1 GROUP BY product_id) b ON b.product_id=p.id WHERE p.business_id=$1 ORDER BY p.name LIMIT 5000`,
      [b],
    ),
    suppliers: db.query(
      'SELECT id,name,contact,whatsapp,address,payment_days,lead_days FROM suppliers WHERE business_id=$1 AND active ORDER BY name LIMIT 1000',
      [b],
    ),
    locations: db.query('SELECT id,name FROM locations WHERE business_id=$1 ORDER BY name', [b]),
    invoices: db.query(
      `SELECT i.id,i.invoice_number,i.invoice_date,i.delivery_date,i.due_date,i.total,i.paid_amount,i.status,i.match_warnings,s.name supplier_name,i.operation_id FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE i.business_id=$1 ORDER BY i.invoice_date DESC LIMIT 200`,
      [b],
    ),
    orders: db.query(
      `SELECT o.id,o.reference,o.supplier_id,o.status,o.created_at,s.name supplier_name,(SELECT jsonb_agg(jsonb_build_object('product_id',l.product_id,'name',p.name,'quantity',l.quantity,'received_quantity',l.received_quantity,'unit',l.unit,'unit_price',l.unit_price)) FROM purchase_order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=o.id) lines FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.business_id=$1 ORDER BY o.created_at DESC LIMIT 200`,
      [b],
    ),
    sales: db.query(
      'SELECT id,operation_id,reference,total,discount,cost_total,payment_method,tendered,created_at FROM sales WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200',
      [b],
    ),
    movements: db.query(
      `SELECT m.id,m.operation_id,m.created_at,m.type,m.quantity,m.unit_cost,m.reference,p.sku,p.name,l.name location FROM inventory_movements m JOIN products p ON p.id=m.product_id JOIN locations l ON l.id=m.location_id WHERE m.business_id=$1 ORDER BY m.id DESC LIMIT 200`,
      [b],
    ),
    imports: db.query(
      'SELECT id,source_title,report,imported_at FROM source_imports WHERE business_id=$1 ORDER BY imported_at DESC LIMIT 20',
      [b],
    ),
    source: db.query(
      'SELECT id,sheet,row_number,data,status FROM source_records WHERE business_id=$1 ORDER BY sheet,row_number LIMIT 2000',
      [b],
    ),
    tags: db.query(
      'SELECT entity_type,entity_id,tag,source,evidence FROM tags WHERE business_id=$1 ORDER BY created_at DESC LIMIT 5000',
      [b],
    ),
    drafts: db.query(
      `SELECT id,mode,data,version,updated_at FROM ocr_review_drafts WHERE business_id=$1 AND status='draft' ORDER BY updated_at DESC LIMIT 30`,
      [b],
    ),
    conversions: db.query(
      'SELECT product_id,unit,multiplier FROM product_unit_conversions WHERE business_id=$1',
      [b],
    ),
    mappings: db.query(
      'SELECT product_id,supplier_id,supplier_code,alias FROM product_supplier_mappings WHERE business_id=$1',
      [b],
    ),
    prices: db.query(
      `SELECT h.id,h.product_id,h.supplier_id,p.sku,p.name,s.name supplier,h.unit_cost,h.observed_at,h.reference FROM supplier_price_history h JOIN products p ON p.id=h.product_id JOIN suppliers s ON s.id=h.supplier_id WHERE h.business_id=$1 ORDER BY h.observed_at DESC LIMIT 1000`,
      [b],
    ),
    summary: db.query(
      `SELECT (SELECT coalesce(sum(total),0) FROM sales WHERE business_id=$1 AND (created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date) today_sales,(SELECT coalesce(sum(total-cost_total),0) FROM sales WHERE business_id=$1 AND (created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date) today_profit,(SELECT coalesce(sum(quantity*average_cost),0) FROM inventory_balances WHERE business_id=$1) valuation,(SELECT coalesce(sum(total-paid_amount),0) FROM supplier_invoices WHERE business_id=$1) payables,(SELECT count(*) FROM products WHERE business_id=$1 AND NOT stock_verified) unverified,(SELECT count(*) FROM sales WHERE business_id=$1) sales_count`,
      [b],
    ),
  };
  const entries = await Promise.all(
    Object.entries(queries).map(async ([k, v]) => [k, await v] as const),
  );
  const result = Object.fromEntries(entries);
  return c.json({
    ...result,
    business: result.business[0],
    summary: result.summary[0],
    user: { id: u.id, name: u.name, email: u.email, role: u.role },
  });
});
app.post('/api/operations', async (c) => {
  const { b, u } = context(c);
  const body = z
    .object({
      type: z.enum([
        'SALE',
        'PURCHASE_RECEIPT',
        'OPENING_BALANCE',
        'STOCK_ADJUSTMENT',
        'DAMAGE',
        'CUSTOMER_RETURN',
        'SUPPLIER_RETURN',
        'TRANSFER',
        'PAYMENT',
      ]),
      location_id: uuid,
      idempotency_key: z.string().min(8).max(200),
      reference: z.string().min(1).max(200),
    })
    .passthrough()
    .parse(await c.req.json());
  const [row] = await c
    .get('db')
    .query<{ result: unknown }>('SELECT post_operation($1,$2,$3::jsonb) result', [
      b,
      u.id,
      JSON.stringify(body),
    ]);
  return c.json(row.result);
});
app.post('/api/products', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'catalog');
  const x = z
    .object({
      id: uuid.optional(),
      sku: z.string().min(1).max(150),
      name: z.string().min(1).max(500),
      barcode: z.string().max(100).nullable().optional(),
      base_unit: z.string().min(1).max(30),
      purchase_cost: number,
      selling_price: number.nullable(),
      min_stock: number,
      pieces_per_base: finite.positive().max(1000000).nullable().optional(),
      active: z.boolean().default(true),
    })
    .parse(await c.req.json());
  const db = c.get('db');
  const [row] = await db.query(
    `WITH change AS (INSERT INTO products(id,business_id,sku,name,barcode,base_unit,purchase_cost,selling_price,min_stock,active,pieces_per_base) VALUES(coalesce($1::uuid,gen_random_uuid()),$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10,$13) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,name=excluded.name,barcode=excluded.barcode,base_unit=excluded.base_unit,purchase_cost=excluded.purchase_cost,selling_price=excluded.selling_price,min_stock=excluded.min_stock,active=excluded.active,pieces_per_base=excluded.pieces_per_base WHERE products.business_id=$2 AND products.base_unit=excluded.base_unit RETURNING id), audit AS (INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $2,$11,'SAVE_PRODUCT','product',id::text,$12::jsonb FROM change) SELECT id FROM change`,
    [
      x.id ?? null,
      b,
      x.sku,
      x.name,
      x.barcode ?? null,
      x.base_unit,
      x.purchase_cost,
      x.selling_price,
      x.min_stock,
      x.active,
      u.id,
      JSON.stringify(x),
      x.pieces_per_base ?? null,
    ],
  );
  if (!row)
    return c.json({ error: 'Satuan dasar produk yang sudah dibuat tidak dapat diubah.' }, 400);
  return c.json(row);
});
app.post('/api/products/import', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'catalog');
  const row = z.object({
    sku: z.string().min(1).max(150),
    name: z.string().min(1).max(500),
    barcode: z.string().max(100).nullable().optional(),
    base_unit: z.string().min(1).max(30),
    purchase_cost: number,
    selling_price: number.nullable(),
    min_stock: number,
    pieces_per_base: finite.positive().nullable().optional(),
    active: z.boolean().default(true),
  });
  const x = z
    .array(row)
    .min(1)
    .max(500)
    .parse(await c.req.json());
  if (new Set(x.map((r) => r.sku)).size !== x.length)
    return c.json({ error: 'SKU duplikat dalam impor.' }, 400);
  const [r] = await c
    .get('db')
    .query('SELECT import_catalog($1,$2,$3::jsonb) count', [b, u.id, JSON.stringify(x)]);
  return c.json(r);
});
app.post('/api/conversions', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'catalog');
  const x = z
    .object({
      product_id: uuid,
      unit: z.string().min(1).max(30),
      multiplier: finite.positive().max(100000),
    })
    .parse(await c.req.json());
  await c
    .get('db')
    .query(
      `WITH change AS(INSERT INTO product_unit_conversions(business_id,product_id,unit,multiplier) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,product_id,unit) DO UPDATE SET multiplier=excluded.multiplier RETURNING product_id) INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $1,$5,'SET_CONVERSION','product',product_id::text,$6::jsonb FROM change`,
      [b, x.product_id, x.unit, x.multiplier, u.id, JSON.stringify(x)],
    );
  return c.json({ ok: true });
});
app.post('/api/aliases', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'catalog');
  const x = z
    .object({
      product_id: uuid,
      supplier_id: uuid,
      supplier_code: z.string().min(1),
      alias: z.string().nullable(),
    })
    .parse(await c.req.json());
  await c
    .get('db')
    .query(
      `WITH change AS(INSERT INTO product_supplier_mappings(business_id,product_id,supplier_id,supplier_code,alias,confirmed_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id,supplier_id,supplier_code) DO UPDATE SET product_id=excluded.product_id,alias=excluded.alias,confirmed_by=excluded.confirmed_by RETURNING id) INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $1,$6,'CONFIRM_ALIAS','mapping',id::text,$7::jsonb FROM change`,
      [b, x.product_id, x.supplier_id, x.supplier_code, x.alias, u.id, JSON.stringify(x)],
    );
  return c.json({ ok: true });
});
app.post('/api/suppliers', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'purchase');
  const x = z
    .object({
      name: z.string().min(2).max(200),
      contact: z.string().optional(),
      whatsapp: z.string().optional(),
      address: z.string().optional(),
      payment_days: z.coerce.number().int().min(0).max(365),
      lead_days: z.coerce.number().int().min(0).max(365),
    })
    .parse(await c.req.json());
  const [r] = await c
    .get('db')
    .query(
      `WITH s AS(INSERT INTO suppliers(business_id,name,contact,whatsapp,address,payment_days,lead_days) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id), a AS(INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $1,$8,'CREATE_SUPPLIER','supplier',id::text,$9::jsonb FROM s) SELECT id FROM s`,
      [
        b,
        x.name,
        x.contact ?? null,
        x.whatsapp ?? null,
        x.address ?? null,
        x.payment_days,
        x.lead_days,
        u.id,
        JSON.stringify(x),
      ],
    );
  return c.json(r);
});
app.post('/api/locations', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'settings');
  const x = z.object({ name: z.string().min(2).max(100) }).parse(await c.req.json());
  const [r] = await c
    .get('db')
    .query(
      `WITH loc AS(INSERT INTO locations(business_id,name) VALUES($1,$2) RETURNING id),a AS(INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $1,$3,'CREATE_LOCATION','location',id::text,$4::jsonb FROM loc) SELECT id FROM loc`,
      [b, x.name, u.id, JSON.stringify(x)],
    );
  return c.json(r);
});
app.post('/api/orders', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'purchase');
  const x = z
    .object({
      reference: z.string().min(1).max(100),
      supplier_id: uuid,
      lines: z
        .array(
          z.object({
            product_id: uuid,
            quantity: finite.positive().max(1e8),
            unit: z.string(),
            unit_price: number,
          }),
        )
        .min(1)
        .max(300),
    })
    .parse(await c.req.json());
  const [r] = await c
    .get('db')
    .query(
      `WITH o AS(INSERT INTO purchase_orders(business_id,supplier_id,reference) VALUES($1,$2,$3) RETURNING id), l AS(INSERT INTO purchase_order_lines(business_id,order_id,product_id,quantity,unit,unit_price) SELECT $1,o.id,(x->>'product_id')::uuid,(x->>'quantity')::numeric,x->>'unit',(x->>'unit_price')::numeric FROM o,jsonb_array_elements($4::jsonb) x), a AS(INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $1,$5,'CREATE_PO','purchase_order',id::text,$4::jsonb FROM o) SELECT id FROM o`,
      [b, x.supplier_id, x.reference, JSON.stringify(x.lines), u.id],
    );
  return c.json(r);
});
app.post('/api/invoices/:id/approve', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'pay');
  const x = z.object({ reason: z.string().min(10).max(2000) }).parse(await c.req.json());
  await c
    .get('db')
    .query('SELECT approve_invoice($1,$2,$3,$4)', [
      b,
      u.id,
      uuid.parse(c.req.param('id')),
      x.reason,
    ]);
  return c.json({ ok: true });
});
app.post('/api/drafts', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'receive');
  const x = z
    .object({
      id: uuid,
      version: z.number().int().min(0),
      mode: z.enum(['PURCHASE_RECEIPT', 'OPENING_BALANCE']),
      data: z.record(z.string(), z.unknown()),
    })
    .parse(await c.req.json());
  const [r] = await c
    .get('db')
    .query(
      `INSERT INTO ocr_review_drafts(id,business_id,mode,data,created_by) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=ocr_review_drafts.version+1,updated_at=now() WHERE ocr_review_drafts.business_id=$2 AND ocr_review_drafts.version=$6 RETURNING id,version`,
      [x.id, b, x.mode, JSON.stringify(x.data), u.id, x.version],
    );
  if (!r)
    return c.json(
      { error: 'Draft sudah diubah di perangkat lain. Muat ulang sebelum menyimpan.' },
      409,
    );
  return c.json(r);
});
app.post('/api/documents', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'receive');
  const x = z
    .object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      filename: z.string().min(1).max(500),
      rawText: z.string().max(500000),
      evidence: z.unknown().optional(),
      lines: z.array(z.unknown()).max(500),
    })
    .parse(await c.req.json());
  const [r] = await c
    .get('db')
    .query(
      `WITH d AS(INSERT INTO scanned_documents(business_id,content_hash,filename,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,content_hash) DO UPDATE SET filename=scanned_documents.filename RETURNING id), j AS(INSERT INTO ocr_jobs(document_id,status,engine_version) SELECT id,'review','tesseract.js-6' FROM d RETURNING id), raw AS(INSERT INTO ocr_raw_results(job_id,raw_text,positional_evidence) SELECT id,$5,$6::jsonb FROM j), lines AS(INSERT INTO ocr_parsed_lines(job_id,line_index,data) SELECT j.id,ordinality::integer,value FROM j,jsonb_array_elements($7::jsonb) WITH ORDINALITY) SELECT id FROM d`,
      [
        b,
        x.hash,
        x.filename,
        u.id,
        x.rawText,
        JSON.stringify(x.evidence ?? null),
        JSON.stringify(x.lines),
      ],
    );
  return c.json(r);
});
app.post('/api/tags', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'catalog');
  const x = z
    .object({
      entity_type: z.enum(['product', 'invoice', 'operation', 'source_record', 'supplier']),
      entity_id: uuid,
      tag: z.string().min(1).max(60),
      note: z.string().min(3).max(2000),
    })
    .parse(await c.req.json());
  await c
    .get('db')
    .query(
      `WITH t AS(INSERT INTO tags(business_id,entity_type,entity_id,tag,source,evidence,created_by) VALUES($1,$2,$3,$4,'manual',$5::jsonb,$6) ON CONFLICT(business_id,entity_type,entity_id,tag,source) DO UPDATE SET evidence=excluded.evidence RETURNING id) INSERT INTO audit_logs(business_id,actor_id,action,entity_type,entity_id,data) SELECT $1,$6,'MANUAL_TAG','tag',id::text,$5::jsonb FROM t`,
      [b, x.entity_type, x.entity_id, x.tag, JSON.stringify({ note: x.note }), u.id],
    );
  return c.json({ ok: true });
});
app.post('/api/analyze', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'read');
  return c.json(await analyze(c.get('db'), b, u.id));
});
app.get('/api/history', async (c) => {
  const { b } = context(c);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000000)
    .parse(c.req.query('offset') ?? 0);
  const type = c.req.query('type') ?? '';
  const rows = await c
    .get('db')
    .query(
      `SELECT o.id,o.reference,o.type,o.created_at,o.payload,u.name actor FROM operations o JOIN users u ON u.id=o.created_by WHERE o.business_id=$1 AND ($2='' OR o.type=$2) ORDER BY o.created_at DESC,o.id LIMIT 100 OFFSET $3`,
      [b, type, offset],
    );
  return c.json({ rows, next: rows.length === 100 ? offset + 100 : null });
});
app.get('/api/audit', async (c) => {
  const { b, u } = context(c);
  requireRole(u.role, 'settings');
  const rows = await c
    .get('db')
    .query(
      `SELECT a.id,a.action,a.entity_type,a.entity_id,a.data,a.created_at,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.business_id=$1 ORDER BY a.id DESC LIMIT 200`,
      [b],
    );
  return c.json(rows);
});
app.get('/api/export', async (c) => {
  const { b } = context(c);
  const rows = await c
    .get('db')
    .query(
      `SELECT p.sku,p.name,p.base_unit,l.name location,coalesce(i.quantity,0) quantity,coalesce(i.average_cost,p.purchase_cost) average_cost,p.selling_price,p.stock_verified FROM products p CROSS JOIN locations l LEFT JOIN inventory_balances i ON i.product_id=p.id AND i.location_id=l.id AND i.business_id=p.business_id WHERE p.business_id=$1 AND l.business_id=$1 ORDER BY p.sku,l.name`,
      [b],
    );
  const cols = [
    'sku',
    'name',
    'base_unit',
    'location',
    'quantity',
    'average_cost',
    'selling_price',
    'stock_verified',
  ];
  const cell = (x: unknown) => {
    let s = String(x ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const csv =
    '\uFEFF' +
    [cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="stok-new-system.csv"',
      'Cache-Control': 'no-store',
    },
  });
});
app.get('/api/report', async (c) => {
  const { b } = context(c);
  const from = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(c.req.query('from')),
    to = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(c.req.query('to'));
  if (from > to) return c.json({ error: 'Periode tidak valid.' }, 400);
  const [r] = await c
    .get('db')
    .query(
      `WITH period AS(SELECT total,cost_total,(created_at AT TIME ZONE 'Asia/Jakarta')::date day FROM sales WHERE business_id=$1 AND (created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2::date AND $3::date), days AS(SELECT day,count(*) transactions,sum(total) revenue,sum(total-cost_total) gross_profit FROM period GROUP BY day) SELECT (SELECT coalesce(sum(total),0) FROM period) revenue,(SELECT coalesce(sum(total-cost_total),0) FROM period) gross_profit,(SELECT count(*) FROM period) transactions,coalesce((SELECT jsonb_agg(days ORDER BY day) FROM days),'[]'::jsonb) daily`,
      [b, from, to],
    );
  return c.json(r);
});
app.get('/api/health', (c) => c.json({ ok: true }));
app.all('/api/*', (c) => c.json({ error: 'Endpoint tidak ditemukan.' }, 404));
app.all('*', (c) =>
  c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Jalankan frontend pada port 5173.'),
);
app.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: 'Data tidak valid.',
        details: error.issues.map((i) => i.path.join('.') + ': ' + i.message),
      },
      400,
    );
  if (error.message === 'FORBIDDEN') return c.json({ error: 'Akses ditolak.' }, 403);
  const pg = error as Error & { code?: string };
  const safe =
    pg.code === '23505'
      ? 'Data atau referensi sudah tercatat. Gunakan transaksi yang sudah ada.'
      : pg.code === '23503'
        ? 'Relasi data tidak valid.'
        : pg.code === 'P0001'
          ? pg.message
          : 'Permintaan gagal. Periksa data dan coba kembali.';
  console.error(
    JSON.stringify({ event: 'request_error', path: c.req.path, code: pg.code ?? 'unknown' }),
  );
  return c.json({ error: safe }, pg.code ? 400 : 500);
});
export default app;
