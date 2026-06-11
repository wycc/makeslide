const SENTENCE_MATCH_RE = /[^。！？!?；;\n]+[。！？!?；;]?|\n+/g;
const TONE_MARKER_RE = /\[\[\s*[^\]]+\s*\]\]/g;

export interface SentenceTimelineItem {
  text: string;
  start: number;
  end: number;
}

/** Splits a page script into subtitle sentences (strips Gemini TTS tone tags). */
export function splitScriptIntoSentences(script: string): string[] {
  const withoutToneMarkers = script.replace(TONE_MARKER_RE, ' ');
  const normalized = withoutToneMarkers.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized.match(SENTENCE_MATCH_RE) ?? [];
  return parts
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Estimates a start/end playback time for each sentence within a page's audio
 * duration. Used to highlight the active subtitle and to resolve animation
 * effects that start when a given transcript sentence is reached.
 */
export function buildSentenceTimeline(sentences: string[], duration: number): SentenceTimelineItem[] {
  if (!Number.isFinite(duration) || duration <= 0 || sentences.length === 0) return [];
  // 估時模型：先估每句「朗讀秒數」與「句後停頓秒數」，再按整頁 duration 等比縮放。
  const CJK_CHAR_RE = /[㐀-鿿豈-﫿]/;
  const STRONG_END_RE = /[。！？.!?]$/;
  const MEDIUM_END_RE = /[；;]$/;
  const LIGHT_END_RE = /[，,、:]$/;

  const estimateSpeakSeconds = (text: string): number => {
    const compact = text.replace(/\s+/g, '');
    if (!compact) return 0.08;
    let sec = 0;
    for (const ch of compact) {
      if (CJK_CHAR_RE.test(ch)) sec += 0.15;
      else if (/\d/.test(ch)) sec += 0.14;
      else if (/[A-Za-z]/.test(ch)) sec += 0.09;
      else sec += 0.06;
    }
    return Math.max(0.12, sec);
  };

  const estimatePauseSeconds = (text: string, isLast: boolean): number => {
    if (isLast) return 0;
    const compact = text.replace(/\s+/g, '');
    if (STRONG_END_RE.test(compact)) return 0.32;
    if (MEDIUM_END_RE.test(compact)) return 0.22;
    if (LIGHT_END_RE.test(compact)) return 0.16;
    return 0.12;
  };

  const rough = sentences.map((text, idx) => {
    const speak = estimateSpeakSeconds(text);
    const pause = estimatePauseSeconds(text, idx === sentences.length - 1);
    return { text, speak, pause, total: speak + pause };
  });

  const roughTotal = rough.reduce((acc, item) => acc + item.total, 0);
  if (!(roughTotal > 0)) return [];
  const scale = duration / roughTotal;

  let cursor = 0;
  return rough.map((item, idx) => {
    const seg = item.total * scale;
    const start = cursor;
    const end = idx === rough.length - 1 ? duration : Math.min(duration, cursor + seg);
    cursor = end;
    return { text: item.text, start, end };
  });
}
