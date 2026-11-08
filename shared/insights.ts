import type { Insight } from './types';
export const RULE_VERSION = '2026.11.08-v1';
export interface AnalyticsProduct {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  cost: number;
  minStock: number;
  verified: boolean;
  sold30: number;
  soldPrevious30: number;
  salesDays: number;
  revenue30: number;
  profit30: number;
  daysSinceSale: number | null;
  leadDays: number;
  latestPrice: number | null;
  previousPrice: number | null;
}
export function productInsights(products: AnalyticsProduct[]): Insight[] {
  const result: Insight[] = [];
  const sorted = [...products].sort((a, b) => b.revenue30 - a.revenue30);
  const revenue = sorted.reduce((s, p) => s + p.revenue30, 0);
  let cumulative = 0;
  for (const p of sorted) {
    const add = (
      tag: string,
      severity: Insight['severity'],
      title: string,
      reason: string,
      recommendation: string,
      evidence: Record<string, unknown>,
      metric?: number,
    ) =>
      result.push({
        id: p.id + ':' + tag,
        entityType: 'product',
        entityId: p.id,
        tag,
        severity,
        title: `${p.sku} · ${title}`,
        reason,
        recommendation,
        evidence,
        metric,
      });
    if (!p.verified)
      add(
        'STOK_BELUM_DIVERIFIKASI',
        'warning',
        'Stok belum diverifikasi',
        'Katalog belum memiliki saldo stok yang dikonfirmasi.',
        'Verifikasi saldo pembukaan atau lakukan penerimaan fisik.',
        {},
      );
    else if (p.quantity === 0)
      add(
        'STOK_HABIS',
        'critical',
        'Stok habis',
        'Saldo ledger di seluruh lokasi adalah 0.',
        'Periksa kebutuhan pembelian.',
        { quantity: 0 },
      );
    else if (p.minStock > 0 && p.quantity <= p.minStock)
      add(
        'STOK_MENIPIS',
        'warning',
        'Di bawah batas minimum',
        `Saldo ${p.quantity}, minimum ${p.minStock}.`,
        'Buat permintaan pembelian.',
        { quantity: p.quantity, minStock: p.minStock },
      );
    if (p.sold30 > 0 && p.salesDays >= 7) {
      const daily = p.sold30 / 30;
      const cover = p.quantity / daily;
      const reorder = Math.max(0, Math.ceil(daily * (p.leadDays + 7) - p.quantity));
      if (cover < p.leadDays + 7)
        add(
          'REKOMENDASI_RESTOK',
          'warning',
          'Restok berbasis laju penjualan',
          `${p.sold30} unit terjual dalam 30 hari; cakupan stok sekitar ${cover.toFixed(1)} hari.`,
          `Pertimbangkan ${reorder} unit untuk lead time ${p.leadDays} hari dan buffer 7 hari.`,
          {
            dailyRate: daily,
            coverDays: cover,
            leadDays: p.leadDays,
            bufferDays: 7,
            sampleDays: p.salesDays,
          },
          reorder,
        );
      if (p.soldPrevious30 > 0 && p.sold30 > p.soldPrevious30 * 1.5)
        add(
          'PERMINTAAN_NAIK',
          'info',
          'Permintaan meningkat',
          `Penjualan ${p.soldPrevious30} → ${p.sold30} unit dibanding periode 30 hari sebelumnya.`,
          'Evaluasi kapasitas restok.',
          { current: p.sold30, previous: p.soldPrevious30 },
        );
    }
    if (
      p.latestPrice !== null &&
      p.previousPrice !== null &&
      p.previousPrice > 0 &&
      p.latestPrice > p.previousPrice * 1.1
    )
      add(
        'HARGA_BELI_NAIK',
        'warning',
        'Harga beli naik >10%',
        `Harga dasar terbaru ${p.latestPrice}, sebelumnya ${p.previousPrice}.`,
        'Bandingkan penawaran supplier.',
        { latest: p.latestPrice, previous: p.previousPrice },
        (p.latestPrice / p.previousPrice - 1) * 100,
      );
    if (p.revenue30 > 0) {
      const group = cumulative / revenue < 0.8 ? 'A' : cumulative / revenue < 0.95 ? 'B' : 'C';
      add(
        'ABC_' + group,
        'info',
        `Kelompok ABC ${group}`,
        'Klasifikasi berdasarkan kontribusi omzet 30 hari terakhir.',
        'Gunakan untuk prioritas ketersediaan.',
        { revenue30: p.revenue30, totalRevenue: revenue },
      );
      cumulative += p.revenue30;
      if (p.profit30 < 0)
        add(
          'MARGIN_NEGATIF',
          'critical',
          'Margin negatif',
          'Pendapatan setelah alokasi diskon lebih rendah dari biaya barang.',
          'Periksa harga jual dan diskon.',
          { profit30: p.profit30 },
        );
    }
    if (p.verified && p.quantity > 0 && p.daysSinceSale !== null && p.daysSinceSale >= 60)
      add(
        'LAMBAT_BERGERAK',
        'warning',
        'Tidak terjual ≥60 hari',
        `Terakhir terjual ${p.daysSinceSale} hari lalu.`,
        'Tinjau promosi atau batasi pembelian.',
        { daysSinceSale: p.daysSinceSale },
      );
  }
  return result;
}
