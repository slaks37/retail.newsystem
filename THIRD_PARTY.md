# Komponen pihak ketiga

Versi persis terkunci di `package-lock.json`. Ikuti lisensi masing-masing paket saat mendistribusikan aplikasi.

- React dan React DOM — MIT.
- Hono — MIT.
- Tesseract.js dan model Tesseract — Apache-2.0; aset model diambil dari distribusi tessdata Project Naptha.
- PDF.js (`pdfjs-dist`) — Apache-2.0.
- Lucide React — ISC.
- Neon serverless driver — MIT/Apache-2.0 sesuai paket.
- PGlite — Apache-2.0; dipakai untuk development/pengujian.
- Cloudflare CLI/Vite plugin, Vite, TypeScript, Vitest, Playwright, dan pg — lihat distribusi paket masing-masing.

Script `assets:ocr` menyalin worker/core dan mengambil model bahasa untuk dihosting sendiri. Model OCR berukuran besar tidak dimasukkan ke repository Git.
