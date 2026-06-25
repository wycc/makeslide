import type { TranslationKey } from '../i18n';

/** Singular/plural suffix forms for a relative-time unit. */
export interface PluralSuffix {
  /** Suffix used when the count is exactly 1 (e.g. ' day ago'). */
  one: string;
  /** Suffix used for any other count (e.g. ' days ago'). */
  other: string;
}

/**
 * Locale-agnostic relative-time formatting ("just now", "N minutes ago", …).
 * Kept free of React/i18n so it can be unit-tested: callers pass the localized
 * label strings (built from `t()`), since `t()` has no interpolation. Each unit
 * carries singular/plural suffix forms (so English reads "1 day ago" not
 * "1 days ago"); for languages without plural inflection both forms are equal.
 * Suffixes are concatenated after the number, so they include any leading space.
 */
export interface RelativeTimeLabels {
  justNow: string;
  minutes: PluralSuffix;
  hours: PluralSuffix;
  days: PluralSuffix;
  months: PluralSuffix;
  years: PluralSuffix;
}

/** Map from a relative-time label field to its i18n key(s). */
export const RELATIVE_TIME_LABEL_KEYS = {
  justNow: 'time.justNow',
  minutes: { one: 'time.minuteOne', other: 'time.minuteOther' },
  hours: { one: 'time.hourOne', other: 'time.hourOther' },
  days: { one: 'time.dayOne', other: 'time.dayOther' },
  months: { one: 'time.monthOne', other: 'time.monthOther' },
  years: { one: 'time.yearOne', other: 'time.yearOther' },
} as const;

/**
 * Builds a {@link RelativeTimeLabels} from a translate function, so components
 * don't each repeat the same `t('time.*')` lookups.
 */
export function buildRelativeTimeLabels(t: (key: TranslationKey) => string): RelativeTimeLabels {
  const k = RELATIVE_TIME_LABEL_KEYS;
  return {
    justNow: t(k.justNow),
    minutes: { one: t(k.minutes.one), other: t(k.minutes.other) },
    hours: { one: t(k.hours.one), other: t(k.hours.other) },
    days: { one: t(k.days.one), other: t(k.days.other) },
    months: { one: t(k.months.one), other: t(k.months.other) },
    years: { one: t(k.years.one), other: t(k.years.other) },
  };
}

function suffix(count: number, forms: PluralSuffix): string {
  return count === 1 ? forms.one : forms.other;
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
    if (mins < 60) return `${mins}${suffix(mins, labels.minutes)}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}${suffix(hours, labels.hours)}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${suffix(days, labels.days)}`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}${suffix(months, labels.months)}`;
    const years = Math.floor(months / 12);
    return `${years}${suffix(years, labels.years)}`;
  } catch {
    return iso;
  }
}
