// 旁白錄製的「游標軌跡」與「繪圖筆畫」播放讀取（純函式）。座標為正規化 0–1，tMs 相對段起點。

export interface CursorPoint {
  tMs: number;
  x: number;
  y: number;
}
export interface StrokePoint {
  x: number;
  y: number;
  // 該點的時間（相對段起點，毫秒）。舊資料可能沒有——此時整筆一起出現（見 strokesUntil）。
  tMs?: number;
}
export interface NarrationStroke {
  tMs: number;
  points: StrokePoint[];
}

// 給定播放毫秒，回傳當下游標位置（在相鄰兩點間線性內插使移動平順）；早於第一點回 null。
export function cursorAtTime(track: readonly CursorPoint[], ms: number): { x: number; y: number } | null {
  if (track.length === 0) return null;
  let prev: CursorPoint | null = null;
  for (const p of track) {
    if (p.tMs <= ms) {
      prev = p;
    } else {
      if (!prev) return null;
      const span = p.tMs - prev.tMs;
      const f = span > 0 ? (ms - prev.tMs) / span : 0;
      return { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f };
    }
  }
  return prev ? { x: prev.x, y: prev.y } : null;
}

// 給定播放毫秒，回傳「到此刻為止已畫出的筆畫」。每一筆會依點的時間戳裁切，讓筆畫**隨時間一段段長出來**，
// 並在最後一段做內插使筆尖平順推進；若某筆的點沒有時間戳（舊資料），該筆一旦起筆就整筆顯示。
export function strokesUntil(track: readonly NarrationStroke[], ms: number): NarrationStroke[] {
  const out: NarrationStroke[] = [];
  for (const s of track) {
    if (s.tMs > ms) continue;
    const timed = s.points.some((p) => typeof p.tMs === 'number');
    if (!timed) {
      out.push(s);
      continue;
    }
    const pts: StrokePoint[] = [];
    let prev: StrokePoint | null = null;
    for (const p of s.points) {
      const pt = p.tMs ?? s.tMs;
      if (pt <= ms) {
        pts.push({ x: p.x, y: p.y, tMs: p.tMs });
        prev = { ...p, tMs: pt };
      } else {
        if (prev) {
          const span = pt - (prev.tMs ?? s.tMs);
          const f = span > 0 ? (ms - (prev.tMs ?? s.tMs)) / span : 0;
          if (f > 0) pts.push({ x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f });
        }
        break;
      }
    }
    if (pts.length > 0) out.push({ tMs: s.tMs, points: pts });
  }
  return out;
}

// 錄音時原生畫筆（DrawingCanvas）每次筆劃變化的快照，帶相對段起點的時間。
// data 直接是 DrawingCanvas 的 { strokes } 結構（含顏色/粗細/橡皮擦），重播時交給唯讀 DrawingCanvas 還原。
export interface DrawSnapshot<TData = { strokes: unknown[] }> {
  tMs: number;
  data: TData;
}

// 給定播放毫秒，回傳「當下應顯示的畫面快照」（<= ms 的最後一份），早於第一份回 null。
export function drawingSnapshotAtTime<TData>(snaps: readonly DrawSnapshot<TData>[], ms: number): TData | null {
  let cur: TData | null = null;
  for (const s of snaps) {
    if (s.tMs <= ms) cur = s.data;
    else break;
  }
  return cur;
}

// 錄音時播放原有 TTS 的區間。重播時用來同步播放該頁語音並切字幕。
export interface AudioCue {
  startMs: number;
  endMs: number;
  page: number;
  fromSec: number;
}

// 給定播放毫秒，回傳當下所處的 TTS 播放區間（若有），否則 null。
export function audioCueAtTime(cues: readonly AudioCue[], ms: number): AudioCue | null {
  for (const c of cues) {
    if (ms >= c.startMs && ms < c.endMs) return c;
  }
  return null;
}

export interface WordCue {
  tMs: number;
  word: string;
}

// 依播放毫秒，把最近 `windowMs`（預設 6 秒）內講到的字組成一行字幕（滾動式）。
export function subtitleAtTime(cues: readonly WordCue[], ms: number, windowMs = 6000): string {
  return cues
    .filter((c) => c.tMs <= ms && c.tMs > ms - windowMs)
    .map((c) => c.word.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
