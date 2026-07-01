import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { uploadQuizRecording } from '../lib/api';

export type QuizRecorderStatus = 'idle' | 'recording' | 'uploading' | 'done' | 'error';

export interface UseQuizRecorderParams {
  pdfId: string | undefined;
  quizId: number | undefined;
  sessionId: string | null;
  clientId: string;
  resolveCode: () => Promise<string | null>;
}

export interface QuizRecorder {
  videoRef: RefObject<HTMLVideoElement>;
  status: QuizRecorderStatus;
  error: string | null;
  /** 請求相機並開始錄影；使用者拒絕或不支援時 reject（呼叫端可據此擋下作答）。 */
  start: () => Promise<void>;
  /** 停止錄影、關閉相機並上傳；可重複呼叫（idempotent）。 */
  stopAndUpload: () => Promise<void>;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/**
 * 測驗監考錄影：以 getUserMedia 開前鏡頭 + MediaRecorder 全程錄影，交卷時上傳伺服器。
 * 相機為必要條件——start() 失敗時 reject，呼叫端（QuizProctorGate 的前置檢查）應阻止進入測驗。
 */
export function useQuizRecorder({ pdfId, quizId, sessionId, clientId, resolveCode }: UseQuizRecorderParams): QuizRecorder {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stoppedRef = useRef(false);
  // 開始錄影時擷取當下的上傳識別子。測驗結束時 sessionId 等 prop 可能已被重置為 null
  // （老師結束測驗會一併清掉 active_quiz_id / quiz_session_id），若上傳時才讀 prop 會漏傳；
  // 故以本次錄影開始時的識別子為準。
  const uploadCtxRef = useRef<{ pdfId: string; quizId: number; sessionId: string; clientId: string } | null>(null);
  // 每次 render 保存最新 props，讓 stable 的 start/stopAndUpload 在呼叫當下讀到最新值。
  const latestRef = useRef({ pdfId, quizId, sessionId, clientId, resolveCode });
  latestRef.current = { pdfId, quizId, sessionId, clientId, resolveCode };
  const [status, setStatus] = useState<QuizRecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('camera_unsupported');
      throw new Error('camera_unsupported');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    } catch (err) {
      setError('camera_denied');
      throw err instanceof Error ? err : new Error('camera_denied');
    }
    streamRef.current = stream;
    stoppedRef.current = false;
    chunksRef.current = [];
    // 擷取本次錄影開始時的上傳識別子，結束上傳時不受 prop 變動（session 被清空）影響。
    const { pdfId, quizId, sessionId, clientId } = latestRef.current;
    uploadCtxRef.current = pdfId && quizId != null && sessionId ? { pdfId, quizId, sessionId, clientId } : null;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      void videoRef.current.play().catch(() => {});
    }
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorderRef.current = recorder;
    recorder.start(1000); // 每秒 flush 一個 chunk，降低長時間錄影的記憶體壓力
    setStatus('recording');
    setError(null);
  }, []);

  const stopAndUpload = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    const recorder = recorderRef.current;
    const stream = streamRef.current;

    const finalBlob = await new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'video/webm' }) : null);
        return;
      }
      recorder.onstop = () => {
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' }) : null);
      };
      try { recorder.stop(); } catch { resolve(null); }
    });

    // 關閉相機（熄燈）。
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current = null;
    recorderRef.current = null;

    const ctx = uploadCtxRef.current;
    if (!finalBlob || !ctx) {
      setStatus('done');
      return;
    }
    setStatus('uploading');
    try {
      const code = await latestRef.current.resolveCode();
      await uploadQuizRecording(ctx.pdfId, ctx.quizId, { client_id: ctx.clientId, session_id: ctx.sessionId, code, blob: finalBlob });
      setStatus('done');
    } catch {
      setError('upload_failed');
      setStatus('error');
    }
  }, []);

  return { videoRef, status, error, start, stopAndUpload };
}
