import { Link } from 'react-router-dom';
import { RegenerateProgress } from './RegenerateProgress';
import type { ShareAccessMode } from '../../lib/api';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';

export function PlayPageHeader() {
  const { t } = useI18n();
  const {
    currentShareToken,
    titleInput, setTitleInput,
    titleBusy, titleMsg,
    videoError,
    shareMessage, shareError,
    githubSyncMessage, githubSyncError,
    currentIdx, totalPages,
    syncEnabled, syncRole, syncError,
    syncFollowerQuestions,
    syncFollowerQuestionInput, setSyncFollowerQuestionInput,
    syncDisplayedQuestionId,
    syncAiAnswer, syncAiAnswerBusy,
    handleSyncEnabledChange,
    handleSubmitFollowerQuestion,
    handleToggleDisplayedQuestion,
    handleAiAnswerFollowerQuestions,
    readOnlyReason, detail,
    currentPage,
    confirmScriptBusy,
    handleConfirmScript,
    videoProgressText, videoBusy, videoUrl,
    handleGenerateVideo,
    handleSaveTitle, handleRegenerateTitle,
    isReadOnlyProcessing, isLockedFullscreen,
    setFullscreenLayout, setImageOnlyFullscreen,
    slideImageScale, setSlideImageScale,
    setTtsDialogOpen,
    openImageStyleDialog,
    pdfId,
    shareAccess, setShareAccess,
    shareBusy,
    handleCreateShareLink,
    handleMakeSharePrivate,
    canViewPostClassReport,
    openPostClassReport,
    githubSyncBusy, handleSyncToGithub,
    regenJob, regenAllMsg,
    regenJobRunning, regenJobTerminal,
    regenStopBusy, regenRollbackBusy,
    setRegenBannerDismissed,
    showRegenBanner,
    handleStopRegenerate, handleRollbackRegenerate,
  } = usePlayPageContext();

  const pageCounterText = t('play.header.pageCounter')
    .replace('{current}', String(currentIdx + 1))
    .replace('{total}', String(totalPages));
  const followerQuestionCountText = t('play.sync.followerQuestionCount').replace(
    '{count}',
    String(syncFollowerQuestions.length),
  );
  const currentRegenPageText = regenJob?.last_processed_page != null
    ? t('play.regenBanner.currentPage').replace('{page}', String(regenJob.last_processed_page))
    : '';

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3">
        {!currentShareToken ? (
          <Link
            to="/"
            className="shrink-0 whitespace-nowrap rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 sm:px-3 sm:text-sm"
          >
            ← {t('play.header.back')}
          </Link>
        ) : (
          <div className="w-16 shrink-0 sm:w-20" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-2">
          <input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            disabled={isReadOnlyProcessing}
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-center text-xs text-slate-100 sm:px-2 sm:text-sm"
            maxLength={200}
          />
          <button
            type="button"
            onClick={() => void handleSaveTitle()}
            disabled={isReadOnlyProcessing || titleBusy || !titleInput.trim()}
            className="shrink-0 whitespace-nowrap rounded-md border border-cyan-500/50 bg-cyan-500/15 px-1.5 py-1 text-[11px] text-cyan-200 disabled:opacity-40 sm:px-2 sm:text-xs"
          >
            {titleBusy ? t('play.header.savingTitle') : t('play.header.updateTitle')}
          </button>
          <button
            type="button"
            onClick={() => void handleRegenerateTitle()}
            disabled={isReadOnlyProcessing || titleBusy}
            className="shrink-0 whitespace-nowrap rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-1.5 py-1 text-[11px] text-fuchsia-200 disabled:opacity-40 sm:px-2 sm:text-xs"
          >
            {titleBusy ? t('play.header.processing') : t('play.header.regenerateTitle')}
          </button>
        </div>
          <div className="shrink-0 whitespace-nowrap text-right text-xs text-slate-400 sm:w-20 sm:text-sm">
            {pageCounterText}
          </div>
          <label className="ml-2 inline-flex items-center gap-1 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(e) => handleSyncEnabledChange(e.target.checked)}
            />
            {t('play.sync.mode')}
            {syncEnabled ? `(${syncRole === 'master' ? 'master' : 'follower'})` : ''}
          </label>
        </div>
        {syncError ? <div className="mt-1 text-xs text-rose-300">{syncError}</div> : null}
        {syncEnabled ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <div className="rounded-md border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-200">
              {syncRole === 'follower' ? (
                <div className="flex gap-2">
                  <input
                    value={syncFollowerQuestionInput}
                    onChange={(e) => setSyncFollowerQuestionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSubmitFollowerQuestion();
                    }}
                    placeholder={t('play.sync.questionPlaceholder')}
                    className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSubmitFollowerQuestion()}
                    disabled={!syncFollowerQuestionInput.trim()}
                    className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1 text-cyan-100 disabled:opacity-40"
                  >
                    {t('play.sync.submitQuestion')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-slate-100">
                      {followerQuestionCountText}
                      <span className="ml-2 text-slate-400">{t('play.sync.aiAnswerShortcut')}</span>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/remote/${encodeURIComponent(pdfId ?? '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-violet-500/50 bg-violet-500/15 px-2 py-1 text-violet-100"
                      >
                        {t('play.header.remoteController')}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleToggleDisplayedQuestion()}
                        disabled={syncFollowerQuestions.length === 0}
                        className="rounded border border-slate-600 px-2 py-1 text-slate-200 disabled:opacity-40"
                      >
                        {syncDisplayedQuestionId ? t('play.sync.hideQuestion') : t('play.sync.showLatestQuestion')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAiAnswerFollowerQuestions()}
                        disabled={syncAiAnswerBusy || syncFollowerQuestions.length === 0}
                        className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-emerald-100 disabled:opacity-40"
                      >
                        {syncAiAnswerBusy ? t('play.sync.aiAnswerBusy') : t('play.sync.aiAnswer')}
                      </button>
                    </div>
                  </div>
                  {syncAiAnswer ? (
                    <div className="max-h-72 overflow-y-auto rounded border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-50 whitespace-pre-wrap">
                      {syncAiAnswer.answer}
                    </div>
                  ) : null}
                  <div className="max-h-28 space-y-1 overflow-auto">
                    {syncFollowerQuestions.slice(0, 5).map((q) => (
                      <div key={q.id} className="rounded bg-slate-950/70 px-2 py-1">
                        <span className="text-cyan-300">{q.code || t('play.sync.anonymous')}：</span>{q.question}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      {readOnlyReason ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {readOnlyReason}
          </div>
        </div>
      ) : null}
      {detail?.status === 'failed' && detail.error_message ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <span className="font-medium">{t('play.header.generationFailed')}</span>
            <span className="whitespace-pre-wrap">{detail.error_message}</span>
          </div>
        </div>
      ) : null}
      {currentPage?.status === 'failed' && currentPage.error_message ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <span className="font-medium">{t('play.header.pageGenerationFailed').replace('{page}', String(currentPage.page_number))}</span>
            <span className="whitespace-pre-wrap">{currentPage.error_message}</span>
          </div>
        </div>
      ) : null}
      {detail?.status === 'awaiting_script_confirmation' ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="flex flex-col gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{t('play.header.scriptReadyTitle')}</p>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                {t('play.header.scriptReadyDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleConfirmScript()}
              disabled={confirmScriptBusy}
              className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmScriptBusy ? t('play.header.processing') : t('play.header.confirmScript')}
            </button>
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 pb-3 md:flex-row md:items-center md:justify-between md:gap-3">
        <div className="space-y-1 text-xs text-slate-400">
          {videoError ? <span className="text-rose-300">{videoError}</span> : null}
          {!videoError && titleMsg ? <span className="text-slate-300">{titleMsg}</span> : null}
          {shareMessage ? <div className="text-emerald-300">{shareMessage}</div> : null}
          {shareError ? <div className="text-rose-300">{shareError}</div> : null}
          {githubSyncMessage ? <div className="text-emerald-300">{githubSyncMessage}</div> : null}
          {githubSyncError ? <div className="text-rose-300">{githubSyncError}</div> : null}
        </div>
        {/* Mobile keeps a 3-column action grid; desktop keeps the original flexible toolbar. */}
        <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap md:items-center md:justify-end md:gap-2">
          <button
            type="button"
            onClick={() => {
              setFullscreenLayout('image');
              setImageOnlyFullscreen(true);
            }}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title={t('play.header.fullscreenImageTitle')}
          >
            {t('play.header.fullscreen')}
          </button>
          <button
            type="button"
            onClick={() => {
              setFullscreenLayout('split');
              setImageOnlyFullscreen(true);
            }}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title={t('play.header.fullscreenSubtitleTitle')}
          >
            {t('play.header.fullscreenSubtitle')}
          </button>
          {!isLockedFullscreen ? (
            <button
              type="button"
              onClick={() => {
                setFullscreenLayout('edit');
                setImageOnlyFullscreen(true);
              }}
              disabled={isReadOnlyProcessing}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              title={t('play.header.fullscreenEditTitle')}
            >
              {t('play.header.fullscreenEdit')}
            </button>
          ) : null}
          <div className="col-span-2 flex items-center justify-center gap-1 rounded-md border border-slate-700 px-2 py-1 md:col-span-1" title={t('play.header.imageScaleTitle')}>
            <button
              type="button"
              onClick={() => setSlideImageScale((scale) => Math.max(0.65, Number((scale - 0.1).toFixed(2))))}
              className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={slideImageScale <= 0.65}
              aria-label={t('play.header.decreaseImageScale')}
            >
              −
            </button>
            <span className="w-10 text-center text-xs tabular-nums text-slate-400">{Math.round(slideImageScale * 100)}%</span>
            <button
              type="button"
              onClick={() => setSlideImageScale((scale) => Math.min(1.35, Number((scale + 0.1).toFixed(2))))}
              className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={slideImageScale >= 1.35}
              aria-label={t('play.header.increaseImageScale')}
            >
              ＋
            </button>
          </div>
          <button
            type="button"
            onClick={() => setTtsDialogOpen(true)}
            disabled={isReadOnlyProcessing}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title={t('play.header.voiceSettings')}
            aria-label={t('play.header.voiceSettings')}
          >
            ⚙️ {t('play.header.settings')}
          </button>
          <button
            type="button"
            onClick={() => void openImageStyleDialog()}
            disabled={isReadOnlyProcessing}
            className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20"
            title={t('play.header.imageStyleSettings')}
            aria-label={t('play.header.imageStyleSettings')}
          >
            🖼️ {t('play.header.style')}
          </button>
          <button
            type="button"
            onClick={() => void handleGenerateVideo()}
            disabled={isReadOnlyProcessing || videoBusy}
            className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {videoBusy
              ? `${t('play.header.generatingVideo')}${videoProgressText ? ` ${videoProgressText}` : ''}`
              : videoUrl
                ? t('play.header.regenerateVideo')
                : t('play.header.generateVideo')}
          </button>
          <Link
            to={`/play/${encodeURIComponent(pdfId ?? '')}/quizzes`}
            className={`rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-center text-sm text-fuchsia-100 hover:bg-fuchsia-500/25 ${isReadOnlyProcessing ? 'pointer-events-none opacity-40' : ''}`}
          >
            {t('play.header.quizGeneration')}
          </Link>
          {canViewPostClassReport ? (
            <button
              type="button"
              onClick={() => void openPostClassReport()}
              className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-center text-sm text-emerald-100 hover:bg-emerald-500/25"
            >
              📊 課後報告
            </button>
          ) : null}
          {videoUrl ? (
            <a
              href={videoUrl}
              download={`${(titleInput.trim() || pdfId || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100)}.mp4`}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-200 hover:bg-cyan-500/25"
            >
              {t('play.header.downloadVideo')}
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-500 opacity-60"
              title={t('play.header.videoNotReady')}
            >
              {t('play.header.downloadVideo')}
            </button>
          )}
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/handout.pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadHandoutPdf')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/subtitles.srt`}
            download="subtitles.srt"
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadSrt')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/subtitles.vtt`}
            download="subtitles.vtt"
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadVtt')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/slides.pptx`}
            download
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadPptx')}
          </a>
          <button
            type="button"
            onClick={() => void handleSyncToGithub()}
            disabled={githubSyncBusy || isReadOnlyProcessing}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={isReadOnlyProcessing ? t('play.header.githubSyncReadOnly') : t('play.header.githubSyncTitle')}
          >
            {githubSyncBusy ? t('play.header.syncing') : `⤴ ${t('play.header.syncToGithub')}`}
          </button>
          {!currentShareToken ? (
            <div className="col-span-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-700/80 px-2 py-1 md:col-span-1">
              <select
                value={shareAccess}
                onChange={(e) => setShareAccess((e.target.value as ShareAccessMode) || 'read_only')}
                disabled={isReadOnlyProcessing}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <option value="read_only">{t('play.share.readOnlyVisible')}</option>
                <option value="editable">{t('play.share.readWriteVisible')}</option>
              </select>
              <button
                type="button"
                onClick={() => void handleCreateShareLink()}
                disabled={shareBusy || isReadOnlyProcessing}
                className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {shareBusy ? t('play.share.creating') : `▦ ${t('play.share.createLink')}`}
              </button>
              <button
                type="button"
                onClick={() => void handleMakeSharePrivate()}
                disabled={shareBusy || isReadOnlyProcessing}
                className="rounded-md border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                title={t('play.share.makePrivateTitle')}
              >
                {t('play.share.makePrivate')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {showRegenBanner ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs text-slate-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span>
                {t('play.regenBanner.task')}
                {regenJob?.status === 'running'
                  ? t('play.regenerate.status.running')
                  : regenJob?.status === 'pending'
                    ? t('play.regenerate.status.pending')
                    : regenJob?.status === 'cancelling'
                      ? t('play.regenBanner.stopping')
                    : regenJob?.status === 'cancelled'
                      ? t('play.regenBanner.stopped')
                    : regenJob?.status === 'completed'
                          ? t('play.regenerate.status.completed')
                          : t('play.regenerate.status.failed')}
                {regenJob?.last_processed_page != null
                  ? ` · ${currentRegenPageText}`
                  : ''}
              </span>
              <div className="flex items-center gap-2">
                {regenJobRunning ? (
                  <button
                    type="button"
                    onClick={() => void handleStopRegenerate()}
                    disabled={regenStopBusy}
                    className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200 disabled:opacity-40"
                  >
                    {regenStopBusy ? t('play.regenBanner.stoppingBusy') : t('play.regenBanner.stopGeneration')}
                  </button>
                ) : null}
                {regenJobTerminal && regenJob?.rollback_available ? (
                  <button
                    type="button"
                    onClick={() => void handleRollbackRegenerate()}
                    disabled={regenRollbackBusy}
                    className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 disabled:opacity-40"
                  >
                    {regenRollbackBusy ? t('play.regenBanner.rollbackBusy') : t('play.regenBanner.rollback')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRegenBannerDismissed(true)}
                  className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300"
                >
                  {t('play.regenBanner.close')}
                </button>
              </div>
            </div>
            <RegenerateProgress job={regenJob} />
            {regenAllMsg ? <p className="mt-1 text-[11px] text-slate-300">{regenAllMsg}</p> : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
