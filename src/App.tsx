import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Warehouse,
  ShoppingBag,
  Truck,
  Wallet,
  ShoppingCart,
  ChartNoAxesCombined,
  Settings,
  Layers,
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  RefreshCw,
  LogOut,
  Menu,
  X,
  Check,
  AlertTriangle,
  Download,
  TrendingUp,
  Banknote,
  Boxes,
  Clock,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import type { Product, Snapshot, Insight } from '../shared/types';
import { api, rupiah, quantity, tanggal, today, download } from './api';
import { Button, Badge, Modal, Field, Empty, Section, DataTable, Stat, Form } from './components';
import { ScanPage } from './ScanPage';
const nav = [
  ['Dashboard', LayoutDashboard],
  ['Scan Nota', ScanLine],
  ['Produk', Package],
  ['Stok & Gudang', Warehouse],
  ['Pembelian', ShoppingBag],
  ['Supplier', Truck],
  ['Hutang Supplier', Wallet],
  ['Penjualan', ShoppingCart],
  ['Laporan', ChartNoAxesCombined],
  ['Pengaturan', Settings],
] as const;
const units = [
  'PCS',
  'SET',
  'TIN',
  'DOS',
  'DUS',
  'BOTOL',
  'LSN',
  'M',
  'DRM',
  'PACK',
  'BOX',
  'KARTON',
  'KG',
  'GRAM',
  'LITER',
  'SACHET',
];
export default function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [page, setPage] = useState('Dashboard'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState(''),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState<ReactNode>(null);
  const [insights, setInsights] = useState<Insight[] | null>(null),
    [analyzing, setAnalyzing] = useState(false);
  async function refresh() {
    try {
      setError('');
      setData(await api<Snapshot>('/snapshot'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  async function perform(path: string, body: unknown, message = 'Berhasil disimpan.') {
    const result = await api(path, body);
    setToast(message);
    await refresh();
    return result;
  }
  const close = () => setModal(null);
  function changePage(p: string) {
    setPage(p);
    setMobile(false);
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Layers size={40} />
        <p>Menyiapkan New System…</p>
      </div>
    );
  if (!data) return <Login error={error} onLogin={refresh} />;
  const can = (action: string) =>
    (
      ({
        owner: ['catalog', 'purchase', 'receive', 'sell', 'pay', 'adjust', 'settings'],
        manager: ['catalog', 'purchase', 'receive', 'sell', 'pay', 'adjust'],
        warehouse: ['receive'],
        cashier: ['sell'],
      })[data.user.role] ?? []
    ).includes(action);
  const locationId = data.locations[0]?.id;
  const productForm = (product?: Product, onSaved?: (id: string) => void) =>
    setModal(
      <Modal title={product ? 'Edit produk' : 'Tambah produk'} onClose={close}>
        <Form
          onSubmit={async (f) => {
            const result = await perform('/products', {
              id: product?.id,
              sku: f.get('sku'),
              name: f.get('name'),
              barcode: f.get('barcode') || null,
              base_unit: f.get('base_unit'),
              purchase_cost: Number(f.get('purchase_cost')),
              selling_price: f.get('selling_price') === '' ? null : Number(f.get('selling_price')),
              min_stock: Number(f.get('min_stock')),
              pieces_per_base:
                f.get('pieces_per_base') === '' ? null : Number(f.get('pieces_per_base')),
              active: f.get('active') === 'on',
            });
            close();
            onSaved?.(String(result.id));
          }}
        >
          <div className="form-grid">
            <Field label="Kode produk / SKU">
              <input name="sku" required defaultValue={product?.sku} />
            </Field>
            <Field label="Barcode (opsional)">
              <input name="barcode" defaultValue={product?.barcode ?? ''} />
            </Field>
            <Field label="Nama produk">
              <input name="name" required defaultValue={product?.name} />
            </Field>
            <Field
              label="Satuan dasar"
              hint={product ? 'Satuan dasar produk tetap setelah dibuat.' : undefined}
            >
              <select
                name="base_unit"
                defaultValue={product?.base_unit ?? 'PCS'}
                disabled={!!product}
              >
                {units.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
              {product && <input type="hidden" name="base_unit" value={product.base_unit} />}
            </Field>
            <Field label="Harga beli per satuan dasar">
              <input
                name="purchase_cost"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={product?.purchase_cost ?? 0}
              />
            </Field>
            <Field label="Harga jual" hint="Kosongkan jika belum ditentukan.">
              <input
                name="selling_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product?.selling_price ?? ''}
              />
            </Field>
            <Field
              label="Isi PCS per satuan dasar"
              hint="Opsional. Contoh: 1 DOS = 24 PCS. Tidak diisi otomatis dari nama produk."
            >
              <input
                name="pieces_per_base"
                type="number"
                step="0.000001"
                min="0.000001"
                defaultValue={product?.pieces_per_base ?? ''}
              />
            </Field>
            <Field label="Batas minimum stok">
              <input
                name="min_stock"
                type="number"
                step="0.0001"
                min="0"
                required
                defaultValue={product?.min_stock ?? 0}
              />
            </Field>
          </div>
          <label className="checkbox">
            <input name="active" type="checkbox" defaultChecked={product?.active ?? true} />
            Produk aktif
          </label>
        </Form>
      </Modal>,
    );
  function conversionForm(product: Product) {
    setModal(
      <Modal title={'Konversi · ' + product.sku} onClose={close}>
        <p>Konfirmasi isi kemasan dari produk atau nota. Sistem tidak menebak isi dus.</p>
        <Form
          onSubmit={async (f) => {
            await perform('/conversions', {
              product_id: product.id,
              unit: f.get('unit'),
              multiplier: Number(f.get('multiplier')),
            });
            close();
          }}
        >
          <Field label="Satuan pembelian">
            <select name="unit">
              {units
                .filter((u) => u !== product.base_unit)
                .map((u) => (
                  <option key={u}>{u}</option>
                ))}
            </select>
          </Field>
          <Field label={'1 kemasan berisi berapa ' + product.base_unit + '?'}>
            <input type="number" step="0.000001" name="multiplier" min="0.000001" required />
          </Field>
        </Form>
      </Modal>,
    );
  }
  function tagForm(entityType: string, id: string) {
    setModal(
      <Modal title="Tambahkan tag manual" onClose={close}>
        <Form
          onSubmit={async (f) => {
            await perform('/tags', {
              entity_type: entityType,
              entity_id: id,
              tag: f.get('tag'),
              note: f.get('note'),
            });
            close();
          }}
        >
          <Field label="Tag">
            <input name="tag" required maxLength={60} />
          </Field>
          <Field label="Alasan / konteks">
            <textarea name="note" required minLength={3} />
          </Field>
        </Form>
      </Modal>,
    );
  }
  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const result = await api<{ insights: Insight[] }>('/analyze', {});
      setInsights(result.insights);
      await refresh();
      setToast('Analisis selesai. Tag otomatis telah disimpan.');
    } catch (e) {
      setToast(String(e));
    } finally {
      setAnalyzing(false);
    }
  }
  function opening() {
    setModal(
      <Modal title="Konfirmasi saldo pembukaan" wide onClose={close}>
        <Opening
          data={data!}
          onPost={async (lines) => {
            await perform('/operations', {
              type: 'OPENING_BALANCE',
              location_id: locationId,
              reference: 'SALDO-AWAL-SUMBER-JAGO',
              idempotency_key: 'opening-source-v1-' + data!.business.id,
              reason: 'Konfirmasi saldo pembukaan berdasarkan master dan opname sumber',
              lines,
            });
            close();
          }}
        />
      </Modal>,
    );
  }
  function adjust() {
    const transactionKey = crypto.randomUUID();
    setModal(
      <Modal title="Catat mutasi / koreksi stok" onClose={close}>
        <Form
          onSubmit={async (f) => {
            const type = String(f.get('type')),
              p = data!.products.find((p) => p.id === f.get('product_id'))!;
            await perform('/operations', {
              type,
              location_id: f.get('location_id'),
              target_location_id: f.get('target_location_id') || undefined,
              original_operation_id: f.get('original_operation_id') || undefined,
              reference: f.get('reference'),
              reason: f.get('reason'),
              idempotency_key: transactionKey,
              lines: [
                {
                  product_id: p.id,
                  quantity: Number(f.get('quantity')),
                  unit: p.base_unit,
                  unit_price: Number(p.purchase_cost),
                  direction: f.get('direction'),
                  counted_quantity:
                    f.get('counted_quantity') === ''
                      ? undefined
                      : Number(f.get('counted_quantity')),
                },
              ],
            });
            close();
          }}
        >
          <Field label="Jenis mutasi">
            <select name="type">
              <option value="STOCK_ADJUSTMENT">Penyesuaian stok</option>
              <option value="DAMAGE">Barang rusak</option>
              <option value="CUSTOMER_RETURN">Retur pelanggan</option>
              <option value="SUPPLIER_RETURN">Retur supplier</option>
              {data!.locations.length > 1 && <option value="TRANSFER">Transfer antargudang</option>}
            </select>
          </Field>
          <Field label="Produk">
            <select name="product_id" required>
              {data!.products.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Gudang asal">
              <select name="location_id">
                {data!.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Gudang tujuan (khusus transfer)">
              <select name="target_location_id">
                <option value="">Pilih jika transfer</option>
                {data!.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Jumlah dalam satuan dasar">
              <input
                type="number"
                name="quantity"
                min="0.0001"
                step="0.0001"
                defaultValue="1"
                required
              />
            </Field>
            <Field
              label="Stok fisik saat ini (khusus opname)"
              hint="Jika diisi, sistem menghitung selisih dari saldo terbaru secara atomik."
            >
              <input type="number" name="counted_quantity" min="0" step="0.0001" />
            </Field>
            <Field label="Arah penyesuaian">
              <select name="direction">
                <option value="in">Tambah stok</option>
                <option value="out">Kurangi stok</option>
              </select>
            </Field>
          </div>
          <Field
            label="ID transaksi asal (wajib untuk retur)"
            hint="Dapatkan dari Riwayat transaksi di halaman Laporan."
          >
            <input name="original_operation_id" />
          </Field>
          <Field label="Referensi">
            <input name="reference" required defaultValue={'MUT-' + Date.now()} />
          </Field>
          <Field label="Alasan / bukti">
            <textarea name="reason" minLength={3} required />
          </Field>
          <p className="muted small">
            Retur ini mencatat barang. Pengembalian uang atau nota kredit perlu dicatat terpisah
            dengan bukti yang sesuai.
          </p>
        </Form>
      </Modal>,
    );
  }
  function payment(row: Record<string, unknown>) {
    const transactionKey = crypto.randomUUID();
    setModal(
      <Modal title={'Pembayaran · ' + row.invoice_number} onClose={close}>
        <p>
          Sisa hutang <strong>{rupiah(Number(row.total) - Number(row.paid_amount))}</strong>
        </p>
        <Form
          onSubmit={async (f) => {
            await perform('/operations', {
              type: 'PAYMENT',
              location_id: locationId,
              idempotency_key: transactionKey,
              reference: f.get('proof_reference'),
              invoice_id: row.id,
              amount: Number(f.get('amount')),
              method: f.get('method'),
              proof_reference: f.get('proof_reference'),
              paid_at: f.get('paid_at'),
            });
            close();
          }}
        >
          <Field label="Jumlah pembayaran">
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              max={Number(row.total) - Number(row.paid_amount)}
              required
            />
          </Field>
          <Field label="Metode">
            <select name="method">
              <option value="cash">Tunai</option>
              <option value="transfer">Transfer manual</option>
              <option value="credit_note">Nota kredit</option>
            </select>
          </Field>
          <Field label="Tanggal pembayaran">
            <input name="paid_at" type="date" defaultValue={today()} required />
          </Field>
          <Field label="Referensi bukti transfer / kas / nota kredit">
            <input name="proof_reference" minLength={3} required />
          </Field>
        </Form>
      </Modal>,
    );
  }
  function approve(row: Record<string, unknown>) {
    setModal(
      <Modal title="Setujui selisih nota" onClose={close}>
        <div className="alert warning">
          Pembayaran diblokir karena ada selisih. Persetujuan ini akan tercatat di audit.
        </div>
        <pre>{JSON.stringify(row.match_warnings, null, 2)}</pre>
        <Form
          onSubmit={async (f) => {
            await perform('/invoices/' + row.id + '/approve', { reason: f.get('reason') });
            close();
          }}
        >
          <Field label="Alasan penyelesaian selisih">
            <textarea name="reason" minLength={10} required />
          </Field>
        </Form>
      </Modal>,
    );
  }
  const sourceReport = data.imports[0]?.report as Record<string, unknown> | undefined;
  return (
    <div className="app">
      <aside className={'sidebar ' + (mobile ? 'open' : '')}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changePage('Dashboard');
          }}
          className="brand"
        >
          <span className="brand-mark">
            <Layers size={25} />
          </span>
          <span>
            new<span className="brand-light">system</span>
            <small>RUANG KERJA TOKO</small>
          </span>
        </a>
        <div className="store-switch">
          <div className="store-avatar">SJ</div>
          <div>
            <strong>Sumber Jago</strong>
            <span>Retail & suku cadang</span>
          </div>
          <ChevronRight size={15} />
        </div>
        <span className="nav-label">OPERASIONAL</span>
        <nav>
          {nav.map(([label, Icon], i) => (
            <button
              key={label}
              className={page === label ? 'active' : ''}
              onClick={() => changePage(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === 'Scan Nota' && <Badge tone="green">OCR</Badge>}
              {label === 'Hutang Supplier' &&
                data.invoices.filter((i) => Number(i.total) > Number(i.paid_amount)).length > 0 && (
                  <i className="nav-dot" />
                )}
              {i === 6 && null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={'smart-nav ' + (page === 'Smart System' ? 'selected' : '')}
            onClick={() => changePage('Smart System')}
          >
            <Sparkles size={21} />
            <div>
              <strong>Smart System</strong>
              <span>Temukan cerita di balik data</span>
            </div>
            <ArrowUpRight size={17} />
          </button>
          <div className="system-status">
            <span />
            Ledger stok terhubung
            <ShieldCheck size={14} />
          </div>
          <div className="profile">
            <div className="profile-avatar">{data.user.name.slice(0, 1)}</div>
            <div>
              <strong>{data.user.name}</strong>
              <small>
                {data.user.role === 'owner'
                  ? 'Pemilik toko'
                  : data.user.role === 'cashier'
                    ? 'Kasir'
                    : data.user.role === 'warehouse'
                      ? 'Gudang'
                      : 'Manajer'}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Keluar"
              onClick={async () => {
                await api('/logout', {});
                setData(null);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && <div className="sidebar-overlay" onClick={() => setMobile(false)} />}
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Buka navigasi"
            onClick={() => setMobile(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Ruang kerja <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="date-label">
              {new Date().toLocaleDateString('id-ID', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'Asia/Jakarta',
              })}
            </span>
            <button
              className="icon-button"
              title="Muat ulang data"
              aria-label="Muat ulang data"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <div className="avatar-mini">SJ</div>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                SUMBER JAGO / {page === 'Dashboard' ? 'IKHTISAR TOKO' : 'OPERASIONAL'}
              </div>
              <h1>{page === 'Dashboard' ? 'Semua terkendali.' : page}</h1>
              <p>
                {
                  (
                    {
                      Dashboard: 'Satu tempat untuk memantau pergerakan toko hari ini.',
                      'Scan Nota':
                        'Dari nota supplier menjadi stok, dengan verifikasi di setiap langkah.',
                      Produk: 'Katalog yang rapi, transaksi yang lebih pasti.',
                      'Stok & Gudang': 'Setiap unit memiliki jejak. Setiap perubahan tercatat.',
                      Pembelian: 'Pesan, cocokkan, dan terima barang dengan percaya diri.',
                      Supplier: 'Hubungan pemasok dan harga beli dalam satu tempat.',
                      'Hutang Supplier': 'Ketahui yang harus dibayar, kapan, dan mengapa.',
                      Penjualan: 'Kasir cepat. Pencatatan tetap lengkap.',
                      Laporan: 'Lihat hasil usaha dari transaksi yang benar-benar tercatat.',
                      Pengaturan: 'Atur akun dan periksa jejak perubahan.',
                      'Smart System':
                        'Pola, prioritas, dan rekomendasi dengan bukti yang bisa ditelusuri.',
                    } as Record<string, string>
                  )[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {page === 'Dashboard' && can('receive') && (
                <Button onClick={() => changePage('Scan Nota')}>
                  <ScanLine size={17} />
                  Scan nota baru
                </Button>
              )}
              {page === 'Produk' && can('catalog') && (
                <Button onClick={() => productForm()}>
                  <Plus size={17} />
                  Tambah produk
                </Button>
              )}
              {page === 'Stok & Gudang' && can('adjust') && (
                <Button onClick={adjust}>
                  <Plus size={17} />
                  Catat mutasi
                </Button>
              )}
              {page === 'Supplier' && can('purchase') && (
                <Button
                  onClick={() =>
                    setModal(
                      <Modal title="Tambah supplier" onClose={close}>
                        <Form
                          onSubmit={async (f) => {
                            await perform('/suppliers', {
                              name: f.get('name'),
                              contact: f.get('contact'),
                              whatsapp: f.get('whatsapp'),
                              address: f.get('address'),
                              payment_days: Number(f.get('payment_days')),
                              lead_days: Number(f.get('lead_days')),
                            });
                            close();
                          }}
                        >
                          <Field label="Nama supplier">
                            <input name="name" required minLength={2} />
                          </Field>
                          <Field label="Kontak">
                            <input name="contact" />
                          </Field>
                          <Field label="WhatsApp">
                            <input name="whatsapp" />
                          </Field>
                          <Field label="Alamat">
                            <textarea name="address" />
                          </Field>
                          <div className="form-grid">
                            <Field label="Tempo pembayaran (hari)">
                              <input
                                type="number"
                                min="0"
                                name="payment_days"
                                defaultValue={0}
                                required
                              />
                            </Field>
                            <Field label="Lead time (hari)">
                              <input
                                type="number"
                                min="0"
                                name="lead_days"
                                defaultValue={7}
                                required
                              />
                            </Field>
                          </div>
                        </Form>
                      </Modal>,
                    )
                  }
                >
                  <Plus size={17} />
                  Tambah supplier
                </Button>
              )}
              {page === 'Smart System' && (
                <Button disabled={analyzing} onClick={() => void runAnalysis()}>
                  <Sparkles size={17} />
                  {analyzing ? 'Menganalisis…' : 'Analisis semua data'}
                </Button>
              )}
            </div>
          </div>
          {page === 'Dashboard' && (
            <>
              <div className="welcome-banner">
                <div>
                  <Badge tone="soft">PUSAT KENDALI TOKO</Badge>
                  <h2>
                    Lebih sedikit administrasi.
                    <br />
                    <span>Lebih banyak kepastian.</span>
                  </h2>
                  <p>
                    Catat penjualan, terima barang, dan pahami stok
                    <br className="desktop-only" /> tanpa berpindah-pindah catatan.
                  </p>
                  <button onClick={() => changePage('Scan Nota')}>
                    Mulai dari scan nota <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="banner-visual" aria-hidden="true">
                  <div className="orbit o1" />
                  <div className="orbit o2" />
                  <div className="floating-card card-back">
                    <Package size={28} />
                    <span>Stok tercatat</span>
                    <Check size={17} />
                  </div>
                  <div className="floating-card card-front">
                    <ScanLine size={42} />
                    <div className="fake-lines">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="scan-beam" />
                    <span>NOTA → STOK</span>
                  </div>
                  <div className="floating-check">
                    <Check size={23} />
                  </div>
                </div>
              </div>
              <div className="stats-grid">
                <Stat
                  label="Penjualan hari ini"
                  value={rupiah(data.summary.today_sales)}
                  detail="Transaksi kasir yang telah tersimpan"
                  icon={<Banknote size={19} />}
                  accent
                />
                <Stat
                  label="Valuasi stok"
                  value={rupiah(data.summary.valuation)}
                  detail="Saldo ledger × rata-rata biaya"
                  icon={<Boxes size={19} />}
                />
                <Stat
                  label="Hutang supplier"
                  value={rupiah(data.summary.payables)}
                  detail="Nota terverifikasi, dikurangi pembayaran"
                  icon={<Wallet size={19} />}
                />
                <Stat
                  label="Laba kotor hari ini"
                  value={rupiah(data.summary.today_profit)}
                  detail="Omzet setelah diskon − biaya barang"
                  icon={<TrendingUp size={19} />}
                />
              </div>
              {Number(data.summary.unverified) > 0 && (
                <div className="notice-strip">
                  <span className="notice-icon">
                    <AlertTriangle size={19} />
                  </span>
                  <div>
                    <strong>{data.summary.unverified} produk menunggu verifikasi stok</strong>
                    <span>
                      Katalog sudah diimpor. Saldo resmi dicatat setelah kamu mengonfirmasi stok
                      awal.
                    </span>
                  </div>
                  {can('adjust') && (
                    <Button kind="secondary" onClick={opening}>
                      Tinjau saldo awal <ArrowRight size={15} />
                    </Button>
                  )}
                </div>
              )}
              <div className="dashboard-grid">
                <Section
                  title="Aktivitas penjualan"
                  description="Ringkasan dari transaksi tersimpan"
                  action={
                    <Button kind="ghost" onClick={() => changePage('Laporan')}>
                      Lihat laporan <ArrowUpRight size={14} />
                    </Button>
                  }
                >
                  <SalesChart sales={data.sales} />
                </Section>
                <Section title="Perlu perhatian" description="Hal penting untuk tindak lanjut">
                  <div className="attention-row" onClick={() => changePage('Produk')}>
                    <span className="attention-icon amber">
                      <Package size={19} />
                    </span>
                    <div>
                      <strong>Stok belum diverifikasi</strong>
                      <small>Konfirmasi saldo sebelum mulai menjual</small>
                    </div>
                    <b>{data.products.filter((p) => !p.stock_verified).length}</b>
                    <ChevronRight size={15} />
                  </div>
                  <div className="attention-row" onClick={() => changePage('Hutang Supplier')}>
                    <span className="attention-icon red">
                      <Clock size={19} />
                    </span>
                    <div>
                      <strong>Nota dengan selisih</strong>
                      <small>Verifikasi sebelum pembayaran</small>
                    </div>
                    <b>{data.invoices.filter((i) => i.status === 'blocked').length}</b>
                    <ChevronRight size={15} />
                  </div>
                  <div className="attention-row" onClick={() => changePage('Smart System')}>
                    <span className="attention-icon mint">
                      <Sparkles size={19} />
                    </span>
                    <div>
                      <strong>Kualitas data sumber</strong>
                      <small>
                        {sourceReport
                          ? rupiah(sourceReport.valueDifference) + ' selisih perlu ditinjau'
                          : 'Belum ada impor'}
                      </small>
                    </div>
                    <ChevronRight size={15} />
                  </div>
                  <div className="mini-tip">
                    <Sparkles size={17} />
                    <p>
                      Smart System membaca pola dari data nyata dan menjelaskan alasan setiap
                      rekomendasi.
                    </p>
                  </div>
                </Section>
              </div>
              <Section
                title="Produk & ketersediaan"
                description="Katalog asli Sumber Jago"
                action={
                  <Button kind="ghost" onClick={() => changePage('Produk')}>
                    Semua produk <ArrowUpRight size={14} />
                  </Button>
                }
              >
                <DataTable
                  rows={data.products.slice(0, 5)}
                  keyOf={(p) => p.id}
                  columns={[
                    { label: 'Produk', render: (p) => <ProductName p={p} /> },
                    { label: 'Satuan', render: (p) => <Badge>{p.base_unit}</Badge> },
                    { label: 'Harga beli', render: (p) => rupiah(p.purchase_cost) },
                    {
                      label: 'Stok resmi',
                      render: (p) =>
                        p.stock_verified ? (
                          quantity(p.quantity)
                        ) : (
                          <span className="muted">Menunggu konfirmasi</span>
                        ),
                    },
                    { label: 'Status', render: (p) => <StockBadge p={p} /> },
                  ]}
                />
              </Section>
            </>
          )}
          {page === 'Scan Nota' && (
            <ScanPage
              data={data}
              onRefresh={refresh}
              notify={setToast}
              canReceive={can('receive')}
              onCreateProduct={(onSaved) => productForm(undefined, onSaved)}
              onConversion={(id) => {
                const p = data.products.find((p) => p.id === id);
                if (p) conversionForm(p);
              }}
            />
          )}
          {page === 'Produk' && (
            <>
              <div className="subtoolbar">
                <div className="segmented">
                  <button className="selected">
                    Semua produk <span>{data.products.length}</span>
                  </button>
                </div>
                <div className="inline-actions">
                  <a className="button secondary" href="/api/export">
                    <Download size={16} />
                    Ekspor stok
                  </a>
                  {can('catalog') && (
                    <Button
                      kind="secondary"
                      onClick={() =>
                        setModal(
                          <Modal title="Impor katalog CSV" wide onClose={close}>
                            <CSVImport
                              onSave={async (rows) => {
                                await api('/products/import', rows);
                                await refresh();
                                setToast('Katalog berhasil diimpor. Stok belum diubah.');
                                close();
                              }}
                            />
                          </Modal>,
                        )
                      }
                    >
                      Impor CSV
                    </Button>
                  )}
                </div>
              </div>
              <Section
                title="Katalog produk"
                description="Harga jual kosong berarti belum ditentukan; tidak dibuat otomatis."
              >
                <DataTable
                  rows={data.products}
                  keyOf={(p) => p.id}
                  searchBy={(p) => p.sku + ' ' + p.name + ' ' + p.barcode}
                  columns={[
                    { label: 'Produk', render: (p) => <ProductName p={p} /> },
                    { label: 'Satuan', render: (p) => <Badge>{p.base_unit}</Badge> },
                    { label: 'Harga beli', render: (p) => rupiah(p.purchase_cost) },
                    {
                      label: 'Modal / PCS',
                      render: (p) =>
                        p.base_unit === 'PCS' ? (
                          rupiah(p.average_cost)
                        ) : p.pieces_per_base ? (
                          rupiah(Number(p.average_cost) / Number(p.pieces_per_base))
                        ) : (
                          <span className="muted">Konfirmasi isi kemasan</span>
                        ),
                    },
                    {
                      label: 'Harga jual',
                      render: (p) =>
                        p.selling_price === null ? (
                          <Badge tone="amber">Belum diisi</Badge>
                        ) : (
                          rupiah(p.selling_price)
                        ),
                    },
                    {
                      label: 'Stok',
                      render: (p) => (p.stock_verified ? quantity(p.quantity) : '—'),
                    },
                    { label: 'Status', render: (p) => <StockBadge p={p} /> },
                    {
                      label: 'Tindakan',
                      render: (p) =>
                        can('catalog') ? (
                          <div className="row-actions">
                            <button onClick={() => productForm(p)}>Edit</button>
                            <button onClick={() => conversionForm(p)}>Konversi</button>
                            <button onClick={() => tagForm('product', p.id)}>Tag</button>
                          </div>
                        ) : (
                          '—'
                        ),
                    },
                  ]}
                />
              </Section>
            </>
          )}
          {page === 'Stok & Gudang' && (
            <>
              <div className="stats-grid three">
                <Stat
                  label="Gudang aktif"
                  value={data.locations.length}
                  detail={data.locations.map((l) => l.name).join(', ')}
                  icon={<Warehouse size={18} />}
                />
                <Stat
                  label="Saldo resmi"
                  value={quantity(data.products.reduce((s, p) => s + Number(p.quantity), 0))}
                  detail="Jumlah satuan beragam; lihat satuan per produk"
                  icon={<Package size={18} />}
                />
                <Stat
                  label="Valuasi stok"
                  value={rupiah(data.summary.valuation)}
                  detail="Berdasarkan ledger, bukan angka manual"
                  icon={<Wallet size={18} />}
                />
              </div>
              {can('adjust') && Number(data.summary.unverified) > 0 && (
                <div className="notice-strip">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>Saldo pembukaan belum lengkap</strong>
                    <span>Histori mutasi sumber tidak ditambahkan lagi ke saldo awal.</span>
                  </div>
                  <Button kind="secondary" onClick={opening}>
                    Konfirmasi stok awal
                  </Button>
                </div>
              )}
              <Section
                title="Saldo per gudang"
                description="Jumlah resmi dan modal rata-rata per satuan dasar."
                action={
                  can('settings') ? (
                    <Button
                      kind="secondary"
                      onClick={() =>
                        setModal(
                          <Modal title="Tambah gudang" onClose={close}>
                            <Form
                              onSubmit={async (f) => {
                                await perform('/locations', { name: f.get('name') });
                                close();
                              }}
                            >
                              <Field label="Nama gudang">
                                <input name="name" minLength={2} required />
                              </Field>
                            </Form>
                          </Modal>,
                        )
                      }
                    >
                      <Plus size={15} />
                      Tambah gudang
                    </Button>
                  ) : undefined
                }
              >
                <DataTable
                  rows={data.balances ?? []}
                  keyOf={(r) => String(r.location_id) + String(r.product_id)}
                  searchBy={(r) => r.sku + ' ' + r.name + ' ' + r.location}
                  columns={[
                    { label: 'Produk', render: (r) => String(r.sku) + ' · ' + r.name },
                    { label: 'Gudang', render: (r) => String(r.location) },
                    {
                      label: 'Jumlah',
                      render: (r) => (
                        <strong>
                          {quantity(r.quantity)} {String(r.base_unit)}
                        </strong>
                      ),
                    },
                    { label: 'Modal rata-rata', render: (r) => rupiah(r.average_cost) },
                    {
                      label: 'Valuasi',
                      render: (r) => rupiah(Number(r.quantity) * Number(r.average_cost)),
                    },
                  ]}
                />
              </Section>
              <Section
                title="Ledger pergerakan stok"
                description="200 mutasi terbaru · koreksi dilakukan dengan transaksi baru."
              >
                <DataTable
                  rows={data.movements}
                  keyOf={(r) => String(r.id)}
                  searchBy={(r) => r.sku + ' ' + r.name + ' ' + r.reference}
                  columns={[
                    { label: 'Waktu', render: (r) => tanggal(r.created_at) },
                    {
                      label: 'Produk',
                      render: (r) => (
                        <div className="product-name">
                          <strong>{String(r.name)}</strong>
                          <small>{String(r.sku)}</small>
                        </div>
                      ),
                    },
                    {
                      label: 'Jenis',
                      render: (r) => <Badge>{movementLabel(String(r.type))}</Badge>,
                    },
                    {
                      label: 'Perubahan',
                      render: (r) => (
                        <b className={Number(r.quantity) > 0 ? 'positive' : 'negative'}>
                          {Number(r.quantity) > 0 ? '+' : ''}
                          {quantity(r.quantity)}
                        </b>
                      ),
                    },
                    { label: 'Gudang', render: (r) => String(r.location) },
                    { label: 'Referensi', render: (r) => String(r.reference) },
                  ]}
                />
              </Section>
            </>
          )}
          {page === 'Pembelian' && (
            <Purchases
              data={data}
              canPurchase={can('purchase')}
              onSave={(body) => perform('/orders', body)}
              onScan={() => changePage('Scan Nota')}
            />
          )}
          {page === 'Supplier' && (
            <>
              <Section
                title="Daftar supplier"
                description="Nama dari sumber dipertahankan; supplier serupa tidak digabung otomatis."
              >
                <DataTable
                  rows={data.suppliers}
                  keyOf={(r) => r.id}
                  searchBy={(r) => r.name}
                  columns={[
                    {
                      label: 'Supplier',
                      render: (r) => (
                        <div className="supplier-name">
                          <div className="store-avatar">
                            {r.name
                              .split(' ')
                              .filter((w) => w.length > 2)
                              .slice(0, 2)
                              .map((w) => w[0])
                              .join('')}
                          </div>
                          <strong>{r.name}</strong>
                        </div>
                      ),
                    },
                    {
                      label: 'Tempo bayar',
                      render: (r) => (
                        <Badge>
                          {r.payment_days ? r.payment_days + ' hari' : 'Belum ditetapkan / tunai'}
                        </Badge>
                      ),
                    },
                    { label: 'Kontak', render: (r) => r.whatsapp || r.contact || 'Belum diisi' },
                    {
                      label: 'Produk terkait',
                      render: (r) => data.mappings.filter((m) => m.supplier_id === r.id).length,
                    },
                    {
                      label: 'Tag',
                      render: (r) =>
                        can('catalog') ? (
                          <button className="text-button" onClick={() => tagForm('supplier', r.id)}>
                            Tambahkan tag
                          </button>
                        ) : (
                          '—'
                        ),
                    },
                  ]}
                />
              </Section>
              <Section
                title="Perbandingan harga beli"
                description="Riwayat pembelian terverifikasi, dalam satuan dasar."
              >
                <DataTable
                  rows={data.prices}
                  keyOf={(r) => String(r.id)}
                  searchBy={(r) => r.sku + ' ' + r.name + ' ' + r.supplier}
                  columns={[
                    { label: 'Produk', render: (r) => String(r.sku) + ' · ' + r.name },
                    { label: 'Supplier', render: (r) => String(r.supplier) },
                    { label: 'Harga dasar', render: (r) => rupiah(r.unit_cost) },
                    { label: 'Tanggal', render: (r) => tanggal(r.observed_at) },
                    { label: 'Referensi', render: (r) => String(r.reference) },
                  ]}
                />
              </Section>
            </>
          )}
          {page === 'Hutang Supplier' && (
            <>
              <div className="notice-strip">
                <ShieldCheck size={22} />
                <div>
                  <strong>Nota historis tidak otomatis menjadi hutang</strong>
                  <span>
                    Status pembayaran pada dokumen sumber belum merupakan bukti pembayaran aktual.
                  </span>
                </div>
              </div>
              <Section
                title="Nota supplier terverifikasi"
                description="Penerimaan, nota, dan pembayaran memiliki pencatatan terpisah."
              >
                <DataTable
                  rows={data.invoices}
                  keyOf={(r) => String(r.id)}
                  searchBy={(r) => r.invoice_number + ' ' + r.supplier_name}
                  columns={[
                    {
                      label: 'Nota / supplier',
                      render: (r) => (
                        <div className="product-name">
                          <strong>{String(r.invoice_number)}</strong>
                          <small>{String(r.supplier_name)}</small>
                        </div>
                      ),
                    },
                    {
                      label: 'Tanggal / jatuh tempo',
                      render: (r) => (
                        <div className="product-name">
                          <span>{tanggal(r.invoice_date)}</span>
                          <small>{tanggal(r.due_date)}</small>
                        </div>
                      ),
                    },
                    { label: 'Total', render: (r) => rupiah(r.total) },
                    { label: 'Sudah dibayar', render: (r) => rupiah(r.paid_amount) },
                    {
                      label: 'Sisa',
                      render: (r) => (
                        <strong>{rupiah(Number(r.total) - Number(r.paid_amount))}</strong>
                      ),
                    },
                    {
                      label: 'Status',
                      render: (r) => (
                        <Badge
                          tone={
                            r.status === 'paid' ? 'green' : r.status === 'blocked' ? 'red' : 'amber'
                          }
                        >
                          {r.status === 'paid'
                            ? 'Lunas'
                            : r.status === 'blocked'
                              ? 'Perlu verifikasi'
                              : 'Disetujui'}
                        </Badge>
                      ),
                    },
                    {
                      label: 'Tindakan',
                      render: (r) =>
                        can('pay') && r.status !== 'paid' ? (
                          <Button
                            kind="secondary"
                            onClick={() => (r.status === 'blocked' ? approve(r) : payment(r))}
                          >
                            {r.status === 'blocked' ? 'Tinjau selisih' : 'Bayar'}
                          </Button>
                        ) : (
                          '—'
                        ),
                    },
                  ]}
                />
              </Section>
            </>
          )}
          {page === 'Penjualan' && (
            <POS
              data={data}
              canSell={can('sell')}
              onPost={(body) =>
                perform('/operations', body, 'Penjualan tercatat. Stok sudah diperbarui.')
              }
            />
          )}
          {page === 'Laporan' && <Reports data={data} />}
          {page === 'Smart System' && (
            <Smart data={data} insights={insights} onRun={runAnalysis} busy={analyzing} />
          )}
          {page === 'Pengaturan' && (
            <SettingsPage
              data={data}
              canManage={can('settings')}
              onPassword={async (f) => {
                await api('/password', { current: f.get('current'), password: f.get('password') });
                setData(null);
                setToast('Kata sandi diubah. Silakan masuk kembali.');
              }}
            />
          )}
        </div>
        <footer className="footer">
          <span>
            New System <i /> Sumber Jago
          </span>
          <span>
            <ShieldCheck size={13} /> Setiap transaksi memiliki jejak
          </span>
        </footer>
      </main>
      {modal}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button aria-label="Tutup notifikasi" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Login({ error, onLogin }: { error: string; onLogin: () => Promise<void> }) {
  const [activation, setActivation] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('activate') ?? '',
  );
  const [activated, setActivated] = useState(false);
  return (
    <div className="login-page">
      <section className="login-art">
        <div className="brand">
          <Layers size={33} />
          new<span>system</span>
        </div>
        <Badge tone="soft">TOKO SUMBER JAGO</Badge>
        <h1>
          Catatan rapi.
          <br />
          Stok pasti.
          <br />
          <span>Usaha terkendali.</span>
        </h1>
        <p>
          Sistem operasional untuk penjualan, pembelian,
          <br />
          dan setiap pergerakan barang.
        </p>
        <div className="login-decoration">
          <Boxes size={120} />
          <div>
            <Check size={21} />
            Setiap unit punya cerita
          </div>
        </div>
        <small>Dibangun untuk keseharian toko Indonesia.</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">SELAMAT DATANG KEMBALI</span>
          <h2>{activation ? 'Buat kata sandi pemilik' : 'Masuk ke ruang kerja'}</h2>
          <p>
            {activation
              ? 'Aktifkan akun pemilik dengan kata sandi pilihanmu.'
              : 'Gunakan akun toko untuk melanjutkan.'}
          </p>
          {activated && (
            <div className="alert success">
              Akun aktif. Masuk menggunakan email pemilik dan kata sandi yang baru dibuat.
            </div>
          )}
          {error && !error.includes('masuk kembali') && (
            <div className="alert warning">{error}</div>
          )}
          {activation ? (
            <Form
              submit="Aktifkan akun pemilik"
              onSubmit={async (f) => {
                if (f.get('password') !== f.get('confirm'))
                  throw Error('Konfirmasi kata sandi belum sama.');
                await api('/setup', { token: activation, password: f.get('password') });
                window.history.replaceState(null, '', window.location.pathname);
                setActivation('');
                setActivated(true);
              }}
            >
              <Field label="Kata sandi baru (minimal 12 karakter)">
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field label="Ulangi kata sandi baru">
                <input
                  name="confirm"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </Field>
            </Form>
          ) : (
            <Form
              submit="Masuk ke New System"
              onSubmit={async (f) => {
                await api('/login', { email: f.get('email'), password: f.get('password') });
                await onLogin();
              }}
            >
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  placeholder="nama@toko.com"
                  autoComplete="username"
                  required
                />
              </Field>
              <Field label="Kata sandi">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Masukkan kata sandi"
                  required
                />
              </Field>
            </Form>
          )}
          <div className="login-foot">
            <ShieldCheck size={16} /> Akses sesuai peran. Data toko tetap terlindungi.
          </div>
        </div>
      </section>
    </div>
  );
}
function ProductName({ p }: { p: Product }) {
  return (
    <div className="product-cell">
      <span className="product-symbol">
        <Package size={18} />
      </span>
      <div className="product-name">
        <strong>{p.name}</strong>
        <small>{p.sku}</small>
      </div>
    </div>
  );
}
function StockBadge({ p }: { p: Product }) {
  return !p.active ? (
    <Badge>Nonaktif</Badge>
  ) : !p.stock_verified ? (
    <Badge tone="amber">Perlu verifikasi</Badge>
  ) : Number(p.quantity) === 0 ? (
    <Badge tone="red">Habis</Badge>
  ) : Number(p.min_stock) > 0 && Number(p.quantity) <= Number(p.min_stock) ? (
    <Badge tone="amber">Menipis</Badge>
  ) : (
    <Badge tone="green">Tersedia</Badge>
  );
}
function movementLabel(t: string) {
  return (
    (
      {
        OPENING_BALANCE: 'Saldo awal',
        PURCHASE_RECEIPT: 'Penerimaan',
        SALE: 'Penjualan',
        CUSTOMER_RETURN: 'Retur pelanggan',
        SUPPLIER_RETURN: 'Retur supplier',
        STOCK_ADJUSTMENT: 'Penyesuaian',
        DAMAGE: 'Kerusakan',
        TRANSFER_IN: 'Transfer masuk',
        TRANSFER_OUT: 'Transfer keluar',
        PAYMENT: 'Pembayaran',
      } as Record<string, string>
    )[t] ?? t
  );
}
function SalesChart({ sales }: { sales: Record<string, unknown>[] }) {
  if (!sales.length)
    return (
      <Empty
        title="Cerita penjualan dimulai di sini"
        description="Catat transaksi pertama melalui kasir. Grafik akan tumbuh dari data penjualan nyata."
      />
    );
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
    return {
      label: d.toLocaleDateString('id-ID', { weekday: 'short' }),
      total: sales
        .filter(
          (s) =>
            new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
              new Date(String(s.created_at)),
            ) === key,
        )
        .reduce((sum, s) => sum + Number(s.total), 0),
    };
  });
  const max = Math.max(...days.map((d) => d.total), 1);
  return (
    <div className="chart">
      <div className="chart-total">
        <strong>{rupiah(days.reduce((s, d) => s + d.total, 0))}</strong>
        <span>7 hari terakhir · maksimal 200 transaksi terbaru</span>
      </div>
      <div className="bars">
        {days.map((d, i) => (
          <div key={i}>
            <span className="bar-amount">{d.total ? rupiah(d.total) : ''}</span>
            <i style={{ height: Math.max((d.total / max) * 150, 3) }} />
            <small>{d.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
function Opening({
  data,
  onPost,
}: {
  data: Snapshot;
  onPost: (lines: unknown[]) => Promise<void>;
}) {
  const source = data.source.filter((r) => r.sheet === 'Stock Opname & Mutasi');
  const [quantities, setQuantities] = useState<Record<string, string>>({}),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const rows = source
    .map((r) => {
      const a = r.data as unknown[];
      const p = data.products.find((p) => p.sku === a[1]);
      return {
        id: String(r.id),
        p,
        sku: String(a[1]),
        name: String(a[2]),
        qty: quantities[String(r.id)] ?? String(a[8]),
        unit: String(a[4]),
        cost: Number(a[11]),
      };
    })
    .filter((r) => r.p && !r.p.stock_verified);
  return (
    <>
      <div className="alert warning">
        Saldo dari master menjadi titik awal. Log historis tetap diarsipkan tanpa menambah stok
        lagi. Periksa jumlah dan satuan sebelum menyetujui.
      </div>
      <DataTable
        rows={rows}
        keyOf={(r) => r.id}
        columns={[
          {
            label: 'Produk',
            render: (r) => (
              <div className="product-name">
                <strong>{r.name}</strong>
                <small>{r.sku}</small>
              </div>
            ),
          },
          {
            label: 'Jumlah pembukaan',
            render: (r) => (
              <input
                className="qty-input"
                type="number"
                min="0"
                step="0.0001"
                value={r.qty}
                onChange={(e) => setQuantities({ ...quantities, [r.id]: e.target.value })}
              />
            ),
          },
          { label: 'Satuan', render: (r) => r.unit },
          { label: 'Biaya per unit', render: (r) => rupiah(r.cost) },
        ]}
      />
      <label className="checkbox">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Saya sudah memeriksa stok fisik dan satuan. Total{' '}
        {quantity(rows.reduce((s, r) => s + Number(r.qty), 0))} satuan beragam akan dibukukan.
      </label>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <Button
          disabled={!checked || busy || !rows.length}
          onClick={async () => {
            setBusy(true);
            try {
              if (
                rows.some(
                  (r) => !Number.isFinite(Number(r.qty)) || Number(r.qty) < 0 || r.qty === '',
                )
              )
                throw Error('Isi jumlah yang valid untuk setiap produk.');
              const valid = rows.filter((r) => Number(r.qty) > 0);
              if (!valid.length) throw Error('Tidak ada saldo positif untuk dibukukan.');
              await onPost(
                valid.map((r) => ({
                  product_id: r.p!.id,
                  quantity: Number(r.qty),
                  unit: r.unit,
                  unit_price: r.cost,
                })),
              );
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Menyimpan…' : 'Konfirmasi & catat saldo awal'}
        </Button>
      </div>
    </>
  );
}
function Purchases({
  data,
  canPurchase,
  onSave,
  onScan,
}: {
  data: Snapshot;
  canPurchase: boolean;
  onSave: (body: unknown) => Promise<unknown>;
  onScan: () => void;
}) {
  const [show, setShow] = useState(false),
    [items, setItems] = useState<
      { product_id: string; quantity: string; unit: string; unit_price: string }[]
    >([]);
  return (
    <>
      <div className="workflow-strip">
        {[
          'Kebutuhan stok',
          'Bandingkan supplier',
          'Purchase order',
          'Penerimaan & nota',
          'Pembayaran',
        ].map((s, i) => (
          <div key={s}>
            <span>{i + 1}</span>
            <strong>{s}</strong>
            {i < 4 && <ChevronRight size={14} />}
          </div>
        ))}
      </div>
      <Section
        title="Purchase order"
        description="Penerimaan parsial dicocokkan dengan PO dan nota supplier."
        action={
          canPurchase ? (
            <Button onClick={() => setShow(true)}>
              <Plus size={16} />
              Buat pesanan
            </Button>
          ) : undefined
        }
      >
        <DataTable
          rows={data.orders}
          keyOf={(r) => String(r.id)}
          searchBy={(r) => r.reference + ' ' + r.supplier_name}
          columns={[
            { label: 'PO', render: (r) => <strong>{String(r.reference)}</strong> },
            { label: 'Supplier', render: (r) => String(r.supplier_name) },
            { label: 'Tanggal', render: (r) => tanggal(r.created_at) },
            {
              label: 'Status',
              render: (r) => (
                <Badge tone={r.status === 'received' ? 'green' : 'amber'}>
                  {r.status === 'received'
                    ? 'Diterima'
                    : r.status === 'partial'
                      ? 'Diterima sebagian'
                      : r.status === 'cancelled'
                        ? 'Dibatalkan'
                        : 'Menunggu penerimaan'}
                </Badge>
              ),
            },
            {
              label: 'Detail',
              render: (r) => (
                <details>
                  <summary>{Array.isArray(r.lines) ? r.lines.length : 0} produk</summary>
                  {((r.lines as Record<string, unknown>[]) ?? []).map((l, i) => (
                    <p key={i}>
                      {String(l.name)} · {quantity(l.received_quantity)}/{quantity(l.quantity)}{' '}
                      {String(l.unit)} @ {rupiah(l.unit_price)}
                    </p>
                  ))}
                </details>
              ),
            },
            {
              label: 'Terima',
              render: () => (
                <button className="text-button" onClick={onScan}>
                  Scan / input nota
                </button>
              ),
            },
          ]}
        />
      </Section>
      <Section
        title="Rekap nota historis"
        description="Arsip dari spreadsheet · belum dibukukan sebagai hutang atau penerimaan baru."
      >
        <DataTable
          rows={data.source.filter((r) => r.sheet === 'Rekap Nota Supplier')}
          keyOf={(r) => String(r.id)}
          searchBy={(r) => (r.data as unknown[]).join(' ')}
          columns={[
            { label: 'Nota', render: (r) => String((r.data as unknown[])[4]) },
            { label: 'Supplier', render: (r) => String((r.data as unknown[])[3]) },
            { label: 'Tanggal', render: (r) => String((r.data as unknown[])[1]) },
            { label: 'Keterangan sumber', render: (r) => String((r.data as unknown[])[5]) },
            { label: 'Nilai', render: (r) => rupiah((r.data as unknown[])[7]) },
            { label: 'Status', render: () => <Badge tone="amber">Belum diverifikasi</Badge> },
          ]}
        />
      </Section>
      {show && (
        <Modal wide title="Buat purchase order" onClose={() => setShow(false)}>
          <Form
            onSubmit={async (f) => {
              if (!items.length) throw Error('Tambahkan minimal satu produk.');
              await onSave({
                reference: f.get('reference'),
                supplier_id: f.get('supplier_id'),
                lines: items.map((l) => ({
                  ...l,
                  quantity: Number(l.quantity),
                  unit_price: Number(l.unit_price),
                })),
              });
              setShow(false);
              setItems([]);
            }}
          >
            <div className="form-grid">
              <Field label="Nomor PO">
                <input name="reference" required defaultValue={'PO-' + Date.now()} />
              </Field>
              <Field label="Supplier">
                <select name="supplier_id" required>
                  <option value="">Pilih supplier</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="field">
              <span>Tambahkan produk</span>
              <select
                value=""
                onChange={(e) => {
                  const p = data.products.find((p) => p.id === e.target.value);
                  if (p && !items.some((i) => i.product_id === p.id))
                    setItems([
                      ...items,
                      {
                        product_id: p.id,
                        quantity: '1',
                        unit: p.base_unit,
                        unit_price: p.purchase_cost,
                      },
                    ]);
                }}
              >
                <option value="">Pilih dari katalog</option>
                {data.products
                  .filter((p) => p.active)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {items.map((l, i) => (
              <div className="po-row" key={l.product_id}>
                <strong>{data.products.find((p) => p.id === l.product_id)?.sku}</strong>
                <Field label="Jumlah">
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={l.quantity}
                    onChange={(e) =>
                      setItems(
                        items.map((r, k) => (k === i ? { ...r, quantity: e.target.value } : r)),
                      )
                    }
                    required
                  />
                </Field>
                <Field label="Satuan">
                  <select
                    value={l.unit}
                    onChange={(e) =>
                      setItems(items.map((r, k) => (k === i ? { ...r, unit: e.target.value } : r)))
                    }
                  >
                    <option>{data.products.find((p) => p.id === l.product_id)?.base_unit}</option>
                    {data.conversions
                      .filter((c) => c.product_id === l.product_id)
                      .map((c) => (
                        <option key={c.unit}>{c.unit}</option>
                      ))}
                  </select>
                </Field>
                <Field label="Harga per satuan">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unit_price}
                    onChange={(e) =>
                      setItems(
                        items.map((r, k) => (k === i ? { ...r, unit_price: e.target.value } : r)),
                      )
                    }
                    required
                  />
                </Field>
                <button
                  className="icon-button"
                  aria-label="Hapus baris PO"
                  type="button"
                  onClick={() => setItems(items.filter((_, k) => k !== i))}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </Form>
        </Modal>
      )}
    </>
  );
}
function POS({
  data,
  canSell,
  onPost,
}: {
  data: Snapshot;
  canSell: boolean;
  onPost: (body: unknown) => Promise<Record<string, unknown>>;
}) {
  const [search, setSearch] = useState(''),
    [cart, setCart] = useState<{ id: string; qty: number; price: number }[]>([]),
    [discount, setDiscount] = useState('0'),
    [cash, setCash] = useState(''),
    [method, setMethod] = useState('cash'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [key, setKey] = useState(crypto.randomUUID()),
    [receipt, setReceipt] = useState<{
      reference: string;
      total: number;
      cart: typeof cart;
    } | null>(null);
  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0),
    total = Math.round((subtotal - Number(discount)) * 100) / 100;
  function edit(next: typeof cart) {
    setCart(next);
    setKey(crypto.randomUUID());
  }
  function add(p: Product) {
    if (!p.stock_verified || !p.active || p.selling_price === null || Number(p.quantity) <= 0)
      return;
    const existing = cart.find((l) => l.id === p.id);
    edit(
      existing
        ? cart.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...cart, { id: p.id, qty: 1, price: Number(p.selling_price) }],
    );
  }
  return (
    <>
      <div className="pos-layout">
        <Section
          title="Pilih produk"
          description="Cari SKU, nama, atau scan barcode dengan scanner kasir."
        >
          <label className="searchbox pos-search">
            <Search size={18} />
            <input
              aria-label="Cari produk kasir"
              value={search}
              placeholder="Cari produk / scan barcode…"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const p = data.products.find((p) => p.barcode === search || p.sku === search);
                  if (p) {
                    add(p);
                    setSearch('');
                  }
                }
              }}
            />
          </label>
          <div className="pos-products">
            {data.products
              .filter(
                (p) =>
                  p.active &&
                  (p.name + ' ' + p.sku + ' ' + p.barcode)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .slice(0, 48)
              .map((p) => (
                <button
                  className="pos-product"
                  key={p.id}
                  disabled={
                    !canSell ||
                    !p.stock_verified ||
                    p.selling_price === null ||
                    Number(p.quantity) <= 0
                  }
                  onClick={() => add(p)}
                >
                  <div className="pos-product-art">
                    <Package size={31} />
                    <span>{p.base_unit}</span>
                  </div>
                  <small>{p.sku}</small>
                  <strong>{p.name}</strong>
                  <div>
                    <b>{p.selling_price === null ? 'Isi harga jual' : rupiah(p.selling_price)}</b>
                    <span>
                      {p.stock_verified ? quantity(p.quantity) + ' stok' : 'Belum verifikasi'}
                    </span>
                  </div>
                </button>
              ))}
          </div>
          <p className="muted small">
            Menampilkan maksimal 48 hasil. Produk perlu harga jual dan stok terverifikasi sebelum
            dijual.
          </p>
        </Section>
        <section className="panel pos-cart">
          <div className="section-heading">
            <div>
              <h2>Keranjang penjualan</h2>
              <p>{cart.length} jenis produk</p>
            </div>
            <ShoppingCart size={21} />
          </div>
          {!cart.length ? (
            <Empty
              title="Keranjang masih kosong"
              description="Pilih produk untuk memulai transaksi."
            />
          ) : (
            <div className="cart-lines">
              {cart.map((l) => {
                const p = data.products.find((p) => p.id === l.id)!;
                return (
                  <div className="cart-line" key={l.id}>
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.sku} · {rupiah(l.price)}
                      </small>
                    </div>
                    <div className="cart-controls">
                      <input
                        aria-label={'Jumlah ' + p.sku}
                        type="number"
                        min="0.0001"
                        max={p.quantity}
                        step="0.0001"
                        value={l.qty}
                        onChange={(e) =>
                          edit(
                            cart.map((x) =>
                              x.id === l.id ? { ...x, qty: Number(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                      <b>{rupiah(l.qty * l.price)}</b>
                      <button
                        className="icon-button"
                        aria-label={'Hapus ' + p.sku}
                        onClick={() => edit(cart.filter((x) => x.id !== l.id))}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <strong>{rupiah(subtotal)}</strong>
            </div>
            <Field label="Diskon transaksi (Rp)">
              <input
                type="number"
                min="0"
                max={subtotal}
                step="0.01"
                value={discount}
                onChange={(e) => {
                  setDiscount(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </Field>
            <div className="total">
              <span>Total pembayaran</span>
              <strong>{rupiah(total)}</strong>
            </div>
            <Field label="Metode pembayaran">
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              >
                <option value="cash">Tunai</option>
                <option value="transfer">Transfer manual (sudah diterima)</option>
              </select>
            </Field>
            <Field label="Jumlah yang diterima">
              <input
                type="number"
                min={Math.max(0, total)}
                step="0.01"
                value={cash}
                onChange={(e) => {
                  setCash(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </Field>
            <div>
              <span>Kembalian</span>
              <b>{rupiah(Math.max(0, Number(cash) - total))}</b>
            </div>
            {error && <div className="alert error">{error}</div>}
            <Button
              disabled={!canSell || busy || !cart.length}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  if (
                    cart.some((l) => !Number.isFinite(l.qty) || l.qty <= 0) ||
                    total < 0 ||
                    cash === '' ||
                    Number(cash) < total
                  )
                    throw Error('Periksa jumlah, diskon, dan uang diterima.');
                  const ref = 'JUAL-' + key.slice(0, 8).toUpperCase();
                  await onPost({
                    type: 'SALE',
                    location_id: data.locations[0]?.id,
                    idempotency_key: key,
                    reference: ref,
                    payment_method: method,
                    tendered: Number(cash),
                    discount: Number(discount),
                    lines: cart.map((l) => ({
                      product_id: l.id,
                      quantity: l.qty,
                      unit: data.products.find((p) => p.id === l.id)!.base_unit,
                      unit_price: l.price,
                    })),
                  });
                  setReceipt({ reference: ref, total, cart: [...cart] });
                  setCart([]);
                  setCash('');
                  setDiscount('0');
                  setKey(crypto.randomUUID());
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Check size={17} />
              {busy ? 'Mencatat transaksi…' : 'Selesaikan & catat penjualan'}
            </Button>
            <p className="small muted">Penjualan selalu dicatat. Cetak struk bersifat opsional.</p>
          </div>
        </section>
      </div>
      {receipt && (
        <Modal title="Penjualan berhasil dicatat" onClose={() => setReceipt(null)}>
          <div id="receipt">
            <h2>TOKO SUMBER JAGO</h2>
            <p>{receipt.reference}</p>
            {receipt.cart.map((l) => (
              <div className="receipt-line" key={l.id}>
                <span>
                  {data.products.find((p) => p.id === l.id)?.name}
                  <small>
                    {quantity(l.qty)} × {rupiah(l.price)}
                  </small>
                </span>
                <strong>{rupiah(l.qty * l.price)}</strong>
              </div>
            ))}
            <hr />
            <h3>Total {rupiah(receipt.total)}</h3>
            <p>Terima kasih telah berbelanja.</p>
          </div>
          <Button onClick={() => window.print()}>Cetak struk</Button>
        </Modal>
      )}
    </>
  );
}
function Reports({ data }: { data: Snapshot }) {
  const [history, setHistory] = useState<Record<string, unknown>[]>([]),
    [offset, setOffset] = useState<number | null>(0),
    [error, setError] = useState('');
  const report = data.imports[0]?.report as Record<string, unknown> | undefined;
  return (
    <>
      <div className="stats-grid three">
        <Stat
          label="Total transaksi penjualan"
          value={quantity(data.summary.sales_count)}
          detail="Seluruh transaksi tersimpan"
          icon={<ShoppingCart size={18} />}
        />
        <Stat
          label="Saldo hutang"
          value={rupiah(data.summary.payables)}
          detail="Nota resmi dikurangi pembayaran"
          icon={<Wallet size={18} />}
        />
        <Stat
          label="Nilai persediaan"
          value={rupiah(data.summary.valuation)}
          detail="Rata-rata tertimbang per gudang"
          icon={<Boxes size={18} />}
        />
      </div>
      <ReportRange />
      <Section
        title="Rekonsiliasi data sumber"
        description="Master stok, log mutasi, dan rekap nota dibaca secara terpisah."
        action={
          <Button
            kind="secondary"
            onClick={() => download('rekonsiliasi-sumber-jago.json', report)}
          >
            Unduh rekonsiliasi
          </Button>
        }
      >
        {report ? (
          <>
            <div className="reconcile-grid">
              <div>
                <small>MASTER PRODUK</small>
                <strong>{String(report.masterProducts)}</strong>
                <span>
                  {quantity(report.masterQuantity)} unit · {rupiah(report.masterValuation)}
                </span>
              </div>
              <div>
                <small>HISTORI MUTASI</small>
                <strong>{String(report.historicalLines)} baris</strong>
                <span>
                  {quantity(report.historicalQuantity)} unit · {rupiah(report.logTotal)}
                </span>
              </div>
              <div>
                <small>REKAP NOTA</small>
                <strong>{String(report.invoices)} nota</strong>
                <span>{rupiah(report.invoiceTotal)}</span>
              </div>
            </div>
            <div className="alert warning">
              Selisih nilai log vs rekap: <strong>{rupiah(report.valueDifference)}</strong>. Tidak
              ada penyesuaian nilai secara diam-diam.
            </div>
            <DataTable
              rows={report.discrepancies as Record<string, unknown>[]}
              keyOf={(r) => String(r.sourceRow)}
              columns={[
                { label: 'Nota', render: (r) => String(r.invoice) },
                { label: 'Supplier', render: (r) => String(r.supplier) },
                { label: 'Rekap nota', render: (r) => rupiah(r.invoiceTotal) },
                { label: 'Jumlah baris log', render: (r) => rupiah(r.lineTotal) },
                {
                  label: 'Selisih',
                  render: (r) => <b className="negative">{rupiah(r.difference)}</b>,
                },
                { label: 'Baris sumber', render: (r) => String(r.sourceRow) },
              ]}
            />
            <details className="source-details">
              <summary>Catatan impor dan SKU di luar master</summary>
              <ul>
                {(report.warnings as string[]).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p>{(report.extraSkus as string[]).join(', ')}</p>
            </details>
          </>
        ) : (
          <Empty />
        )}
      </Section>
      <Section
        title="Riwayat seluruh jenis transaksi"
        description="Ambil bertahap 100 transaksi per halaman. ID dipakai untuk referensi retur."
        action={
          <Button
            kind="secondary"
            disabled={offset === null}
            onClick={async () => {
              try {
                const r = await api<{ rows: Record<string, unknown>[]; next: number | null }>(
                  '/history?offset=' + (offset ?? 0),
                );
                setHistory([...history, ...r.rows]);
                setOffset(r.next);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Muat {history.length ? 'berikutnya' : 'riwayat'}
          </Button>
        }
      >
        {error && <div className="alert error">{error}</div>}
        <DataTable
          rows={history}
          keyOf={(r) => String(r.id)}
          searchBy={(r) => r.reference + ' ' + r.type}
          columns={[
            {
              label: 'Referensi / ID',
              render: (r) => (
                <div className="product-name">
                  <strong>{String(r.reference)}</strong>
                  <small className="copyable">{String(r.id)}</small>
                </div>
              ),
            },
            { label: 'Jenis', render: (r) => movementLabel(String(r.type)) },
            { label: 'Tanggal', render: (r) => tanggal(r.created_at) },
            { label: 'Petugas', render: (r) => String(r.actor) },
            {
              label: 'Detail',
              render: (r) => (
                <details>
                  <summary>Data transaksi</summary>
                  <pre>{JSON.stringify(r.payload, null, 2)}</pre>
                </details>
              ),
            },
          ]}
        />
      </Section>
      <Section
        title="Arsip mutasi dari spreadsheet"
        description="Seluruh baris sumber dipertahankan dengan nomor baris dan status verifikasi."
      >
        <DataTable
          rows={data.source.filter((r) => r.sheet === 'Log Transaksi & Mutasi')}
          keyOf={(r) => String(r.id)}
          searchBy={(r) => (r.data as unknown[]).join(' ')}
          columns={[
            {
              label: 'Baris / tanggal',
              render: (r) => String(r.row_number) + ' · ' + (r.data as unknown[])[1],
            },
            { label: 'Nota', render: (r) => String((r.data as unknown[])[2]) },
            {
              label: 'Produk',
              render: (r) => String((r.data as unknown[])[5]) + ' · ' + (r.data as unknown[])[6],
            },
            {
              label: 'Jumlah masuk',
              render: (r) => quantity((r.data as unknown[])[7]) + ' ' + (r.data as unknown[])[9],
            },
            { label: 'Nilai netto', render: (r) => rupiah((r.data as unknown[])[12]) },
            { label: 'Referensi bukti', render: (r) => String((r.data as unknown[])[13]) },
          ]}
        />
      </Section>
    </>
  );
}
function ReportRange() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  return (
    <Section
      title="Laporan periode"
      description="Agregasi seluruh transaksi database sesuai periode, bukan hanya halaman terbaru."
    >
      <Form
        submit="Tampilkan laporan"
        onSubmit={async (f) =>
          setResult(await api('/report?from=' + f.get('from') + '&to=' + f.get('to')))
        }
      >
        <div className="form-grid">
          <Field label="Dari tanggal">
            <input type="date" name="from" defaultValue={today().slice(0, 8) + '01'} required />
          </Field>
          <Field label="Sampai tanggal">
            <input type="date" name="to" defaultValue={today()} required />
          </Field>
        </div>
      </Form>
      {result && (
        <div className="report-result">
          <div className="reconcile-grid">
            <div>
              <small>OMZET</small>
              <strong>{rupiah(result.revenue)}</strong>
            </div>
            <div>
              <small>LABA KOTOR</small>
              <strong>{rupiah(result.gross_profit)}</strong>
            </div>
            <div>
              <small>TRANSAKSI</small>
              <strong>{quantity(result.transactions)}</strong>
            </div>
          </div>
          <DataTable
            rows={(result.daily as Record<string, unknown>[]) ?? []}
            keyOf={(r) => String(r.day)}
            columns={[
              { label: 'Tanggal', render: (r) => tanggal(r.day) },
              { label: 'Transaksi', render: (r) => quantity(r.transactions) },
              { label: 'Omzet', render: (r) => rupiah(r.revenue) },
              { label: 'Laba kotor', render: (r) => rupiah(r.gross_profit) },
            ]}
          />
        </div>
      )}
    </Section>
  );
}
function Smart({
  data,
  insights,
  onRun,
  busy,
}: {
  data: Snapshot;
  insights: Insight[] | null;
  onRun: () => Promise<void>;
  busy: boolean;
}) {
  const [filter, setFilter] = useState('Semua'),
    [query, setQuery] = useState('');
  const all =
    insights ??
    data.tags
      .filter((t) => t.source === 'rule')
      .map(
        (t) =>
          ({
            id: String(t.entity_id) + String(t.tag),
            entityId: String(t.entity_id),
            entityType: String(t.entity_type),
            tag: String(t.tag),
            severity: 'info',
            title: String(t.tag).replaceAll('_', ' '),
            reason: 'Tag dari analisis tersimpan. Jalankan analisis untuk penjelasan lengkap.',
            recommendation: 'Periksa bukti data.',
            evidence: t.evidence,
          }) as Insight,
      );
  const filtered = all.filter(
    (i) =>
      (filter === 'Semua' || i.severity === filter) &&
      (i.title + ' ' + i.tag + ' ' + i.reason + ' ' + i.recommendation)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="smart-hero">
        <div className="smart-orb">
          <Sparkles size={36} />
        </div>
        <div>
          <Badge tone="green">BERDASARKAN DATA NYATA</Badge>
          <h2>Dari transaksi menjadi keputusan.</h2>
          <p>
            Analisis stok, laju penjualan, perubahan harga, margin, hutang, dan kualitas sumber.
            <br />
            Setiap tag menyimpan alasan, bukti, dan versi aturan. Tidak ada SQL otomatis dari AI.
          </p>
        </div>
      </div>
      <div className="smart-categories">
        {['Stok & restok', 'Pola penjualan', 'Harga & margin', 'Hutang & sumber'].map((s, i) => (
          <div key={s}>
            <span>0{i + 1}</span>
            <strong>{s}</strong>
            <small>
              {
                [
                  'Saldo, batas minimum, dan cakupan stok',
                  'ABC omzet dan perbandingan 30 hari',
                  'Kenaikan biaya dan margin negatif',
                  'Jatuh tempo serta selisih dokumen',
                ][i]
              }
            </small>
          </div>
        ))}
      </div>
      {Number(data.summary.sales_count) === 0 && (
        <div className="alert warning">
          Belum ada transaksi penjualan. Sistem belum memiliki bukti untuk menentukan barang laris,
          perubahan permintaan, atau rekomendasi restok berdasarkan penjualan.
        </div>
      )}
      <Section
        title="Temuan & tag otomatis"
        description={
          all.length + ' temuan · analisis dipicu pengguna agar tidak ada polling dan biaya rutin.'
        }
        action={
          <Button kind="secondary" onClick={() => download('insight-new-system.json', all)}>
            Ekspor temuan
          </Button>
        }
      >
        <div className="table-toolbar">
          <label className="searchbox">
            <Search size={17} />
            <input
              placeholder="Cari temuan: stok, harga, margin, hutang…"
              aria-label="Cari temuan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Tingkat prioritas"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option>Semua</option>
            <option value="critical">Mendesak</option>
            <option value="warning">Perlu perhatian</option>
            <option value="info">Informasi</option>
          </select>
        </div>
        {all.length ? (
          <DataTable
            rows={filtered}
            keyOf={(r) => r.id}
            columns={[
              {
                label: 'Temuan',
                render: (r) => (
                  <div className="insight-cell">
                    <Badge
                      tone={
                        r.severity === 'critical'
                          ? 'red'
                          : r.severity === 'warning'
                            ? 'amber'
                            : 'green'
                      }
                    >
                      {r.tag.replaceAll('_', ' ')}
                    </Badge>
                    <strong>{r.title}</strong>
                    <p>{r.reason}</p>
                  </div>
                ),
              },
              { label: 'Saran tindakan', render: (r) => <p>{r.recommendation}</p> },
              {
                label: 'Bukti',
                render: (r) => (
                  <details>
                    <summary>Telusuri data</summary>
                    <pre>{JSON.stringify(r.evidence, null, 2)}</pre>
                    <small>
                      {r.entityType} · {r.entityId}
                    </small>
                  </details>
                ),
              },
            ]}
          />
        ) : (
          <Empty
            title="Baca pola toko kamu"
            description="Jalankan analisis untuk memeriksa seluruh data yang tersimpan."
            action={
              <Button onClick={() => void onRun()} disabled={busy}>
                <Sparkles size={16} />
                {busy ? 'Menganalisis…' : 'Analisis sekarang'}
              </Button>
            }
          />
        )}
      </Section>
      <Section
        title="Tag manual"
        description="Penilaian petugas disimpan terpisah dari aturan otomatis."
      >
        <DataTable
          rows={data.tags.filter((t) => t.source === 'manual')}
          keyOf={(r) => String(r.entity_id) + String(r.tag)}
          columns={[
            { label: 'Tag', render: (r) => <Badge tone="green">{String(r.tag)}</Badge> },
            { label: 'Entitas', render: (r) => String(r.entity_type) + ' · ' + r.entity_id },
            {
              label: 'Konteks',
              render: (r) => String((r.evidence as Record<string, unknown>)?.note ?? ''),
            },
          ]}
        />
      </Section>
    </>
  );
}
function SettingsPage({
  data,
  canManage,
  onPassword,
}: {
  data: Snapshot;
  canManage: boolean;
  onPassword: (f: FormData) => Promise<void>;
}) {
  const [audit, setAudit] = useState<Record<string, unknown>[] | null>(null);
  return (
    <>
      <div className="settings-grid">
        <Section title="Ruang kerja" description="Identitas operasional">
          <div className="setting-detail">
            <span>Nama toko</span>
            <strong>{data.business.name}</strong>
          </div>
          <div className="setting-detail">
            <span>Zona waktu</span>
            <strong>Asia/Jakarta</strong>
          </div>
          <div className="setting-detail">
            <span>Akun aktif</span>
            <strong>{data.user.email}</strong>
          </div>
          <div className="setting-detail">
            <span>Penyimpanan dokumen</span>
            <Badge tone="amber">Lokal pada perangkat</Badge>
          </div>
          <p className="muted small">
            Gambar asli tersimpan di IndexedDB perangkat ini. Gambar belum diarsipkan lintas
            perangkat. Ekspor berkas asli secara terpisah sebelum membersihkan data browser.
          </p>
          <p className="muted small">
            OCR diproses lokal. Aset bahasa pertama kali diunduh dari server aplikasi; sesudah
            tersimpan di cache, OCR tidak memerlukan layanan eksternal. Pencatatan stok tetap
            membutuhkan koneksi.
          </p>
        </Section>
        <Section
          title="Ubah kata sandi"
          description="Setelah diubah, semua sesi lama akan berakhir."
        >
          <Form submit="Ubah kata sandi" onSubmit={onPassword}>
            <Field label="Kata sandi saat ini">
              <input name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="Kata sandi baru (minimal 12 karakter)">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
          </Form>
        </Section>
      </div>
      {canManage && (
        <Section
          title="Jejak audit"
          description="200 perubahan terbaru; riwayat tidak dapat diedit."
          action={
            <Button
              kind="secondary"
              onClick={async () => setAudit(await api<Record<string, unknown>[]>('/audit'))}
            >
              Muat audit
            </Button>
          }
        >
          {audit ? (
            <DataTable
              rows={audit}
              keyOf={(r) => String(r.id)}
              searchBy={(r) => r.action + ' ' + r.actor}
              columns={[
                { label: 'Tanggal', render: (r) => tanggal(r.created_at) },
                { label: 'Petugas', render: (r) => String(r.actor ?? 'Sistem') },
                { label: 'Tindakan', render: (r) => String(r.action) },
                { label: 'Entitas', render: (r) => String(r.entity_type) + ' · ' + r.entity_id },
                {
                  label: 'Detail',
                  render: (r) => (
                    <details>
                      <summary>Lihat</summary>
                      <pre>{JSON.stringify(r.data, null, 2)}</pre>
                    </details>
                  ),
                },
              ]}
            />
          ) : (
            <Empty
              title="Audit siap ditelusuri"
              description="Muat audit untuk memeriksa perubahan dan transaksi."
            />
          )}
        </Section>
      )}
    </>
  );
}
function CSVImport({ onSave }: { onSave: (rows: unknown[]) => Promise<void> }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false);
  return (
    <>
      <p>
        Header: <code>sku,name,base_unit,purchase_cost,selling_price,min_stock,barcode</code>. Angka
        menggunakan titik untuk desimal tanpa pemisah ribuan. SKU lama diperbarui, SKU baru dibuat.
        Seluruh impor atomik; stok tidak berubah.
      </p>
      <input
        aria-label="Pilih CSV"
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          setError('');
          setApproved(false);
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 1024 * 1024) throw Error('Batas CSV 1 MB.');
            const grid = parseCSV((await f.text()).replace(/^\uFEFF/, ''));
            const header = grid.shift() ?? [];
            if (!['sku', 'name', 'base_unit', 'purchase_cost'].every((k) => header.includes(k)))
              throw Error('Header wajib belum lengkap.');
            const mapped = grid
              .filter((r) => r.some(Boolean))
              .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
            if (mapped.length > 500) throw Error('Maksimal 500 produk sekali impor.');
            if (new Set(mapped.map((r) => r.sku)).size !== mapped.length)
              throw Error('Ada SKU berulang di CSV.');
            const result = mapped.map((r, i) => {
              if (
                !r.sku ||
                !r.name ||
                !units.includes(r.base_unit) ||
                ![r.purchase_cost, r.selling_price || '0', r.min_stock || '0'].every((v) =>
                  /^\d+(\.\d+)?$/.test(v),
                )
              )
                throw Error('Data tidak valid di baris ' + (i + 2));
              return {
                ...r,
                purchase_cost: Number(r.purchase_cost),
                selling_price:
                  r.selling_price === '' || !r.selling_price ? null : Number(r.selling_price),
                min_stock: Number(r.min_stock || 0),
                barcode: r.barcode || null,
                active: true,
              };
            });
            setRows(result);
          } catch (err) {
            setRows([]);
            setError(String(err));
          }
        }}
      />
      {error && <div className="alert error">{error}</div>}
      <DataTable
        rows={rows}
        keyOf={(r) => String(r.sku)}
        columns={[
          { label: 'SKU', render: (r) => String(r.sku) },
          { label: 'Nama', render: (r) => String(r.name) },
          { label: 'Satuan', render: (r) => String(r.base_unit) },
          { label: 'Harga beli', render: (r) => rupiah(r.purchase_cost) },
        ]}
      />
      <label className="checkbox">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
        Saya sudah memeriksa {rows.length} produk pada pratinjau.
      </label>
      <Button
        disabled={!approved || !rows.length || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(rows);
          } catch (e) {
            setError('Impor dibatalkan seluruhnya; tidak ada pembaruan parsial. ' + String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Mengimpor…' : 'Impor katalog'}
      </Button>
    </>
  );
}
function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quote) throw Error('Tanda kutip CSV belum ditutup.');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
