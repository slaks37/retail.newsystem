import type { InvoiceDraft, ParsedLine, Product } from './types';
export function parseNumber(
  raw: string,
  context: 'money' | 'quantity' = 'money',
  style: 'auto' | 'id' | 'en' = 'auto',
): number | null {
  const s = raw.replace(/\bRp\.?\s*/gi, '').replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let normalized = s;
  if (style === 'en') {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,4})?$/.test(s)) return null;
    const n = Number(s.replaceAll(',', ''));
    return Number.isFinite(n) && n >= 0 && n <= 1e14 ? n : null;
  }
  if (style === 'id') {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,4})?$/.test(s)) return null;
    const n = Number(s.replaceAll('.', '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= 1e14 ? n : null;
  }
  if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) return Number(s.replaceAll(',', ''));
  if (/^\d+,\d{3}$/.test(s)) return null;

  if (s.includes(',') && s.includes('.')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,4}$/.test(s)) return null;
    normalized = s.replaceAll('.', '').replace(',', '.');
  } else if (s.includes(',')) {
    if (!/^\d+,\d{1,4}$/.test(s)) return null;
    normalized = s.replace(',', '.');
  } else if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      if (context === 'quantity' && s.split('.').length === 2) return null;
      normalized = s.replaceAll('.', '');
    } else if (/^\d+\.\d{1,2}$/.test(s)) {
      if (context === 'quantity') return null; /* decimal currency from explicit dot notation */
    } else return null;
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n <= 1e14 ? n : null;
}
export function normalizeName(s: string) {
  return s
    .toUpperCase()
    .replace(/\bGRG\b/g, 'GORENG')
    .replace(/\bMI\b/g, 'MIE')
    .replace(/\bGRAM\b/g, 'G')
    .replace(/(\d)\s+(G|ML|KG)\b/g, '$1$2')
    .replace(/[^A-Z0-9]/g, '');
}
const units =
  'PCS|PAK|PACK|DUS|DOS|CTN|BOX|KARTON|KRT|LUSIN|LSN|BOTOL|SACHET|KG|GRAM|LITER|SET|TIN|DRM|M';
const number = '(?:Rp\\.?\\s*)?\\d[\\d.,]*';
export function blankLine(): ParsedLine {
  return {
    id: crypto.randomUUID(),
    raw: '',
    code: null,
    name: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    discount: null,
    tax: null,
    lineTotal: null,
    productId: null,
    receivedQuantity: null,
    damagedQuantity: 0,
    status: 'needs_review',
    warnings: ['Baris manual: isi dan verifikasi semua nilai.'],
  };
}
export function parseInvoice(rawText: string): InvoiceDraft {
  const d: InvoiceDraft = {
    supplier: null,
    invoiceNumber: null,
    invoiceDate: null,
    deliveryDate: null,
    dueDate: null,
    subtotal: null,
    discount: null,
    tax: null,
    total: null,
    lines: [],
    warnings: [],
    rawText,
    reviewed: false,
  };
  const lines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const date = (s: string) => {
    const m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
    if (!m) return null;
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const dt = new Date(iso + 'T00:00:00Z');
    return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
  };
  for (const raw of lines) {
    if (/^(supplier|pemasok)\s*[:\-]/i.test(raw)) {
      d.supplier = raw.replace(/^[^:\-]+[:\-]\s*/, '') || null;
      continue;
    }
    const invoice = raw.match(
      /(?:no\.?\s*(?:nota|faktur|invoice)|nomor\s*(?:nota|faktur))\s*[:#.]?\s*(\S+)/i,
    );
    if (invoice) {
      d.invoiceNumber = invoice[1];
      continue;
    }
    if (/jatuh\s*tempo/i.test(raw)) {
      d.dueDate = date(raw);
      continue;
    }
    if (/(?:tanggal|tgl)\s*(?:kirim|terima|jalan)/i.test(raw)) {
      d.deliveryDate = date(raw);
      continue;
    }
    if (/tanggal|\btgl\b/i.test(raw)) {
      d.invoiceDate = date(raw);
      continue;
    }
    const head = raw.match(
      new RegExp(
        `^(SUB\s*TOTAL|TOTAL(?:\\s+(?:AKHIR|BAYAR|NOTA))?|DISKON|PPN|PAJAK)\\s*[:=]?\\s*(${number})$`,
        'i',
      ),
    );
    if (head) {
      const k = /^SUB/i.test(head[1])
        ? 'subtotal'
        : /^DISKON/i.test(head[1])
          ? 'discount'
          : /PPN|PAJAK/i.test(head[1])
            ? 'tax'
            : 'total';
      d[k] = parseNumber(head[2]);
      continue;
    }
    if (
      /^(?:NOTA|FAKTUR|SURAT JALAN|KODE\b|NAMA BARANG|QTY\b|JUMLAH\b|HARGA\b|TERIMA KASIH)/i.test(
        raw,
      )
    )
      continue;
    const m = raw.match(
      new RegExp(`^(.+?)\\s+(${number})\\s+(${units})\\s+(${number})(?:\\s+(${number}))?$`, 'i'),
    );
    if (m) {
      const item = blankLine();
      item.raw = raw;
      item.name = m[1];
      item.quantity = parseNumber(m[2], 'quantity');
      item.unit = m[3].toUpperCase();
      item.unitPrice = parseNumber(m[4]);
      item.lineTotal = m[5] ? parseNumber(m[5]) : null;
      item.warnings = [];
      const code = item.name.match(/^([A-Z0-9][A-Z0-9./\-]{3,})\s+(.+)$/i);
      if (code && /[0-9]/.test(code[1])) {
        item.code = code[1];
        item.name = code[2];
      }
      item.receivedQuantity = null;
      item.discount = null;
      item.tax = null;
      if (item.quantity === null)
        item.warnings.push('Pemisah angka jumlah ambigu. Isi ulang dari dokumen.');
      if (
        item.lineTotal !== null &&
        item.quantity !== null &&
        item.unitPrice !== null &&
        Math.abs(item.quantity * item.unitPrice - item.lineTotal) > 0.01
      )
        item.warnings.push('Total baris berbeda dari jumlah × harga. Periksa diskon/pajak.');
      if (item.lineTotal === null) item.warnings.push('Total baris tidak terbaca.');
      item.status = item.warnings.length ? 'needs_review' : 'detected';
      d.lines.push(item);
    } else if (/\d/.test(raw) && !/^\s*(?:\+?62|0\d{2,3})[-\s]/.test(raw)) {
      const item = blankLine();
      item.raw = raw;
      item.name = raw;
      item.warnings = ['Format baris belum dikenali; jangan gunakan angka tanpa verifikasi.'];
      d.lines.push(item);
    }
  }
  const seen = new Set<string>();
  for (const l of d.lines) {
    const key = l.raw.toUpperCase().replace(/\s+/g, ' ');
    if (seen.has(key)) l.warnings.push('Kemungkinan baris berulang: periksa halaman duplikat.');
    seen.add(key);
  }
  if (!d.invoiceNumber) d.warnings.push('Nomor nota belum terbaca.');
  if (!d.invoiceDate) d.warnings.push('Tanggal nota belum terbaca.');
  if (!d.supplier) d.warnings.push('Pilih supplier dari katalog.');
  const printed = d.lines.every((l) => l.lineTotal !== null)
    ? d.lines.reduce((s, l) => s + l.lineTotal!, 0)
    : null;
  if (
    printed !== null &&
    d.total !== null &&
    Math.abs(printed - (d.discount ?? 0) + (d.tax ?? 0) - d.total) > 0.01
  )
    d.warnings.push('Jumlah total baris tidak sama dengan total nota.');
  if (!d.lines.length)
    d.warnings.push('Belum ada baris produk yang terbaca. Tambahkan manual atau proses ulang.');
  return d;
}
export function matchProducts(
  line: ParsedLine,
  products: Product[],
  aliases: { product_id: string; supplier_code: string; alias: string | null }[] = [],
): { product: Product; reason: string; score: number }[] {
  const normalize = normalizeName(line.name ?? line.raw);
  const token = new Set((line.name ?? '').toUpperCase().split(/\W+/).filter(Boolean));
  return products
    .map((product) => {
      let score = 0;
      let reason = 'Kemiripan nama: wajib verifikasi';
      if (line.code && product.barcode === line.code) {
        score = 1;
        reason = 'Barcode sama';
      } else if (line.code && product.sku.toUpperCase() === line.code.toUpperCase()) {
        score = 0.99;
        reason = 'SKU sama';
      } else if (
        aliases.some(
          (a) =>
            a.product_id === product.id &&
            ((line.code && a.supplier_code === line.code) ||
              (a.alias && normalizeName(a.alias) === normalize)),
        )
      ) {
        score = 0.98;
        reason = 'Alias supplier yang telah dikonfirmasi';
      } else if (normalize && normalize === normalizeName(product.name)) {
        score = 0.97;
        reason = 'Nama ternormalisasi sama';
      } else {
        const words = new Set(product.name.toUpperCase().split(/\W+/).filter(Boolean));
        const intersection = [...token].filter((t) => words.has(t)).length;
        score = intersection / Math.max(new Set([...token, ...words]).size, 1);
      }
      return { product, score, reason };
    })
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
export type SupplierTemplate = (text: string) => InvoiceDraft;
const registry = new Map<string, SupplierTemplate>();
export function registerSupplierTemplate(id: string, parser: SupplierTemplate) {
  registry.set(id, parser);
}
export function parseWithTemplate(text: string, supplierId?: string) {
  return ((supplierId && registry.get(supplierId)) || parseInvoice)(text);
}
