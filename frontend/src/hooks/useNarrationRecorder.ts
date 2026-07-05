import { useCallback, useEffect, useRef, useState } from 'react';
import { startRecording, recordSlideSwitch, stopRecording, type RecordingSession } from '../lib/recordingSession';
import { addNarrationSegment, reRecordNarrationSegment, type NarrationCursorPoint, type NarrationStrokeData } from '../lib/api/pdfs';

// 錄製時擷取投影片上的指標動作：'move' 記游標、按住拖曳（'down'→'move'→'up'）記成一筆繪圖。
export type NarrationPointerKind = 'move' | 'down' | 'up';
// 游標取樣最小間隔（毫秒），控制軌跡大小。
const CURSOR_SAMPLE_MS = 40;

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
  // 由投影片上的擷取層在錄音期間呼叫（x/y 為正規化 0–1）。
  onCapturePointer: (kind: NarrationPointerKind, x: number, y: number) => void;
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
  const drawTrackRef = useRef<NarrationStrokeData[]>([]);
  const currentStrokeRef = useRef<NarrationStrokeData | null>(null);
  const lastCursorTsRef = useRef(0);
  const recordingRef = useRef(false);
  const lastCountTsRef = useRef(0);
  const [captureCounts, setCaptureCounts] = useState({ cursor: 0, strokes: 0 });

  // 擷取投影片指標動作（僅錄音期間）。move 記游標（節流）；down/move(按住)/up 記成一筆繪圖。
  const onCapturePointer = useCallback((kind: NarrationPointerKind, x: number, y: number) => {
    if (!recordingRef.current) return;
    const tMs = Date.now() - startedAtRef.current;
    if (kind === 'down') {
      currentStrokeRef.current = { tMs, points: [{ x, y, tMs }] };
    } else if (kind === 'up') {
      if (currentStrokeRef.current && currentStrokeRef.current.points.length > 1) {
        drawTrackRef.current.push(currentStrokeRef.current);
      }
      currentStrokeRef.current = null;
      setCaptureCounts({ cursor: cursorTrackRef.current.length, strokes: drawTrackRef.current.length });
    } else {
      // move
      if (currentStrokeRef.current) currentStrokeRef.current.points.push({ x, y, tMs });
      if (tMs - lastCursorTsRef.current >= CURSOR_SAMPLE_MS) {
        lastCursorTsRef.current = tMs;
        cursorTrackRef.current.push({ tMs, x, y });
      }
    }
    // 節流更新即時計數（給錄音中的回饋，也方便確認有在擷取）。
    if (tMs - lastCountTsRef.current > 300) {
      lastCountTsRef.current = tMs;
      setCaptureCounts({ cursor: cursorTrackRef.current.length, strokes: drawTrackRef.current.length });
    }
  }, []);

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
    currentStrokeRef.current = null;
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
      drawTrackRef.current = [];
      currentStrokeRef.current = null;
      lastCursorTsRef.current = -CURSOR_SAMPLE_MS;
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
      const endedAt = Date.now();
      const segments = stopRecording(session, endedAt);
      const durationMs = Math.max(0, endedAt - startedAtRef.current);
      const upload = { durationMs, segments, cursorTrack: cursorTrackRef.current, drawTrack: drawTrackRef.current };
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
  }, [pdfId, onSaved, cleanupStream]);

  const cancelRecording = useCallback(() => {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    targetRef.current = null;
    setTargetSegmentId(null);
    cleanupStream();
    setRecording(false);
  }, [cleanupStream]);

  // 卸載時釋放麥克風。
  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { recording, saving, error, supported, targetSegmentId, captureCounts, startRecording: start, stopAndSave, cancelRecording, onCapturePointer };
}
