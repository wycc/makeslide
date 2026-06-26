// Theme 偏好基礎設施（前端 MVP，不動後端資料模型）。
//
// 三種偏好：`system`（跟隨瀏覽器 prefers-color-scheme，預設）、`light`、`dark`。
// 使用者選擇寫入 localStorage；套用時在 <html> 加上 `class="dark"`（給 Tailwind
// dark: variant 用）與 `data-theme` 屬性（給 CSS variables 切換用）。localStorage /
// window / document 的存取都做非瀏覽器環境（SSR、測試）防護，與 i18n.ts、viewerId.ts
// 的慣例一致。
//
// 後續的 CSS token 化、設定頁 UI、啟動前防白閃會建立在這層之上。

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'makeslide.theme';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** 將任意值收斂成合法的 ThemePreference；無法辨識時回 fallback（預設 `system`）。 */
export function normalizeThemePreference(value: unknown, fallback: ThemePreference = 'system'): ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark' ? value : fallback;
}

/** 讀取儲存的偏好；未設定或壞值時回 `system`。 */
export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined' || !window.localStorage) return 'system';
  return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
}

/** 寫入偏好（非瀏覽器環境為 no-op）。 */
export function setStoredThemePreference(pref: ThemePreference): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(THEME_STORAGE_KEY, pref);
}

/** 目前系統（瀏覽器）的色彩偏好；無 matchMedia 時保守回 `light`。 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

/**
 * 把偏好解析成實際要套用的 light/dark。`system` 會依瀏覽器目前設定決定；
 * 省略參數時讀取已儲存的偏好。
 */
export function resolveThemePreference(pref: ThemePreference = getStoredThemePreference()): ResolvedTheme {
  return pref === 'system' ? getSystemTheme() : pref;
}

/**
 * 解析偏好並套用到 <html>：切換 `dark` class 與設定 `data-theme` 屬性。
 * 回傳實際套用的 ResolvedTheme，方便呼叫端同步狀態。
 */
export function applyThemePreference(pref: ThemePreference = getStoredThemePreference()): ResolvedTheme {
  const resolved = resolveThemePreference(pref);
  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.dataset.theme = resolved;
  }
  return resolved;
}

/**
 * 監聽瀏覽器 prefers-color-scheme 變化；只有在偏好為 `system` 時才重新套用，
 * 並透過 onChange 回報新的 ResolvedTheme。回傳取消監聽的函式。
 * 非瀏覽器環境回 no-op cleanup。
 */
export function watchSystemThemeChange(onChange?: (resolved: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DARK_MEDIA_QUERY);
  const handler = () => {
    if (getStoredThemePreference() !== 'system') return;
    const resolved = applyThemePreference('system');
    onChange?.(resolved);
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
