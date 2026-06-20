export class ApiKeyMissingError extends Error {
  readonly code = 'API_KEY_MISSING';
  readonly provider: string;

  constructor(provider: string, message?: string) {
    super(message ?? `${provider} API key is not set. Configure it in AI settings and retry.`);
    this.name = 'ApiKeyMissingError';
    this.provider = provider;
  }
}

export function isApiKeyMissingError(err: unknown): err is ApiKeyMissingError {
  return err instanceof ApiKeyMissingError || (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'API_KEY_MISSING');
}
