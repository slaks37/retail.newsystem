import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));
const login = JSON.parse(await readFile('work/local-login.json', 'utf8'));
await page.goto('http://localhost:5173');
await page.getByLabel('Email', { exact: true }).fill(login.email);
await page.getByLabel('Kata sandi', { exact: true }).fill(login.password);
await page.getByRole('button', { name: 'Masuk ke New System' }).click();
await page.getByRole('heading', { name: 'Semua terkendali.' }).waitFor();
const suffix = Date.now();
const sku = 'UI-TEST-' + suffix;
const snapshot = () => page.evaluate(async () => await (await fetch('/api/snapshot')).json());
await page.locator('nav').getByRole('button', { name: 'Produk', exact: true }).click();
await page.getByRole('button', { name: 'Tambah produk', exact: true }).click();
let modal = page.getByRole('dialog');
await modal.getByLabel('Kode produk / SKU').fill(sku);
await modal.getByLabel('Nama produk', { exact: true }).fill('Produk pengujian alur kasir');
await modal.getByLabel('Harga beli per satuan dasar').fill('100');
await modal.locator('[name=selling_price]').fill('150');
await modal.getByLabel('Isi PCS per satuan dasar').fill('1');
await modal.getByRole('button', { name: 'Simpan', exact: true }).click();
await modal.waitFor({ state: 'hidden' });
let d = await snapshot();
const product = d.products.find((p) => p.sku === sku);
if (!product) throw Error('Produk tidak dibuat');
const supplier = d.suppliers[0].id;
const startProducts = d.products.length;
async function receive(n, index) {
  await page.locator('nav').getByRole('button', { name: 'Scan Nota OCR' }).click();
  await page.getByRole('button', { name: 'Input nota manual' }).click();
  await page.getByLabel('Supplier *', { exact: true }).selectOption(supplier);
  await page.getByLabel('Nomor nota *', { exact: true }).fill('UI-NOTA-' + suffix + '-' + index);
  await page.getByLabel('Tanggal nota *', { exact: true }).fill('2026-11-08');
  const row = page.locator('.review-line');
  await row.getByLabel('Produk pada katalog *', { exact: true }).selectOption(product.id);
  await row.getByLabel('Jumlah nota *', { exact: true }).fill(String(n));
  await row.getByLabel('Satuan pembelian *', { exact: true }).selectOption('PCS');
  await row.getByLabel('Harga per satuan *', { exact: true }).fill('100');
  await row.getByLabel('Jumlah fisik diterima *', { exact: true }).fill(String(n));
  await row.getByLabel('Total tercetak', { exact: true }).fill(String(n * 100));
  await page.getByLabel('Total nota tercetak', { exact: true }).fill(String(n * 100));
  await page.locator('.review-confirm input').check();
  await page.getByRole('button', { name: 'Tinjau & konfirmasi' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Konfirmasi & bukukan sekali' })
    .click();
  await page.getByText('Berhasil disimpan. Ledger stok sudah diperbarui.').waitFor();
  await page.locator('nav').getByRole('button', { name: 'Dashboard', exact: true }).click();
}
await receive(5, 1);
await receive(3, 2);
d = await snapshot();
if (
  Number(d.products.find((p) => p.id === product.id).quantity) !== 8 ||
  d.products.length !== startProducts
)
  throw Error('Penerimaan duplikat atau saldo tidak sesuai');
await page.locator('nav').getByRole('button', { name: 'Produk', exact: true }).click();
await page.getByLabel('Cari dalam tabel').fill(sku);
await page.getByRole('button', { name: 'Edit', exact: true }).click();
modal = page.getByRole('dialog');
await modal.locator('[name=selling_price]').fill('200');
await modal.getByRole('button', { name: 'Simpan', exact: true }).click();
await modal.waitFor({ state: 'hidden' });
await page.locator('nav').getByRole('button', { name: 'Penjualan', exact: true }).click();
await page.getByLabel('Cari produk kasir').fill(sku);
await page.locator('.pos-product').click();
await page.getByLabel('Jumlah ' + sku, { exact: true }).fill('2');
await page.getByLabel('Jumlah yang diterima', { exact: true }).fill('400');
await page.getByRole('button', { name: 'Selesaikan & catat penjualan' }).click();
await page.getByRole('dialog', { name: 'Penjualan berhasil dicatat' }).waitFor();
await page.getByRole('dialog').getByRole('button', { name: 'Tutup', exact: true }).click();
d = await snapshot();
if (Number(d.products.find((p) => p.id === product.id).quantity) !== 6)
  throw Error('POS tidak mengurangi stok');
await page.locator('nav').getByRole('button', { name: 'Stok & Gudang', exact: true }).click();
await page.getByRole('button', { name: 'Catat mutasi', exact: true }).click();
modal = page.getByRole('dialog');
await modal.getByLabel('Produk', { exact: true }).selectOption(product.id);
await modal.locator('[name=counted_quantity]').fill('4');
await modal.getByLabel('Alasan / bukti', { exact: true }).fill('Pengujian opname jumlah fisik');
await modal.getByRole('button', { name: 'Simpan', exact: true }).click();
await modal.waitFor({ state: 'hidden' });
d = await snapshot();
if (Number(d.products.find((p) => p.id === product.id).quantity) !== 4)
  throw Error('Opname tidak mencatat jumlah fisik');
await page.locator('nav').getByRole('button', { name: 'Hutang Supplier', exact: true }).click();
const invoiceRow = page.locator('tr').filter({ hasText: 'UI-NOTA-' + suffix + '-1' });
await invoiceRow.getByRole('button', { name: 'Bayar', exact: true }).click();
modal = page.getByRole('dialog');
await modal.getByLabel('Jumlah pembayaran', { exact: true }).fill('200');
await modal
  .getByLabel('Referensi bukti transfer / kas / nota kredit', { exact: true })
  .fill('BUKTI-UI-' + suffix);
await modal.getByRole('button', { name: 'Simpan', exact: true }).click();
await modal.waitFor({ state: 'hidden' });
d = await snapshot();
const inv = d.invoices.find((i) => i.invoice_number === 'UI-NOTA-' + suffix + '-1');
if (Number(inv.paid_amount) !== 200) throw Error('Pembayaran tidak tercatat');
await writeFile(
  'work/transaction-ui-results.json',
  JSON.stringify(
    {
      checks: [
        'create-product',
        'receive-existing-twice-no-duplicate',
        'edit-price',
        'pos-deduct-stock',
        'physical-stock-count',
        'partial-payment',
      ],
      issues,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ checks: 6, issues }));
await browser.close();
if (issues.length) process.exitCode = 1;
