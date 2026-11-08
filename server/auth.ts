import type { DB } from './db';
export const iterations = 100000;
const encode = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function hashPassword(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return `${iterations}$${encode(salt)}$${encode(bits)}`;
}
export async function verifyPassword(password: string, hash: string) {
  try {
    const [n, salt, bits] = hash.split('$');
    if (Number(n) !== iterations) return false;
    const actual = (await hashPassword(password, decode(salt))).split('$')[2];
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(bits),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(actual));
    return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(bits));
  } catch {
    return false;
  }
}
export interface Session {
  id: string;
  email: string;
  name: string;
  role: string;
  businessId: string;
  expires: number;
  passwordVersion: string;
}
export async function signSession(session: Session, secret: string) {
  const data = encode(new TextEncoder().encode(JSON.stringify(session)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return data + '.' + encode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
export async function readSession(token: string, secret: string, db: DB): Promise<Session | null> {
  try {
    const [data, mac] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (!(await crypto.subtle.verify('HMAC', key, decode(mac), new TextEncoder().encode(data))))
      return null;
    const session = JSON.parse(new TextDecoder().decode(decode(data))) as Session;
    if (session.expires < Date.now()) return null;
    const [user] = await db.query<{ role: string; password_hash: string }>(
      'SELECT m.role,u.password_hash FROM business_memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND m.user_id=$2 AND u.active',
      [session.businessId, session.id],
    );
    if (!user || (await passwordVersion(user.password_hash)) !== session.passwordVersion)
      return null;
    return { ...session, role: user.role };
  } catch {
    return null;
  }
}

export async function passwordVersion(hash: string) {
  return encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hash)));
}
