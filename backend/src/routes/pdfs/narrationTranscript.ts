// 把 Whisper 逐字時間戳（秒）依「該段的翻頁時間軸」切成逐頁逐字稿（純函式）。
//
// 每個 word 有 `start`（秒），乘 1000 換成相對段起點的毫秒，落在哪個 `[startMs, endMs)`
// 區段就歸到該頁；超出所有區段者歸到最後一段（避免結尾字漏掉）。同頁的字以空白串接
// （英文自然、CJK 會多空白，但逐字稿本就可在編輯界面修正）。

export interface TranscriptWord {
  word: string;
  start: number; // seconds
}
export interface TimelineSeg {
  page: number;
  startMs: number;
  endMs: number;
}

// 沒有逐字時間戳時（部分 OpenAI 相容端點不支援 word timestamps）的退路：把整段純文字逐字稿
// 掛到該段的第一頁；使用者可在編輯界面把內容搬到其他頁。
export function assignPlainTranscript(text: string, timeline: readonly TimelineSeg[]): Record<number, string> {
  const trimmed = text.trim();
  if (!trimmed || timeline.length === 0) return {};
  const pages = new Set<number>();
  for (const s of timeline) pages.add(s.page);
  const firstPage = Math.min(...pages);
  return { [firstPage]: trimmed };
}

export function splitWordsByPage(words: readonly TranscriptWord[], timeline: readonly TimelineSeg[]): Record<number, string> {
  if (timeline.length === 0) return {};
  const last = timeline[timeline.length - 1]!;
  const byPage = new Map<number, string[]>();
  for (const w of words) {
    if (typeof w.word !== 'string' || !Number.isFinite(w.start)) continue;
    const ms = w.start * 1000;
    const seg = timeline.find((s) => ms >= s.startMs && ms < s.endMs) ?? (ms >= last.endMs ? last : undefined);
    if (!seg) continue;
    const token = w.word.trim();
    if (!token) continue;
    const arr = byPage.get(seg.page) ?? [];
    arr.push(token);
    byPage.set(seg.page, arr);
  }
  const out: Record<number, string> = {};
  for (const [page, arr] of byPage) out[page] = arr.join(' ');
  return out;
}
