import { describe, it, expect } from 'vitest';
import { parseSmartInvoice, normalizeTSV } from '../shared/supplier-templates';
describe('Template supplier berbasis layout nyata', () => {
  it('memilih kolom harga dan potongan Astra, bukan HET', () => {
    const d = parseSmartInvoice(
      'PT Astra Otoparts Tbk\nFaktur : INV-TEST\nTgl Faktur : 30-SEP-2026\nTgl Jatuh Tempo : 30-OCT-2026\nNO KODE BARANG NAMA BARANG JUMLAH HET BASE HARGA DISC POTONGAN JUMLAH\n1 TEST-001 TUBE 5.50 13 2 PCS 200,000 35.00 130,000 4.00 10,400 249,600\nCash Discount 0\nTOTAL 249,600',
    );
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].unitPrice).toBe(130000);
    expect(d.lines[0].discount).toBe(10400);
    expect(d.lines[0].lineTotal).toBe(249600);
    expect(d.invoiceDate).toBe('2026-09-30');
    expect(d.dueDate).toBe('2026-10-30');
    expect(d.lines[0].receivedQuantity).toBeNull();
  });
  it('format jumlah di kiri Mataram tidak menebak satuan', () => {
    const d = parseSmartInvoice(
      'CV. MATARAM MITRA SENTOSA\nNo. FN000/TEST\nTgl. : 18/09/2026\nQty Part Number Uraian Type Merk Disc Harga Total\n3 TEST-002 CONTOH PART GP 10 200.000 540.000\nNilai Netto: 540.000,00',
    );
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].quantity).toBe(3);
    expect(d.lines[0].discount).toBe(60000);
    expect(d.lines[0].unit).toBeNull();
    expect(d.total).toBe(540000);
  });
  it('membaca bukti posisi TSV tanpa menebak karakter', () => {
    const t =
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t80\tBARANG\n5\t1\t1\t1\t1\t2\t45\t20\t10\t10\t70\tA';
    const [r] = normalizeTSV(t);
    expect(r.text).toBe('BARANG A');
    expect(r.bbox).toEqual({ x0: 10, y0: 20, x1: 55, y1: 30 });
  });
});
