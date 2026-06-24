export type DiffOp = { type: 'add' | 'del' | 'eq'; line: string };

/**
 * Computes a line-level diff from oldText to newText using LCS backtracking.
 * 'del' = present in old, absent in new (removed)
 * 'add' = absent in old, present in new (added)
 * 'eq'  = unchanged
 */
export function computeLineDiff(oldText: string, newText: string): DiffOp[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // dp[i][j] = LCS length of oldLines[0..i-1] and newLines[0..j-1]
  const dp: number[] = new Array<number>((m + 1) * (n + 1)).fill(0);
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[idx(i, j)] = (dp[idx(i - 1, j - 1)] ?? 0) + 1;
      } else {
        dp[idx(i, j)] = Math.max(dp[idx(i - 1, j)] ?? 0, dp[idx(i, j - 1)] ?? 0);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const oldLine = oldLines[i - 1] ?? '';
    const newLine = newLines[j - 1] ?? '';
    if (i > 0 && j > 0 && oldLine === newLine) {
      ops.push({ type: 'eq', line: oldLine });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[idx(i, j - 1)] ?? 0) >= (dp[idx(i - 1, j)] ?? 0))) {
      ops.push({ type: 'add', line: newLine });
      j--;
    } else {
      ops.push({ type: 'del', line: oldLine });
      i--;
    }
  }
  return ops.reverse();
}
