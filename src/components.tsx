import { useState, type ReactNode, type FormEvent } from 'react';
import {
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  LoaderCircle,
  Inbox,
} from 'lucide-react';
export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled = false,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <button
      className={'button ' + kind}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'wide' : '')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Tutup" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  title = 'Belum ada data',
  description = 'Data akan muncul setelah transaksi dicatat.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span>
        <Inbox size={27} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Section({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'panel ' + className}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function DataTable<T>({
  rows,
  columns,
  keyOf,
  empty,
  searchBy,
}: {
  rows: T[];
  columns: { label: string; render: (row: T) => ReactNode; className?: string }[];
  keyOf: (row: T) => string;
  empty?: string;
  searchBy?: (row: T) => string;
}) {
  const [page, setPage] = useState(0),
    [search, setSearch] = useState('');
  const filtered = searchBy
    ? rows.filter((r) => searchBy(r).toLowerCase().includes(search.toLowerCase()))
    : rows;
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const safePage = Math.min(page, pages - 1);
  return (
    <>
      {searchBy && (
        <div className="table-toolbar">
          <label className="searchbox">
            <Search size={17} />
            <input
              aria-label="Cari dalam tabel"
              value={search}
              placeholder="Cari nama, kode, atau referensi…"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <span>{filtered.length} hasil</span>
        </div>
      )}
      {!filtered.length ? (
        <Empty title={empty ?? 'Belum ada data'} />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th className={c.className} key={i}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(safePage * 15, safePage * 15 + 15).map((r) => (
                  <tr key={keyOf(r)}>
                    {columns.map((c, i) => (
                      <td className={c.className} key={i}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {safePage * 15 + 1}–{Math.min(filtered.length, (safePage + 1) * 15)} dari{' '}
              {filtered.length}
            </span>
            <div>
              <button
                className="icon-button"
                disabled={!safePage}
                aria-label="Halaman sebelumnya"
                onClick={() => setPage(safePage - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {safePage + 1} / {pages}
              </span>
              <button
                className="icon-button"
                disabled={safePage + 1 === pages}
                aria-label="Halaman berikutnya"
                onClick={() => setPage(safePage + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={'stat ' + (accent ? 'accent' : '')}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function Form({
  children,
  onSubmit,
  busy = false,
  submit = 'Simpan',
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  busy?: boolean;
  submit?: string;
}) {
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <form onSubmit={handle}>
      {children}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={busy || loading}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <ArrowUpRight size={16} />}{' '}
          {submit}
        </Button>
      </div>
    </form>
  );
}
