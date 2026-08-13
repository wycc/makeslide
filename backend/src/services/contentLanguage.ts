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
      ].join('\n')
    : [
        '- 加入少量「好」、「那我們來看」、「這裡有一個重點」等自然轉場。',
        '- 皆使用台灣用語、台灣連接詞，可適時使用台灣狀聲詞。',
        '- 術語保留原文（如有必要）。',
      ].join('\n');
}

/**
 * What the character budget means once the language changes.
 *
 * The targets are character counts, which is a sentence's worth of Chinese and a few words of
 * English. Left unsaid, a model reading 「約 350 字」 while writing English produces 350 *words*
 * — several times the intended length, and the page's audio runs long against its slide.
 */
export function contentLanguageLengthNote(language: AppLanguage): string {
  return language === 'en'
    ? '【字數單位】上述「字」指的是**英文字元數**（characters, including spaces），不是單字數（words）——大約 6 個字元算一個英文單字。'
    : '';
}

/**
 * The three variables every script template declares, so a caller cannot fill in one and forget
 * another — the mismatch that produced Chinese scripts under an English setting.
 */
export function promptLanguageVars(language: AppLanguage): Record<string, string> {
  return {
    language: contentLanguageName(language),
    language_notes: contentLanguageStyleNotes(language),
    length_note: contentLanguageLengthNote(language),
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
