# New System

Aplikasi operasional retail berbahasa Indonesia: katalog dan harga, POS, stok/opname, pembelian, penerimaan, supplier, hutang, OCR nota lokal, serta analisis transaksi yang dapat ditelusuri.

**Hosting:** Cloudflare Workers + Static Assets. **Database:** PostgreSQL di Neon. Vercel hanya dipakai jika database Neon dibuat melalui Marketplace; aplikasi tidak memerlukan hosting Vercel.

## Menjalankan secara lokal

Node.js 24+, npm, dan browser modern. PostgreSQL lokal menggunakan PGlite untuk development, bukan database produksi.

```bash
npm ci
npm run assets:ocr
# Terminal pertama
npm run dev:local
# Terminal kedua
npm run dev
```

Buka `http://localhost:5173`. Akun lokal dibuat dengan kata sandi acak; baca `work/local-login.json` di perangkat sendiri. Berkas ini diabaikan Git. Untuk menjalankan tanpa data bisnis, gunakan contoh sintetis:

```bash
SOURCE_DATA_DIR=./tests/fixtures npm run dev:local
```

Data bisnis asli sengaja tidak dimasukkan ke repository. Paket sumber privat berisi `data/source-0.json` (master), `data/source-1.json` (mutasi), dan `data/source-2.json` (rekap nota). Ini snapshot, bukan sinkronisasi Google Sheets otomatis. Nama file bukti pada spreadsheet tidak berarti gambar sudah diarsipkan aplikasi.

## Alur penggunaan

1. **Produk:** tambah/edit SKU, barcode, nama, harga beli, harga jual, minimum stok, status aktif, dan isi PCS per satuan dasar. SKU unik; impor CSV memperbarui SKU lama secara atomik tanpa menggandakan produk atau mengubah stok.
2. **Stok & Gudang:** konfirmasi saldo pembukaan hasil impor. Jangan menjumlahkan saldo master dan histori mutasi lagi. Catat opname menggunakan jumlah fisik; server menghitung selisih terhadap saldo terbaru. Penyesuaian, kerusakan, retur, dan transfer memakai ledger.
3. **Penjualan:** cari produk atau gunakan scanner barcode sebagai input keyboard; pilih barang, ubah jumlah, berikan diskon, catat tunai/transfer manual, selesaikan transaksi. Stok dan penjualan tersimpan bersama, dengan pengecekan stok di server. Struk opsional.
4. **Scan Nota:** foto dengan kamera belakang atau unggah gambar/PDF; periksa teks, cocokkan produk, isi jumlah fisik/rusak, pilih satuan dan konversi yang terkonfirmasi, lalu tinjau rekonsiliasi sebelum membukukan. Produk yang sudah ada dipakai kembali; stok ditambah melalui penerimaan, bukan membuat SKU baru.
5. **Pembelian:** buat PO, kemudian cocokkan dengan nota dan penerimaan. PO mendukung penerimaan sebagian. Selisih fisik, kelebihan jumlah terhadap PO, harga, atau produk di luar PO memblokir persetujuan pembayaran.
6. **Hutang Supplier:** lihat total/sisa, jatuh tempo, persetujuan selisih, pembayaran sebagian, tunai, transfer, dan nota kredit dengan referensi bukti. Nota lama yang belum diverifikasi tidak otomatis menjadi hutang atau dianggap lunas.
7. **Smart System:** jalankan analisis untuk tag stok, ABC omzet, laju permintaan, cakupan stok, rekomendasi restok, perubahan harga, margin negatif, jatuh tempo, dan kualitas sumber. Setiap temuan memiliki alasan, bukti, dan versi aturan. Tanpa histori penjualan, sistem tidak mengarang label barang laris.

Harga jual tidak dibuat otomatis dari harga beli. Modal ditampilkan per satuan dasar; modal per PCS hanya dihitung untuk satuan PCS atau jika isi PCS per satuan dasar dikonfirmasi pengguna. Tidak ada asumsi “1 dus = 24 PCS”.

## Database produksi

Lihat [panduan deployment](docs/DEPLOYMENT.md) dan [model data](docs/ARCHITECTURE.md). Buat database Neon khusus aplikasi ini, terpisah dari aplikasi lain. Uji migrasi di branch pengembangan sebelum memakai data operasional.

```bash
# Isi .env.local secara privat; jangan commit credential.
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/import.ts
# ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD ada di environment privat
node --env-file=.env.local --import tsx scripts/admin.ts
```

`DATABASE_URL_UNPOOLED` dipakai migrasi melalui `pg`; aplikasi memakai `DATABASE_URL` dan HTTP driver Neon. Transaksi resmi berjalan di satu pemanggilan fungsi PostgreSQL, bukan beberapa permintaan HTTP terpisah.

## OCR

- Tesseract.js 6, bahasa Indonesia + Inggris, worker digunakan ulang, progres nyata, pembatalan, idle termination, dan pemrosesan berurutan.
- Aset worker/WASM/model dihosting sendiri melalui `npm run assets:ocr`. Service worker hanya menyimpan aset OCR publik; respons API tidak di-cache.
- PDF.js mengambil lapisan teks bila tersedia, atau merender halaman untuk OCR. Batas aman: 8 file, 20 MB/file, 10 halaman/PDF, dan 16 halaman total.
- Penyesuaian gambar berjalan di Web Worker: orientasi, crop, putar, resize, grayscale, kontras, kecerahan, dan threshold. Dokumen asli disimpan di IndexedDB.
- Parser umum dan template layout Astra Otoparts / Mataram; angka tak terbaca tetap kosong. Teks dan TSV posisi disimpan bersama draft bila pengguna menyimpan ke server.
- Tidak ada pengiriman gambar atau teks ke layanan OCR/AI pihak ketiga. Gambar asli **lokal pada perangkat**; belum ada arsip R2 lintas perangkat.

## Pemeriksaan

```bash
npm test
npm run build
npm run build:cloudflare
# Dengan dua server lokal dan Chromium Playwright tersedia
npm run test:browser
```

Lihat [cakupan dan batas validasi](docs/VALIDATION.md). CI menjalankan parser, template, ledger PostgreSQL lokal, otorisasi, dan build. Deployment Cloudflare dipicu manual melalui GitHub Actions setelah secret runtime disiapkan.

## Batas versi ini

Tidak ada sinkronisasi POS offline, pembayaran bank otomatis, arsip bukti privat lintas perangkat, koreksi perspektif otomatis, atau integrasi LLM berbayar. Analisis pintar memakai aturan dan statistik yang bisa diperiksa; bukan model AI yang mengubah database. Retur barang tidak otomatis mengembalikan uang; catat refund/nota kredit sesuai bukti. Laba kotor pada laporan penjualan belum merupakan laporan laba bersih/akuntansi lengkap. UI menampilkan data terbatas per halaman, sedangkan analisis dan laporan periode memakai agregasi seluruh data yang sesuai.
