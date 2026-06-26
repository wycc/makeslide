/**
 * Escapes the five reserved XML characters. Single source of truth for the
 * SVG text rendering (renderTextPages) and SCORM manifest builder, which
 * previously held byte-identical copies.
 */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
