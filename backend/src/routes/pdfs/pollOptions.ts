/**
 * Safe parser for a page poll's `options_json` column. Polls store their option
 * texts as a JSON string array; this guards against malformed/corrupt data so a
 * single bad row can't 500 a whole export or vote request.
 */

/**
 * Parse `options_json` into the poll's option texts. Returns an empty array when
 * the value is not valid JSON or not an array, and filters out any non-string
 * entries so callers always get a clean `string[]`.
 */
export function parsePollOptions(optionsJson: string | null | undefined): string[] {
  if (optionsJson == null) return [];
  try {
    const parsed = JSON.parse(optionsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/**
 * Normalize incoming poll option texts before persisting: trim each option and
 * drop blank ones, optionally capping to `limit` options. Shared by the manual
 * poll-create and AI-generated poll routes in detail.ts.
 */
export function sanitizePollOptions(options: readonly string[], limit?: number): string[] {
  const cleaned = options.map((option) => option.trim()).filter(Boolean);
  return typeof limit === 'number' ? cleaned.slice(0, limit) : cleaned;
}
