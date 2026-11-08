import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') issues.push(m.text());
});
const login = JSON.parse(await readFile('work/local-login.json', 'utf8'));
await page.goto('http://localhost:5173');
await page.getByLabel('Email', { exact: true }).fill(login.email);
await page.getByLabel('Kata sandi', { exact: true }).fill(login.password);
await page.getByRole('button', { name: 'Masuk ke New System' }).click();
await page.getByRole('heading', { name: 'Semua terkendali.' }).waitFor();
await page.locator('nav').getByRole('button', { name: 'Scan Nota OCR' }).click();
await page.locator('input[type=file][multiple]').setInputFiles(
  process.env.OCR_INPUT ??
    (() => {
      throw Error('Isi OCR_INPUT dengan path gambar nota lokal.');
    })(),
);
await page.getByRole('button', { name: 'Baca nota sekarang' }).click();
await page.getByText('Teks selesai dibaca.', { exact: false }).waitFor({ timeout: 180000 });
await page.getByRole('button', { name: 'Input / lihat teks' }).click();
const text = await page.locator('.raw-text textarea').inputValue();
await writeFile('work/astra-ocr.txt', text);
await page.screenshot({ path: 'work/astra-ocr-review.png', fullPage: true });
console.log(JSON.stringify({ issues, chars: text.length }));
await browser.close();
