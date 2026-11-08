# Deployment: Cloudflare + Neon

## 1. Neon terpisah

Buat project/database baru khusus New System. Jika melalui Vercel Marketplace, gunakan akun/team yang dipilih pengguna dan buat Neon dari Storage. Pilih paket yang sesuai; tidak ada janji biaya nol di luar kuota provider. Region yang disarankan untuk toko Indonesia adalah Singapore (`aws-ap-southeast-1`).

Buat branch development untuk menguji migrasi. Simpan koneksi pooled di `DATABASE_URL` dan direct di `DATABASE_URL_UNPOOLED` pada `.env.local`. Jangan menempel credential di chat atau commit ke Git.

Jalankan migrasi, impor privat opsional, dan pembuatan owner sesuai README. Bila port TCP database diblokir, `scripts/migrate-http.ts` memakai batch `transaction()` Neon melalui HTTPS, satu transaksi per berkas. Splitter mempertahankan fungsi PL/pgSQL dan telah diuji pada PostgreSQL. Script migrasi memakai koneksi direct `pg` dan transaction per berkas, sehingga DDL serta penanda migrasi tersimpan bersama. Pembuatan owner memakai password minimal 12 karakter dari environment.

## 2. Cloudflare

Project menggunakan `cf` dan `cloudflare.config.ts`, bukan konfigurasi Wrangler. Node.js 24+ diperlukan. Jalankan `npm ci`, `npm run assets:ocr`, dan `npm run build:cloudflare`.

Autentikasikan CLI sendiri (`npx cf auth login`) atau isi token dalam secret CI. Tentukan akun Newsystem yang tepat melalui `CLOUDFLARE_ACCOUNT_ID`. Jangan memilih akun lain otomatis.

Secret runtime Worker:

| Nama             | Isi                            |
| ---------------- | ------------------------------ |
| `DATABASE_URL`   | Koneksi Neon khusus New System |
| `SESSION_SECRET` | Nilai acak minimal 32 byte     |

`BUSINESS_ID` berada di konfigurasi dan harus cocok dengan bisnis hasil seed. `WORKER_REGION` harus cocok dengan region database, misalnya `aws:ap-southeast-1`. `APP_ORIGIN` opsional di runtime; bila tidak diset, origin permintaan same-origin dipakai.

Temukan perintah secret yang berlaku pada versi CLI terpasang:

```bash
npx cf cli search "set worker secret"
```

Baca schema/help perintah yang ditemukan; kirim nilai melalui stdin/berkas privat sesuai kontrak CLI. Atau isi secret melalui dashboard Worker setelah Worker pertama diunggah. Jangan menaruh URL database sebagai binding teks biasa.

Deploy:

```bash
npm run deploy
```

Cloudflare account baru mungkin belum memiliki subdomain workers.dev; aktifkan di Workers & Pages atau pilih custom domain milik sendiri sebelum mengaktifkan URL publik. Jangan menebak atau menampilkan URL aplikasi sebagai aktif sebelum deploy dan readback berhasil.

## 3. GitHub

Repository kode tidak memuat data bisnis. GitHub Actions `Checks` memvalidasi kode; `Deploy Cloudflare` dipicu manual. Isi secret repository/environment:

- `CLOUDFLARE_API_TOKEN` dengan izin deploy Workers dan assets pada akun tujuan.
- `CLOUDFLARE_ACCOUNT_ID`.
- Variabel `WORKER_REGION` bila berbeda dari Singapore.

Secret database dan sesi harus sudah tersedia di Worker; workflow tidak menaruhnya ke client bundle. Tidak ada workflow yang menjalankan migrasi produksi tanpa tahapan deployment database yang dipilih operator.

## 4. Verifikasi sebelum dipakai

Masuk sebagai owner; ubah password awal. Verifikasi katalog/harga dan stok awal. Uji penerimaan kecil menggunakan produk lama, ulangi request untuk memastikan tidak ganda, lalu catat penjualan dan lihat ledger. Uji pembayaran sebagian terhadap invoice yang disetujui. Periksa hak kasir/gudang serta akses tanpa sesi. Foto nota 20 produk nyata perlu diuji di perangkat toko dan dikoreksi manusia sebelum menyatakan kualitas ekstraksi siap operasional.

Backup terpisah diperlukan untuk database dan dokumen asli; IndexedDB bukan arsip lintas perangkat.
