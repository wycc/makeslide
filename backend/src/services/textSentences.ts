const SENTENCE_MATCH_RE = /[^。！？!?；;\n]+[。！？!?；;]?|\n+/g;
const TONE_MARKER_RE = /\[\[\s*[^\]]+\s*\]\]/g;

/**
 * Splits a page script into subtitle sentences (strips Gemini TTS tone tags).
 * Mirrors `frontend/src/lib/subtitles.ts`'s `splitScriptIntoSentences` exactly,
 * so the resulting sentence indices line up with `startTrigger: { type: 'transcript-line', line }`
 * effects resolved during frontend playback.
 */
export function splitScriptIntoSentences(script: string): string[] {
  const withoutToneMarkers = script.replace(TONE_MARKER_RE, ' ');
  const normalized = withoutToneMarkers.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized.match(SENTENCE_MATCH_RE) ?? [];
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}
