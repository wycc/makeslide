// 跨 session 持久化的匿名訪客識別碼，用於回報觀看進度（與 sync 用的「每個分頁唯一」
// client_id 概念不同：這裡需要「同一個瀏覽器再次造訪也算同一人」，所以存在 localStorage
// 而不是 sessionStorage）。產生方式沿用專案既有的 voterId/client_id 隨機字串模式
// （見 usePagePolls.ts 的 makeslide.poll.voterId），不額外引入新的相依套件。
const STORAGE_KEY = 'makeslide.viewer.id';

export function getOrCreateViewerId(): string {
  const next = `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Guard for non-browser environments (SSR, tests), consistent with i18n.ts.
  if (typeof window === 'undefined' || !window.localStorage) return next;
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  window.localStorage.setItem(STORAGE_KEY, next);
  return next;
}
