/**
 * BreezeTTS 2's vocal events — sounds written into the text itself, performed rather than read.
 *
 * From the model card (huggingface.co/BreezeBlue/Breeze-TTS-2, "Vocal Events"): English uses
 * parentheses — `(laugh)`, `(cough)`, `(clears throat)`, `(sigh)` — and Chinese uses square
 * brackets — `[笑]`, `[咳嗽]`, `[清嗓子]`, `[叹气]`. The Chinese set is in *simplified* characters;
 * a zh-TW script will naturally write 嘆氣, which is not a tag the model knows, so it is rewritten
 * to the trained form before synthesis.
 *
 * The tags only mean something to Breeze. Every other engine reads them out ("括號笑括號"), and a
 * page keeps its script when the TTS setting changes later — so they are removed for any other
 * provider, and never shown in subtitles.
 */
import type { TtsProvider } from './aiSettings';
import { isBreezeTtsFamily } from './audiocpp';

export const BREEZE_VOCAL_EVENTS_ZH = ['笑', '咳嗽', '清嗓子', '叹气'] as const;
export const BREEZE_VOCAL_EVENTS_EN = ['laugh', 'cough', 'clears throat', 'sigh'] as const;

/** Traditional spellings a zh-TW script produces, mapped onto the tag the model was trained on. */
const ZH_TRADITIONAL: Readonly<Record<string, string>> = { 嘆氣: '叹气' };

// Full-width brackets included: a Chinese model writing Chinese text reaches for them.
const ZH_TAG_RE = /[[［【]\s*(笑|咳嗽|清嗓子|叹气|嘆氣)\s*[\]］】]/g;
const EN_TAG_RE = /[(（]\s*(laugh|cough|clears throat|sigh)\s*[)）]/gi;

/** Every tag in the exact form Breeze was trained on. */
export function normalizeBreezeVocalEvents(text: string): string {
  return text
    .replace(ZH_TAG_RE, (_m, word: string) => `[${ZH_TRADITIONAL[word] ?? word}]`)
    .replace(EN_TAG_RE, (_m, word: string) => `(${word.toLowerCase()})`);
}

/** The text with every vocal event removed — for any engine but Breeze, and for display. */
export function stripBreezeVocalEvents(text: string): string {
  return text
    .replace(ZH_TAG_RE, '')
    .replace(EN_TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([，。！？、；：,.!?;:])/g, '$1')
    .trim();
}

/** Whether the configured TTS is BreezeTTS 2 on audio.cpp. */
export function isBreezeTtsActive(runtime: { ttsProvider: string; audiocppTtsFamily: string }): boolean {
  return runtime.ttsProvider === 'audiocpp' && isBreezeTtsFamily(runtime.audiocppTtsFamily);
}

/**
 * The text a given engine should receive.
 *
 * Decided per provider at the point of synthesis, not once per page: a page that fails over from
 * Breeze to a hosted provider must not hand that provider the tags.
 */
export function vocalEventsForProvider(text: string, provider: TtsProvider, audiocppFamily: string): string {
  return provider === 'audiocpp' && isBreezeTtsFamily(audiocppFamily)
    ? normalizeBreezeVocalEvents(text)
    : stripBreezeVocalEvents(text);
}

/**
 * What a script prompt says about vocal events when Breeze will read the script.
 *
 * Only the language's own set is listed: offering both invites an English tag in a Chinese script,
 * which Breeze ignores. Sparing on purpose — a narration that laughs every other sentence is worse
 * than one that never does.
 */
export function breezeVocalEventsInstruction(language: string): string {
  const english = language.trim().toLowerCase().startsWith('en');
  const tags = english
    ? BREEZE_VOCAL_EVENTS_EN.map((t) => `(${t})`).join('、')
    : BREEZE_VOCAL_EVENTS_ZH.map((t) => `[${t}]`).join('、');
  const examples = english
    ? '例如輕鬆的比喻或自嘲之後 (laugh)、要講重點之前 (clears throat)、提到常見錯誤時 (sigh)'
    : '例如輕鬆的比喻或自嘲之後 [笑]、要講重點之前 [清嗓子]、提到常見錯誤時 [叹气]';
  return [
    '【聲音事件標記（這份簡報由 BreezeTTS 2 朗讀）】',
    `朗讀引擎會把下列標記演成真的聲音，而不是唸出來：${tags}`,
    `請在真正適合的地方自然地使用，讓講解更像真人：${examples}。`,
    '- 整頁最多一到兩個，大多數段落不需要任何標記，寧缺勿濫；',
    '- 標記必須逐字照上面的寫法（包括括號種類與簡體字），直接放在聲音發生的位置；',
    '- 不要自創其他標記，也不要在標記前後加引號或其他符號。',
  ].join('\n');
}
