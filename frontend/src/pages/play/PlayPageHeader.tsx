import { Link } from 'react-router-dom';
import { RegenerateProgress } from './RegenerateProgress';
import type { ShareAccessMode } from '../../lib/api';
import { usePlayPageContext } from './PlayPageContext';

export function PlayPageHeader() {
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
    githubSyncBusy, handleSyncToGithub,
    regenJob, regenAllMsg,
    regenJobRunning, regenJobTerminal,
    regenStopBusy, regenRollbackBusy,
    setRegenBannerDismissed,
    showRegenBanner,
    handleStopRegenerate, handleRollbackRegenerate,
  } = usePlayPageContext();

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3">
        {!currentShareToken ? (
          <Link
            to="/"
            className="shrink-0 whitespace-nowrap rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 sm:px-3 sm:text-sm"
          >
            ← 返回
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
            {titleBusy ? '儲存中…' : '更新標題'}
          </button>
          <button
            type="button"
            onClick={() => void handleRegenerateTitle()}
            disabled={isReadOnlyProcessing || titleBusy}
            className="shrink-0 whitespace-nowrap rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-1.5 py-1 text-[11px] text-fuchsia-200 disabled:opacity-40 sm:px-2 sm:text-xs"
          >
            {titleBusy ? '處理中…' : '重新生成標題'}
          </button>
        </div>
          <div className="shrink-0 whitespace-nowrap text-right text-xs text-slate-400 sm:w-20 sm:text-sm">
            頁 {currentIdx + 1}/{totalPages}
          </div>
          <label className="ml-2 inline-flex items-center gap-1 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(e) => handleSyncEnabledChange(e.target.checked)}
            />
            同步模式
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
                    placeholder="輸入要問 master 的問題"
                    className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSubmitFollowerQuestion()}
                    disabled={!syncFollowerQuestionInput.trim()}
                    className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1 text-cyan-100 disabled:opacity-40"
                  >
                    送出問題
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-slate-100">
                      Follower 問題：{syncFollowerQuestions.length} 題
                      <span className="ml-2 text-slate-400">按 a 讓 AI 總結並回答</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleDisplayedQuestion()}
                        disabled={syncFollowerQuestions.length === 0}
                        className="rounded border border-slate-600 px-2 py-1 text-slate-200 disabled:opacity-40"
                      >
                        {syncDisplayedQuestionId ? '隱藏問題' : '顯示最新問題'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAiAnswerFollowerQuestions()}
                        disabled={syncAiAnswerBusy || syncFollowerQuestions.length === 0}
                        className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-emerald-100 disabled:opacity-40"
                      >
                        {syncAiAnswerBusy ? 'AI 回答中…' : 'AI 總結回答 (a)'}
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
                        <span className="text-cyan-300">{q.code || '匿名'}：</span>{q.question}
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
            <span className="font-medium">產生失敗：</span>
            <span className="whitespace-pre-wrap">{detail.error_message}</span>
          </div>
        </div>
      ) : null}
      {currentPage?.status === 'failed' && currentPage.error_message ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <span className="font-medium">第 {currentPage.page_number} 頁產生失敗：</span>
            <span className="whitespace-pre-wrap">{currentPage.error_message}</span>
          </div>
        </div>
      ) : null}
      {detail?.status === 'awaiting_script_confirmation' ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="flex flex-col gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">AI 分頁與逐字稿已產生！</p>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                您可以在下方瀏覽並編輯每一頁的文字內容。確認無誤後，請點擊右側按鈕開始產生投影片圖片與語音。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleConfirmScript()}
              disabled={confirmScriptBusy}
              className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmScriptBusy ? '處理中…' : '確認分頁並開始產生圖片與語音'}
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
        {/* 手機：一排 3 欄（設定 / 產生影片 / 下載影片）；桌面：維持原本 flex 排列。
            註：「重生」按鍵已搬到右側問答區（aside）。 */}
        <div className="grid grid-cols-3 gap-2 md:flex md:flex-wrap md:items-center md:justify-end md:gap-2">
          <button
            type="button"
            onClick={() => {
              setFullscreenLayout('image');
              setImageOnlyFullscreen(true);
            }}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title="全螢幕圖片模式"
          >
            全螢幕
          </button>
          <button
            type="button"
            onClick={() => {
              setFullscreenLayout('split');
              setImageOnlyFullscreen(true);
            }}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title="全螢幕字幕模式（左圖右字，整頁字幕一次顯示）"
          >
            全螢幕字幕
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
              title="全螢幕編輯模式（左圖右逐字稿，可直接編輯並重生語音）"
            >
              全螢幕編輯
            </button>
          ) : null}
          <div className="col-span-2 flex items-center justify-center gap-1 rounded-md border border-slate-700 px-2 py-1 md:col-span-1" title="調整圖片與下方資料區比例">
            <button
              type="button"
              onClick={() => setSlideImageScale((scale) => Math.max(0.65, Number((scale - 0.1).toFixed(2))))}
              className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={slideImageScale <= 0.65}
              aria-label="縮小圖片區"
            >
              −
            </button>
            <span className="w-10 text-center text-xs tabular-nums text-slate-400">{Math.round(slideImageScale * 100)}%</span>
            <button
              type="button"
              onClick={() => setSlideImageScale((scale) => Math.min(1.35, Number((scale + 0.1).toFixed(2))))}
              className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={slideImageScale >= 1.35}
              aria-label="放大圖片區"
            >
              ＋
            </button>
          </div>
          <button
            type="button"
            onClick={() => setTtsDialogOpen(true)}
            disabled={isReadOnlyProcessing}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title="語音設定"
            aria-label="語音設定"
          >
            ⚙️ 設定
          </button>
          <button
            type="button"
            onClick={() => void openImageStyleDialog()}
            disabled={isReadOnlyProcessing}
            className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20"
            title="圖片風格設定"
            aria-label="圖片風格設定"
          >
            🖼️ 風格
          </button>
          <button
            type="button"
            onClick={() => void handleGenerateVideo()}
            disabled={isReadOnlyProcessing || videoBusy}
            className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {videoBusy
              ? `產生影片中…${videoProgressText ? ` ${videoProgressText}` : ''}`
              : videoUrl
                ? '重新產生影片'
                : '產生影片'}
          </button>
          <Link
            to={`/play/${encodeURIComponent(pdfId ?? '')}/quizzes`}
            className={`rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-center text-sm text-fuchsia-100 hover:bg-fuchsia-500/25 ${isReadOnlyProcessing ? 'pointer-events-none opacity-40' : ''}`}
          >
            測驗生成
          </Link>
          {videoUrl ? (
            <a
              href={videoUrl}
              download={`${(titleInput.trim() || pdfId || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100)}.mp4`}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-200 hover:bg-cyan-500/25"
            >
              下載影片
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-500 opacity-60"
              title="尚未產生影片"
            >
              下載影片
            </button>
          )}
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/handout.pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            下載講義 PDF
          </a>
          <button
            type="button"
            onClick={() => void handleSyncToGithub()}
            disabled={githubSyncBusy}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title="將此簡報同步到設定中的 GitHub repository"
          >
            {githubSyncBusy ? '同步中…' : '⤴ 同步到 GitHub'}
          </button>
          {!currentShareToken ? (
            <div className="col-span-3 flex items-center gap-2 rounded-md border border-slate-700/80 px-2 py-1 md:col-span-1">
              <select
                value={shareAccess}
                onChange={(e) => setShareAccess((e.target.value as ShareAccessMode) || 'read_only')}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
              >
                <option value="read_only">分享唯讀</option>
                <option value="editable">分享可編輯</option>
              </select>
              <button
                type="button"
                onClick={() => void handleCreateShareLink()}
                disabled={shareBusy}
                className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/25 disabled:opacity-40"
              >
                {shareBusy ? '建立中…' : '▦ 建立分享連結'}
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
                重生任務：
                {regenJob?.status === 'running'
                  ? '執行中'
                  : regenJob?.status === 'pending'
                    ? '等待中'
                    : regenJob?.status === 'cancelling'
                      ? '停止中'
                      : regenJob?.status === 'cancelled'
                        ? '已停止'
                        : regenJob?.status === 'completed'
                          ? '已完成'
                          : '失敗'}
                {regenJob?.last_processed_page != null
                  ? ` · 目前頁 ${regenJob.last_processed_page}`
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
                    {regenStopBusy ? '停止中…' : '停止生成'}
                  </button>
                ) : null}
                {regenJobTerminal && regenJob?.rollback_available ? (
                  <button
                    type="button"
                    onClick={() => void handleRollbackRegenerate()}
                    disabled={regenRollbackBusy}
                    className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 disabled:opacity-40"
                  >
                    {regenRollbackBusy ? '還原中…' : '還原'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRegenBannerDismissed(true)}
                  className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300"
                >
                  關閉
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
