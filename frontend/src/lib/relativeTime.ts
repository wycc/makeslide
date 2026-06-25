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
