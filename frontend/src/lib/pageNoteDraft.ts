// 頁面備註（Markdown）編輯草稿的純邏輯：正規化、是否有未存變更、超長截斷。
// 側邊欄與全螢幕兩處編輯器共用同一份規則，才不會「側邊欄存得進去、全螢幕存不進去」。

import { MAX_PAGE_NOTE_LENGTH } from './noteLimits';

/**
 * 備註內容的正規化：統一換行為 `\n`（貼上 Windows 或舊 Mac 來源的內容時會混入
 * `\r\n`／`\r`，留著會讓 Markdown 的段落判斷與「有沒有改動」的比較都不準），
 * 並去掉整份文件前後的空白。刻意**不動行尾空白與段落間的空行**——行尾兩個空白是
 * Markdown 的硬換行、空行是段落分隔，清掉就是在改使用者寫的文件。
 */
export function normalizePageNote(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/** 草稿與已儲存內容相比是否真的有變更（兩邊都先正規化，避免只差空白就送出請求）。 */
export function isPageNoteDirty(draft: string, saved: string | null | undefined): boolean {
  return normalizePageNote(draft) !== normalizePageNote(saved ?? '');
}

/**
 * 截到上限之內。`<textarea maxLength>` 擋得住鍵盤輸入，但擋不住程式化塞入的內容
 * （例如貼上一整份文件、或未來由 AI 產生備註），送出前再收斂一次以免後端回 400。
 */
export function clampPageNote(text: string, max: number = MAX_PAGE_NOTE_LENGTH): string {
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  return text.length <= limit ? text : text.slice(0, limit);
}
