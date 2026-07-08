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

/**
 * Sums a deck total from page rows, treating interactive notebook pages
 * (`render_type === 'notebook'`) as silent regardless of any `audio_duration_seconds` that
 * lingers from before the page was converted (Jupyter phase 5b). This keeps the deck total
 * consistent with playback, where notebook pages never play audio (phase 1d).
 */
export function sumPageAudioDurations(
  pages: Array<{ audio_duration_seconds: number | null | undefined; render_type: string | null | undefined }>,
): number | null {
  return sumAudioDurationSeconds(
    pages.map((p) => (p.render_type === 'notebook' ? null : p.audio_duration_seconds)),
  );
}
