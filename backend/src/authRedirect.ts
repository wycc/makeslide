const MAX_LENGTH = 2048;

/**
 * Validates a post-login redirect target the client asks the Google OAuth flow to return to
 * (e.g. `#/play/abc123?share=xyz`, captured from `window.location.hash` before the full-page
 * navigation to `/api/auth/google/start`). Only same-page hash-router paths are allowed — the
 * value is later concatenated onto our own origin (`${nbPrefix}/${target}`), never used as a
 * standalone URL, so this can't become an open redirect; the checks here just guard against
 * control characters that could smuggle extra headers into the redirect response.
 */
export function sanitizeOAuthRedirectTarget(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith('#/')) return null;
  if (/[\r\n\x00-\x1f]/.test(raw)) return null;
  return raw;
}
