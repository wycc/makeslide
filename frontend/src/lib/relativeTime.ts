import type { TranslationKey } from '../i18n';

/**
 * Locale-agnostic relative-time formatting ("just now", "N minutes ago", …).
 * Kept free of React/i18n so it can be unit-tested: callers pass the localized
 * label strings (built from `t()`), since `t()` has no interpolation. Suffixes
 * are concatenated after the number, so they should include any leading space
 * (e.g. ' 分鐘前' / ' min ago').
 */
export interface RelativeTimeLabels {
  justNow: string;
  minutesSuffix: string;
  hoursSuffix: string;
  daysSuffix: string;
  monthsSuffix: string;
  yearsSuffix: string;
}

/** Map from a relative-time label field to its i18n key. */
export const RELATIVE_TIME_LABEL_KEYS = {
  justNow: 'time.justNow',
  minutesSuffix: 'time.minutesSuffix',
  hoursSuffix: 'time.hoursSuffix',
  daysSuffix: 'time.daysSuffix',
  monthsSuffix: 'time.monthsSuffix',
  yearsSuffix: 'time.yearsSuffix',
} as const;

/**
 * Builds a {@link RelativeTimeLabels} from a translate function, so components
 * don't each repeat the same six `t('time.*')` lookups.
 */
export function buildRelativeTimeLabels(t: (key: TranslationKey) => string): RelativeTimeLabels {
  return {
    justNow: t(RELATIVE_TIME_LABEL_KEYS.justNow),
    minutesSuffix: t(RELATIVE_TIME_LABEL_KEYS.minutesSuffix),
    hoursSuffix: t(RELATIVE_TIME_LABEL_KEYS.hoursSuffix),
    daysSuffix: t(RELATIVE_TIME_LABEL_KEYS.daysSuffix),
    monthsSuffix: t(RELATIVE_TIME_LABEL_KEYS.monthsSuffix),
    yearsSuffix: t(RELATIVE_TIME_LABEL_KEYS.yearsSuffix),
  };
}

export function formatRelativeTime(
  iso: string,
  labels: RelativeTimeLabels,
  now: number = Date.now(),
): string {
  try {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return iso;
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return labels.justNow;
    if (mins < 60) return `${mins}${labels.minutesSuffix}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}${labels.hoursSuffix}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${labels.daysSuffix}`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}${labels.monthsSuffix}`;
    return `${Math.floor(months / 12)}${labels.yearsSuffix}`;
  } catch {
    return iso;
  }
}
