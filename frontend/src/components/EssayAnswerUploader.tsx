import { useCallback, useRef, useState } from 'react';
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

/**
 * 問答題（essay）作答：學生在紙上寫完後，用手機相機拍照上傳。支援多張；上傳後由伺服器
 * AI 閱卷（分數不回傳給學生，僅供老師檢視）。
 */
export function EssayAnswerUploader({ pdfId, quizId, questionId, clientId, sessionId, resolveCode, disabled }: EssayAnswerUploaderProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>('idle');

  const onPick = useCallback((list: FileList | null) => {
    const picked = list ? Array.from(list).filter((f) => f.type.startsWith('image/')) : [];
    if (picked.length === 0) return;
    setPreviews((prev) => { prev.forEach((url) => URL.revokeObjectURL(url)); return picked.map((f) => URL.createObjectURL(f)); });
    setFiles(picked);
    setStatus('idle');
  }, []);

  const onUpload = useCallback(async () => {
    if (!pdfId || !sessionId || files.length === 0) return;
    setStatus('uploading');
    try {
      const code = await resolveCode();
      await uploadEssayAnswer(pdfId, quizId, { client_id: clientId, session_id: sessionId, code, question_id: questionId, photos: files });
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }, [pdfId, sessionId, files, resolveCode, quizId, clientId, questionId]);

  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="mb-2 text-xs text-slate-400">{t('quiz.essay.uploadHint')}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        disabled={disabled || status === 'uploading'}
        onChange={(e) => onPick(e.target.files)}
        className="block w-full text-xs text-slate-300 file:mr-3 file:rounded file:border file:border-slate-600 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-100"
      />
      {previews.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {previews.map((url, i) => (
            <img key={i} src={url} alt={`answer-${i}`} className="h-20 w-20 rounded border border-slate-700 object-cover" />
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onUpload()}
          disabled={disabled || files.length === 0 || status === 'uploading' || status === 'done'}
          className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-1.5 text-sm text-emerald-100 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'uploading' ? t('quiz.essay.uploading') : status === 'done' ? t('quiz.essay.uploaded') : t('quiz.essay.uploadButton')}
        </button>
        {status === 'done' ? <span className="text-xs text-emerald-300">{t('quiz.essay.uploadedHint')}</span> : null}
        {status === 'error' ? <span className="text-xs text-rose-300">{t('quiz.essay.uploadFailed')}</span> : null}
      </div>
    </div>
  );
}
