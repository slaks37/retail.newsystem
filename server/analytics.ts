import type { DB } from './db';
import { productInsights, RULE_VERSION, type AnalyticsProduct } from '../shared/insights';
import type { Insight } from '../shared/types';
export async function analyze(db: DB, businessId: string, actor: string) {
  const rows = await db.query(
    `WITH balances AS (SELECT product_id,sum(quantity) qty,sum(quantity*average_cost)/NULLIF(sum(quantity),0) cost FROM inventory_balances WHERE business_id=$1 GROUP BY product_id), history AS (
 SELECT l.product_id,sum(l.quantity) FILTER(WHERE s.created_at>=now()-interval '30 days') sold30,sum(l.quantity) FILTER(WHERE s.created_at<now()-interval '30 days' AND s.created_at>=now()-interval '60 days') previous30,count(DISTINCT (s.created_at AT TIME ZONE 'Asia/Jakarta')::date) FILTER(WHERE s.created_at>=now()-interval '30 days') days,
 sum(l.line_total*(CASE WHEN s.total+s.discount>0 THEN s.total/(s.total+s.discount) ELSE 0 END)) FILTER(WHERE s.created_at>=now()-interval '30 days') revenue,
 sum(l.line_total*(CASE WHEN s.total+s.discount>0 THEN s.total/(s.total+s.discount) ELSE 0 END)-l.quantity*l.unit_cost) FILTER(WHERE s.created_at>=now()-interval '30 days') profit,
 extract(day FROM now()-max(s.created_at)) since FROM sales_lines l JOIN sales s ON s.id=l.sale_id WHERE s.business_id=$1 GROUP BY l.product_id), prices AS (SELECT product_id,unit_cost,row_number() OVER(PARTITION BY product_id ORDER BY observed_at DESC,id DESC) rn FROM supplier_price_history WHERE business_id=$1)
 SELECT p.id,p.sku,p.name,p.min_stock,p.stock_verified,COALESCE((SELECT min(s.lead_days) FROM product_supplier_mappings m JOIN suppliers s ON s.id=m.supplier_id WHERE m.business_id=$1 AND m.product_id=p.id),7) lead_days,coalesce(b.qty,0) qty,coalesce(b.cost,p.purchase_cost) cost,coalesce(h.sold30,0) sold30,coalesce(h.previous30,0) previous30,coalesce(h.days,0) days,coalesce(h.revenue,0) revenue,coalesce(h.profit,0) profit,h.since,(SELECT unit_cost FROM prices WHERE product_id=p.id AND rn=1) latest,(SELECT unit_cost FROM prices WHERE product_id=p.id AND rn=2) previous FROM products p LEFT JOIN balances b ON b.product_id=p.id LEFT JOIN history h ON h.product_id=p.id WHERE p.business_id=$1 AND p.active`,
    [businessId],
  );
  const products: AnalyticsProduct[] = rows.map((r) => ({
    id: String(r.id),
    sku: String(r.sku),
    name: String(r.name),
    quantity: Number(r.qty),
    cost: Number(r.cost),
    minStock: Number(r.min_stock),
    verified: Boolean(r.stock_verified),
    sold30: Number(r.sold30),
    soldPrevious30: Number(r.previous30),
    salesDays: Number(r.days),
    revenue30: Number(r.revenue),
    profit30: Number(r.profit),
    daysSinceSale: r.since === null ? null : Number(r.since),
    leadDays: Number(r.lead_days),
    latestPrice: r.latest === null ? null : Number(r.latest),
    previousPrice: r.previous === null ? null : Number(r.previous),
  }));
  const insights = productInsights(products);
  const overdue = await db.query(
    `SELECT id,invoice_number,total-paid_amount remaining,due_date FROM supplier_invoices WHERE business_id=$1 AND due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date AND total>paid_amount`,
    [businessId],
  );
  for (const r of overdue)
    insights.push({
      id: String(r.id) + ':JATUH_TEMPO',
      entityType: 'invoice',
      entityId: String(r.id),
      tag: 'JATUH_TEMPO',
      severity: 'critical',
      title: 'Hutang melewati jatuh tempo',
      reason: `Nota ${r.invoice_number}; sisa Rp${r.remaining}.`,
      recommendation: 'Verifikasi kecocokan dokumen sebelum membayar.',
      evidence: r,
    });
  const imports = await db.query(`SELECT id,report FROM source_imports WHERE business_id=$1`, [
    businessId,
  ]);
  for (const r of imports) {
    const report = r.report as Record<string, unknown>;
    if (Number(report.valueDifference) !== 0)
      insights.push({
        id: String(r.id) + ':SELISIH_SUMBER',
        entityType: 'import',
        entityId: String(r.id),
        tag: 'SELISIH_SUMBER',
        severity: 'critical',
        title: 'Nilai mutasi dan rekap nota berbeda',
        reason: `Selisih Rp${report.valueDifference}. Histori impor belum dibukukan sebagai hutang.`,
        recommendation: 'Periksa daftar nota berselisih pada rekonsiliasi.',
        evidence: report,
      });
  }
  const anomalies = await db.query(
    `SELECT sr.id,sr.row_number,sr.data FROM source_records sr WHERE sr.business_id=$1 AND sr.sheet='Log Transaksi & Mutasi' AND (coalesce((sr.data->>7)::numeric,0)=0 OR coalesce((sr.data->>12)::numeric,0)=0)`,
    [businessId],
  );
  for (const r of anomalies) {
    const a = r.data as unknown[];
    insights.push({
      id: String(r.id) + ':HISTORI_NILAI_NOL',
      entityType: 'source_record',
      entityId: String(r.id),
      tag: 'NILAI_NOL_PERLU_CEK',
      severity: 'info',
      title: `Histori ${a[5]} bernilai nol`,
      reason: 'Bisa merupakan barang bonus; perlu konfirmasi, bukan otomatis dianggap kesalahan.',
      recommendation: 'Cek bukti nota asli.',
      evidence: { row: r.row_number, sourceRecordId: r.id },
    });
  }
  const operations = await db.query(
    `SELECT o.id,o.reference,o.type,o.payload,s.total,s.discount FROM operations o LEFT JOIN sales s ON s.operation_id=o.id WHERE o.business_id=$1 AND (o.type IN ('STOCK_ADJUSTMENT','DAMAGE','SUPPLIER_RETURN') OR (s.total+s.discount>0 AND s.discount/(s.total+s.discount)>.2)) ORDER BY o.created_at DESC LIMIT 200`,
    [businessId],
  );
  for (const r of operations) {
    const discount = Number(r.discount ?? 0),
      gross = Number(r.total ?? 0) + discount;
    insights.push({
      id: String(r.id) + ':' + (discount > 0 ? 'DISKON_TINGGI' : 'MUTASI_PERLU_AUDIT'),
      entityType: 'operation',
      entityId: String(r.id),
      tag: discount > 0 ? 'DISKON_TINGGI' : 'MUTASI_PERLU_AUDIT',
      severity: 'warning',
      title: discount > 0 ? 'Diskon melebihi 20%' : 'Mutasi stok untuk ditinjau',
      reason:
        discount > 0
          ? `Diskon ${((discount / gross) * 100).toFixed(1)}% pada ${r.reference}.`
          : `${r.type} tercatat pada ${r.reference}.`,
      recommendation: 'Tinjau alasan dan bukti; temuan ini bukan tuduhan kesalahan.',
      evidence: { operationId: r.id, reference: r.reference, type: r.type, discount, gross },
    });
  }
  const pairs = await db.query(
    `SELECT a.product_id first_id,b.product_id second_id,p.name first_name,q.name second_name,count(*) frequency FROM sales_lines a JOIN sales_lines b ON a.sale_id=b.sale_id AND a.product_id<b.product_id JOIN sales s ON s.id=a.sale_id JOIN products p ON p.id=a.product_id JOIN products q ON q.id=b.product_id WHERE s.business_id=$1 AND s.created_at>=now()-interval '90 days' GROUP BY a.product_id,b.product_id,p.name,q.name HAVING count(*)>=3 ORDER BY count(*) DESC LIMIT 20`,
    [businessId],
  );
  for (const r of pairs)
    insights.push({
      id: String(r.first_id) + ':PAIR:' + r.second_id,
      entityType: 'product_pair',
      entityId: String(r.first_id) + ':' + r.second_id,
      tag: 'SERING_DIBELI_BERSAMA',
      severity: 'info',
      title: 'Pola pembelian bersama',
      reason: `${r.first_name} dan ${r.second_name} muncul bersama dalam ${r.frequency} transaksi selama 90 hari.`,
      recommendation:
        'Pertimbangkan penempatan produk berdekatan; belum membuktikan hubungan sebab-akibat.',
      evidence: r,
    });
  const [coverage] = await db.query<{ operations: string; source_records: string }>(
    `SELECT (SELECT count(*) FROM operations WHERE business_id=$1) operations,(SELECT count(*) FROM source_records WHERE business_id=$1) source_records`,
    [businessId],
  );
  // Atomically replace the current deterministic rule projection; preserve manual tags.
  await db.query('SELECT refresh_rule_tags($1,$2,$3,$4::jsonb)', [
    businessId,
    actor,
    RULE_VERSION,
    JSON.stringify(insights),
  ]);
  return {
    ruleVersion: RULE_VERSION,
    insights,
    coverage: {
      products: products.length,
      overdue: overdue.length,
      sourceImports: imports.length,
      operations: Number(coverage.operations),
      sourceRecords: Number(coverage.source_records),
    },
    salesEvidence: products.reduce((s, p) => s + p.sold30, 0),
  };
}
