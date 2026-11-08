import { describe, it, expect } from 'vitest';
import { parseNumber, parseInvoice, matchProducts, blankLine } from '../shared/parser';
import type { Product } from '../shared/types';
describe('Angka dan parser nota', () => {
  it('membaca format rupiah dan desimal Indonesia', () => {
    expect(parseNumber('Rp12.500')).toBe(12500);
    expect(parseNumber('Rp 125.000')).toBe(125000);
    expect(parseNumber('1.250.000')).toBe(1250000);
    expect(parseNumber('12,5', 'quantity')).toBe(12.5);
    expect(parseNumber('1.250', 'quantity')).toBeNull();
  });
  it.each(['1O0', 'I00', '5O.OOO', 'B000', '1,250.00', '1.2.50'])(
    'tidak mengganti karakter ambigu %s',
    (raw) => expect(parseNumber(raw)).toBeNull(),
  );
  it('menahan kesalahan matematika untuk review', () => {
    const d = parseInvoice(
      'SUPPLIER: PT Uji\nNO NOTA: N-123\nTANGGAL: 08/11/2026\nProduk A 100 PCS 5.000 50.000\nTOTAL 50.000',
    );
    expect(d.lines[0].quantity).toBe(100);
    expect(d.lines[0].warnings.join(' ')).toContain('Total baris berbeda');
    expect(d.lines[0].receivedQuantity).toBeNull();
    expect(d.total).toBe(50000);
  });
  it('menyimpan jumlah yang tidak terbaca sebagai null', () => {
    const d = parseInvoice('Bearing 1O0 PCS 5.000 50.000');
    expect(d.lines[0].quantity).toBeNull();
    expect(d.lines[0].status).toBe('needs_review');
  });
  it('tidak menggabungkan baris identik otomatis', () => {
    const d = parseInvoice('Produk A 2 PCS 5.000 10.000\nProduk A 2 PCS 5.000 10.000');
    expect(d.lines).toHaveLength(2);
    expect(d.lines[1].warnings.join()).toContain('berulang');
  });
  it('tanggal kalender tidak valid tetap null', () =>
    expect(parseInvoice('Tanggal 31/02/2026').invoiceDate).toBeNull());
  it('SKU persis menjadi saran, tanpa auto merge', () => {
    const p = { id: 'p1', sku: 'BANDO-A37', barcode: null, name: 'BANDO FAN BELT A 37' } as Product;
    const l = { ...blankLine(), code: 'BANDO-A37', name: 'BANDO BELT' };
    expect(matchProducts(l, [p])[0].score).toBe(0.99);
    expect(l.productId).toBeNull();
  });
  it('mempertahankan seluruh 20 baris nota', () => {
    const d = parseInvoice(
      Array.from({ length: 20 }, (_, i) => `SKU${1000 + i} PRODUK ${i} 2 PCS 10.000 20.000`).join(
        '\n',
      ),
    );
    expect(d.lines).toHaveLength(20);
    expect(
      d.lines.every((l) => l.quantity === 2 && l.unitPrice === 10000 && l.productId === null),
    ).toBe(true);
  });
});

describe('Pemisah dengan konteks supplier', () => {
  it('tidak mengira koma ribuan sebagai desimal', () => {
    expect(parseNumber('97,000')).toBeNull();
    expect(parseNumber('97,000', 'money', 'en')).toBe(97000);
    expect(parseNumber('1,619,280', 'money', 'en')).toBe(1619280);
    expect(parseNumber('100.000,00', 'money', 'id')).toBe(100000);
  });
});
