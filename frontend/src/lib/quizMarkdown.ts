/**
 * Whether a quiz text uses any Markdown / LaTeX syntax worth previewing while editing.
 *
 * Plain sentences are the norm; the editor only shows a rendered preview under the textarea when
 * the author has actually typed something the renderer would transform — otherwise every question
 * would carry a duplicate of itself. Kept deliberately loose: a false positive costs one extra
 * preview block, a false negative hides a formula until it is saved.
 */
export function hasMarkdownOrMath(text: string): boolean {
  if (!text) return false;
  return (
    /\$[^$\n]+\$|\$\$[\s\S]+\$\$|\\\(|\\\[/.test(text) // inline / block math
    || /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(text) // bold, code, links
    || /^\s*(#{1,6}\s|[-*]\s|\d+\.\s|\|)/m.test(text) // headings, lists, tables
  );
}
