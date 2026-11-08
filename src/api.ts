export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await r.json()) as T & { error?: string };
  if (!r.ok) throw Error(result.error ?? 'Permintaan gagal.');
  return result;
}
export const rupiah = (n: unknown) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
export const quantity = (n: unknown) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(Number(n ?? 0));
export const tanggal = (s: unknown) =>
  s
    ? new Date(String(s)).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      })
    : 'Belum diisi';
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
