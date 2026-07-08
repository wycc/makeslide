// Collapse long multi-line text for the notebook single-cell view (Jupyter phase 6e): a very
// long stream/error output shouldn't blow out the fixed-height cell, so it is truncated to the
// first N lines with a count of what's hidden. Pure/string-only so it is unit-testable.

export interface CollapsedText {
  /** The text to show when collapsed (first `maxLines` lines), or the full text when it fits. */
  text: string;
  /** Number of lines hidden by collapsing; 0 when nothing was truncated. */
  hiddenLines: number;
}

/**
 * Truncate `text` to its first `maxLines` lines. Returns the original text and `hiddenLines: 0`
 * when it already fits (or `maxLines` is not a positive number). Never mutates the input.
 */
export function collapseText(text: string, maxLines: number): CollapsedText {
  if (!Number.isFinite(maxLines) || maxLines <= 0) return { text, hiddenLines: 0 };
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, hiddenLines: 0 };
  return { text: lines.slice(0, maxLines).join('\n'), hiddenLines: lines.length - maxLines };
}
