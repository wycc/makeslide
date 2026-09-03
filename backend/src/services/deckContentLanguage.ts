/**
 * 每份簡報自己的產生語言：查詢、正規化，以及「在這份簡報的語言情境中執行」。
 *
 * `pdfs.content_language` 為 NULL 代表沿用帳號設定（舊資料一律如此），所以這裡
 * 查不到值時回傳 null，讓 {@link runWithDeckContentLanguage} 直接不建立覆蓋情境。
 */
import { db } from '../db';
import type { AppLanguage } from './aiSettings';
import { runWithContentLanguage } from './contentLanguageContext';

/** 把任意輸入正規化成支援的產生語言；無法辨識時回傳 null。 */
export function normalizeContentLanguage(value: unknown): AppLanguage | null {
  return value === 'en' ? 'en' : value === 'zh-TW' ? 'zh-TW' : null;
}

/** 這份簡報自己設定的產生語言；沒設（或簡報不存在）時回傳 null = 沿用帳號設定。 */
export function getDeckContentLanguage(pdfId: string): AppLanguage | null {
  const row = db
    .prepare(`SELECT content_language FROM pdfs WHERE id = ?`)
    .get(pdfId) as { content_language?: string | null } | undefined;
  return normalizeContentLanguage(row?.content_language);
}

/**
 * 在 `pdfId` 的產生語言情境中執行 fn。管線、重生、加頁等背景工作，以及帶 :id 的
 * HTTP 請求都經過這裡，底下所有讀 `getRuntimeAiSettings().contentLanguage` 的既有
 * 程式碼因此自動使用這份簡報的語言。
 */
export function runWithDeckContentLanguage<T>(pdfId: string, fn: () => T): T {
  return runWithContentLanguage(getDeckContentLanguage(pdfId), fn);
}
