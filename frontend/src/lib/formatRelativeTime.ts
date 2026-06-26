/**
 * Returns a human-readable relative time string for a given ISO 8601 datetime.
 * Within 3 days it uses relative labels ("剛剛", "3 分鐘前", "2 小時前", "昨天");
 * beyond that it falls back to localised absolute date. The optional `now`
 * parameter is provided so unit tests can inject a fixed reference time.
 */
export function formatRelativeTime(isoString: string, now: Date = new Date()): string {
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) {
    return isoString;
  }
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  if (diffHour < 24) return `${diffHour} 小時前`;
  if (diffDay === 1) return '昨天';
  if (diffDay < 3) return `${diffDay} 天前`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
