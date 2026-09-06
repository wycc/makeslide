import type { SlideAnimationEffect } from '../types';

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
