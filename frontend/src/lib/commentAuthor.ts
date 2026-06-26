// 記住上次留言的暱稱（localStorage，含非瀏覽器環境防護）。
// 慣例沿用 i18n.ts / viewerId.ts 的 `typeof window` 檢查。

const COMMENT_AUTHOR_KEY = 'makeslide.comment.author';
// 對齊評論作者輸入框的 maxLength。
const MAX_LEN = 80;

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/** 讀取上次儲存的暱稱；未設定、壞值或非瀏覽器環境回空字串。 */
export function getStoredCommentAuthor(): string {
  if (!hasLocalStorage()) return '';
  try {
    const raw = window.localStorage.getItem(COMMENT_AUTHOR_KEY);
    return typeof raw === 'string' ? raw.trim().slice(0, MAX_LEN) : '';
  } catch {
    return '';
  }
}

/**
 * 儲存暱稱（trim 後上限 MAX_LEN）。空白則移除既有紀錄。非瀏覽器環境為 no-op。
 */
export function setStoredCommentAuthor(name: string): void {
  if (!hasLocalStorage()) return;
  const cleaned = name.trim().slice(0, MAX_LEN);
  try {
    if (cleaned) {
      window.localStorage.setItem(COMMENT_AUTHOR_KEY, cleaned);
    } else {
      window.localStorage.removeItem(COMMENT_AUTHOR_KEY);
    }
  } catch {
    // 寫入失敗（如配額/隱私模式）時靜默忽略。
  }
}
