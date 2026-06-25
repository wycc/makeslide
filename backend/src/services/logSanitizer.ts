const REDACTED = '[redacted]';
const LARGE_CONTENT_REDACTED = '[redacted-large-content]';

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|authorization|bearer|token|secret|password|raw[_-]?content|rawContent|prompt|system|userPrompt|input|text|script|payload|b64_json|base64|hex|audio|buffer|dataUrl|url)$/iu;
const SAFE_METADATA_KEYS = new Set([
  'attempt',
  'bytes',
  'chars',
  'code',
  'count',
  'detail',
  'durationSeconds',
  'error',
  'file',
  'finishReason',
  'hasB64Json',
  'hasImage',
  'hasUrl',
  'label',
  'latencyMs',
  'maxAttempts',
  'maxTokens',
  'message',
  'model',
  'pageCount',
  'pageNumber',
  'pdfId',
  'promptLength',
  'quality',
  'requestId',
  'responseShape',
  'reused',
  'size',
  'stage',
  'status',
  'timeoutMs',
  'total_tokens',
  'type',
  'usage',
  'voice',
]);

const API_KEY_VALUE_PATTERN = /\b(?:sk|sk-proj|sk-ant|AIza)[A-Za-z0-9_\-]{16,}\b/g;
const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/gi;
// Credentials embedded in a URL, e.g. the https://x-access-token:<token>@github.com
// remote presentationGit builds for GitHub pushes — redact the user:secret part
// (any token shape) while keeping the scheme/host for debugging.
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
// GitHub personal access tokens (classic gh*_ and fine-grained github_pat_), which
// the generic API-key pattern above does not match.
const GITHUB_TOKEN_PATTERN = /\b(?:gh[opsru]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g;
const DATA_URL_PATTERN = /data:[^;,]+;base64,[A-Za-z0-9+/=]{64,}/gi;
const LONG_HEX_PATTERN = /\b(?:[a-f0-9]{2}){64,}\b/gi;
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{256,}={0,2}\b/g;
const LARGE_STRING_LIMIT = 256;

export interface RedactedTextSummary {
  redacted: true;
  chars: number;
  preview?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeString(value: string): string {
  let out = value
    .replace(DATA_URL_PATTERN, LARGE_CONTENT_REDACTED)
    .replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`)
    .replace(BEARER_VALUE_PATTERN, `Bearer ${REDACTED}`)
    .replace(API_KEY_VALUE_PATTERN, REDACTED)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(LONG_HEX_PATTERN, LARGE_CONTENT_REDACTED)
    .replace(LONG_BASE64_PATTERN, LARGE_CONTENT_REDACTED);
  if (out.length > LARGE_STRING_LIMIT) {
    out = `${out.slice(0, LARGE_STRING_LIMIT)}…[truncated chars=${value.length}]`;
  }
  return out;
}

function redactTextSummary(value: unknown): RedactedTextSummary | string | null {
  if (typeof value !== 'string') return REDACTED;
  const sanitized = sanitizeString(value);
  if (value.length > 20) {
    return { redacted: true, chars: value.length };
  }
  return {
    redacted: true,
    chars: value.length,
    ...(sanitized && sanitized.length <= 120 ? { preview: sanitized } : {}),
  };
}

export function redactLogValue(value: unknown, keyHint = '', depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_PATTERN.test(keyHint) && !SAFE_METADATA_KEYS.has(keyHint)) {
      return redactTextSummary(value);
    }
    return sanitizeString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return { redacted: true, bytes: value.byteLength, type: 'Buffer' };
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return { redacted: true, bytes: value.byteLength, type: value.constructor.name };
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }
  if (depth >= 6) return '[redacted-depth-limit]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactLogValue(item, keyHint, depth + 1));
  }
  if (!isPlainObject(value)) return String(value);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && !SAFE_METADATA_KEYS.has(key)) {
      out[key] = redactTextSummary(item);
      continue;
    }
    out[key] = redactLogValue(item, key, depth + 1);
  }
  return out;
}

export function redactLogObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return redactLogValue(value) as Record<string, unknown>;
}

export function redactPromptForLog(value: string | null | undefined): RedactedTextSummary | null {
  if (!value) return null;
  return redactTextSummary(value) as RedactedTextSummary;
}

export function redactTextForLog(value: string | null | undefined): RedactedTextSummary | null {
  if (!value) return null;
  return redactTextSummary(value) as RedactedTextSummary;
}
