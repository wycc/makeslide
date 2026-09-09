import type { SlideAnimationEffect } from '../types';
import type { SentenceTimelineItem } from './subtitles';

/**
 * One line that says what an effect is and when it runs, for the collapsed rows of the animation
 * editor (docs: the editor shows a summary per effect and expands one at a time).
 */
export interface EffectSummaryLabels {
  typeLabel: string;
  /** e.g. "第 3 句開始" — built by the caller from the trigger (needs i18n). */
  triggerLabel: string | null;
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0s';
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
}

/** The text of a collapsed effect row: type · when · how long · optional content excerpt. */
export function effectSummary(effect: SlideAnimationEffect, resolvedStart: number, labels: EffectSummaryLabels): string {
  const when = labels.triggerLabel ?? formatSeconds(resolvedStart);
  const parts = [labels.typeLabel, when, formatSeconds(effect.duration)];
  const excerpt = effectExcerpt(effect);
  if (excerpt) parts.push(excerpt);
  return parts.join(' · ');
}

/** A short piece of the effect's content, when it has any: callout text, step items, formula, figure. */
export function effectExcerpt(effect: SlideAnimationEffect, max = 24): string | null {
  const raw =
    effect.type === 'text-callout' ? effect.text
    : effect.type === 'step-list' ? effect.items?.join(' / ')
    : effect.type === 'formula' ? effect.formula
    : effect.type === 'overlay-image' ? effect.figureId
    : null;
  const text = raw?.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The transcript sentence an effect lines up with: the sentence its trigger names, or — for a
 * time-based effect — the sentence that is being spoken when it starts. 0-based index; null when
 * the page has no narration or the time falls after the last sentence.
 */
export function effectSentence(
  effect: SlideAnimationEffect,
  resolvedStart: number,
  timeline: readonly SentenceTimelineItem[],
): { index: number; text: string } | null {
  if (effect.startTrigger) {
    const item = timeline[effect.startTrigger.line];
    return item ? { index: effect.startTrigger.line, text: item.text } : null;
  }
  const epsilon = 0.05;
  const index = timeline.findIndex((item) => resolvedStart + epsilon >= item.start && resolvedStart < item.end);
  if (index < 0) return null;
  return { index, text: timeline[index]!.text };
}

/** Clock-style time for the summary row: "0:04" / "1:12.5". */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const rounded = Math.round(s * 10) / 10;
  const sec = Number.isInteger(rounded) ? String(rounded).padStart(2, '0') : rounded.toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

/**
 * CSS to show just the part of the slide picture under an effect's box, as a background of a
 * fixed-width element: the box in page percentages becomes background-size / background-position,
 * and the element's aspect ratio follows the box (page aspect × box aspect).
 */
export function cropStyleForBox(
  box: { xPct: number; yPct: number; widthPct: number; heightPct: number },
  pageAspect = 16 / 9,
): { backgroundSize: string; backgroundPosition: string; aspectRatio: string } {
  const w = Math.max(1, Math.min(100, box.widthPct));
  const h = Math.max(1, Math.min(100, box.heightPct));
  const x = Math.max(0, Math.min(100 - w, box.xPct));
  const y = Math.max(0, Math.min(100 - h, box.yPct));
  // background-position percentages place the image so that P% of the image lines up with P% of
  // the element; solving for a box at x with width w gives x / (100 - w).
  const posX = w >= 100 ? 0 : (x / (100 - w)) * 100;
  const posY = h >= 100 ? 0 : (y / (100 - h)) * 100;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    backgroundSize: `${r((100 / w) * 100)}% ${r((100 / h) * 100)}%`,
    backgroundPosition: `${r(posX)}% ${r(posY)}%`,
    aspectRatio: `${r(pageAspect * (w / h))}`,
  };
}
