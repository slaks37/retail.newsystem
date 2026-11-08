import { parseSmartInvoice as parseInvoice, normalizeTSV } from '../shared/supplier-templates';
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Upload,
  ScanLine,
  FileText,
  RotateCw,
  ZoomIn,
  SlidersHorizontal,
  Trash2,
  Plus,
  Check,
  ArrowRight,
  AlertTriangle,
  Save,
  RefreshCw,
  X,
  Image as ImageIcon,
  Download,
  ShieldCheck,
} from 'lucide-react';
import type { Snapshot, InvoiceDraft, ParsedLine } from '../shared/types';
import { blankLine, matchProducts } from '../shared/parser';
import {
  processDocuments,
  preprocess,
  cancelOCR,
  saveLocalDraft,
  loadLocalDraft,
  type OCRDocument,
  type OCRProgress,
} from './ocr';
import { Button, Badge, Modal, Field, Empty, Section, DataTable } from './components';
import { api, rupiah, quantity, today, download } from './api';
const statuses = {
  detected: 'Terdeteksi',
  needs_review: 'Perlu verifikasi',
  unreadable: 'Tidak terbaca',
  manually_corrected: 'Dikoreksi manual',
  confirmed: 'Dikonfirmasi',
};
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
  'CTN',
  'KRT',
];
interface SavedDraft {
  draft: InvoiceDraft;
  supplierId: string;
  mode: 'PURCHASE_RECEIPT' | 'OPENING_BALANCE';
  orderId: string;
  locationId: string;
  document: OCRDocument | null;
  draftId: string;
  version: number;
  operationKey: string;
}
export function ScanPage({
  data,
  onRefresh,
  notify,
  canReceive,
  onCreateProduct,
  onConversion,
}: {
  data: Snapshot;
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
  canReceive: boolean;
  onCreateProduct: (onSaved: (id: string) => void) => void;
  onConversion: (productId: string) => void;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [image, setImage] = useState<string | null>(null),
    [processed, setProcessed] = useState<Blob | null>(null),
    [processedURL, setProcessedURL] = useState<string | null>(null),
    [showOriginal, setShowOriginal] = useState(true),
    [rotation, setRotation] = useState(0),
    [zoom, setZoom] = useState(1),
    [contrast, setContrast] = useState(1.25),
    [brightness, setBrightness] = useState(0),
    [threshold, setThreshold] = useState(false),
    [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 }),
    [showControls, setShowControls] = useState(false);
  const [mode, setMode] = useState<'PURCHASE_RECEIPT' | 'OPENING_BALANCE'>('PURCHASE_RECEIPT'),
    [draft, setDraft] = useState<InvoiceDraft | null>(null),
    [doc, setDoc] = useState<OCRDocument | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<OCRProgress | null>(null),
    [error, setError] = useState(''),
    [supplierId, setSupplierId] = useState(''),
    [orderId, setOrderId] = useState(''),
    [locationId, setLocationId] = useState(data.locations[0]?.id ?? ''),
    [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState(false),
    [draftId, setDraftId] = useState<string>(crypto.randomUUID()),
    [version, setVersion] = useState(0),
    [operationKey, setOperationKey] = useState<string>(crypto.randomUUID()),
    [saved, setSaved] = useState(false),
    [manualText, setManualText] = useState(''),
    [showText, setShowText] = useState(false),
    [camera, setCamera] = useState(false),
    [localAvailable, setLocalAvailable] = useState(false),
    [idleError, setIdleError] = useState('');
  const input = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    busyRef = useRef(false);
  useEffect(() => {
    void loadLocalDraft('last')
      .then((v) => setLocalAvailable(!!v))
      .catch(() =>
        setIdleError(
          'Penyimpanan lokal tidak tersedia. Simpan draft ke server sebelum meninggalkan halaman.',
        ),
      );
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (busyRef.current) void cancelOCR();
    };
  }, []);
  useEffect(() => {
    if (!files.length) {
      setImage(null);
      return;
    }
    const url = URL.createObjectURL(files[0]);
    setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [files]);
  useEffect(() => {
    if (!processed) {
      setProcessedURL(null);
      return;
    }
    const url = URL.createObjectURL(processed);
    setProcessedURL(url);
    return () => URL.revokeObjectURL(url);
  }, [processed]);
  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => {
        setCamera(false);
        setError(
          'Kamera tidak dapat diakses. Izinkan kamera di browser atau gunakan unggah galeri.',
        );
        cameraInput.current?.click();
      });
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [camera]);
  function change(next: InvoiceDraft) {
    setDraft({ ...next, reviewed: false });
    setConfirmed(false);
    setSaved(false);
    setOperationKey(crypto.randomUUID());
  }
  function updateLine(id: string, key: keyof ParsedLine, value: unknown) {
    if (!draft) return;
    change({
      ...draft,
      lines: draft.lines.map((l) =>
        l.id === id ? { ...l, [key]: value, status: 'manually_corrected' } : l,
      ),
    });
  }
  const saveObject = (): SavedDraft => ({
    draft: draft!,
    supplierId,
    mode,
    orderId,
    locationId,
    document: doc,
    draftId,
    version,
    operationKey,
  });
  useEffect(() => {
    if (!draft) return;
    const timeout = setTimeout(() => {
      void saveLocalDraft('last', saveObject()).catch(() =>
        setIdleError('Gagal menyimpan draft lokal. Gunakan Simpan draft ke server.'),
      );
    }, 600);
    return () => clearTimeout(timeout);
  }, [draft, supplierId, mode, orderId, locationId, doc, draftId, version, operationKey]);
  function restore(s: SavedDraft) {
    setDraft(s.draft);
    setSupplierId(s.supplierId);
    setMode(s.mode);
    setOrderId(s.orderId);
    setLocationId(s.locationId);
    setDoc(s.document);
    setDraftId(s.draftId);
    setVersion(s.version);
    setOperationKey(s.operationKey);
    setConfirmed(false);
    setSaved(false);
    notify('Draft dipulihkan. Verifikasi kembali sebelum konfirmasi.');
  }
  async function runOCR() {
    setError('');
    setBusy(true);
    busyRef.current = true;
    setSaved(false);
    try {
      const result = await processDocuments(files, setProgress, processed ?? undefined);
      setDoc(result);
      const parsed = parseInvoice(result.text);
      for (const line of parsed.lines) {
        const candidates = matchProducts(line, data.products);
        if (
          candidates[0]?.score >= 0.99 &&
          candidates.filter((c) => c.score >= 0.99).length === 1
        ) {
          line.productId = candidates[0].product.id;
          line.warnings.push(
            'Produk lama dikenali dari SKU/barcode; verifikasi sebelum menambah stok.',
          );
        }
      }
      const evidence = result.pages.flatMap((p) => (p.tsv ? normalizeTSV(p.tsv, p.page) : []));
      for (const line of parsed.lines) {
        const match = evidence.find((e) => e.text === line.raw);
        if (match) line.evidence = { page: match.page, bbox: match.bbox };
      }
      setDraft(parsed);
      setManualText(result.text);
      setConfirmed(false);
      setOperationKey(crypto.randomUUID());
      setDraftId(crypto.randomUUID());
      setVersion(0);
      notify('Teks selesai dibaca. Periksa hasil ekstraksi dan jumlah fisik.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const added = Array.from(list);
    if (added.some((f) => f.size > 20 * 1024 * 1024) || files.length + added.length > 8) {
      setError('Batas 8 file, maksimal 20 MB per file.');
      return;
    }
    setFiles([...files, ...added]);
    setProcessed(null);
    setRotation(0);
    setCrop({ x: 0, y: 0, w: 100, h: 100 });
    setError('');
  }
  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      if (doc)
        await api('/documents', {
          hash: doc.hash,
          filename: doc.filenames.join(', '),
          rawText: doc.text,
          evidence: doc.pages,
          lines: draft.lines,
        });
      const result = await api<{ id: string; version: number }>('/drafts', {
        id: draftId,
        version,
        mode,
        data: saveObject(),
      });
      setVersion(result.version);
      await onRefresh();
      notify('Draft tersimpan. Stok belum berubah.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const reconciled = (draft?.lines ?? []).map((l) => {
    const p = data.products.find((p) => p.id === l.productId);
    const conversion =
      p &&
      (p.base_unit === l.unit
        ? 1
        : Number(
            data.conversions.find((c) => c.product_id === p.id && c.unit === l.unit)?.multiplier,
          ) || null);
    const qty = mode === 'OPENING_BALANCE' ? l.quantity : l.receivedQuantity;
    const good = qty === null ? null : qty - (mode === 'OPENING_BALANCE' ? 0 : l.damagedQuantity);
    const base =
      good === null || conversion === null || conversion === undefined ? null : good * conversion;
    const total =
      l.quantity === null || l.unitPrice === null
        ? null
        : l.quantity * l.unitPrice - (l.discount ?? 0) + (l.tax ?? 0);
    return { l, p, conversion, base, total };
  });
  const invoiceTotal =
    reconciled.reduce((s, r) => s + (r.total ?? 0), 0) -
    (draft?.discount ?? 0) +
    (draft?.tax ?? 0) +
    (draft?.rounding ?? 0);
  function validate() {
    if (!draft || !draft.lines.length) throw Error('Tambahkan minimal satu produk.');
    if (!locationId) throw Error('Pilih gudang.');
    if (mode === 'PURCHASE_RECEIPT' && (!supplierId || !draft.invoiceNumber || !draft.invoiceDate))
      throw Error('Isi supplier, nomor nota, dan tanggal nota.');
    const selected = new Set<string>();
    for (const r of reconciled) {
      if (!r.p) throw Error('Pilih produk untuk setiap baris.');
      if (selected.has(r.p.id))
        throw Error('Ada produk berulang. Gabungkan baris yang sama setelah memeriksa nota.');
      selected.add(r.p.id);
      if (r.l.quantity === null || r.l.quantity <= 0 || r.l.unitPrice === null || r.l.unitPrice < 0)
        throw Error('Jumlah pada nota dan harga wajib valid.');
      if (r.base === null || r.base < 0 || !r.conversion)
        throw Error('Isi jumlah fisik dan konfirmasi konversi setiap produk.');
      if (mode === 'OPENING_BALANCE' && (r.conversion !== 1 || r.base <= 0))
        throw Error('Saldo awal harus menggunakan jumlah positif dalam satuan dasar.');
      if (
        mode === 'PURCHASE_RECEIPT' &&
        (r.l.receivedQuantity === null ||
          r.l.receivedQuantity < 0 ||
          r.l.damagedQuantity < 0 ||
          r.l.damagedQuantity > r.l.receivedQuantity)
      )
        throw Error('Jumlah fisik/rusak tidak valid.');
      if (
        (r.l.discount !== null &&
          (r.l.discount < 0 || r.l.discount > r.l.quantity * r.l.unitPrice)) ||
        (r.l.tax !== null && r.l.tax < 0)
      )
        throw Error('Diskon/pajak baris tidak valid.');
      if (r.l.lineTotal !== null && r.total !== null && Math.abs(r.l.lineTotal - r.total) > 0.01)
        throw Error(
          'Total baris tidak cocok. Koreksi jumlah, harga, diskon, pajak, atau total yang terbaca.',
        );
    }
    if (
      mode === 'PURCHASE_RECEIPT' &&
      draft.total !== null &&
      Math.abs(draft.total - invoiceTotal) > 0.01
    )
      throw Error('Total nota belum sesuai dengan perhitungan.');
    if (!confirmed) throw Error('Centang konfirmasi verifikasi terlebih dahulu.');
  }
  async function post() {
    setBusy(true);
    setError('');
    try {
      validate();
      const body = {
        type: mode,
        location_id: locationId,
        idempotency_key: operationKey,
        reference:
          mode === 'PURCHASE_RECEIPT' ? draft!.invoiceNumber : 'AWAL-' + operationKey.slice(0, 8),
        reason:
          mode === 'OPENING_BALANCE'
            ? 'Saldo pembukaan hasil scan yang dikonfirmasi pengguna'
            : undefined,
        supplier_id: supplierId || undefined,
        order_id: orderId || undefined,
        invoice_number: draft!.invoiceNumber,
        invoice_date: draft!.invoiceDate,
        delivery_date: draft!.deliveryDate,
        due_date: draft!.dueDate,
        printed_total: draft!.total,
        discount: draft!.discount ?? 0,
        tax: draft!.tax ?? 0,
        rounding: draft!.rounding ?? 0,
        document_hash: doc?.hash,
        draft_id: draftId,
        lines: reconciled.map((r) => ({
          product_id: r.p!.id,
          quantity: r.l.quantity,
          unit: r.l.unit,
          unit_price: r.l.unitPrice,
          received_quantity: r.l.receivedQuantity,
          damaged_quantity: r.l.damagedQuantity,
          discount: r.l.discount ?? 0,
          tax: r.l.tax ?? 0,
          printed_total: r.l.lineTotal,
        })),
      };
      const result = await api<{ warnings: unknown[] }>('/operations', body);
      setSaved(true);
      setPreview(false);
      setConfirmed(false);
      await onRefresh();
      notify(
        result.warnings?.length
          ? 'Penerimaan tersimpan. Nota diblokir untuk verifikasi selisih.'
          : 'Berhasil disimpan. Ledger stok sudah diperbarui.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }
  function merge() {
    if (!draft) return;
    const seen = new Map<string, ParsedLine>();
    const lines: ParsedLine[] = [];
    for (const l of draft.lines) {
      const key = l.productId && [l.productId, l.unit, l.unitPrice].join('|');
      const existing = key ? seen.get(key) : undefined;
      if (existing) {
        if ([existing.quantity, l.quantity].some((v) => v === null))
          throw Error('Isi jumlah sebelum menggabungkan.');
        existing.quantity = existing.quantity! + l.quantity!;
        existing.receivedQuantity =
          existing.receivedQuantity !== null && l.receivedQuantity !== null
            ? existing.receivedQuantity + l.receivedQuantity
            : null;
        existing.damagedQuantity += l.damagedQuantity;
        existing.lineTotal =
          existing.lineTotal !== null && l.lineTotal !== null
            ? existing.lineTotal + l.lineTotal
            : null;
        existing.discount = (existing.discount ?? 0) + (l.discount ?? 0);
        existing.tax = (existing.tax ?? 0) + (l.tax ?? 0);
        existing.raw += '\n' + l.raw;
        existing.warnings.push('Baris digabung manual; periksa kembali.');
        existing.status = 'manually_corrected';
      } else {
        const copy = { ...l, warnings: [...l.warnings] };
        lines.push(copy);
        if (key) seen.set(key, copy);
      }
    }
    change({ ...draft, lines });
  }
  return (
    <>
      <div className="scan-stepper">
        {['Unggah nota', 'Baca & cocokkan', 'Verifikasi fisik', 'Konfirmasi stok'].map((s, i) => (
          <div className={(saved ? i <= 3 : draft ? i <= 2 : i === 0) ? 'current' : ''} key={s}>
            <span>{saved ? <Check size={14} /> : i + 1}</span>
            {s}
            {i < 3 && <ArrowRight size={14} />}
          </div>
        ))}
      </div>
      {!canReceive && (
        <div className="alert warning">
          Peran akun ini hanya dapat melihat. Konfirmasi penerimaan memerlukan izin gudang atau
          manajer.
        </div>
      )}
      {idleError && <div className="alert warning">{idleError}</div>}
      {localAvailable && !draft && (
        <div className="notice-strip">
          <Save size={21} />
          <div>
            <strong>Ada draft terakhir di perangkat ini</strong>
            <span>Pulihkan draft untuk melanjutkan verifikasi.</span>
          </div>
          <Button
            kind="secondary"
            onClick={async () => {
              const saved = await loadLocalDraft('last');
              if (saved) restore(saved as SavedDraft);
            }}
          >
            Pulihkan
          </Button>
        </div>
      )}
      <div className="scan-mode">
        <button
          className={mode === 'PURCHASE_RECEIPT' ? 'selected' : ''}
          disabled={busy || saved}
          onClick={() => {
            setMode('PURCHASE_RECEIPT');
            setConfirmed(false);
          }}
        >
          <TruckIcon />
          <span>
            <strong>Penerimaan pembelian</strong>
            <small>Barang datang dari supplier</small>
          </span>
          <Badge tone="green">MODE A</Badge>
        </button>
        <button
          className={mode === 'OPENING_BALANCE' ? 'selected' : ''}
          disabled={busy || saved}
          onClick={() => {
            setMode('OPENING_BALANCE');
            setConfirmed(false);
          }}
        >
          <PackageIcon />
          <span>
            <strong>Impor stok awal</strong>
            <small>Migrasi catatan / daftar stok</small>
          </span>
          <Badge>MODE B</Badge>
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="scan-layout">
        <Section
          className="document-panel"
          title="Dokumen nota"
          description="Gambar asli tetap disimpan lokal pada perangkat."
          action={
            <Badge tone="green">
              <ShieldCheck size={12} />
              OCR lokal
            </Badge>
          }
        >
          {!files.length ? (
            <div
              className="upload-area"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <div className="upload-icon">
                <ScanLine size={39} />
              </div>
              <h3>Nota masuk. Stok tercatat.</h3>
              <p>
                Foto nota dari kamera, pilih gambar, atau unggah PDF.
                <br />
                Teks dibaca di perangkatmu, tanpa layanan OCR berbayar.
              </p>
              <Button
                onClick={() => {
                  if (navigator.mediaDevices) setCamera(true);
                  else cameraInput.current?.click();
                }}
                disabled={busy}
              >
                <Camera size={17} />
                Ambil foto nota
              </Button>
              <Button kind="secondary" onClick={() => input.current?.click()} disabled={busy}>
                <Upload size={16} />
                Pilih gambar / PDF
              </Button>
              <small>JPG, PNG, WEBP, PDF · 20 MB/file · maksimal 8 file</small>
            </div>
          ) : (
            <>
              <div className="document-toolbar">
                <Button
                  kind="ghost"
                  disabled={busy}
                  onClick={() => {
                    setRotation((rotation + 90) % 360);
                    setShowControls(true);
                  }}
                >
                  <RotateCw size={16} />
                  Putar
                </Button>
                <Button kind="ghost" onClick={() => setZoom(zoom >= 2 ? 1 : zoom + 0.25)}>
                  <ZoomIn size={16} />
                  Zoom
                </Button>
                <Button kind="ghost" disabled={busy} onClick={() => setShowControls(!showControls)}>
                  <SlidersHorizontal size={16} />
                  Atur gambar
                </Button>
              </div>
              <div className="image-stage">
                {files[0].type === 'application/pdf' ? (
                  <PDFPreview file={files[0]} />
                ) : image ? (
                  <img
                    alt={showOriginal ? 'Nota asli' : 'Nota hasil penyesuaian'}
                    src={!showOriginal && processedURL ? processedURL : (image ?? '')}
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                  />
                ) : (
                  <span>Menyiapkan dokumen…</span>
                )}
              </div>
              <div className="preview-options">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={showOriginal}
                    disabled={!processedURL}
                    onChange={(e) => setShowOriginal(e.target.checked)}
                  />
                  Lihat gambar asli
                </label>
                <Badge>{files.length} file</Badge>
              </div>
              {showControls && files[0].type !== 'application/pdf' && (
                <div className="image-controls">
                  <div className="form-grid">
                    <Field label={'Putar ' + rotation + '°'}>
                      <input
                        type="range"
                        min="0"
                        max="270"
                        step="90"
                        value={rotation}
                        onChange={(e) => setRotation(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Kontras">
                      <input
                        type="range"
                        min="0.5"
                        max="3"
                        step="0.05"
                        value={contrast}
                        onChange={(e) => setContrast(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Kecerahan">
                      <input
                        type="range"
                        min="-80"
                        max="80"
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Hitam putih">
                      <input
                        type="checkbox"
                        checked={threshold}
                        onChange={(e) => setThreshold(e.target.checked)}
                      />
                    </Field>
                    {(['x', 'y', 'w', 'h'] as const).map((k) => (
                      <Field
                        key={k}
                        label={
                          {
                            x: 'Crop kiri (%)',
                            y: 'Crop atas (%)',
                            w: 'Lebar crop (%)',
                            h: 'Tinggi crop (%)',
                          }[k]
                        }
                      >
                        <input
                          type="number"
                          min={k === 'w' || k === 'h' ? 1 : 0}
                          max="100"
                          value={crop[k]}
                          onChange={(e) => setCrop({ ...crop, [k]: Number(e.target.value) })}
                        />
                      </Field>
                    ))}
                  </div>
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (
                          crop.x + crop.w > 100 ||
                          crop.y + crop.h > 100 ||
                          crop.w <= 0 ||
                          crop.h <= 0
                        )
                          throw Error('Area crop melewati batas gambar.');
                        setProcessed(
                          await preprocess(files[0], {
                            rotation,
                            contrast,
                            brightness,
                            threshold,
                            crop,
                          }),
                        );
                        setShowOriginal(false);
                        notify('Pratinjau gambar diperbarui.');
                      } catch (e) {
                        setError(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Terapkan penyesuaian
                  </Button>
                  <small>
                    Penyesuaian hanya diterapkan pada gambar pertama; gunakan satu gambar untuk crop
                    per nota.
                  </small>
                </div>
              )}
              <div className="file-list">
                {files.map((f, i) => (
                  <div key={i}>
                    <FileText size={15} />
                    <span>{f.name}</span>
                    <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                    <button
                      className="icon-button"
                      aria-label={'Hapus ' + f.name}
                      disabled={busy}
                      onClick={() => {
                        setFiles(files.filter((_, k) => k !== i));
                        setProcessed(null);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="document-actions">
                <Button kind="secondary" disabled={busy} onClick={() => input.current?.click()}>
                  <Plus size={15} />
                  Tambah halaman
                </Button>
                <Button
                  kind="ghost"
                  disabled={busy}
                  onClick={() => {
                    setFiles([]);
                    setProcessed(null);
                  }}
                >
                  Ambil ulang
                </Button>
              </div>
              <Button disabled={busy || !files.length || saved} onClick={() => void runOCR()}>
                <ScanLine size={17} />
                {draft ? 'Baca ulang dokumen' : 'Baca nota sekarang'}
              </Button>
            </>
          )}
          {busy && progress && (
            <div className="ocr-progress" role="status">
              <div>
                <span>{progress.stage}</span>
                <strong>{Math.round(progress.progress * 100)}%</strong>
              </div>
              <progress value={progress.progress} max={1} />
              <small>
                Halaman {progress.page} dari {progress.pages}
              </small>
              <Button
                kind="ghost"
                onClick={async () => {
                  await cancelOCR();
                  setBusy(false);
                  setProgress(null);
                }}
              >
                Batalkan OCR
              </Button>
            </div>
          )}
          <div className="document-note">
            <ShieldCheck size={17} />
            <p>
              Dokumen tidak dikirim ke OCR eksternal. Teks hasil scan baru dikirim ke database saat
              kamu menyimpan draft. Gambar asli belum diarsipkan lintas perangkat.
            </p>
          </div>
        </Section>
        <Section
          className="review-panel"
          title="Verifikasi hasil ekstraksi"
          description={
            draft
              ? draft.lines.length + ' baris perlu diperiksa sebelum stok berubah.'
              : 'Hasil pembacaan nota akan muncul di sini.'
          }
          action={
            <button className="text-button" onClick={() => setShowText(!showText)}>
              {showText ? 'Tutup teks' : 'Input / lihat teks'}
            </button>
          }
        >
          {showText && (
            <div className="raw-text">
              <Field
                label="Teks nota mentah"
                hint="Bisa ditempel dari dokumen atau diperbaiki dari hasil OCR."
              >
                <textarea
                  value={manualText || draft?.rawText || ''}
                  onChange={(e) => setManualText(e.target.value)}
                  rows={10}
                />
              </Field>
              <Button
                kind="secondary"
                disabled={busy || saved}
                onClick={() => {
                  setDraft(parseInvoice(manualText));
                  setConfirmed(false);
                  setOperationKey(crypto.randomUUID());
                }}
              >
                Analisis teks
              </Button>
            </div>
          )}
          {!draft ? (
            <Empty
              title="Periksa sebelum percaya"
              description="Sesudah teks dibaca, cocokkan produk dan verifikasi jumlah yang benar-benar datang. Stok berubah hanya setelah kamu mengonfirmasi."
              action={
                <Button
                  kind="ghost"
                  onClick={() => {
                    setDraft({ ...parseInvoice(''), lines: [blankLine()] });
                    setShowText(false);
                  }}
                >
                  <Plus size={16} />
                  Input nota manual
                </Button>
              }
            />
          ) : (
            <>
              {saved && (
                <div className="alert success">
                  <Check size={17} />
                  Berhasil disimpan. Dokumen ini selesai; buka Scan Nota lagi untuk nota berikutnya.
                </div>
              )}
              <div className="form-grid invoice-header">
                <Field label="Gudang penerimaan">
                  <select
                    value={locationId}
                    disabled={saved}
                    onChange={(e) => {
                      setLocationId(e.target.value);
                      setConfirmed(false);
                    }}
                  >
                    {data.locations.map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {mode === 'PURCHASE_RECEIPT' && (
                  <>
                    <Field label="Supplier *">
                      <select
                        value={supplierId}
                        disabled={saved}
                        onChange={(e) => {
                          setSupplierId(e.target.value);
                          setOrderId('');
                          setConfirmed(false);
                        }}
                      >
                        <option value="">Pilih supplier terdaftar</option>
                        {data.suppliers.map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Nomor nota *">
                      <input
                        value={draft.invoiceNumber ?? ''}
                        disabled={saved}
                        onChange={(e) =>
                          change({ ...draft, invoiceNumber: e.target.value || null })
                        }
                      />
                    </Field>
                    <Field label="Tanggal nota *">
                      <input
                        type="date"
                        value={draft.invoiceDate ?? ''}
                        disabled={saved}
                        onChange={(e) => change({ ...draft, invoiceDate: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Tanggal pengiriman">
                      <input
                        type="date"
                        value={draft.deliveryDate ?? ''}
                        disabled={saved}
                        onChange={(e) => change({ ...draft, deliveryDate: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Jatuh tempo">
                      <input
                        type="date"
                        value={draft.dueDate ?? ''}
                        disabled={saved}
                        onChange={(e) => change({ ...draft, dueDate: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Tempo dari tanggal pengiriman">
                      <select
                        defaultValue=""
                        disabled={saved || !draft.deliveryDate}
                        onChange={(e) => {
                          if (!e.target.value || !draft.deliveryDate) return;
                          const date = new Date(draft.deliveryDate + 'T12:00:00Z');
                          date.setUTCDate(date.getUTCDate() + Number(e.target.value));
                          change({ ...draft, dueDate: date.toISOString().slice(0, 10) });
                        }}
                      >
                        <option value="">Pilih tempo</option>
                        {[0, 21, 30, 45, 60, 90].map((n) => (
                          <option value={n} key={n}>
                            {n === 0 ? 'Tunai / hari yang sama' : n + ' hari'}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Cocokkan purchase order">
                      <select
                        value={orderId}
                        disabled={saved}
                        onChange={(e) => {
                          setOrderId(e.target.value);
                          setConfirmed(false);
                        }}
                      >
                        <option value="">Tanpa PO</option>
                        {data.orders
                          .filter(
                            (o) =>
                              o.supplier_id === supplierId &&
                              ['open', 'partial'].includes(String(o.status)),
                          )
                          .map((o) => (
                            <option value={String(o.id)} key={String(o.id)}>
                              {String(o.reference)}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </>
                )}
              </div>
              <div className="review-legend">
                <Badge tone="amber">Periksa jumlah fisik</Badge>
                <span>Jumlah nota dan jumlah diterima terpisah.</span>
              </div>
              <div className="review-lines">
                {draft.lines.map((line, index) => {
                  const r = reconciled[index];
                  const suggestions = matchProducts(
                    line,
                    data.products,
                    data.mappings.filter((m) => m.supplier_id === supplierId),
                  );
                  return (
                    <article
                      className={
                        'review-line ' + (line.status === 'needs_review' ? 'needs-review' : '')
                      }
                      key={line.id}
                    >
                      <div className="review-line-head">
                        <div>
                          <span className="line-number">{String(index + 1).padStart(2, '0')}</span>
                          <strong>{line.name ?? 'Baris belum terbaca'}</strong>
                        </div>
                        <div>
                          <Badge
                            tone={
                              line.status === 'confirmed'
                                ? 'green'
                                : line.status === 'detected'
                                  ? 'neutral'
                                  : 'amber'
                            }
                          >
                            {statuses[line.status]}
                          </Badge>
                          <button
                            className="icon-button"
                            aria-label={'Hapus baris ' + (index + 1)}
                            disabled={saved}
                            onClick={() =>
                              change({
                                ...draft,
                                lines: draft.lines.filter((l) => l.id !== line.id),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <details className="raw-evidence">
                        <summary>Lihat teks sumber</summary>
                        <p>{line.raw || 'Baris ditambahkan manual.'}</p>
                        {line.warnings.map((w, i) => (
                          <p className="warning-text" key={i}>
                            {w}
                          </p>
                        ))}
                      </details>
                      <div className="form-grid">
                        <Field label="Nama terbaca">
                          <input
                            value={line.name ?? ''}
                            disabled={saved}
                            onChange={(e) => updateLine(line.id, 'name', e.target.value || null)}
                          />
                        </Field>
                        <Field label="Kode terbaca">
                          <input
                            value={line.code ?? ''}
                            disabled={saved}
                            onChange={(e) => updateLine(line.id, 'code', e.target.value || null)}
                          />
                        </Field>
                      </div>
                      <Field label="Produk pada katalog *">
                        <select
                          value={line.productId ?? ''}
                          disabled={saved}
                          onChange={(e) => updateLine(line.id, 'productId', e.target.value || null)}
                        >
                          <option value="">Pilih produk — tidak digabung otomatis</option>
                          {suggestions.length > 0 && (
                            <optgroup label="Saran pencocokan">
                              {suggestions.map((s) => (
                                <option key={'s' + s.product.id} value={s.product.id}>
                                  {s.product.sku} · {s.product.name} ({s.reason})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Semua produk">
                            {data.products
                              .filter((p) => p.active)
                              .map((p) => (
                                <option value={p.id} key={p.id}>
                                  {p.sku} · {p.name}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                      </Field>
                      <div className="line-actions">
                        <button
                          className="text-button"
                          disabled={saved}
                          onClick={() =>
                            onCreateProduct((id) => updateLine(line.id, 'productId', id))
                          }
                        >
                          <Plus size={13} />
                          Buat produk baru
                        </button>
                        {line.productId && supplierId && line.code && (
                          <button
                            className="text-button"
                            disabled={saved}
                            onClick={async () => {
                              try {
                                await api('/aliases', {
                                  product_id: line.productId,
                                  supplier_id: supplierId,
                                  supplier_code: line.code,
                                  alias: line.name,
                                });
                                await onRefresh();
                                notify('Pemetaan supplier dikonfirmasi dan disimpan.');
                              } catch (e) {
                                setError(String(e));
                              }
                            }}
                          >
                            Simpan alias supplier
                          </button>
                        )}
                      </div>
                      <div className="form-grid three">
                        <NumberField
                          label={mode === 'OPENING_BALANCE' ? 'Jumlah awal *' : 'Jumlah nota *'}
                          value={line.quantity}
                          disabled={saved}
                          onChange={(v) => updateLine(line.id, 'quantity', v)}
                        />
                        <Field label="Satuan pembelian *">
                          <select
                            value={line.unit ?? ''}
                            disabled={saved}
                            onChange={(e) => updateLine(line.id, 'unit', e.target.value || null)}
                          >
                            <option value="">Pilih satuan</option>
                            {units.map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </Field>
                        <NumberField
                          label="Harga per satuan *"
                          value={line.unitPrice}
                          disabled={saved}
                          onChange={(v) => updateLine(line.id, 'unitPrice', v)}
                        />
                        {mode === 'PURCHASE_RECEIPT' && (
                          <>
                            <NumberField
                              label="Jumlah fisik diterima *"
                              value={line.receivedQuantity}
                              disabled={saved}
                              onChange={(v) => updateLine(line.id, 'receivedQuantity', v)}
                            />
                            <NumberField
                              label="Rusak dari jumlah fisik"
                              value={line.damagedQuantity}
                              disabled={saved}
                              onChange={(v) => updateLine(line.id, 'damagedQuantity', v ?? 0)}
                            />
                          </>
                        )}
                        <NumberField
                          label="Diskon baris (Rp)"
                          value={line.discount}
                          disabled={saved}
                          onChange={(v) => updateLine(line.id, 'discount', v)}
                        />
                        <NumberField
                          label="Pajak baris (Rp)"
                          value={line.tax}
                          disabled={saved}
                          onChange={(v) => updateLine(line.id, 'tax', v)}
                        />
                        <NumberField
                          label="Total tercetak"
                          value={line.lineTotal}
                          disabled={saved}
                          onChange={(v) => updateLine(line.id, 'lineTotal', v)}
                        />
                      </div>
                      <div className="line-reconciliation">
                        {r.p && r.conversion ? (
                          <>
                            <span>
                              {quantity(
                                mode === 'OPENING_BALANCE' ? line.quantity : line.receivedQuantity,
                              )}{' '}
                              {line.unit}
                              {mode === 'PURCHASE_RECEIPT' && line.damagedQuantity > 0
                                ? ' − ' + quantity(line.damagedQuantity) + ' rusak'
                                : ''}{' '}
                              × {quantity(r.conversion)}
                            </span>
                            <strong>
                              {r.base === null
                                ? 'Isi jumlah fisik'
                                : '+ ' + quantity(r.base) + ' ' + r.p.base_unit}
                            </strong>
                          </>
                        ) : r.p ? (
                          <button
                            className="text-button warning-text"
                            disabled={saved}
                            onClick={() => onConversion(r.p!.id)}
                          >
                            Konversi belum tersimpan. Konfirmasi isi kemasan →
                          </button>
                        ) : (
                          <span>Pilih produk untuk menghitung stok dasar.</span>
                        )}
                        <span>
                          Total hitung:{' '}
                          <b>{r.total === null ? 'Belum lengkap' : rupiah(r.total)}</b>
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="review-table-actions">
                <Button
                  kind="secondary"
                  disabled={saved}
                  onClick={() => change({ ...draft, lines: [...draft.lines, blankLine()] })}
                >
                  <Plus size={15} />
                  Tambah baris
                </Button>
                <Button
                  kind="ghost"
                  disabled={saved}
                  onClick={() => {
                    try {
                      merge();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Gabung produk berulang
                </Button>
              </div>
              {mode === 'PURCHASE_RECEIPT' && (
                <div className="form-grid three">
                  <NumberField
                    label="Diskon seluruh nota (Rp)"
                    value={draft.discount}
                    disabled={saved}
                    onChange={(v) => change({ ...draft, discount: v })}
                  />
                  <NumberField
                    label="Pajak seluruh nota (Rp)"
                    value={draft.tax}
                    disabled={saved}
                    onChange={(v) => change({ ...draft, tax: v })}
                  />
                  <NumberField
                    label="Pembulatan nota (±Rp, maks. 100)"
                    allowNegative
                    value={draft.rounding ?? null}
                    disabled={saved}
                    onChange={(v) => change({ ...draft, rounding: v })}
                  />
                  <NumberField
                    label="Total nota tercetak"
                    value={draft.total}
                    disabled={saved}
                    onChange={(v) => change({ ...draft, total: v })}
                  />
                </div>
              )}
              <div className="invoice-total">
                <span>
                  Nilai {mode === 'OPENING_BALANCE' ? 'saldo awal' : 'nota'} hasil perhitungan
                </span>
                <strong>{rupiah(invoiceTotal)}</strong>
              </div>
              <label className="checkbox review-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={saved}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    if (e.target.checked)
                      setDraft({
                        ...draft,
                        lines: draft.lines.map((l) => ({ ...l, status: 'confirmed' })),
                      });
                  }}
                />
                Saya sudah memeriksa produk, angka nota, diskon/pajak (kosong = tidak ada), satuan,
                dan jumlah fisik yang layak masuk stok.
              </label>
              <div className="sticky-actions">
                <Button
                  kind="secondary"
                  disabled={busy || saved || !canReceive}
                  onClick={() => void saveDraft()}
                >
                  <Save size={16} />
                  Simpan draft
                </Button>
                <Button
                  disabled={busy || saved || !canReceive || !confirmed}
                  onClick={() => {
                    setError('');
                    try {
                      validate();
                      setPreview(true);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <Check size={16} />
                  Tinjau & konfirmasi
                </Button>
              </div>
              <button
                className="text-button export-draft"
                onClick={() => download('draft-nota-new-system.json', saveObject())}
              >
                <Download size={14} />
                Unduh draft JSON
              </button>
            </>
          )}
        </Section>
      </div>
      {error && (
        <div className="alert error scan-error" role="alert">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}
      {data.drafts.length > 0 && !draft && (
        <Section
          title="Draft tersimpan"
          description="Lanjutkan verifikasi yang sebelumnya ditunda."
        >
          <DataTable
            rows={data.drafts}
            keyOf={(r) => String(r.id)}
            columns={[
              {
                label: 'Nota',
                render: (r) => String((r.data as SavedDraft).draft?.invoiceNumber ?? 'Tanpa nomor'),
              },
              {
                label: 'Mode',
                render: (r) => (r.mode === 'PURCHASE_RECEIPT' ? 'Penerimaan' : 'Saldo awal'),
              },
              {
                label: 'Lanjutkan',
                render: (r) => (
                  <Button
                    kind="secondary"
                    onClick={() =>
                      restore({
                        ...(r.data as SavedDraft),
                        version: Number(r.version),
                        draftId: String(r.id),
                      })
                    }
                  >
                    Buka draft
                  </Button>
                ),
              },
            ]}
          />
        </Section>
      )}
      {preview && (
        <Modal title="Rekonsiliasi sebelum pembukuan" wide onClose={() => setPreview(false)}>
          <div className="alert warning">
            Konfirmasi ini akan mencatat transaksi resmi dan mengubah stok. Jumlah pada nota tidak
            menggantikan jumlah fisik.
          </div>
          <DataTable
            rows={reconciled}
            keyOf={(r) => r.l.id}
            columns={[
              { label: 'Produk', render: (r) => r.p!.sku },
              {
                label: 'Nota / jumlah awal',
                render: (r) => quantity(r.l.quantity) + ' ' + r.l.unit,
              },
              {
                label: 'Fisik',
                render: (r) =>
                  mode === 'OPENING_BALANCE'
                    ? 'Saldo awal'
                    : quantity(r.l.receivedQuantity) + ' ' + r.l.unit,
              },
              { label: 'Rusak', render: (r) => quantity(r.l.damagedQuantity) },
              {
                label: 'Masuk stok',
                render: (r) => (
                  <strong className="positive">
                    +{quantity(r.base)} {r.p!.base_unit}
                  </strong>
                ),
              },
              { label: 'Nilai nota', render: (r) => rupiah(r.total) },
            ]}
          />
          <label className="checkbox">
            <input checked readOnly type="checkbox" />
            Diverifikasi oleh {data.user.name}. Nilai nota {rupiah(invoiceTotal)}.
          </label>
          <Button onClick={() => void post()} disabled={busy}>
            {busy ? 'Membukukan…' : 'Konfirmasi & bukukan sekali'}
          </Button>
        </Modal>
      )}
      {camera && (
        <Modal title="Foto nota" onClose={() => setCamera(false)}>
          <video ref={video} autoPlay playsInline muted className="camera-video" />
          <p>Posisikan nota pada bidang datar dengan cahaya yang cukup.</p>
          <Button
            onClick={async () => {
              const v = video.current;
              if (!v || !v.videoWidth) return;
              const canvas = document.createElement('canvas');
              const scale = Math.min(1, 2000 / Math.max(v.videoWidth, v.videoHeight));
              canvas.width = v.videoWidth * scale;
              canvas.height = v.videoHeight * scale;
              canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
              const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.9),
              );
              if (blob)
                addFiles([new File([blob], 'nota-' + Date.now() + '.jpg', { type: 'image/jpeg' })]);
              setCamera(false);
            }}
          >
            <Camera size={16} />
            Ambil foto
          </Button>
        </Modal>
      )}
    </>
  );
}
function NumberField({
  label,
  value,
  onChange,
  disabled,
  allowNegative = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  allowNegative?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={allowNegative ? -100 : 0}
        step="0.0001"
        inputMode="decimal"
        value={value ?? ''}
        placeholder="Belum terbaca"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Field>
  );
}
function TruckIcon() {
  return <FileText size={23} />;
}
function PackageIcon() {
  return <ImageIcon size={23} />;
}
function PDFPreview({ file }: { file: File }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let task: { destroy: () => Promise<void> } | undefined;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        task = loading;
        const pdf = await loading.promise;
        if (!active) return;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const el = canvas.current;
        if (!el) return;
        el.width = viewport.width;
        el.height = viewport.height;
        await page.render({ canvas: el, canvasContext: el.getContext('2d')!, viewport }).promise;
      } catch (e) {
        if (active) setError(String(e));
      }
    })();
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [file]);
  return (
    <>
      {error ? <p>{error}</p> : <canvas ref={canvas} className="pdf-preview" />}
      <small>Pratinjau halaman pertama. Semua halaman diproses saat membaca nota.</small>
    </>
  );
}
