# Validasi

## Sudah diuji

- TypeScript strict dan build React/Vite produksi.
- Build Worker melalui Cloudflare CLI `cf` dan plugin Vite Cloudflare, termasuk assets OCR lokal.
- Parser rupiah/desimal, separator ambigu, kesalahan O/0 dan I/1, tanggal tidak valid, total tidak sesuai, baris berulang, dan 20 baris produk sintetis.
- Template kolom Astra (HET, diskon dasar, HARGA, potongan) dan Mataram (jumlah pada sisi kiri). Contoh uji di repository menggunakan data sintetis.
- Fungsi PostgreSQL pada PGlite: saldo awal, penerimaan produk lama berulang, stok kurang, rollback seluruh keranjang, idempotensi, kunci dengan isi berbeda, konversi kemasan, fisik parsial/rusak, total nota berbeda, pembayaran sebagian, retur, izin peran, scope bisnis, ledger immutable, impor sumber idempoten, dan analisis berulang.
- Browser Chromium lokal: login, sepuluh halaman navigasi, analisis dan penyimpanan tag, layar scan manual, layout desktop dan ponsel, serta pemeriksaan error JavaScript/overflow.
- Tesseract.js benar-benar dijalankan di browser pada foto nota supplier yang disediakan; output mentah dan status review diperiksa. Ini bukan bukti ekstraksi seluruh kolom sudah akurat.

## Masih perlu validasi operasional

- Deployment pada database Neon dan domain Cloudflare yang benar-benar terhubung, termasuk uji konkurensi beberapa koneksi database.
- Foto nota nyata berisi 20 produk dari perangkat toko, bukan hanya parser 20 baris sintetis.
- Kamera/perizinan pada perangkat iOS/Android toko, memori perangkat rendah, pembatalan saat inisialisasi, dan pemulihan cache OCR setelah browser ditutup.
- Dokumen supplier di luar template yang telah dicoba serta OCR PDF gambar yang sulit atau terlipat/miring.
- Pemulihan backup database dan arsip gambar lintas perangkat jika adapter penyimpanan privat ditambahkan.

PGlite menjalankan PostgreSQL nyata dalam WASM dan memvalidasi SQL/trigger/transaksi, tetapi satu koneksi lokal tidak membuktikan perilaku jaringan Neon atau beberapa koneksi produksi. Hasil OCR yang tidak terbaca tetap harus dikoreksi manusia; aplikasi tidak menjamin akurasi 100%.
