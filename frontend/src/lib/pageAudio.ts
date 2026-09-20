import type { PdfDetailPage, SlideRenderType } from '../types';

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

/**
 * The audio to play for a page *at a given step*.
 *
 * A step-built page narrates one step at a time, so its audio is the current step's, not the
 * page's — and a step with nothing to say is silent rather than falling back to the whole page's
 * narration, which would replay the entire slide on every click.
 */
export function playableStepAudioUrl(
  page: (PdfDetailPage | null | undefined),
  stepIndex: number,
): string | null {
  const steps = page?.steps;
  if (!steps || steps.length === 0) return playablePageAudioUrl(page);
  const clamped = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  return steps[clamped]?.audio_url ?? null;
}

/**
 * The text the audio that is playing right now actually says: the current step's narration on a
 * step-built page, the page's script otherwise.
 *
 * The companion of `playableStepAudioUrl`, and needed for the same reason. Captions are laid out
 * by spreading a script's sentences over the playing clip's duration, so the script has to be the
 * one that clip speaks. The page-level script of a step page is all its steps joined together;
 * spread over the first step's 27 seconds, an eight-step page's captions reach step two's text
 * within three seconds while step one is still being read (reported on rYFD1VwStl page 5).
 *
 * A step with nothing to say gets no captions, for the reason it gets no audio: falling back to
 * the whole page would caption a silent step with everything the page says.
 */
export function spokenScriptFor(
  page: (PdfDetailPage | null | undefined),
  stepIndex: number,
  pageScript: string,
): string {
  const steps = page?.steps;
  if (!steps || steps.length === 0) return pageScript;
  const clamped = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  return steps[clamped]?.script ?? '';
}

/** How many steps a page is built in; 0 for an ordinary page. */
export function pageStepCount(page: PdfDetailPage | null | undefined): number {
  return page?.steps?.length ?? 0;
}
