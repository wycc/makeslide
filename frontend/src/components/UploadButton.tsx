import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ApiError, createBlankPdf, createYoutubeTask, mapApiErrorToHumanMessage, uploadPdf } from '../lib/api';
import { normalizeYoutubeSubtitleLanguageForSubmit, YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS } from '../lib/youtubeLanguage';
import { uploadProgressPercent } from '../lib/uploadProgress';
import type { UploadResponse } from '../types';
import Menu from './Menu';
import UploadPdfDialog from './UploadPdfDialog';
import { useProviderStatus } from '../lib/providerStatus';

type T = ReturnType<typeof useI18n>['t'];

function buildRecoveryGuide(err: unknown, t: T): string[] {
  if (err instanceof ApiError) {
    if (err.code === 'API_KEY_MISSING') {
      return [t('upload.recoveryApiKey1'), t('upload.recoveryApiKey2')];
    }
    if (err.code === 'POPPLER_NOT_FOUND' || err.code === 'DEPENDENCY_MISSING') {
      return [t('upload.recoveryDependency1'), t('upload.recoveryDependency2')];
    }
    if (err.code === 'MODEL_QUOTA_EXCEEDED' || err.code === 'MODEL_UNAVAILABLE') {
      return [t('upload.recoveryModel1'), t('upload.recoveryModel2')];
    }
    if (err.code === 'INVALID_UPLOAD_TYPE' || err.code === 'INVALID_URL') {
      return [t('upload.recoveryInvalidInput1'), t('upload.recoveryInvalidInput2')];
    }
  }
  return [t('upload.recoveryDefault1'), t('upload.recoveryDefault2')];
}

interface UploadButtonProps {
  /**
   * Fired after a successful upload. The parent is expected to open a
   * prompt-input dialog for the returned PDF id.
   */
  onUploaded: (resp: UploadResponse) => void;
  /**
   * Category the new presentation should be filed under — the one the user is
   * currently browsing. Null when a view filter (all / recent) is active, which
   * lets the backend fall back to the default category.
   */
  category?: string | null;
}

export default function UploadButton({ onUploaded, category = null }: UploadButtonProps) {
  const { t } = useI18n();
  // 沒有可用的 LLM 就不必讓使用者先傳完一份 PDF、填完提示詞，才在後端撞上 API_KEY_MISSING。
  // 空白簡報不經 pipeline，所以那一項不受影響。
  const providerStatus = useProviderStatus();
  const llmDisabled = providerStatus.loaded && !providerStatus.llmEnabled;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const [error, setError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeLang, setYoutubeLang] = useState('zh-TW');
  const [pdfImportMode, setPdfImportMode] = useState<'slides' | 'document'>('slides');
  const [hostMode, setHostMode] = useState<'solo' | 'dual'>('solo');
  const [showPdfModePicker, setShowPdfModePicker] = useState(false);
  const [isSubmittingYoutube, setIsSubmittingYoutube] = useState(false);
  const [isCreatingBlank, setIsCreatingBlank] = useState(false);
  const [showYoutubePanel, setShowYoutubePanel] = useState(false);
  const [recoveryGuide, setRecoveryGuide] = useState<string[]>([]);

  const handlePickPdf = () => {
    if (isUploading) return;
    setError(null);
    setRecoveryGuide([]);
    setShowPdfModePicker(true);
  };

  /**
   * 對話框按下「選擇 PDF 檔案」：先關掉對話框再開系統的檔案選擇器。
   * 順序有意義——留著對話框的話，選完檔案會看到一個已經沒有用的對話框疊在上傳進度上。
   */
  const handleConfirmPdfDialog = () => {
    if (isUploading) return;
    setShowPdfModePicker(false);
    fileInputRef.current?.click();
  };

  const handlePickText = () => {
    if (isUploading) return;
    navigate('/import-text');
  };

  const handleCancelUpload = () => {
    uploadAbortControllerRef.current?.abort();
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
    setRecoveryGuide([]);
    const abortController = new AbortController();
    uploadAbortControllerRef.current = abortController;
    try {
      const resp = await uploadPdf(file, {
        pdfImportMode,
        hostMode,
        category,
        signal: abortController.signal,
        onProgress: (loaded, total) => {
          if (total > 0) {
            setProgress(uploadProgressPercent(loaded, total));
          }
        },
      });
      onUploaded(resp);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ABORTED') {
          setError(t('upload.uploadCanceled'));
          setRecoveryGuide([]);
          return;
        }
        const h = mapApiErrorToHumanMessage(err, t);
        setError(t('upload.uploadFailedDetail').replace('{title}', h.title).replace('{message}', h.message).replace('{nextStep}', h.nextStep));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(t('upload.uploadFailedDetail').replace('{title}', h.title).replace('{message}', h.message).replace('{nextStep}', h.nextStep));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else {
        setError(t('upload.uploadFailedUnknown'));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      }
    } finally {
      if (uploadAbortControllerRef.current === abortController) {
        uploadAbortControllerRef.current = null;
      }
      setIsUploading(false);
      setProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCreateBlank = async () => {
    if (isCreatingBlank || isUploading) return;
    setError(null);
    setRecoveryGuide([]);
    setIsCreatingBlank(true);
    try {
      const resp = await createBlankPdf(undefined, category);
      // Nothing to generate, so skip the prompt dialog the other entry points open and go
      // straight to the deck, where pages get added one at a time.
      navigate(`/play/${encodeURIComponent(resp.id)}`);
    } catch (err) {
      const h = mapApiErrorToHumanMessage(err instanceof Error ? err : new Error(String(err)), t);
      setError(t('upload.blankDeckFailedDetail').replace('{title}', h.title).replace('{message}', h.message).replace('{nextStep}', h.nextStep));
      setRecoveryGuide(buildRecoveryGuide(err, t));
    } finally {
      setIsCreatingBlank(false);
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
      const resp = await createYoutubeTask(
        url,
        normalizeYoutubeSubtitleLanguageForSubmit(youtubeLang),
        hostMode,
        category,
      );
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
        const h = mapApiErrorToHumanMessage(err, t);
        setError(t('upload.youtubeTaskFailedDetail').replace('{title}', h.title).replace('{message}', h.message).replace('{nextStep}', h.nextStep));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(t('upload.youtubeTaskFailedDetail').replace('{title}', h.title).replace('{message}', h.message).replace('{nextStep}', h.nextStep));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      } else {
        setError(t('upload.youtubeTaskFailedUnknown'));
        setRecoveryGuide(buildRecoveryGuide(err, t));
      }
    } finally {
      setIsSubmittingYoutube(false);
    }
  };


  const hostModePicker = (
    <div className="flex w-full items-center gap-2">
      <span className="whitespace-nowrap text-xs text-slate-400">{t('upload.hostModeLabel')}</span>
      <div className="flex overflow-hidden rounded-md border border-slate-600">
        {(['solo', 'dual'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setHostMode(mode)}
            aria-pressed={hostMode === mode}
            className={`px-3 py-1 text-xs ${
              hostMode === mode
                ? 'bg-cyan-500/25 font-medium text-cyan-100'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {mode === 'solo' ? t('upload.hostModeSolo') : t('upload.hostModeDual')}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
        {/*
          一顆下拉選單，不是 split button。
          四種來源全都在選單裡之後，主按鈕的「預設動作」就只是選單第一項的複製品——
          兩個按鍵、兩種點擊結果，卻通往同一組選擇。合併成一顆之後，「要建立簡報」與
          「用什麼素材建立」變成先後兩步，而不是要先看懂這兩半的差別。
          見 docs/home-toolbar-redesign.md B3。
        */}
        <Menu
          label={t('upload.uploadLabel')}
          align="left"
          trigger={
            <>
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
              {isUploading ? t('upload.uploading').replace('{progress}', String(progress)) : t('upload.uploadLabel')}
              <span aria-hidden="true">▾</span>
            </>
          }
          disabled={isUploading}
          triggerClassName="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          items={[
            {
              key: 'pdf',
              icon: '📑',
              label: t('upload.sourcePdf'),
              disabled: isUploading || llmDisabled,
              onSelect: handlePickPdf,
            },
            {
              key: 'paste-txt',
              icon: '📝',
              label: t('upload.pasteTxt'),
              disabled: isUploading || llmDisabled,
              onSelect: handlePickText,
            },
            {
              key: 'blank',
              icon: '📄',
              label: isCreatingBlank ? t('upload.creating') : t('upload.blankDeck'),
              disabled: isUploading || isCreatingBlank,
              onSelect: () => void handleCreateBlank(),
            },
            {
              key: 'youtube',
              icon: '▶️',
              label: showYoutubePanel ? t('upload.collapseYoutubeImport') : t('upload.youtubeImport'),
              disabled: isUploading || isSubmittingYoutube || llmDisabled,
              onSelect: () => setShowYoutubePanel((v) => !v),
            },
          ]}
        />


        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleChange}
        />

        {isUploading && (
          <div className="col-span-2 flex w-full items-center gap-2 sm:col-span-1 sm:w-auto">
            <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-700" aria-label={t('upload.uploadProgress')}>
              <div
                className="h-full bg-indigo-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <button
              type="button"
              onClick={handleCancelUpload}
              className="rounded-md border border-rose-400/60 px-3 py-1 text-xs font-medium text-rose-100 transition hover:bg-rose-500/10"
            >
              {t('upload.cancelUpload')}
            </button>
          </div>
        )}
      </div>

      {llmDisabled ? (
        <p className="text-xs text-amber-300">
          {t('providerDisabled.llmHint')}{' '}
          <button type="button" onClick={() => navigate('/settings')} className="underline underline-offset-2 hover:text-amber-200">
            {t('providerDisabled.openSettings')}
          </button>
        </p>
      ) : null}

      {showPdfModePicker && !isUploading && (
        <UploadPdfDialog
          importMode={pdfImportMode}
          hostMode={hostMode}
          onImportModeChange={setPdfImportMode}
          onHostModeChange={setHostMode}
          onPickFile={handleConfirmPdfDialog}
          onClose={() => setShowPdfModePicker(false)}
        />
      )}

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
          <div className="flex min-w-[260px] flex-wrap items-center gap-2">
            <input
              type="text"
              value={youtubeLang}
              onChange={(e) => setYoutubeLang(e.target.value)}
              placeholder={t('upload.subtitleLanguagePlaceholder')}
              aria-label={t('upload.subtitleLanguageLabel')}
              className="w-44 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400"
              disabled={isSubmittingYoutube || isUploading}
            />
            <div className="flex flex-wrap items-center gap-1" aria-label={t('upload.subtitleLanguageQuickSelect')}>
              {YOUTUBE_SUBTITLE_LANGUAGE_OPTIONS.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setYoutubeLang(lang)}
                  disabled={isSubmittingYoutube || isUploading}
                  aria-pressed={youtubeLang.trim().toLowerCase() === lang.toLowerCase()}
                  className={`rounded-md border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    youtubeLang.trim().toLowerCase() === lang.toLowerCase()
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                      : 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {lang === 'auto' ? t('upload.subtitleLanguageAuto') : lang}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSubmitYoutube}
            disabled={isSubmittingYoutube || isUploading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmittingYoutube ? t('upload.creating') : t('upload.createYoutubeTask')}
          </button>
          {hostModePicker}
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
            {t('upload.errorCodeGuide')}
          </a>
        </div>
      )}
    </div>
  );
}
