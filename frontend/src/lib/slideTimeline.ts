// 錄音模式的「簡報切換時間軸」模型（第一步、純函式）。
//
// 未來「錄音模式」會在講者錄音的同時記錄簡報切頁的時間點，之後要能同步播放
// 簡報+錄音、或把兩者合成影片。這裡先把「原始切頁事件」正規化成一串連續、
// 以錄音起點為 0 的區段 `{page, startMs, endMs}`，作為播放/合成的共同資料模型；
// 尚不含 MediaRecorder 接線、儲存或 UI。
//
// 設計要點：
// - 事件時間為絕對時間戳（如 Date.now()）；輸出一律換算成「相對錄音起點」的毫秒。
// - 事件可能亂序、含錄音前（負偏移）或錄音後（超過時長）的雜訊，一律夾到 [0, duration]。
// - 連續切到「同一頁」視為無動作，合併之。
// - 第一段回溯到 0，讓時間軸完整覆蓋整段錄音（假設錄音一開始就停在第一個記錄到的頁）。
// - 零長度區段（同一時間點的重複/被後續事件立即取代者）會被濾除；同一時間點以「較晚者」勝出。

import { clamp } from './clamp';

export interface SlideSwitchEvent {
  /** 從這個時間點起顯示的頁碼。 */
  page: number;
  /** 切到該頁的絕對時間戳（毫秒，如 Date.now()）。 */
  atMs: number;
}

export interface SlideTimelineSegment {
  page: number;
  /** 相對錄音起點的毫秒（含）。 */
  startMs: number;
  /** 相對錄音起點的毫秒（不含）。 */
  endMs: number;
}

export function buildSlideTimeline(
  recordingStartMs: number,
  events: readonly SlideSwitchEvent[],
  recordingDurationMs: number,
): SlideTimelineSegment[] {
  if (!Number.isFinite(recordingStartMs) || !Number.isFinite(recordingDurationMs) || recordingDurationMs <= 0) {
    return [];
  }
  // 換算為相對偏移、夾到 [0, duration]、濾掉非法事件，再依偏移穩定排序。
  const rel = events
    .filter((e) => Number.isFinite(e.atMs) && Number.isInteger(e.page))
    .map((e) => ({ page: e.page, offset: clamp(e.atMs - recordingStartMs, 0, recordingDurationMs) }))
    .sort((a, b) => a.offset - b.offset);
  if (rel.length === 0) return [];

  // 合併連續的同頁事件（切到同一頁不產生新區段）。
  const merged: { page: number; offset: number }[] = [];
  for (const r of rel) {
    const prev = merged[merged.length - 1];
    if (prev && prev.page === r.page) continue;
    merged.push(r);
  }
  // 第一段回溯到錄音起點，讓時間軸完整覆蓋整段錄音。
  const first = merged[0];
  if (first) first.offset = 0;

  const segments: SlideTimelineSegment[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const cur = merged[i];
    if (!cur) continue;
    const startMs = cur.offset;
    const next = merged[i + 1];
    const endMs = next ? next.offset : recordingDurationMs;
    if (endMs > startMs) segments.push({ page: cur.page, startMs, endMs });
  }
  return segments;
}
