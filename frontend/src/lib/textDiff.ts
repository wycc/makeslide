/**
 * Line diff for the tutor's script proposals (docs/tutor-edit-tools.md §5).
 *
 * Written here rather than pulled from a package: a page's script is a few hundred characters, and
 * a dependency to colour two kinds of line is not a trade worth making. The algorithm is the usual
 * LCS over lines — O(n·m) on inputs this size, which is nothing.
 */

export type DiffOp = 'same' | 'added' | 'removed';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Split for diffing. Trailing whitespace is dropped so an invisible change is not shown as one, and
 * empty text is no lines rather than one empty line — otherwise a script written from scratch opens
 * with a removed blank row that never existed.
 */
function toLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized.trim() === '') return [];
  return normalized.split('\n').map((l) => l.trimEnd());
}

/**
 * Line-by-line difference between two versions.
 *
 * Removed lines are emitted before the added ones that replace them, so a changed line reads as
 * "this became that" rather than as two unrelated edits several rows apart.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before);
  const b = toLines(after);

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: 'removed', text: a[i]! });
      i += 1;
    } else {
      out.push({ op: 'added', text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ op: 'removed', text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    out.push({ op: 'added', text: b[j]! });
    j += 1;
  }
  return out;
}

/** How many lines the proposal actually touches, for "N 行變更" without counting context. */
export function countChangedLines(lines: DiffLine[]): number {
  return lines.filter((l) => l.op !== 'same').length;
}
