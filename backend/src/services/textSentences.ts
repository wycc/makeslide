const SENTENCE_MATCH_RE = /[^。！？!?；;\n]+[。！？!?；;]?|\n+/g;
const TONE_MARKER_RE = /\[\[\s*[^\]]+\s*\]\]/g;
// Single-bracket English tone tags ([seriously], [very fast], …) that Gemini
// script prompts embed as TTS steering; they must never appear in subtitles.
// Digits ([1]) and Chinese ([[ 語氣 ]]) are unaffected.
const INLINE_TONE_TAG_RE = /\[[A-Za-z][A-Za-z ]*\]/g;
// BreezeTTS 2 vocal events ([笑], (laugh)…): performed by that engine, never shown as words.
// Exact tags only, so ordinary parentheses and bracketed citations are left alone. The space
// before a tag goes with it, or 「常見 [嘆氣]，」 leaves 「常見 ，」 in the subtitle.
const BREEZE_ZH_EVENT_RE = /\s*[[［【]\s*(?:笑|咳嗽|清嗓子|叹气|嘆氣)\s*[\]］】]/g;
const BREEZE_EN_EVENT_RE = /\s*[(（]\s*(?:laugh|cough|clears throat|sigh)\s*[)）]/gi;

/**
 * Splits a page script into subtitle sentences (strips Gemini TTS tone tags).
 * Mirrors `frontend/src/lib/subtitles.ts`'s `splitScriptIntoSentences` exactly,
 * so the resulting sentence indices line up with `startTrigger: { type: 'transcript-line', line }`
 * effects resolved during frontend playback.
 */
export function splitScriptIntoSentences(script: string): string[] {
  const withoutToneMarkers = script
    .replace(TONE_MARKER_RE, ' ')
    .replace(INLINE_TONE_TAG_RE, ' ')
    .replace(BREEZE_ZH_EVENT_RE, '')
    .replace(BREEZE_EN_EVENT_RE, '')
    .replace(/[ \t]{2,}/g, ' ');
  const normalized = withoutToneMarkers.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized.match(SENTENCE_MATCH_RE) ?? [];
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}
