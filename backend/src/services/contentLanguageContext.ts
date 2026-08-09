/**
 * 「這一段工作要用哪一種產生語言」的情境層。
 *
 * 產生語言原本只有帳號層級一份（settings.env 的 CONTENT_LANGUAGE），於是同一個帳號
 * 底下的每一份簡報都被綁在同一種語言上。改成每份簡報各自可設之後，問題是：讀語言的
 * 地方散落在整條管線裡（generateScript／generateTitle／generateDescription／圖片提示／
 * TTS…），逐層把 language 參數傳下去要動幾十個函式簽章。
 *
 * 因此比照 accountContext 的做法：用 AsyncLocalStorage 疊一層覆蓋值，
 * {@link getRuntimeAiSettings} 讀 contentLanguage 時會先看這一層。管線／重生／
 * 加頁的進入點，以及帶 :id 的 HTTP 請求，都會在起點進入該簡報的語言情境
 * （見 services/deckContentLanguage.ts），底下的所有既有呼叫因此自動拿到正確語言。
 *
 * 這一層刻意不 import db —— aiSettings 會 import 它，而 db 那一側會 import aiSettings，
 * 直接讀 DB 會繞成循環相依。查簡報語言的部分放在 deckContentLanguage.ts。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppLanguage } from './aiSettings';

const storage = new AsyncLocalStorage<AppLanguage>();

/**
 * 在指定產生語言的情境中執行 fn；fn 內（含其觸發的非同步操作）呼叫
 * getRuntimeAiSettings() 拿到的 contentLanguage 都會是這個語言。
 * language 為 null／undefined 時直接執行 fn，不建立情境——代表「沿用帳號設定」。
 */
export function runWithContentLanguage<T>(language: AppLanguage | null | undefined, fn: () => T): T {
  if (!language) return fn();
  return storage.run(language, fn);
}

/** 目前情境的產生語言覆蓋值；不在任何簡報情境中時回傳 null（= 沿用帳號設定）。 */
export function currentContentLanguageOverride(): AppLanguage | null {
  return storage.getStore() ?? null;
}
