import type { PdfListItem } from '../types';

/** 首頁總覽統計：簡報數、總頁數、總播放次數、音訊總時長（分鐘）。 */
export interface HomeStats {
  totalPdfs: number;
  totalPages: number;
  totalPlays: number;
  totalAudioMin: number;
}

/** `summarizeHomeStats` 只需用到的欄位（以結構型別降低耦合、方便測試）。 */
type HomeStatsItem = Pick<
  PdfListItem,
  'page_count' | 'play_count' | 'total_audio_duration_seconds'
>;

/**
 * 彙總首頁清單的總覽統計。
 *
 * 原為 `HomePage` 內聯的 `items.reduce(...)` 計算（每項各跑一次 reduce、
 * 音訊總秒數除以 60 後四捨五入），無測試。收斂為單次遍歷的純函式：
 * 各欄位缺值（`null`/`undefined`）以 0 計入，與原內聯 `?? 0` 行為一致。
 */
export function summarizeHomeStats(items: ReadonlyArray<HomeStatsItem>): HomeStats {
  let totalPages = 0;
  let totalPlays = 0;
  let totalAudioSec = 0;
  for (const p of items) {
    totalPages += p.page_count ?? 0;
    totalPlays += p.play_count ?? 0;
    totalAudioSec += p.total_audio_duration_seconds ?? 0;
  }
  return {
    totalPdfs: items.length,
    totalPages,
    totalPlays,
    totalAudioMin: Math.round(totalAudioSec / 60),
  };
}
