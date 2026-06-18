const DEBUG_STORAGE_KEY = 'makeslide.debug';

function isDebugLoggingEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function debugLog(...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    // eslint-disable-next-line no-console
    console.info(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}
