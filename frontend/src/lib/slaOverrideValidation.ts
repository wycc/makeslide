export interface SlaBoundsMs {
  min_ms: number;
  max_ms: number;
}

export type SlaOverrideValidationResult =
  | { ok: true; targetMs: number | null }
  | { ok: false; reason: 'invalid-number' | 'out-of-range'; minSeconds?: number; maxSeconds?: number };

export function validateSlaOverrideSecondsInput(rawInput: string, bounds?: SlaBoundsMs | null): SlaOverrideValidationResult {
  const raw = rawInput.trim();
  if (raw === '') {
    return { ok: true, targetMs: null };
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) {
    return { ok: false, reason: 'invalid-number' };
  }

  const targetMs = Math.round(seconds * 1000);
  if (bounds && (targetMs < bounds.min_ms || targetMs > bounds.max_ms)) {
    return {
      ok: false,
      reason: 'out-of-range',
      minSeconds: bounds.min_ms / 1000,
      maxSeconds: bounds.max_ms / 1000,
    };
  }

  return { ok: true, targetMs };
}

export function formatSlaOverrideRangeMessage(template: string, minSeconds: number, maxSeconds: number): string {
  return template.replace('{min}', String(minSeconds)).replace('{max}', String(maxSeconds));
}
