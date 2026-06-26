import test from 'node:test';
import assert from 'node:assert/strict';

// theme.ts reads window.localStorage / window.matchMedia / document, so stub a
// minimal browser environment before importing (mirrors lib/viewerId.test.ts).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

const localStorage = new MemoryStorage();

// matchMedia stub whose result we can flip between tests.
let systemPrefersDark = false;
let changeHandler: (() => void) | null = null;
function matchMedia(query: string) {
  return {
    matches: query.includes('dark') ? systemPrefersDark : false,
    media: query,
    addEventListener: (_type: string, cb: () => void) => { changeHandler = cb; },
    removeEventListener: () => { changeHandler = null; },
  };
}

// minimal <html> stub recording class + dataset.
const classSet = new Set<string>();
const documentElement = {
  classList: {
    toggle: (cls: string, force?: boolean) => {
      const on = force ?? !classSet.has(cls);
      if (on) classSet.add(cls); else classSet.delete(cls);
      return on;
    },
  },
  dataset: {} as Record<string, string>,
};

(globalThis as { window?: unknown }).window = { localStorage, matchMedia };
(globalThis as { document?: unknown }).document = { documentElement };

const {
  THEME_STORAGE_KEY,
  normalizeThemePreference,
  getStoredThemePreference,
  setStoredThemePreference,
  getSystemTheme,
  resolveThemePreference,
  applyThemePreference,
  watchSystemThemeChange,
} = await import('./theme');

function reset() {
  localStorage.clear();
  systemPrefersDark = false;
  changeHandler = null;
  classSet.clear();
  for (const k of Object.keys(documentElement.dataset)) delete documentElement.dataset[k];
}

test('normalizeThemePreference accepts valid values and falls back otherwise', () => {
  assert.equal(normalizeThemePreference('system'), 'system');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('nonsense'), 'system');
  assert.equal(normalizeThemePreference(null), 'system');
  assert.equal(normalizeThemePreference(undefined, 'light'), 'light');
});

test('getStoredThemePreference defaults to system and reads stored value', () => {
  reset();
  assert.equal(getStoredThemePreference(), 'system');
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  assert.equal(getStoredThemePreference(), 'dark');
  localStorage.setItem(THEME_STORAGE_KEY, 'garbage');
  assert.equal(getStoredThemePreference(), 'system'); // bad value -> default
});

test('setStoredThemePreference persists the value', () => {
  reset();
  setStoredThemePreference('light');
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), 'light');
  assert.equal(getStoredThemePreference(), 'light');
});

test('getSystemTheme reflects matchMedia', () => {
  reset();
  assert.equal(getSystemTheme(), 'light');
  systemPrefersDark = true;
  assert.equal(getSystemTheme(), 'dark');
});

test('resolveThemePreference resolves explicit and system preferences', () => {
  reset();
  assert.equal(resolveThemePreference('light'), 'light');
  assert.equal(resolveThemePreference('dark'), 'dark');
  assert.equal(resolveThemePreference('system'), 'light'); // system + light OS
  systemPrefersDark = true;
  assert.equal(resolveThemePreference('system'), 'dark'); // system + dark OS
});

test('resolveThemePreference without arg uses stored preference', () => {
  reset();
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  assert.equal(resolveThemePreference(), 'dark');
});

test('applyThemePreference toggles dark class and sets data-theme', () => {
  reset();
  let result = applyThemePreference('dark');
  assert.equal(result, 'dark');
  assert.equal(classSet.has('dark'), true);
  assert.equal(documentElement.dataset.theme, 'dark');

  result = applyThemePreference('light');
  assert.equal(result, 'light');
  assert.equal(classSet.has('dark'), false);
  assert.equal(documentElement.dataset.theme, 'light');
});

test('applyThemePreference with system follows OS preference', () => {
  reset();
  systemPrefersDark = true;
  const result = applyThemePreference('system');
  assert.equal(result, 'dark');
  assert.equal(classSet.has('dark'), true);
  assert.equal(documentElement.dataset.theme, 'dark');
});

test('watchSystemThemeChange re-applies only while preference is system', () => {
  reset();
  localStorage.setItem(THEME_STORAGE_KEY, 'system');
  const seen: string[] = [];
  const stop = watchSystemThemeChange((resolved) => seen.push(resolved));

  // OS flips to dark and fires change -> should apply because pref is system
  systemPrefersDark = true;
  changeHandler?.();
  assert.deepEqual(seen, ['dark']);
  assert.equal(classSet.has('dark'), true);

  // user switches to explicit light; an OS change should now be ignored
  localStorage.setItem(THEME_STORAGE_KEY, 'light');
  systemPrefersDark = false;
  changeHandler?.();
  assert.deepEqual(seen, ['dark']); // unchanged

  stop();
  assert.equal(changeHandler, null);
});

test('helpers degrade gracefully without window/document', () => {
  const savedWindow = (globalThis as { window?: unknown }).window;
  const savedDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { window?: unknown }).window = undefined;
  (globalThis as { document?: unknown }).document = undefined;
  try {
    assert.equal(getStoredThemePreference(), 'system');
    assert.equal(getSystemTheme(), 'light');
    assert.equal(resolveThemePreference('dark'), 'dark');
    // applyThemePreference must not throw without document
    assert.equal(applyThemePreference('light'), 'light');
    // watch returns a no-op cleanup
    const stop = watchSystemThemeChange();
    assert.equal(typeof stop, 'function');
    stop();
  } finally {
    (globalThis as { window?: unknown }).window = savedWindow;
    (globalThis as { document?: unknown }).document = savedDoc;
  }
});
