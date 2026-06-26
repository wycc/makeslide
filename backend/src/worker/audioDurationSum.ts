/**
 * Sums per-page audio durations (seconds) into a deck total, ignoring missing or
 * non-positive values, and rounds to millisecond precision. Returns null when no
 * page contributes a usable duration. Shared by the pipeline and regenerate
 * workers (previously a byte-identical copy in each).
 */
export function sumAudioDurationSeconds(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      total += value;
      count += 1;
    }
  }
  return count > 0 ? Math.round(total * 1000) / 1000 : null;
}
