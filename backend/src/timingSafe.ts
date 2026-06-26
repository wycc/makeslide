import crypto from 'node:crypto';

/**
 * Constant-time string equality, used for comparing secrets/signatures (session
 * HMACs, OAuth state, MCP bearer tokens) so a match can't be inferred from how
 * long the comparison takes. Single source of truth — previously copied verbatim
 * across server.ts, routes/auth.ts and services/aiSettings.ts, where any drift
 * could have silently reintroduced a timing side channel.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
