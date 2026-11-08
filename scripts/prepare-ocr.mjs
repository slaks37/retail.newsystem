import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
await mkdir('public/ocr/core', { recursive: true });
await mkdir('public/ocr/lang', { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const f of await readdir('node_modules/tesseract.js-core'))
  if (/\.wasm(?:\.js)?$/.test(f))
    await cp('node_modules/tesseract.js-core/' + f, 'public/ocr/core/' + f);
for (const lang of ['ind', 'eng']) {
  const url = `https://tessdata.projectnaptha.com/4.0.0/${lang}.traineddata.gz`;
  const response = await fetch(url);
  if (!response.ok) throw Error('Tidak dapat mengambil model ' + lang);
  await writeFile(
    `public/ocr/lang/${lang}.traineddata.gz`,
    Buffer.from(await response.arrayBuffer()),
  );
}
console.log('Aset OCR lokal siap.');
