/**
 * TTS 模型會被 provider 直接下架，而模型名是使用者設定裡的一個字串。
 *
 * OpenRouter 在 2026 年把 Google 的 Gemini 2.5 TTS 預覽模型下架，換成
 * `google/gemini-3.1-flash-tts-preview`（2026-04 發布）。舊名不是變慢或降級，而是整個不存在
 * ——`POST /api/v1/audio/speech` 回 `400 Model google/gemini-2.5-flash-preview-tts does not
 * exist`，於是每一頁的語音都失敗。設定裡存著舊名的帳號自己不會好，改預設值也救不到他們
 * （那個欄位有值就不會用預設），所以送出請求前把已知的舊名換成現行的。
 *
 * 只列**已經證實不存在**的模型：這是在改使用者的設定，猜測沒有位置。Google 直連的
 * `gemini-2.5-flash-preview-tts` 沒有列在這裡——Google 的 release notes 至今沒有說它退役，
 * 而換掉一個還能用的模型會無故改變旁白的音色。
 */
const RETIRED_TTS_MODELS: Readonly<Record<string, string>> = {
  // OpenRouter，2026-09-06 實測：舊名 400 does not exist，新名 200 audio/pcm。
  'google/gemini-2.5-flash-preview-tts': 'google/gemini-3.1-flash-tts-preview',
  'google/gemini-2.5-pro-preview-tts': 'google/gemini-3.1-flash-tts-preview',
};

/** OpenRouter 目前實際可用的 Gemini TTS 模型；也是 `OPENROUTER_TTS_MODEL` 的預設值。 */
export const OPENROUTER_DEFAULT_TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';

/** 這個模型名是否已被 provider 下架。 */
export function isRetiredTtsModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETIRED_TTS_MODELS, model.trim());
}

/**
 * 換掉已下架的模型名，其餘原樣回傳。
 *
 * 空字串照樣回空字串——那代表「沿用預設」，不是一個模型名。
 */
export function currentTtsModel(model: string | null | undefined): string {
  const trimmed = (model ?? '').trim();
  if (!trimmed) return trimmed;
  return RETIRED_TTS_MODELS[trimmed] ?? trimmed;
}

/**
 * 這個模型被換成了什麼，沒被換就是 null。
 *
 * 給要記 log 的呼叫端用。這個模組刻意不碰 logger——`config` 會 import 它拿預設模型名，而
 * logger 又 import config，接上就是一圈循環引用。
 */
export function retiredTtsModelReplacement(model: string | null | undefined): string | null {
  const trimmed = (model ?? '').trim();
  if (!trimmed) return null;
  return RETIRED_TTS_MODELS[trimmed] ?? null;
}

/**
 * 補一句可操作的說明給「模型不存在」這類錯誤。
 *
 * provider 回的 `400 Model … does not exist` 精確但沒有出路：使用者看不出該把那個欄位改成
 * 什麼，也不知道問題出在設定而不是金鑰或額度。訊息會一路顯示到頁面上的失敗原因。
 */
export function ttsModelErrorHint(params: { provider: string; model: string; message: string }): string {
  const looksLikeMissingModel = /does not exist|model_not_found|no such model|unknown model/i.test(params.message);
  if (!looksLikeMissingModel) return params.message;
  const suggestion = params.provider === 'openrouter' ? `（目前可用：${OPENROUTER_DEFAULT_TTS_MODEL}）` : '';
  return `${params.message}｜「${params.model}」這個模型 ${params.provider} 已經沒有了，請到設定頁改成現行的模型${suggestion}`;
}
