import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { uploadEssayAnswer } from '../lib/api';

export interface EssayAnswerUploaderProps {
  pdfId: string | undefined;
  quizId: number;
  questionId: string;
  clientId: string;
  sessionId: string | null;
  resolveCode: () => Promise<string | null>;
  disabled?: boolean;
}

type Status = 'idle' | 'uploading' | 'done' | 'error';
/** 單題問答題一次最多上傳幾張照片，需與後端 quizzes.ts 的 MAX_ESSAY_PHOTOS 一致。 */
const MAX_ESSAY_PHOTOS = 10;
/** 拍照/選檔累積的一張作答照片，url 為對應的 object URL（釋放用）。 */
interface Photo {
  file: File;
  url: string;
}

/**
 * 問答題（essay）作答：學生在紙上寫完後拍照上傳。兩種取得照片的方式：
 *  1.「選擇檔案」——手機上 `capture` 會直接開系統相機，桌機則是選圖檔。
 *  2.「開啟相機」——用 getUserMedia 在 App 內即時預覽並拍照，桌機／筆電也能直接拍
 *     （手機優先後鏡頭）。
 * 兩者拍/選的照片都累積到同一份清單，可逐張移除，最後一起上傳；伺服器 AI 閱卷
 *（分數不回傳給學生，僅供老師檢視）。
 */
export function EssayAnswerUploader({ pdfId, quizId, questionId, clientId, sessionId, resolveCode, disabled }: EssayAnswerUploaderProps) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<Status>('idle');

  // 即時相機狀態。
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<'unsupported' | 'denied' | null>(null);

  // 卸載時釋放所有 object URL 與相機串流，避免記憶體外洩與相機燈長亮。
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;
  useEffect(() => () => {
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const addFiles = useCallback((list: File[]) => {
    const images = list.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setPhotos((prev) => {
      // Keep at most MAX_ESSAY_PHOTOS per answer, matching the server's per-request files limit, so
      // we never build an upload the backend would reject; extra picks are simply ignored.
      const accepted = images.slice(0, Math.max(0, MAX_ESSAY_PHOTOS - prev.length));
      return [...prev, ...accepted.map((file) => ({ file, url: URL.createObjectURL(file) }))];
    });
    setStatus('idle');
  }, []);

  const removeAt = useCallback((index: number) => {
    setPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
    setStatus('idle');
  }, []);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const openCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('unsupported');
      return;
    }
    try {
      // 手機優先用後鏡頭拍紙本（ideal 而非 exact，桌機沒有後鏡頭時仍可退回可用相機）。
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      setCameraError(null);
      setCameraOn(true);
    } catch {
      setCameraError('denied');
    }
  }, []);

  // <video> 只在 cameraOn 時渲染，故串流要在渲染後才綁上去。
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.muted = true;
      void videoRef.current.play().catch(() => {});
    }
  }, [cameraOn]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return; // 串流尚未就緒
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        addFiles([new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
      },
      'image/jpeg',
      0.9,
    );
  }, [addFiles]);

  const onUpload = useCallback(async () => {
    if (!pdfId || !sessionId || photos.length === 0) return;
    setStatus('uploading');
    try {
      const code = await resolveCode();
      await uploadEssayAnswer(pdfId, quizId, { client_id: clientId, session_id: sessionId, code, question_id: questionId, photos: photos.map((p) => p.file) });
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }, [pdfId, sessionId, photos, resolveCode, quizId, clientId, questionId]);

  const busy = disabled || status === 'uploading';

  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="mb-2 text-xs text-slate-400">{t('quiz.essay.uploadHint')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className={`cursor-pointer rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          {t('quiz.essay.pickFile')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={busy}
            onChange={(e) => { addFiles(e.target.files ? Array.from(e.target.files) : []); e.target.value = ''; }}
            className="hidden"
          />
        </label>
        {!cameraOn ? (
          <button
            type="button"
            onClick={() => void openCamera()}
            disabled={busy}
            className="rounded border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📷 {t('quiz.essay.cameraOpen')}
          </button>
        ) : null}
      </div>

      {cameraError ? (
        <p className="mt-2 text-xs text-rose-300">
          {cameraError === 'unsupported' ? t('quiz.essay.cameraUnsupported') : t('quiz.essay.cameraDenied')}
        </p>
      ) : null}

      {cameraOn ? (
        <div className="mt-2 space-y-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className="w-full max-w-sm rounded border border-slate-700 bg-black" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={capture}
              disabled={busy}
              className="rounded-md border border-sky-500/50 bg-sky-500/20 px-4 py-1.5 text-sm text-sky-100 hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              📸 {t('quiz.essay.cameraCapture')}
            </button>
            <button
              type="button"
              onClick={closeCamera}
              className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
            >
              {t('quiz.essay.cameraClose')}
            </button>
          </div>
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative">
              <img src={p.url} alt={`answer-${i}`} className="h-20 w-20 rounded border border-slate-700 object-cover" />
              {!busy && status !== 'done' ? (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  title={t('quiz.essay.removePhoto')}
                  aria-label={t('quiz.essay.removePhoto')}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-xs text-slate-200 hover:bg-rose-600 hover:text-white"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onUpload()}
          disabled={busy || photos.length === 0 || status === 'done'}
          className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-1.5 text-sm text-emerald-100 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'uploading'
            ? t('quiz.essay.uploading')
            : status === 'done'
              ? t('quiz.essay.uploaded')
              : photos.length > 0
                ? `${t('quiz.essay.uploadButton')}（${photos.length}）`
                : t('quiz.essay.uploadButton')}
        </button>
        {status === 'done' ? <span className="text-xs text-emerald-300">{t('quiz.essay.uploadedHint')}</span> : null}
        {status === 'error' ? <span className="text-xs text-rose-300">{t('quiz.essay.uploadFailed')}</span> : null}
      </div>
    </div>
  );
}
