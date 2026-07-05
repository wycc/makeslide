// 旁白錄製的「游標軌跡」與「繪圖筆畫」播放讀取（純函式）。座標為正規化 0–1，tMs 相對段起點。

export interface CursorPoint {
  tMs: number;
  x: number;
  y: number;
}
export interface NarrationStroke {
  tMs: number;
  points: { x: number; y: number }[];
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

// 給定播放毫秒，回傳「到此刻為止已開始畫的筆畫」（漸進顯示）。
export function strokesUntil(track: readonly NarrationStroke[], ms: number): NarrationStroke[] {
  return track.filter((s) => s.tMs <= ms);
}
