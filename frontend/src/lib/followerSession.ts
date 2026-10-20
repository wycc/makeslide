/**
 * 追隨者（學生）這個分頁的同步狀態記憶（使用者回報，2026-10-20）。
 *
 * PlayPage 只在「全螢幕跟隨」模式下才會把學生自動導進進行中的測驗，而全螢幕跟隨原本只靠網址上的
 * `?share=`（分享連結）或 `?fullscreen=1`；學生從測驗頁按返回、或自己打開沒帶參數的簡報網址，就停在
 * 一般檢視，不會被導回測驗。這裡用 sessionStorage 記住「這個分頁是全螢幕跟隨的學生」與分享 token，
 * 之後回到簡報頁即使網址沒帶參數也照樣自動全螢幕、自動導回測驗。sessionStorage 是分頁層級，
 * 老師自己的另一個分頁不受影響。
 */
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const FULLSCREEN_PREFIX = 'makeslide.sync.followerFullscreen.';
const SHARE_TOKEN_PREFIX = 'makeslide.sync.shareToken.';

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch {
    /* 存取被拒：當作沒有記憶 */
  }
  return null;
}

function read(key: string, storage?: StorageLike): string {
  const store = resolveStorage(storage);
  if (!store) return '';
  try {
    return store.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string | null, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** 這個分頁是否曾以全螢幕跟隨進入測驗。 */
export function readFollowerFullscreen(pdfId: string, storage?: StorageLike): boolean {
  return Boolean(pdfId) && read(FULLSCREEN_PREFIX + pdfId, storage) === '1';
}

/** PlayPage 把學生導進測驗頁時記下；回到簡報頁即使網址沒帶 `?fullscreen=1` 也自動全螢幕。 */
export function markFollowerFullscreen(pdfId: string, storage?: StorageLike): void {
  if (pdfId) write(FULLSCREEN_PREFIX + pdfId, '1', storage);
}

/** 使用者自己退出全螢幕時清掉，重新整理不再自動進入。 */
export function clearFollowerFullscreen(pdfId: string, storage?: StorageLike): void {
  if (pdfId) write(FULLSCREEN_PREFIX + pdfId, null, storage);
}

/** 網址帶 `?share=` 時記住，之後同一分頁打開沒帶 token 的網址仍視為分享連結進入（鎖定全螢幕、可 share-join）。 */
export function rememberShareToken(pdfId: string, token: string, storage?: StorageLike): void {
  if (pdfId && token) write(SHARE_TOKEN_PREFIX + pdfId, token, storage);
}

export function readShareToken(pdfId: string, storage?: StorageLike): string {
  return pdfId ? read(SHARE_TOKEN_PREFIX + pdfId, storage) : '';
}
