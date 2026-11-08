# Arsitektur dan integritas data

## Komponen

- `src/`: React/Vite, kamera, PDF.js, Tesseract.js, IndexedDB, dan antarmuka Indonesia.
- `shared/`: kontrak data, parser angka, pencocokan produk, template supplier, aturan analisis.
- `server/`: Hono Worker, sesi cookie HttpOnly, pembatasan peran, query parameter, API laporan/analisis.
- `migrations/`: skema PostgreSQL dan fungsi pembukuan atomik.
- `scripts/`: migrasi direct connection, impor snapshot, akun pemilik, server development, aset OCR.

## Stok resmi

`operations` menyimpan payload, referensi, aktor, dan kunci idempotensi. `post_operation()` mengunci baris bisnis terlebih dahulu, memeriksa izin dan gudang, memvalidasi data, mengunci saldo produk, mencatat seluruh dokumen, mutasi, dan audit dalam satu transaksi PostgreSQL.

Penguncian per bisnis sengaja sederhana: satu transaksi tulis bisnis diproses pada satu waktu. Ini mencegah overselling, bentrok penerimaan, dan duplikasi kunci pada toko kecil. Untuk beban tinggi dapat diganti penguncian terurut per produk dengan pengujian konkurensi tambahan.

`inventory_movements` bersifat immutable melalui trigger. `inventory_balances` adalah proyeksi dengan jumlah non-negatif dan biaya rata-rata tertimbang. Riwayat operasi, mutasi, audit, dan pembayaran tidak bisa diubah melalui endpoint. Koreksi stok memakai transaksi baru dengan alasan.

Kunci idempotensi yang sama dan payload sama mengembalikan transaksi terdahulu. Payload berbeda ditolak. Nomor nota unik per supplier dan bisnis; hash dokumen membatasi pembukuan ulang dokumen identik. Tetap perlu verifikasi manusia karena foto berbeda atau nomor nota salah OCR tidak selalu dapat diketahui sebagai dokumen yang sama.

## Harga dan satuan

Produk memiliki satuan dasar tetap. Konversi pembelian disimpan eksplisit per produk: `quantity × multiplier = quantity_base`. Misalnya bila satuan dasar BOTOL dan `DUS=24`, 2 DUS menjadi 48 BOTOL. Jangan menyimpulkan rasio dari nama produk.

`pieces_per_base` adalah data tambahan yang dikonfirmasi untuk menampilkan modal per PCS pada produk bersatuan DOS/SET/dll. Angka ini tidak otomatis memecah kemasan atau membuat stok PCS. Gunakan produk bersatuan dasar PCS dan konversi pembelian bila penjualan dilakukan per PCS.

Modal historis suatu penjualan adalah biaya rata-rata pada saat penjualan. Mengedit harga beli master tidak menulis ulang histori biaya atau valuasi ledger. Opname menghitung selisih jumlah fisik di server dengan saldo terbaru, sehingga perubahan di perangkat lain tidak memakai saldo client yang usang.

## Dokumen dan hutang

Tanggal nota, pengiriman, penerimaan aktual, jatuh tempo, dan pembayaran disimpan terpisah. Jumlah nota, fisik diterima, dan rusak tetap terpisah. Hanya jumlah fisik layak yang menambah stok. Kewajiban mengikuti nilai nota; selisih dapat memblokir pembayaran hingga manajer mencatat alasan penyelesaian.

Retur mengacu ke transaksi asal dan tidak boleh melebihi jumlah asal dikurangi retur sebelumnya. Pembayaran tidak boleh melebihi sisa hutang. Referensi bukti pembayaran wajib, tetapi berkas bank tidak diunggah/diarsipkan otomatis.

## Sumber lama

Impor hanya mengisi katalog, pemetaan supplier, dan tabel `source_records`; stok lama tidak langsung dibukukan. Master stok dan log mutasi dapat merepresentasikan barang yang sama sehingga tidak dijumlahkan. Produk di luar master yang ditemukan pada log disimpan dengan stok belum diketahui. Nota lama tidak membuktikan hutang belum lunas maupun pembayaran aktual.

Snapshot sumber memiliki hash unik. Rekonsiliasi membandingkan total baris per nomor nota **dan** nama file bukti untuk menghindari mencampur dokumen berbeda. Perbedaan tetap terlihat; tidak dikoreksi diam-diam.

## Keamanan

- Peran owner, manager, cashier, warehouse diverifikasi di server dan fungsi posting.
- Password PBKDF2-SHA256 dengan salt acak; sesi HMAC bertanda tangan, HttpOnly, SameSite Strict, Secure pada HTTPS. Versi password pada sesi berupa fingerprint, bukan password hash.
- Pembatasan percobaan login 10 per email/IP per 15 menit; origin diperiksa pada permintaan tulis; JSON wajib.
- Semua query nilai bisnis diparameterkan. Tidak ada endpoint SQL bebas atau SQL yang dibuat model AI.
- Tenant bisnis berasal dari sesi tervalidasi, bukan ID bisnis dari payload. Foreign key komposit membatasi relasi antar bisnis pada objek inti.
- Secrets hanya di environment/secret Cloudflare; jangan simpan ke Git, client bundle, atau log. Respons API memakai no-store.
- CSV diekspor dengan proteksi formula injection.
- Untuk beberapa bisnis, pisahkan credential database per deployment atau tambahkan RLS jika akses langsung melalui provider/API tambahan diaktifkan. Versi ini tidak mengekspos Neon Data API ke client.
