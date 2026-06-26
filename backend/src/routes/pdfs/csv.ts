/**
 * Shared CSV field escaping for the poll-results / quiz-results export routes,
 * so both encode user-supplied text the same way (previously each route carried
 * its own byte-identical copy).
 */

// Leading chars a spreadsheet (Excel/Sheets/LibreOffice) may interpret as the
// start of a formula when a CSV cell is opened — the classic "CSV formula
// injection" vector. Tab/CR are included because some apps treat them as cell
// separators that can re-trigger formula parsing on the next token.
const FORMULA_INJECTION_LEAD_RE = /^[=+\-@\t\r]/;
// Field needs quoting per RFC 4180 if it contains a comma, quote, or newline
// (CR or LF — a lone CR would otherwise split rows in some parsers).
const NEEDS_QUOTING_RE = /[",\n\r]/;

/**
 * Escapes a value for a single CSV field. Numbers are emitted as-is (so a
 * legitimate negative number is never treated as a formula); string values that
 * begin with a formula-trigger char are prefixed with a single quote to defang
 * CSV formula injection. Fields containing commas/quotes/newlines are wrapped in
 * double quotes with embedded quotes doubled.
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && s.length > 0 && FORMULA_INJECTION_LEAD_RE.test(s)) {
    s = `'${s}`;
  }
  if (NEEDS_QUOTING_RE.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
