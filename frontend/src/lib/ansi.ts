// Minimal ANSI SGR parser for rendering Jupyter error tracebacks (phase 2b).
//
// Kernel `error` outputs carry a traceback whose text is coloured with ANSI escape
// sequences (e.g. `\x1b[0;31m` for red). Rendered verbatim these show up as garbage, so we
// parse the SGR (Select Graphic Rendition) codes into styled segments the UI maps to colours.
// Only foreground colour + bold are modelled (that covers IPython tracebacks); every other
// escape sequence is stripped. Pure and unit-testable — no DOM.

export type AnsiColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white';

export interface AnsiSegment {
  text: string;
  color?: AnsiColor;
  bold?: boolean;
}

const COLOR_BY_CODE: Record<number, AnsiColor> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
};

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[([0-9;]*)m/g;

interface Style {
  color?: AnsiColor;
  bold?: boolean;
}

function applyCodes(style: Style, params: string): Style {
  // An empty parameter string (ESC[m) means reset, same as ESC[0m.
  const codes = params === '' ? [0] : params.split(';').map((p) => Number(p) || 0);
  let next: Style = { ...style };
  for (const code of codes) {
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 22) next.bold = false;
    else if (code === 39) next.color = undefined;
    else if (code in COLOR_BY_CODE) next.color = COLOR_BY_CODE[code];
    else if (code >= 90 && code <= 97) next.color = COLOR_BY_CODE[code - 60]; // bright → base colour
  }
  return next;
}

function pushSegment(segments: AnsiSegment[], text: string, style: Style): void {
  if (!text) return;
  const seg: AnsiSegment = { text };
  if (style.color) seg.color = style.color;
  if (style.bold) seg.bold = true;
  segments.push(seg);
}

/**
 * Parse a string containing ANSI SGR escapes into styled segments. Adjacent text with the
 * same style is emitted as separate runs only across escape boundaries; plain input yields a
 * single segment. Non-SGR escape sequences are removed.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: Style = {};
  let lastIndex = 0;
  ANSI_ESCAPE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_ESCAPE.exec(input)) !== null) {
    pushSegment(segments, input.slice(lastIndex, match.index), style);
    style = applyCodes(style, match[1] ?? '');
    lastIndex = match.index + match[0].length;
  }
  pushSegment(segments, input.slice(lastIndex), style);
  return segments;
}

/** Strip all ANSI escape sequences, returning plain text. */
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((s) => s.text)
    .join('');
}
