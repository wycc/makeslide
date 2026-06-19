/**
 * Max length (chars) for prompt-to-outline input, matching the backend
 * `MAX_PROMPT_TO_OUTLINE_CHARS` used by `POST /api/prompt-text`.
 */
export const MAX_PROMPT_TO_OUTLINE_CHARS = 128 * 1024;

/**
 * The textarea should not impose a stricter browser-side cap than the API.
 */
export const PROMPT_TO_OUTLINE_TEXTAREA_MAX_CHARS = MAX_PROMPT_TO_OUTLINE_CHARS;
