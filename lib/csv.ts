// CSV helpers for the product export.
//
// - RFC 4180 quoting: cells containing `"`, `,`, `\n` or `\r` are quoted and `"` doubled.
// - Formula-injection guard (OWASP "CSV injection"): a text cell starting with
//   `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'` so spreadsheet apps treat it as
//   text instead of executing it. Plain numbers (e.g. "-3" stock) are left untouched.
// - A UTF-8 BOM is prepended so Excel decodes non-ASCII text (é, ü, 日本) correctly.

export const CSV_BOM = '\uFEFF';

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  let s = (value ?? '').toString();
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a CSV document (BOM + CRLF line endings) from a header and rows of cells. */
export function buildCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return CSV_BOM + lines.join('\r\n');
}
