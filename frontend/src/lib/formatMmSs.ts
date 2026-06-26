// 把秒數格式化為 mm:ss（純函式）。負值 / NaN 視為 0；超過 60 分鐘仍以分:秒呈現
// （例如 3661 秒 → "61:01"），分與秒皆補零至兩位。

export function formatMmSs(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
