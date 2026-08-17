import type { AppLanguage } from './aiSettings';

/**
 * Everything that turns 「輸出語言」 into words a model will actually follow.
 *
 * The setting existed and was read in the right places, but the prompts underneath it were
 * written in Traditional Chinese *about* Traditional Chinese: the script templates open with
 * 「你是一位專業的中文簡報講師」 and repeat 「使用繁體中文」 among their numbered rules, the
 * per-page user message stated 「輸出語言：zh-TW（繁體中文）」 from an unrelated env var, and the
 * image prompt had no language rule at all. A single 【輸出語言】 line appended after all of that
 * loses — the deck came back with an English title (that path had no competing instruction) and
 * Chinese scripts and slides.
 *
 * So the language is a template variable now, and everything that builds a prompt takes it from
 * the same place. Keeping the strings here rather than in each template is what stops the two
 * halves from drifting apart again.
 */

/** How the language is named *inside* a prompt, in that prompt's own voice. */
export function contentLanguageName(language: AppLanguage): string {
  return language === 'en' ? '英文（English）' : '繁體中文';
}

/**
 * The 【輸出語言】 line, stated as an override.
 *
 * Sources are routinely in the other language — an English PDF narrated in Chinese is the normal
 * case, not an edge case — so the instruction has to say what to do about the mismatch, otherwise
 * the model follows the material instead of the setting.
 */
export function contentLanguageInstruction(language: AppLanguage): string {
  return language === 'en'
    ? '【輸出語言】請用英文產生逐字稿、旁白與所有可朗讀內容；即使使用者提示或投影片文字是中文，也要翻譯並自然改寫成英文。'
    : '【輸出語言】請用繁體中文產生逐字稿、旁白與所有可朗讀內容；即使使用者提示或投影片文字是英文，也要翻譯並自然改寫成繁體中文。';
}

/**
 * The language-specific half of a script template's rules — filler words, regional usage, and
 * (for English) the reminder that the Chinese examples above it are about *format* only.
 *
 * These lines used to be hardcoded in the templates: 「加入少量『好』、『那我們來看』等自然轉場」
 * and 「皆使用台灣用語、台灣連接詞」 read as instructions to write Chinese even when the language
 * line says English, and translating them literally would produce stilted English anyway.
 */
export function contentLanguageStyleNotes(language: AppLanguage): string {
  return language === 'en'
    ? [
        '- 自然轉場請用英文的說法（例如 "All right"、"Now let\'s look at"、"Here\'s the key point"），不要出現中文轉場詞。',
        '- 用自然、口語的英文，像講者在課堂或錄音間說話；避免直譯自中文的句型。',
        '- 專有名詞維持原文；中文來源的人名、書名等在第一次出現時可附上英文說明。',
        '- 上面規則裡的中文範例只示範**格式**（標記、講者標籤、JSON 形狀），實際輸出的內容必須是英文。',
        '- 長度以 **words（英文單字數）** 計，不是字元數——上面每一個 words 的數字都是這個意思。',
      ].join('\n')
    : [
        '- 加入少量「好」、「那我們來看」、「這裡有一個重點」等自然轉場。',
        '- 皆使用台灣用語、台灣連接詞，可適時使用台灣狀聲詞。',
        '- 術語保留原文（如有必要）。',
      ].join('\n');
}

/**
 * The two variables every script template declares, so a caller cannot fill in one and forget the
 * other. Length is separate (see `scriptLengthFor`) because it depends on the page's target too.
 */
export function promptLanguageVars(language: AppLanguage): Record<string, string> {
  return {
    language: contentLanguageName(language),
    language_notes: contentLanguageStyleNotes(language),
  };
}

/**
 * The length target, in the unit the output language is actually written in.
 *
 * The stored target is a Chinese character count. Read literally in English it produces a script
 * a third the intended length — and read as *words* it produces one three times too long. Neither
 * is what the number means: it means "about this much speech". So it is converted through
 * duration, at roughly 270 characters and 140 words per minute, which puts an English script at
 * about half the number — and the unit word in the prompt changes with it, since a figure with the
 * wrong unit beside it is worse than no figure.
 */
const WORDS_PER_CHARACTER = 140 / 270;

export function scriptLengthFor(
  language: AppLanguage,
  targetChars: number,
  bounds: { min: number; max: number },
): { target: number; min: number; max: number; unit: string } {
  if (language !== 'en') {
    return { target: targetChars, min: bounds.min, max: bounds.max, unit: '字' };
  }
  const toWords = (n: number) => Math.max(1, Math.round(n * WORDS_PER_CHARACTER));
  return {
    target: toWords(targetChars),
    min: toWords(bounds.min),
    max: toWords(bounds.max),
    unit: 'words',
  };
}

/**
 * The rule for the slide outline (title + bullets).
 *
 * Separate from the image rule because it applies one step earlier: the outline is what the image
 * prompt then quotes as the page's content, so an outline in the wrong language hands the image
 * model Chinese to copy even when the image rule tells it to draw English.
 */
export function outlineLanguageRule(language: AppLanguage): string {
  return language === 'en'
    ? '投影片的 title 與 bullets 必須用英文書寫；來源若是中文，請翻譯成英文（專有名詞可保留原文）。'
    : '投影片的 title 與 bullets 必須用繁體中文書寫；來源若是英文，請翻譯成繁體中文（專有名詞可保留原文）。';
}

/**
 * The rule that decides what language the text *inside a generated slide image* is in.
 *
 * Image models take their cue from the prompt's own language and from the page text quoted in it,
 * both of which are Chinese here whatever the setting says. Without this line an English deck
 * comes back with Chinese slides — the one part of the output a user cannot edit afterwards.
 */
export function imageTextLanguageRule(language: AppLanguage): string {
  return language === 'en'
    ? 'All text rendered inside the image (titles, labels, bullet points, captions, diagram annotations) must be in English. Translate any Chinese wording from the source material into English; do not render Chinese characters.'
    : '圖片中出現的所有文字（標題、標籤、條列、圖說、圖表註記）必須使用繁體中文。來源若為英文，請翻譯成繁體中文後再放入圖片。';
}

/**
 * The rule for text a generated `custom-script` animation draws on screen.
 *
 * This call site was exempt from the language sweep on the grounds that its output is JavaScript,
 * not prose — but the JavaScript draws words the audience reads: axis labels, captions, and
 * prompts like 「按任意鍵繼續」. Those are as much slide content as anything in `imageTextLanguageRule`,
 * and unlike a title the viewer cannot edit them afterwards without regenerating the animation.
 *
 * Identifiers stay untouched: renaming variables to match the deck's language helps nobody and
 * makes the code harder to hand-edit.
 */
export function animationTextLanguageRule(language: AppLanguage): string {
  return language === 'en'
    ? '動畫在畫面上畫出來的所有文字（標題、標籤、座標軸說明、提示語如 "Press any key to continue"、結果文字）必須是英文；投影片或使用者提示若為中文，請翻譯成英文後再放進畫面。程式碼的變數/函式名稱不受此限（維持英文命名慣例即可）。'
    : '動畫在畫面上畫出來的所有文字（標題、標籤、座標軸說明、提示語如「按任意鍵繼續」、結果文字）必須使用繁體中文；投影片或使用者提示若為英文，請翻譯成繁體中文後再放進畫面。程式碼的變數/函式名稱不受此限（維持英文命名慣例即可）。';
}

/**
 * How the AI tutor is told what language to answer in.
 *
 * The tutor's system prompt opened with 「你是繁體中文課堂 AI 導師」 and never consulted this
 * setting at all, so an English deck answered a student's English question in Chinese. This is the
 * same failure the top of this file describes — a prompt written in Traditional Chinese *about*
 * Traditional Chinese — just in the one place that had been missed.
 *
 * The instruction states the language twice, at the start of the prompt and again at its end,
 * because the rest of the tutor's rules are themselves written in Chinese: a single line appended
 * after all of them is exactly the arrangement that already lost once.
 */
export function tutorRoleLine(language: AppLanguage): string {
  return language === 'en'
    ? 'You are a classroom AI tutor. Always answer in English, even when the slides, the transcript or the student\'s question are in another language.'
    : '你是課堂 AI 導師，一律以繁體中文回答；即使投影片、逐字稿或學生的提問是其他語言，也要用繁體中文作答。';
}

/** The closing reminder, mirroring `tutorRoleLine` at the other end of the prompt. */
export function tutorLanguageInstruction(language: AppLanguage): string {
  return language === 'en'
    ? '【Output language】Write the entire answer in English. The rules above are written in Chinese for brevity, but they describe *format* only — the answer itself must be English.'
    : '【輸出語言】整則回答請使用繁體中文。';
}

/**
 * What the tutor says when the material has no answer.
 *
 * Shown to the student verbatim, so unlike the rules above this one is not a prompt — it has to be
 * in the language the tutor is answering in, or a deck set to English ends a conversation in
 * Chinese.
 */
export function tutorNoAnswerFallback(language: AppLanguage): string {
  return language === 'en'
    ? "Sorry — I could not find anything in this material (the slides, the transcript or the source document) that answers this. Try rephrasing, or ask again on a page that covers it."
    : '很抱歉，我在這份教材（投影片、逐字稿與原始來源）中找不到可以回答這個問題的相關資訊。你可以換個問法，或到相關頁面再問一次。';
}

/**
 * The language half of any "you are a <language> assistant" system prompt.
 *
 * Every one of these was written with 繁體中文 spelled into the role line, so a deck set to English
 * got Chinese quizzes, Chinese summaries, Chinese titles and a Chinese answer in the page Q&A —
 * the same failure this file's header describes, repeated once per feature. Calling this is what
 * keeps a new prompt from joining them.
 *
 * Returns both halves because one is not enough: the rules under the role line are themselves in
 * Chinese, so the language has to be stated at the top *and* restated at the end (see
 * `tutorRoleLine`, which learned this the hard way).
 */
export function assistantLanguage(language: AppLanguage): { name: string; closing: string } {
  return {
    name: contentLanguageName(language),
    closing:
      language === 'en'
        ? '【Output language】Write everything you output in English. The rules above are written in Chinese for brevity; they describe *what* to produce, not the language to produce it in.'
        : '【輸出語言】所有輸出內容請使用繁體中文。',
  };
}
