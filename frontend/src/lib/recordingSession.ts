// 錄音 session 模型（純函式狀態層）。
//
// 銜接「錄音期間逐次的切頁通知」與已固化的 `buildSlideTimeline`：錄音開始時建立 session、
// 每次切頁 append 一筆事件（切到同一頁則忽略，避免灌爆事件流），停止時交給 buildSlideTimeline
// 產出正規化時間軸。是錄音資料層的中間層，尚不含 MediaRecorder／儲存／UI。

import { buildSlideTimeline, type SlideSwitchEvent, type SlideTimelineSegment } from './slideTimeline';

export interface RecordingSession {
  startedAtMs: number;
  /** 切頁事件（含錄音起始那一頁），oldest-first。 */
  events: SlideSwitchEvent[];
}

// 於 `page` 開始錄音（`nowMs` 為絕對時間戳，如 Date.now()）。
export function startRecording(page: number, nowMs: number): RecordingSession {
  return { startedAtMs: nowMs, events: [{ page, atMs: nowMs }] };
}

// 記錄一次切頁；若與最近一筆事件同頁則回傳原 session（no-op），避免重複通知灌爆事件流。
export function recordSlideSwitch(session: RecordingSession, page: number, nowMs: number): RecordingSession {
  const last = session.events[session.events.length - 1];
  if (last && last.page === page) return session;
  return { ...session, events: [...session.events, { page, atMs: nowMs }] };
}

// 於 `nowMs` 停止錄音，回傳正規化時間軸（相對錄音起點的 `{page, startMs, endMs}` 區段）。
export function stopRecording(session: RecordingSession, nowMs: number): SlideTimelineSegment[] {
  return buildSlideTimeline(session.startedAtMs, session.events, Math.max(0, nowMs - session.startedAtMs));
}
