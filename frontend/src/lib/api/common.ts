import type { ApiErrorBody } from '../../types';
import type { TranslationKey } from '../../i18n';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

let authRedirecting = false;

function maybeRedirectToGoogleLogin(resp: Response): void {
  if (typeof window === 'undefined') return;
  if (resp.status !== 401) return;
  if (authRedirecting) return;

  const path = window.location.pathname;
  if (path.includes('/api/auth/google/start')) return;

  authRedirecting = true;
  window.location.assign('api/auth/google/start');
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

export interface HumanReadableApiError {
  title: string;
  message: string;
  nextStep: string;
}

export const CREDIT_EXHAUSTED_ERROR_CODES = new Set([
  'CREDIT_EXHAUSTED',
  'CREDITS_EXHAUSTED',
  'INSUFFICIENT_CREDIT',
  'INSUFFICIENT_CREDITS',
  'ACCOUNT_CREDIT_EXHAUSTED',
  'BILLING_CREDIT_EXHAUSTED',
  'MODEL_QUOTA_EXCEEDED',
]);

export const CREDIT_EXHAUSTED_EVENT = 'makeslide:credit-exhausted';
export const API_KEY_REQUIRED_EVENT = 'makeslide:api-key-required';

export interface CreditExhaustedEventDetail {
  code: string;
  status: number;
}

export interface ApiKeyRequiredEventDetail {
  code: string;
  status: number;
}

export function isCreditExhaustedError(err: unknown): err is ApiError {
  return err instanceof ApiError && CREDIT_EXHAUSTED_ERROR_CODES.has(err.code);
}

export function isApiKeyMissingError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'API_KEY_MISSING';
}

/**
 * True for the 409 `INVALID_STATE` conflict `POST /api/pdfs/:id/start` returns once a PDF
 * has moved past `awaiting_prompt`/`uploaded`/`failed`. A dropped/slow first request that the
 * client retries can hit this even though the original request already succeeded, so callers
 * should treat it as a benign no-op (the PDF is already processing or done) rather than a
 * failure that should be shown to the user as an error to retry.
 */
export function isAlreadyProcessingConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.code === 'INVALID_STATE';
}

export function notifyCreditExhausted(err: ApiError): void {
  if (typeof window === 'undefined' || !isCreditExhaustedError(err)) return;
  // Dispatch only the code/status; the dialog (which has the i18n context)
  // resolves the human-readable title/message/nextStep via
  // mapApiErrorToHumanMessage so the text follows the UI language.
  window.dispatchEvent(new CustomEvent<CreditExhaustedEventDetail>(CREDIT_EXHAUSTED_EVENT, {
    detail: {
      code: err.code,
      status: err.status,
    },
  }));
}

export function notifyApiKeyRequired(err: ApiError): void {
  if (typeof window === 'undefined' || !isApiKeyMissingError(err)) return;
  window.dispatchEvent(new CustomEvent<ApiKeyRequiredEventDetail>(API_KEY_REQUIRED_EVENT, {
    detail: {
      code: err.code,
      status: err.status,
    },
  }));
}

interface ApiErrorHintKeys {
  title: TranslationKey;
  message: TranslationKey;
  nextStep: TranslationKey;
}

const RESOURCE_NOT_FOUND_HINT_KEYS: ApiErrorHintKeys = {
  title: 'apiError.resourceNotFound.title',
  message: 'apiError.resourceNotFound.message',
  nextStep: 'apiError.resourceNotFound.nextStep',
};

function hintKeys(name: string): ApiErrorHintKeys {
  return {
    title: `apiError.${name}.title` as TranslationKey,
    message: `apiError.${name}.message` as TranslationKey,
    nextStep: `apiError.${name}.nextStep` as TranslationKey,
  };
}

export const ERROR_HINT_KEYS: Record<string, ApiErrorHintKeys> = {
  INVALID_REQUEST: hintKeys('invalidRequest'),
  INVALID_UPLOAD_TYPE: hintKeys('invalidUploadType'),
  FILE_REQUIRED: hintKeys('fileRequired'),
  FILE_TOO_LARGE: hintKeys('fileTooLarge'),
  INVALID_URL: hintKeys('invalidUrl'),
  API_KEY_MISSING: hintKeys('apiKeyMissing'),
  CREDIT_EXHAUSTED: hintKeys('creditExhausted'),
  CREDITS_EXHAUSTED: hintKeys('creditExhausted'),
  INSUFFICIENT_CREDIT: hintKeys('insufficientCredit'),
  INSUFFICIENT_CREDITS: hintKeys('insufficientCredit'),
  ACCOUNT_CREDIT_EXHAUSTED: hintKeys('creditExhausted'),
  BILLING_CREDIT_EXHAUSTED: hintKeys('billingCreditExhausted'),
  MODEL_QUOTA_EXCEEDED: hintKeys('modelQuotaExceeded'),
  MODEL_UNAVAILABLE: hintKeys('modelUnavailable'),
  DEPENDENCY_MISSING: hintKeys('dependencyMissing'),
  POPPLER_NOT_FOUND: hintKeys('popplerNotFound'),
  PDF_NOT_FOUND: hintKeys('pdfNotFound'),
  PAGE_NOT_FOUND: hintKeys('pageNotFound'),
  NOT_FOUND: RESOURCE_NOT_FOUND_HINT_KEYS,
  RESOURCE_NOT_FOUND: hintKeys('resourceNotReady'),
  INVALID_STATE: hintKeys('invalidState'),
  JOB_CONFLICT: hintKeys('jobConflict'),
  INTERNAL_ERROR: hintKeys('internalError'),
};

export type ApiErrorTranslator = (key: TranslationKey) => string;

export function mapApiErrorToHumanMessage(err: unknown, t: ApiErrorTranslator): HumanReadableApiError {
  const fromKeys = (keys: ApiErrorHintKeys): HumanReadableApiError => ({
    title: t(keys.title),
    message: t(keys.message),
    nextStep: t(keys.nextStep),
  });
  if (err instanceof ApiError) {
    const found = ERROR_HINT_KEYS[err.code];
    if (found) return fromKeys(found);
    // Many backend "X not found" codes (QUIZ_NOT_FOUND, POLL_NOT_FOUND,
    // FIGURE_NOT_FOUND, …) carry only English messages and have no dedicated
    // hint; surface the generic resource-not-found message instead of the raw
    // English text. Codes with a dedicated hint above are unaffected.
    if (err.code.endsWith('_NOT_FOUND')) return fromKeys(RESOURCE_NOT_FOUND_HINT_KEYS);
    return { title: t('apiError.requestFailed.title'), message: err.message, nextStep: t('apiError.requestFailed.nextStepRetry') };
  }
  if (err instanceof Error) {
    return { title: t('apiError.requestFailed.title'), message: err.message, nextStep: t('apiError.requestFailed.nextStepNetwork') };
  }
  return {
    title: t('apiError.unknownError.title'),
    message: t('apiError.unknownError.message'),
    nextStep: t('apiError.unknownError.nextStep'),
  };
}

export async function parseErrorBody(resp: Response): Promise<ApiError> {
  maybeRedirectToGoogleLogin(resp);
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    // ignore
  }
  if (isApiErrorBody(body)) {
    const err = new ApiError(body.error.message, body.error.code, resp.status);
    notifyCreditExhausted(err);
    notifyApiKeyRequired(err);
    return err;
  }
  const err = new ApiError(`HTTP ${resp.status}`, 'HTTP_ERROR', resp.status);
  notifyCreditExhausted(err);
  return err;
}
