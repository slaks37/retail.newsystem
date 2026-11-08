import { parseInvoice, parseNumber, blankLine } from './parser';
import type { InvoiceDraft, ParsedLine } from './types';
const months: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  MEI: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  AGU: '08',
  SEP: '09',
  OCT: '10',
  OKT: '10',
  NOV: '11',
  DEC: '12',
  DES: '12',
};
function date(s: string) {
  const numeric = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/),
    alpha = s.match(
      /\b(\d{1,2})[-/](JAN|FEB|MAR|APR|MAY|MEI|JUN|JUL|AUG|AGU|SEP|OCT|OKT|NOV|DEC|DES)[-/](\d{4})\b/i,
    );
  const iso = numeric
    ? `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`
    : alpha
      ? `${alpha[3]}-${months[alpha[2].toUpperCase()]}-${alpha[1].padStart(2, '0')}`
      : null;
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
function clean(text: string) {
  return text
    .replace(/\b(\d{1,3}),\s+(\d{3})\b/g, '$1,$2')
    .replace(/^\s*\|\s*/gm, '')
    .replace(/\s*\|\s*$/gm, '');
}
function finish(d: InvoiceDraft, lines: ParsedLine[], template: string) {
  d.lines = lines;
  d.warnings = [
    `Template ${template}: nilai merupakan hasil deteksi, wajib diperiksa dengan dokumen asli.`,
  ];
  for (const l of lines) {
    l.receivedQuantity = null;
    l.productId = null;
    l.status = 'needs_review';
    if (l.quantity === null || l.unitPrice === null || l.lineTotal === null)
      l.warnings.push('Ada angka yang tidak terbaca atau ambigu.');
    if (
      l.quantity !== null &&
      l.unitPrice !== null &&
      l.lineTotal !== null &&
      Math.abs(l.quantity * l.unitPrice - (l.discount ?? 0) + (l.tax ?? 0) - l.lineTotal) > 0.01
    )
      l.warnings.push('Perhitungan jumlah × harga − diskon + pajak tidak cocok.');
  }
  if (!lines.length)
    d.warnings.push('Baris tabel belum dikenali. Gunakan input manual atau perbaiki crop.');
  return d;
}
export function parseAstra(text: string): InvoiceDraft {
  const raw = clean(text);
  const d = parseInvoice(raw);
  d.supplier =
    raw
      .split('\n')
      .find((s) => /astra.*otoparts/i.test(s))
      ?.trim() ?? null;
  const invoice = raw.match(/(?:^|\n)\s*(?:No\.?\s*)?Faktur\s*:\s*([A-Z0-9/-]+)/i);
  if (invoice) d.invoiceNumber = invoice[1];
  const ls = raw.split('\n');
  for (const l of ls) {
    if (/tgl\s*faktur/i.test(l)) d.invoiceDate = date(l);
    if (/jatuh\s*tempo/i.test(l)) d.dueDate = date(l);
    const total = l.match(/^\s*TOTAL\s*[:]?\s*([\d,.]+)\s*$/i);
    if (total) d.total = parseNumber(total[1], 'money', 'en');
  }
  const start = ls.findIndex((l) => /KODE\s+BARANG/i.test(l) && /JUMLAH/i.test(l));
  const end = ls.findIndex(
    (l, i) => i > start && /Cash\s*Discount|Dasar\s*Pengenaan|^\s*TOTAL\b/i.test(l),
  );
  const table = start >= 0 ? ls.slice(start + 1, end < 0 ? undefined : end) : [];
  const parsed: ParsedLine[] = [];
  for (const rawLine of table) {
    const m = rawLine.match(
      /^\s*[1-9]\d*\s+([A-Z0-9][A-Z0-9/\-]{4,})\s+(.+?)\s+([\d.,]+)\s+(PCS|SET|PACK|DUS)\b\s*(.*)$/i,
    );
    if (!m) continue;
    const l = blankLine();
    l.raw = rawLine;
    l.code = m[1];
    l.name = m[2];
    l.quantity = parseNumber(m[3], 'quantity', 'en');
    l.unit = m[4].toUpperCase();
    l.warnings = [
      'Astra memuat HET, diskon dasar, harga, dan potongan. Verifikasi kolom HARGA dan POTONGAN.',
    ];
    const tail = m[5]
      .replace(/^[vV✓✔£©\s]+/, '')
      .replace(/[|%\s]+$/, '')
      .split(/\s+/);
    // Known printed columns: HET, BASE DISC%, HARGA, DISC%, POTONGAN, JUMLAH.
    if (tail.length === 6) {
      l.unitPrice = parseNumber(tail[2], 'money', 'en');
      l.discount = parseNumber(tail[4], 'money', 'en');
      l.lineTotal = parseNumber(tail[5], 'money', 'en');
      l.tax = null;
    } else {
      l.unitPrice = null;
      l.discount = null;
      l.lineTotal = null;
      l.warnings.push('Kolom angka terpecah atau tergabung; isi manual.');
    }
    parsed.push(l);
  }
  // The printed PPN is a breakdown, not automatically added a second time.
  d.tax = null;
  d.discount = null;
  d.warnings.push(
    'Rincian PPN tidak ditambahkan otomatis: periksa apakah harga baris sudah termasuk pajak.',
  );
  return finish(d, parsed, 'Astra Otoparts');
}
export function parseMataram(text: string): InvoiceDraft {
  const raw = clean(text),
    d = parseInvoice(raw),
    ls = raw.split('\n');
  d.supplier = ls.find((s) => /MATARAM.*MITRA.*SENTOSA/i.test(s)) ?? null;
  d.invoiceNumber = raw.match(/\b(FN[A-Z0-9/\-]+)\b/i)?.[1] ?? null;
  for (const l of ls) {
    if (/Tgl\.?\s*J(?:tt|atuh)/i.test(l)) d.dueDate = date(l);
    else if (/\bTgl\./i.test(l)) d.invoiceDate = date(l);
    const total = l.match(/Nilai\s*Netto\s*:?\s*([\d.,]+)/i);
    if (total) d.total = parseNumber(total[1], 'money', 'id');
  }
  const start = ls.findIndex((l) => /Qty/i.test(l) && /Part\s*Number/i.test(l));
  const end = ls.findIndex((l, i) => i > start && /PEMBAYARAN|Nilai\s*:/i.test(l));
  const table = start >= 0 ? ls.slice(start + 1, end < 0 ? undefined : end) : [];
  const parsed: ParsedLine[] = [];
  for (const rawLine of table) {
    const m = rawLine.match(
      /^\s*(\d+(?:,\d+)?)\s+([A-Z0-9][A-Z0-9/\-]{4,})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.]+(?:,\d+)?)\s+([\d.]+(?:,\d+)?)\s*$/i,
    );
    if (!m) continue;
    const l = blankLine();
    l.raw = rawLine;
    l.quantity = parseNumber(m[1], 'quantity', 'id');
    l.code = m[2];
    l.name = m[3];
    l.unit = null;
    l.unitPrice = parseNumber(m[5], 'money', 'id');
    l.lineTotal = parseNumber(m[6], 'money', 'id');
    const percent = parseNumber(m[4], 'quantity', 'id');
    l.discount =
      l.quantity !== null && l.unitPrice !== null && percent !== null && percent <= 100
        ? Math.round(l.quantity * l.unitPrice * percent) / 100
        : null;
    l.warnings = ['Satuan tidak tercetak pada format ini. Pilih satuan produk secara manual.'];
    parsed.push(l);
  }
  return finish(d, parsed, 'Mataram Mitra Sentosa');
}
export function parseSmartInvoice(text: string) {
  if (/(?:astra.*otoparts|HET\s+BASE\s+HARGA|BASE\s+HARGA\s+DISC)/i.test(text))
    return parseAstra(text);
  if (/MATARAM.*MITRA.*SENTOSA/i.test(text)) return parseMataram(text);
  return parseInvoice(text);
}
export interface PositionalLine {
  text: string;
  page: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number | null;
}
export function normalizeTSV(tsv: string, page = 1): PositionalLine[] {
  const groups = new Map<
    string,
    { words: string[]; x0: number; y0: number; x1: number; y1: number; confidence: number[] }
  >();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5' || !c[11].trim()) continue;
    const key = c.slice(1, 5).join(':');
    const left = Number(c[6]),
      top = Number(c[7]),
      width = Number(c[8]),
      height = Number(c[9]);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    const g = groups.get(key) ?? {
      words: [],
      x0: left,
      y0: top,
      x1: left + width,
      y1: top + height,
      confidence: [],
    };
    g.words.push(c.slice(11).join('\t'));
    g.x0 = Math.min(g.x0, left);
    g.y0 = Math.min(g.y0, top);
    g.x1 = Math.max(g.x1, left + width);
    g.y1 = Math.max(g.y1, top + height);
    if (Number(c[10]) >= 0) g.confidence.push(Number(c[10]));
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    text: g.words.join(' '),
    page,
    bbox: { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 },
    confidence: g.confidence.length
      ? g.confidence.reduce((a, b) => a + b, 0) / g.confidence.length
      : null,
  }));
}
