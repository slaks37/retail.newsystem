import type { Worker as OCRWorker } from 'tesseract.js';
import { get, set, del } from 'idb-keyval';
let worker: OCRWorker | null = null;
let running = false;
let generation = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
export interface OCRProgress {
  stage: string;
  progress: number;
  page: number;
  pages: number;
}
export interface OCRDocument {
  text: string;
  pages: { text: string; tsv: string | null; page: number; confidence: number | null }[];
  hash: string;
  filenames: string[];
}
let notify: ((p: OCRProgress) => void) | undefined;
let currentPage = 1;
let pageCount = 1;
async function getWorker() {
  if (worker) return worker;
  const { createWorker } = await import('tesseract.js');
  worker = await createWorker(
    'ind+eng',
    1,
    {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      logger: (m) => {
        if (m.status === 'recognizing text')
          notify?.({
            stage: 'Membaca teks',
            progress: m.progress,
            page: currentPage,
            pages: pageCount,
          });
      },
    },
    {},
  );
  return worker;
}
export async function cancelOCR() {
  generation++;
  running = false;
  clearTimeout(idle);
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}
export async function processDocuments(
  files: File[],
  onProgress: (p: OCRProgress) => void,
  processed?: Blob,
): Promise<OCRDocument> {
  if (running) throw Error('Masih ada dokumen yang sedang diproses.');
  if (!files.length || files.length > 8) throw Error('Pilih 1–8 file.');
  if (files.some((f) => f.size > 20 * 1024 * 1024)) throw Error('Batas ukuran 20 MB per file.');
  running = true;
  const run = ++generation;
  notify = onProgress;
  clearTimeout(idle);
  const result: OCRDocument = {
    text: '',
    pages: [],
    hash: '',
    filenames: files.map((f) => f.name),
  };
  const hashes: string[] = [];
  const seen = new Set<string>();
  const hash = async (data: ArrayBuffer) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  const assert = () => {
    if (run !== generation) throw Error('Pemrosesan dibatalkan.');
  };
  try {
    pageCount = files.length;
    currentPage = 0;
    for (const file of files) {
      assert();
      const buffer = await file.arrayBuffer();
      const fingerprint = await hash(buffer);
      if (seen.has(fingerprint)) {
        throw Error('File duplikat dipilih. Hapus salinannya sebelum melanjutkan.');
      }
      seen.add(fingerprint);
      hashes.push(fingerprint);
      await set('original:' + fingerprint, file);
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
        try {
          if (pdf.numPages > 10 || result.pages.length + pdf.numPages > 16)
            throw Error('Batas aman: 10 halaman per PDF dan 16 halaman total.');
          pageCount += pdf.numPages - 1;
          for (let i = 1; i <= pdf.numPages; i++) {
            assert();
            currentPage++;
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            let text = '';
            let lastY: number | null = null;
            for (const item of content.items) {
              if ('str' in item) {
                const y = item.transform[5];
                if (lastY !== null && Math.abs(lastY - y) > 4) text += '\n';
                text += item.str + ' ';
                if (item.hasEOL) text += '\n';
                lastY = y;
              }
            }
            if (text.replace(/\s/g, '').length > 70) {
              result.pages.push({ text, tsv: null, page: currentPage, confidence: null });
              onProgress({
                stage: 'Membaca lapisan teks PDF',
                progress: 1,
                page: currentPage,
                pages: pageCount,
              });
            } else {
              const base = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({
                scale: Math.min(2, 2000 / Math.max(base.width, base.height)),
              });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
                .promise;
              assert();
              const data = await (
                await getWorker()
              ).recognize(canvas, {}, { text: true, tsv: true });
              result.pages.push({
                text: data.data.text,
                tsv: data.data.tsv ?? null,
                page: currentPage,
                confidence: data.data.confidence,
              });
              canvas.width = canvas.height = 0;
            }
            page.cleanup();
          }
        } finally {
          await pdf.destroy();
        }
      } else if (file.type.startsWith('image/')) {
        currentPage++;
        onProgress({
          stage: 'Menyiapkan gambar',
          progress: 0,
          page: currentPage,
          pages: pageCount,
        });
        const image = processed && files.length === 1 ? processed : await preprocess(file);
        assert();
        const data = await (await getWorker()).recognize(image, {}, { text: true, tsv: true });
        assert();
        result.pages.push({
          text: data.data.text,
          tsv: data.data.tsv ?? null,
          page: currentPage,
          confidence: data.data.confidence,
        });
      } else throw Error('Gunakan gambar atau PDF.');
    }
    assert();
    result.hash = await hash(new TextEncoder().encode(hashes.join('|')).buffer);
    result.text = result.pages.map((p) => p.text).join('\n\n');
    await set('ocr:' + result.hash, result);
    onProgress({
      stage: 'Menganalisis baris nota',
      progress: 1,
      page: pageCount,
      pages: pageCount,
    });
    return result;
  } finally {
    if (run === generation) {
      running = false;
      notify = undefined;
      idle = setTimeout(() => {
        void cancelOCR();
      }, 120000);
    }
  }
}
export async function preprocess(file: Blob, options: Record<string, unknown> = {}): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (typeof OffscreenCanvas === 'undefined') {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = bitmap.width * ratio;
    canvas.height = bitmap.height * ratio;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error('Gagal menyiapkan gambar.'))),
        'image/jpeg',
        0.9,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const processor = new Worker(new URL('./preprocess.worker.ts', import.meta.url), {
      type: 'module',
    });
    processor.onmessage = (e) => {
      processor.terminate();
      if (e.data.error) reject(Error(e.data.error));
      else resolve(e.data.blob);
    };
    processor.onerror = (e) => {
      processor.terminate();
      reject(Error(e.message));
    };
    processor.postMessage({ bitmap, ...options }, [bitmap]);
  });
}
export async function saveLocalDraft(id: string, value: unknown) {
  await set('draft:' + id, value);
}
export async function loadLocalDraft(id: string) {
  return get('draft:' + id);
}
export async function deleteLocalDraft(id: string) {
  await del('draft:' + id);
}
