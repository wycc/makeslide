// 由逐字稿估算朗讀長度：要唸的單位有多少，以及大約唸多久（共用純函式）。
//
// 抽自 `PlayPageSlidePanel` 逐字稿編輯區的即時預估內聯邏輯（`Math.round(chars/4)` 再手動組
// `mm:ss`）。原本的假設是「一個字元 ≈ 一個音節」——中文成立，英文完全不成立：英文一個字平均
// 五、六個字元，所以同一段話的字元數大約是中文的三倍，除以同一個 4 之後估出來的時間也就大約
// 是實際的三、四倍（使用者回報：2499 字 → 10:25，實際約兩分半）。
//
// 所以計數改為「照文字自己的語言」：CJK 逐字、拉丁逐詞，兩邊各用自己的語速再相加。判斷依據是
// 文字本身而不是簡報的輸出語言設定——這一列講的是「編輯框裡這一段」有多長，單頁被改寫成另一
// 個語言時也要對；中英夾雜（英文講稿裡的中文書名、中文講稿裡的專有名詞）自然就是兩邊各算各的。

/** 中文語速：每秒約 4 個字（沿用原本的估算，這一半沒有問題）。 */
export const CJK_CHARS_PER_SECOND = 4;

/**
 * 英文語速：每分鐘 140 個字。
 *
 * 與後端把「逐字稿長度目標」在兩種語言間換算時用的數字一致（見 backend 的
 * `contentLanguage.ts`：約 270 字/分、140 words/分），所以「要求多長」與「估計多久」不會各
 * 說各話。
 */
export const WORDS_PER_MINUTE = 140;
const WORDS_PER_SECOND = WORDS_PER_MINUTE / 60;

/** 判定顯示單位時，另一種文字要佔到多少秒數才值得一起顯示。 */
const MIXED_UNIT_THRESHOLD = 0.1;

// 送進 TTS 前會被拿掉、不會被唸出來的東西；算進長度只會讓兩個數字都偏大。與後端
// `synthesizeAudio.ts` 的 `stripSpokenToneTags`／`splitByToneMarkers`／`splitSpeakerPrefix`
// 對齊：[[ 語氣 ]]、舊版 {{ 語氣 }}、Gemini 的單括號英文標籤，以及行首的講者標籤。
const TONE_MARKER_RE = /\[\[[^\]]*\]\]/g;
const LEGACY_BRACE_TONE_RE = /\{\{[^{}]*\}\}/g;
const INLINE_TONE_TAG_RE = /\[[A-Za-z][A-Za-z ]*\]/g;
const SPEAKER_LABEL_RE = /(^|\n)\s*Speaker\s*[12]\s*[:：]\s*/gi;

// CJK 表意文字、假名，與全形標點——中文的標點也佔朗讀時間（停頓），且原本的字元數就含它們。
const CJK_RE = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60]/g;
// 一個「英文字」：字母或數字開頭，可含撇號、連字號與小數點，所以 "541"、"3.5"、"don't"、
// "state-of-the-art" 各算一個。
const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’.-]*/g;

/** 顯示用的單位：只有中文、只有英文、或兩種都值得寫出來。 */
export type SpeechUnit = 'chars' | 'words' | 'mixed';

export interface SpeechEstimate {
  /** 會被唸出來的 CJK 字元數。 */
  cjkChars: number;
  /** 會被唸出來的英文字數。 */
  words: number;
  /** 估計朗讀秒數（兩種文字各用自己的語速相加）。 */
  seconds: number;
  /** 這段文字該用哪種單位呈現。 */
  unit: SpeechUnit;
}

/** 去掉不會被朗讀的標記與講者標籤，留下真正要唸的字。 */
export function spokenTextOf(script: string): string {
  if (typeof script !== 'string') return '';
  return script
    .replace(TONE_MARKER_RE, ' ')
    .replace(LEGACY_BRACE_TONE_RE, ' ')
    .replace(INLINE_TONE_TAG_RE, ' ')
    .replace(SPEAKER_LABEL_RE, '$1')
    .trim();
}

/** 這段逐字稿有多少要唸的字、大約唸多久，以及該用哪個單位顯示。 */
export function estimateSpeech(script: string): SpeechEstimate {
  const spoken = spokenTextOf(script);
  const cjkChars = spoken.match(CJK_RE)?.length ?? 0;
  // 先把 CJK 拿掉再數英文字，免得沒有空白的中文句子裡夾的字母被算成一個超長的字。
  const words = spoken.replace(CJK_RE, ' ').match(WORD_RE)?.length ?? 0;
  const cjkSeconds = cjkChars / CJK_CHARS_PER_SECOND;
  const wordSeconds = words / WORDS_PER_SECOND;
  const total = cjkSeconds + wordSeconds;
  let unit: SpeechUnit = 'mixed';
  if (total <= 0) unit = 'chars';
  else if (wordSeconds / total < MIXED_UNIT_THRESHOLD) unit = 'chars';
  else if (cjkSeconds / total < MIXED_UNIT_THRESHOLD) unit = 'words';
  return { cjkChars, words, seconds: Math.round(total), unit };
}

/** 秒數格式化為 m:ss（分鐘不補零、秒補兩位，沿用原顯示格式）。 */
export function formatSpeakingTime(seconds: number): string {
  const secs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** 逐字稿的估計朗讀時間標籤（m:ss）。 */
export function estimateSpeakingTimeLabel(script: string): string {
  return formatSpeakingTime(estimateSpeech(script).seconds);
}

/**
 * 這段估計該用哪個 i18n 字串顯示數量，以及要代入的值。
 *
 * 回傳 key 而不是直接回字串，是為了讓單位選擇本身可以被測到，同時把三個 key 集中在一處——
 * 顯示的地方（投影片面板）只負責翻譯與排版。
 */
export function speechCountLabelParts(estimate: SpeechEstimate): {
  key: 'play.slidePanel.transcript.charCount'
    | 'play.slidePanel.transcript.wordCount'
    | 'play.slidePanel.transcript.mixedCount';
  values: Record<string, string>;
} {
  if (estimate.unit === 'words') {
    return { key: 'play.slidePanel.transcript.wordCount', values: { '{n}': String(estimate.words) } };
  }
  if (estimate.unit === 'mixed') {
    return {
      key: 'play.slidePanel.transcript.mixedCount',
      values: { '{n}': String(estimate.cjkChars), '{w}': String(estimate.words) },
    };
  }
  return { key: 'play.slidePanel.transcript.charCount', values: { '{n}': String(estimate.cjkChars) } };
}
