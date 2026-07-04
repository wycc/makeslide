import { useCallback, useEffect, useRef, useState } from 'react';
import { startRecording, recordSlideSwitch, stopRecording, type RecordingSession } from '../lib/recordingSession';
import { addNarrationSegment, reRecordNarrationSegment } from '../lib/api/pdfs';

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
  // startRecording(null) 新增一段；startRecording(segId) 重錄該段。
  startRecording: (targetSegmentId?: string | null) => Promise<void>;
  stopAndSave: () => Promise<boolean>;
  cancelRecording: () => void;
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
      targetRef.current = target;
      setTargetSegmentId(target);
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
      const endedAt = Date.now();
      const segments = stopRecording(session, endedAt);
      const durationMs = Math.max(0, endedAt - startedAtRef.current);
      const target = targetRef.current;
      if (target) await reRecordNarrationSegment(pdfId, target, blob, { durationMs, segments });
      else await addNarrationSegment(pdfId, blob, { durationMs, segments });
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

  return { recording, saving, error, supported, targetSegmentId, startRecording: start, stopAndSave, cancelRecording };
}
