import { useCallback, useEffect, useRef, useState } from 'react';
import { startRecording, recordSlideSwitch, stopRecording, type RecordingSession } from '../lib/recordingSession';
import { addNarrationSegment, reRecordNarrationSegment, type NarrationCursorPoint, type NarrationDrawSnapshot, type NarrationDrawingData, type NarrationAudioCue } from '../lib/api/pdfs';

// 游標取樣最小間隔（毫秒），控制軌跡大小。
const CURSOR_SAMPLE_MS = 40;
// 畫筆快照取樣最小間隔（毫秒）：畫的過程節流，但「筆畫數改變」（一筆完成/橡皮擦刪除）一律記錄以保留關鍵狀態。
const DRAW_SAMPLE_MS = 80;

// 深拷貝畫面快照：DrawingCanvas 回報的快照含「進行中筆畫」（其 points 會被後續 move 就地修改），必須拷貝。
function cloneDrawingData(data: NarrationDrawingData): NarrationDrawingData {
  return { strokes: data.strokes.map((s) => ({ ...s, points: s.points.map((p) => [p[0], p[1]] as [number, number]) })) };
}

// 播放頁「錄旁白」：用 MediaRecorder 錄講者聲音，同時以 recordingSession 記錄翻頁時間點；
// 停止時以 stopRecording 產生時間軸並連同音檔上傳。純錄音（不含影片）。

function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export interface NarrationRecorderState {
  recording: boolean;
  saving: boolean;
  error: string | null;
  supported: boolean;
  // 正在重錄的段 id（新錄一段時為 null）。
  targetSegmentId: string | null;
  // 錄音中即時擷取到的游標點數與筆跡筆數（回饋用）。
  captureCounts: { cursor: number; strokes: number };
  // startRecording(null) 新增一段；startRecording(segId) 重錄該段。
  startRecording: (targetSegmentId?: string | null) => Promise<void>;
  stopAndSave: () => Promise<boolean>;
  cancelRecording: () => void;
  // 錄音期間，投影片外框的指標移動呼叫此函式記游標（x/y 為正規化 0–1，不攔截原生畫筆）。
  onCursorMove: (x: number, y: number) => void;
  // 錄音期間，原生畫筆（DrawingCanvas）每次筆劃變化回報完整畫面快照，記成帶時間的快照序列。
  onDrawSnapshot: (data: NarrationDrawingData) => void;
  // 錄音期間講者播放原有 TTS 時呼叫：開始一段（page＝當時頁碼，fromSec＝該頁音檔起播秒數）。
  ttsPlayStart: (page: number, fromSec: number) => void;
  // 錄音期間 TTS 停止/暫停/換頁時呼叫：關閉目前這一段。
  ttsPlayStop: () => void;
}

export function useNarrationRecorder(
  pdfId: string | undefined,
  currentPageNumber: number | null,
  onSaved?: () => void,
): NarrationRecorderState {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetSegmentId, setTargetSegmentId] = useState<string | null>(null);

  const targetRef = useRef<string | null>(null);
  const sessionRef = useRef<RecordingSession | null>(null);
  const startedAtRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cursorTrackRef = useRef<NarrationCursorPoint[]>([]);
  const drawSnapshotsRef = useRef<NarrationDrawSnapshot[]>([]);
  const audioCuesRef = useRef<NarrationAudioCue[]>([]);
  const openCueRef = useRef<{ startMs: number; page: number; fromSec: number } | null>(null);
  const lastCursorTsRef = useRef(0);
  const lastDrawTsRef = useRef(0);
  const lastStrokeCountRef = useRef(-1);
  const recordingRef = useRef(false);
  const lastCountTsRef = useRef(0);
  const [captureCounts, setCaptureCounts] = useState({ cursor: 0, strokes: 0 });

  const bumpCounts = useCallback(() => {
    const last = drawSnapshotsRef.current[drawSnapshotsRef.current.length - 1];
    setCaptureCounts({ cursor: cursorTrackRef.current.length, strokes: last ? last.data.strokes.length : 0 });
  }, []);

  // 錄音期間記游標（節流）。由投影片外框的 onPointerMove 呼叫，不攔截原生畫筆。
  const onCursorMove = useCallback((x: number, y: number) => {
    if (!recordingRef.current) return;
    const tMs = Date.now() - startedAtRef.current;
    if (tMs - lastCursorTsRef.current >= CURSOR_SAMPLE_MS) {
      lastCursorTsRef.current = tMs;
      cursorTrackRef.current.push({ tMs, x, y });
    }
    if (tMs - lastCountTsRef.current > 300) {
      lastCountTsRef.current = tMs;
      bumpCounts();
    }
  }, [bumpCounts]);

  // 錄音期間記原生畫筆快照。筆畫數改變（完成一筆或橡皮擦刪除）一律記錄；畫的過程節流取樣使筆畫漸進長出。
  const onDrawSnapshot = useCallback((data: NarrationDrawingData) => {
    if (!recordingRef.current) return;
    const tMs = Date.now() - startedAtRef.current;
    const structural = data.strokes.length !== lastStrokeCountRef.current;
    if (structural || tMs - lastDrawTsRef.current >= DRAW_SAMPLE_MS) {
      lastDrawTsRef.current = tMs;
      lastStrokeCountRef.current = data.strokes.length;
      drawSnapshotsRef.current.push({ tMs, data: cloneDrawingData(data) });
      bumpCounts();
    }
  }, [bumpCounts]);

  // 關閉目前開啟中的 TTS 區間（若有），寫入 endMs。
  const closeCue = useCallback(() => {
    const open = openCueRef.current;
    if (!open) return;
    const endMs = Date.now() - startedAtRef.current;
    if (endMs > open.startMs) audioCuesRef.current.push({ startMs: open.startMs, endMs, page: open.page, fromSec: open.fromSec });
    openCueRef.current = null;
  }, []);

  const ttsPlayStart = useCallback((page: number, fromSec: number) => {
    if (!recordingRef.current) return;
    closeCue(); // 先關掉前一段（換頁或重新播放）
    openCueRef.current = { startMs: Date.now() - startedAtRef.current, page, fromSec };
  }, [closeCue]);

  const ttsPlayStop = useCallback(() => {
    if (!recordingRef.current) return;
    closeCue();
  }, [closeCue]);

  const supported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  // 錄音期間，頁面切換就記一筆（同頁自動忽略）。
  useEffect(() => {
    if (recording && sessionRef.current && currentPageNumber != null) {
      sessionRef.current = recordSlideSwitch(sessionRef.current, currentPageNumber, Date.now());
    }
  }, [recording, currentPageNumber]);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    sessionRef.current = null;
    recordingRef.current = false;
  }, []);

  const start = useCallback(async (target: string | null = null) => {
    if (!supported || recording || currentPageNumber == null) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorderRef.current = recorder;
      const now = Date.now();
      startedAtRef.current = now;
      sessionRef.current = startRecording(currentPageNumber, now);
      cursorTrackRef.current = [];
      drawSnapshotsRef.current = [];
      audioCuesRef.current = [];
      openCueRef.current = null;
      lastCursorTsRef.current = -CURSOR_SAMPLE_MS;
      lastDrawTsRef.current = -DRAW_SAMPLE_MS;
      lastStrokeCountRef.current = -1;
      lastCountTsRef.current = 0;
      setCaptureCounts({ cursor: 0, strokes: 0 });
      targetRef.current = target;
      setTargetSegmentId(target);
      recordingRef.current = true;
      recorder.start();
      setRecording(true);
    } catch {
      cleanupStream();
      setError('mic');
    }
  }, [supported, recording, currentPageNumber, cleanupStream]);

  const stopAndSave = useCallback(async (): Promise<boolean> => {
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!recorder || !session || !pdfId) return false;
    setRecording(false);
    setSaving(true);
    setError(null);
    try {
      const blob: Blob = await new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
        recorder.stop();
      });
      recordingRef.current = false;
      closeCue(); // 收尾：關閉仍開啟中的 TTS 區間
      const endedAt = Date.now();
      const segments = stopRecording(session, endedAt);
      const durationMs = Math.max(0, endedAt - startedAtRef.current);
      const upload = { durationMs, segments, cursorTrack: cursorTrackRef.current, drawSnapshots: drawSnapshotsRef.current, audioCues: audioCuesRef.current };
      const target = targetRef.current;
      if (target) await reRecordNarrationSegment(pdfId, target, blob, upload);
      else await addNarrationSegment(pdfId, blob, upload);
      onSaved?.();
      return true;
    } catch {
      setError('save');
      return false;
    } finally {
      targetRef.current = null;
      setTargetSegmentId(null);
      cleanupStream();
      setSaving(false);
    }
  }, [pdfId, onSaved, cleanupStream, closeCue]);

  const cancelRecording = useCallback(() => {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    targetRef.current = null;
    setTargetSegmentId(null);
    cleanupStream();
    setRecording(false);
  }, [cleanupStream]);

  // 卸載時釋放麥克風。
  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { recording, saving, error, supported, targetSegmentId, captureCounts, startRecording: start, stopAndSave, cancelRecording, onCursorMove, onDrawSnapshot, ttsPlayStart, ttsPlayStop };
}
