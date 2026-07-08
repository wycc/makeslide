import type { SlideRenderType } from '../types';

/**
 * The playable audio URL for a slide page, or `null` when the page must be treated as
 * silent. Interactive notebook pages (`render_type === 'notebook'`) are always silent —
 * even if an `audio_url` lingers from before the page was converted — so the `<audio>`
 * element never loads or plays their narration (mirrors the backend TTS skip in
 * synthesizeAudio, Jupyter phase 1d-i). Callers use this instead of reading `audio_url`
 * directly so every load / prefetch / retry path stays consistent.
 */
export function playablePageAudioUrl(
  page: { audio_url?: string | null; render_type?: SlideRenderType | null } | null | undefined,
): string | null {
  if (!page) return null;
  if (page.render_type === 'notebook') return null;
  return page.audio_url ?? null;
}
