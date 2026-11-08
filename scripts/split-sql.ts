/** Split trusted SQL migration files while preserving function bodies and quoted semicolons. */
export function splitSQL(sql: string): string[] {
  const result: string[] = [];
  let start = 0,
    quote: "'" | '"' | null = null,
    dollar: string | null = null,
    lineComment = false,
    blockDepth = 0,
    escapeString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i],
      next = sql[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockDepth) {
      if (c === '/' && next === '*') {
        blockDepth++;
        i++;
      } else if (c === '*' && next === '/') {
        blockDepth--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (quote === "'" && escapeString && c === '\\') {
        i++;
        continue;
      }
      if (c === quote) {
        if (next === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (c === '-' && next === '-') {
      lineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      blockDepth = 1;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      escapeString = c === "'" && /[eE]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      continue;
    }
    if (c === '$') {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];
      if (tag) {
        dollar = tag;
        i += tag.length - 1;
        continue;
      }
    }
    if (c === ';') {
      const part = sql.slice(start, i).trim();
      if (part) result.push(part);
      start = i + 1;
    }
  }
  if (quote || dollar || blockDepth)
    throw Error('SQL migration contains an unterminated quote or comment.');
  const last = sql.slice(start).trim();
  if (last) result.push(last);
  return result;
}
