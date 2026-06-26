/**
 * Shared sanitizer for the user's free-text prompt before it is embedded into an
 * LLM system prompt (title and script generation). Trims and caps the length so
 * an over-long prompt can't blow up the system prompt; previously duplicated
 * verbatim in generateTitle.ts and generateScript.ts.
 */
export const MAX_USER_PROMPT_CHARS_IN_SYSTEM = 2000;

export function sanitiseUserPrompt(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_USER_PROMPT_CHARS_IN_SYSTEM
    ? trimmed.slice(0, MAX_USER_PROMPT_CHARS_IN_SYSTEM) + '……（已截斷）'
    : trimmed;
}
