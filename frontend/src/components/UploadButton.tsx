import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ApiError, createYoutubeTask, mapApiErrorToHumanMessage, uploadPdf } from '../lib/api';
import type { UploadResponse } from '../types';

function buildRecoveryGuide(err: unknown, t: ReturnType<typeof useI18n>['t']): string[] {
  if (err instanceof ApiError) {
    if (err.code === 'API_KEY_MISSING') {
      return [t('upload.recovery.apiKeyMissing1'), t('upload.recovery.apiKeyMissing2')];
    }
    if (err.code === 'POPPLER_NOT_FOUND' || err.code === 'DEPENDENCY_MISSING') {
      return [t('upload.recovery.popplerMissing1'), t('upload.recovery.popplerMissing2')];
    }
    if (err.code === 'MODEL_QUOTA_EXCEEDED' || err.code === 'MODEL_UNAVAILABLE') {
      return [t('upload.recovery.modelUnavailable1'), t('upload.recovery.modelUnavailable2')];
    }
    if (err.code === 'INVALID_UPLOAD_TYPE' || err.code === 'INVALID_URL') {
      return [t('upload.recovery.invalidInput1'), t('upload.recovery.invalidInput2')];
    }
  }
  return [t('upload.recovery.generic1'), t('upload.recovery.generic2')];
}

interface UploadButtonProps {
  /**
   * Fired after a successful upload. The parent is expected to open a
   * prompt-input dialog for the returned PDF id.
   */
  onUploaded: (resp: UploadResponse) => void;
}

export default function UploadButton({ onUploaded }: UploadButtonProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const [error, setError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeLang, setYoutubeLang] = useState('zh-TW');
  const [pdfImportMode, setPdfImportMode] = useState<'slides' | 'document'>('slides');
  const [isSubmittingYoutube, setIsSubmittingYoutube] = useState(false);
  const [showYoutubePanel, setShowYoutubePanel] = useState(false);
  const [recoveryGuide, setRecoveryGuide] = useState<string[]>([]);

  const handlePickPdf = () => {
    if (isUploading) return;
    setError(null);
    setRecoveryGuide([]);
    fileInputRef.current?.click();
  };

  const handlePickText = () => {
    if (isUploading) return;
    navigate('/import-text');
  };

  const handleChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    // Reset the input so the same file can be selected again later
    ev.target.value = '';
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf';
    if (!isPdf) {
      setError(t('upload.selectPdfFile'));
      return;
    }

    setIsUploading(true);
    setProgress(0);
    setError(null);
    try {
      const resp = await uploadPdf(file, {
        pdfImportMode,
        onProgress: (loaded, total) => {
          if (total > 0) {
            setProgress(Math.round((loaded / total) * 100));
          }
        },
      });
      onUploaded(resp);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`${t('upload.uploadFailedPrefix')}${h.title}｜${h.message}（${t('upload.suggestionPrefix')}${h.nextStep}）`);
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`${t('upload.uploadFailedPrefix')}${h.title}｜${h.message}（${t('upload.suggestionPrefix')}${h.nextStep}）`);
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else {
        setError(t('upload.uploadFailedUnknown'));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      }
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  const handleSubmitYoutube = async () => {
    if (isSubmittingYoutube || isUploading) return;
    const url = youtubeUrl.trim();
    if (!url) {
      setError(t('upload.enterYoutubeUrl'));
      return;
    }
    setError(null);
    setRecoveryGuide([]);
    setIsSubmittingYoutube(true);
    try {
      const resp = await createYoutubeTask(url, youtubeLang.trim() || undefined);
      onUploaded({
        id: resp.id,
        status: 'uploaded',
        title: `YouTube ${resp.source_video_id}`,
        original_filename: resp.source_url,
        user_prompt: null,
        require_script_confirmation: false,
        category: resp.category ?? 'general',
        created_at: resp.created_at,
      });
      setYoutubeUrl('');
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`${t('upload.youtubeTaskFailedPrefix')}${h.title}｜${h.message}（${t('upload.suggestionPrefix')}${h.nextStep}）`);
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`${t('upload.youtubeTaskFailedPrefix')}${h.title}｜${h.message}（${t('upload.suggestionPrefix')}${h.nextStep}）`);
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else {
        setError(t('upload.youtubeTaskFailedUnknown'));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      }
    } finally {
      setIsSubmittingYoutube(false);
    }
  };


  return (
    <div className="flex flex-col items-start gap-2">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
        <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
          <span className="whitespace-nowrap">{t('upload.pdfContent')}</span>
          <select
            value={pdfImportMode}
            onChange={(e) => setPdfImportMode(e.target.value as 'slides' | 'document')}
            disabled={isUploading}
            className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="slides">{t('upload.pdfModeSlides')}</option>
            <option value="document">{t('upload.pdfModeDocument')}</option>
          </select>
        </label>

        <button
          type="button"
          onClick={handlePickPdf}
          disabled={isUploading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3zM3.75 14.5a.75.75 0 01.75.75v.75h11v-.75a.75.75 0 011.5 0v1.25a1 1 0 01-1 1h-12a1 1 0 01-1-1v-1.25a.75.75 0 01.75-.75z"
              clipRule="evenodd"
            />
          </svg>
          {isUploading ? `${t('upload.uploading')} ${progress}%` : t('upload.uploadPdf')}
        </button>

        <button
          type="button"
          onClick={handlePickText}
          disabled={isUploading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 shadow transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('upload.pasteTxt')}
        </button>

        <button
          type="button"
          onClick={() => setShowYoutubePanel((v) => !v)}
          disabled={isUploading || isSubmittingYoutube}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-900/30 px-4 py-2 text-sm font-medium text-emerald-200 shadow transition hover:bg-emerald-800/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {showYoutubePanel ? t('upload.collapseYoutubeImport') : t('upload.youtubeImport')}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleChange}
        />

        {isUploading && (
          <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-indigo-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {showYoutubePanel && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
          <input
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder={t('upload.youtubeUrlPlaceholder')}
            className="min-w-[260px] flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400"
            disabled={isSubmittingYoutube || isUploading}
          />
          <input
            type="text"
            value={youtubeLang}
            onChange={(e) => setYoutubeLang(e.target.value)}
            placeholder={t('upload.youtubeLangPlaceholder')}
            className="w-44 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400"
            disabled={isSubmittingYoutube || isUploading}
          />
          <button
            type="button"
            onClick={handleSubmitYoutube}
            disabled={isSubmittingYoutube || isUploading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmittingYoutube ? t('upload.creating') : t('upload.createYoutubeTask')}
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <p>{error}</p>
          {recoveryGuide.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-100/90">
              {recoveryGuide.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
          <a
            href="/docs/error-codes.md"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block underline underline-offset-2 hover:text-white"
          >
            {t('upload.viewErrorCodeDocs')}
          </a>
        </div>
      )}
    </div>
  );
}
