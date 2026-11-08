import { neon } from '@neondatabase/serverless';
export interface DB {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
export function database(url: string): DB {
  const sql = neon(url);
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await sql.query(text, params)) as T[],
  };
}
