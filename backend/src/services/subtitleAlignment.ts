/**
 * Sentence/word-timestamp alignment for the "Whisper 精準對齊" subtitle sync mode.
 *
 * The default sync mode (frontend/src/lib/subtitles.ts's buildSentenceTimeline()) estimates
 * each sentence's playback time purely from character counts, scaled to the page's known audio
 * duration — it has no idea where the real pauses/emphasis actually land. This module instead
 * takes Whisper's word-level timestamps (transcribed from the *actual* synthesized audio) and
 * maps each sentence onto them by proportional character position, giving each sentence a real
 * start/end time grounded in what was actually spoken.
 */

/** Mirrors frontend/src/lib/subtitles.ts's splitScriptIntoSentences() exactly, so the sentence
 * list a presentation's Whisper-aligned timeline was built from always matches what the
 * frontend independently re-derives from the same script text when displaying subtitles. */
const SENTENCE_MATCH_RE = /[^。！？!?；;\n]+[。！？!?；;]?|\n+/g;
const TONE_MARKER_RE = /\[\[\s*[^\]]+\s*\]\]/g;

export function splitScriptIntoSentences(script: string): string[] {
  const withoutToneMarkers = script.replace(TONE_MARKER_RE, ' ');
  const normalized = withoutToneMarkers.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized.match(SENTENCE_MATCH_RE) ?? [];
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}

export interface SentenceTimelineItem {
  text: string;
  start: number;
  end: number;
}

export interface WhisperWordTimestamp {
  word: string;
  start: number;
  end: number;
}

/** Character count used to weight a word/sentence's share of the timeline; never zero so an
 * empty/whitespace-only token still claims a sliver of proportional space instead of vanishing. */
function weightOf(text: string): number {
  return text.replace(/\s+/g, '').length || 1;
}

/**
 * Maps a proportional position (0..1, in "total transcribed character weight" space) to a real
 * time, by finding which word's character range contains that position and linearly
 * interpolating between that word's start/end.
 */
function timeAtProportion(
  proportion: number,
  words: readonly WhisperWordTimestamp[],
  wordWeights: readonly number[],
  wordCumStart: readonly number[],
  totalWordWeight: number,
): number {
  const targetWeight = proportion * totalWordWeight;
  for (let i = 0; i < words.length; i++) {
    const start = wordCumStart[i]!;
    const weight = wordWeights[i]!;
    const end = start + weight;
    if (targetWeight < end || i === words.length - 1) {
      const w = words[i]!;
      const frac = weight > 0 ? Math.max(0, Math.min(1, (targetWeight - start) / weight)) : 0;
      return w.start + (w.end - w.start) * frac;
    }
  }
  return words[words.length - 1]!.end;
}

/**
 * Aligns a page's sentences to real per-word timestamps from a Whisper transcription of the
 * page's actual synthesized audio. Doesn't require the transcribed text to match the sentences
 * verbatim (Whisper's own wording/punctuation will differ) — only assumes both sequences cover
 * the same content in the same relative order and density, which holds for a TTS narration of a
 * fixed script. Falls back to evenly dividing `words`' total duration when either input is empty.
 */
export function alignSentencesToWordTimestamps(
  sentences: readonly string[],
  words: readonly WhisperWordTimestamp[],
): SentenceTimelineItem[] {
  if (sentences.length === 0 || words.length === 0) return [];

  const wordWeights = words.map((w) => weightOf(w.word));
  const wordCumStart: number[] = [];
  let acc = 0;
  for (const weight of wordWeights) {
    wordCumStart.push(acc);
    acc += weight;
  }
  const totalWordWeight = acc;
  const totalDuration = words[words.length - 1]!.end;

  const sentenceWeights = sentences.map((s) => weightOf(s));
  const totalSentenceWeight = sentenceWeights.reduce((a, b) => a + b, 0);

  let cumSentenceWeight = 0;
  return sentences.map((text, idx) => {
    // totalSentenceWeight is always >= 1 here: weightOf() never returns 0, and sentences is
    // non-empty (checked above).
    const startProportion = cumSentenceWeight / totalSentenceWeight;
    cumSentenceWeight += sentenceWeights[idx]!;
    const isLast = idx === sentences.length - 1;
    const start = timeAtProportion(startProportion, words, wordWeights, wordCumStart, totalWordWeight);
    const end = isLast
      ? totalDuration
      : timeAtProportion(cumSentenceWeight / totalSentenceWeight, words, wordWeights, wordCumStart, totalWordWeight);
    return { text, start: Math.min(start, totalDuration), end: Math.min(Math.max(end, start), totalDuration) };
  });
}
