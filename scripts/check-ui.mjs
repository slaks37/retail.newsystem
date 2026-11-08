import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 500) issues.push(r.status() + ' ' + r.url());
});
const login = JSON.parse(await readFile('work/local-login.json', 'utf8'));
await page.goto('http://localhost:5173');
await page.getByLabel('Email', { exact: true }).fill(login.email);
await page.getByLabel('Kata sandi', { exact: true }).fill(login.password);
await page.getByRole('button', { name: 'Masuk ke New System' }).click();
await page.getByRole('heading', { name: 'Semua terkendali.' }).waitFor();
await page.screenshot({ path: 'work/dashboard-desktop.png', fullPage: true });
for (const name of [
  'Produk',
  'Stok & Gudang',
  'Pembelian',
  'Supplier',
  'Hutang Supplier',
  'Penjualan',
  'Laporan',
  'Pengaturan',
]) {
  await page.locator('nav').getByRole('button', { name, exact: true }).click();
  await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
}
await page.getByRole('button', { name: 'Smart System Temukan cerita di balik data' }).click();
await page.getByRole('button', { name: 'Analisis semua data' }).click();
await page.getByText('Analisis selesai. Tag otomatis telah disimpan.').waitFor();
await page.screenshot({ path: 'work/smart-desktop.png', fullPage: true });
await page.locator('nav').getByRole('button', { name: 'Scan Nota OCR' }).click();
await page.getByRole('button', { name: 'Input nota manual' }).click();
await page.screenshot({ path: 'work/scan-desktop.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'work/scan-mobile.png', fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
issues.push(...(overflow ? ['mobile horizontal overflow'] : []));
await writeFile('work/ui-results.json', JSON.stringify({ issues }, null, 2));
console.log(JSON.stringify({ issues }));
await browser.close();
if (issues.length) process.exitCode = 1;
