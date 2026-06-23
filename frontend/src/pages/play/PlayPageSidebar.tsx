import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { debugLog, debugWarn } from '../../lib/debugLog';
import { calculateWatchProgressPercent, formatWatchProgressBadgeCount } from '../../lib/watchProgress';
import { updatePageNote } from '../../lib/api/pdfs';
import { usePlayPageContext } from './PlayPageContext';
import { PageAskPanel } from './PageAskPanel';
import { QualityCheckPanel } from './QualityCheckPanel';
import { copyTextToClipboard } from '../../lib/clipboard';

const IMAGE_MSG_PREFIX = '[image] ';

function getOutlineTitle(page: import('../../types').PdfDetailPage, scripts: Record<number, string>): string {
  const notes = page.page_notes?.trim();
  if (notes) {
    const firstLine = notes.split('\n')[0] ?? '';
    if (firstLine.startsWith('# ')) return firstLine.slice(2).trim();
  }
  const script = scripts[page.page_number];
  if (script) {
    const text = script.trim();
    if (text.length > 0) return text.slice(0, 20) + (text.length > 20 ? '…' : '');
  }
  return '';
}

function OutlineSection() {
  const { t } = useI18n();
  const { deckPages, currentIdx, setCurrentIdx, scripts, withImageBust } = usePlayPageContext();

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-300">{t('play.sidebar.outlineTitle')}</h2>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {deckPages.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-500">{t('play.sidebar.outlineEmpty')}</p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {deckPages.map((page, idx) => {
              const isActive = idx === currentIdx;
              const label = t('play.sidebar.outlinePageLabel').replace('{page}', String(page.page_number));
              const title = getOutlineTitle(page, scripts);
              const imgSrc = page.thumbnail_url ?? page.image_url;
              return (
                <li key={page.page_number}>
                  <button
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-800/60 ${
                      isActive ? 'bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/40' : ''
                    }`}
                  >
                    <div className="h-9 w-14 shrink-0 overflow-hidden rounded border border-slate-700 bg-slate-800">
                      {imgSrc ? (
                        <img
                          src={withImageBust(imgSrc) ?? imgSrc}
                          alt={label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-500">
                          {page.page_number}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium ${isActive ? 'text-indigo-200' : 'text-slate-300'}`}>
                        {label}
                      </p>
                      {title ? (
                        <p className="truncate text-[11px] text-slate-500">{title}</p>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function PageNoteSection() {
  const { t } = useI18n();
  const { currentPage, deckPages, pdfId, isReadOnlyProcessing } = usePlayPageContext();
  const [noteText, setNoteText] = useState(currentPage?.page_notes ?? '');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const savingRef = useRef(false);

  const handleCopyAllNotes = () => {
    const lines: string[] = [];
    for (const page of deckPages) {
      const note = page.page_notes?.trim();
      if (note) {
        lines.push(`## ${t('play.sidebar.copyAllNotesPagePrefix')} ${page.page_number}\n${note}`);
      }
    }
    if (lines.length === 0) {
      setCopyMsg(t('play.sidebar.noNotesToCopy'));
      setTimeout(() => setCopyMsg(null), 2000);
      return;
    }
    void copyTextToClipboard(lines.join('\n\n')).then((ok) => {
      setCopyMsg(ok ? t('play.sidebar.copyAllNotesDone') : t('play.sidebar.copyAllNotesFail'));
      setTimeout(() => setCopyMsg(null), 2000);
    });
  };

  useEffect(() => {
    setNoteText(currentPage?.page_notes ?? '');
    setNoteMsg(null);
  }, [currentPage?.page_number]);

  const handleBlur = async () => {
    if (!pdfId || !currentPage || savingRef.current) return;
    const trimmed = noteText.trim();
    if (trimmed === (currentPage.page_notes ?? '')) return;
    savingRef.current = true;
    setNoteBusy(true);
    try {
      await updatePageNote(pdfId, currentPage.page_number, trimmed);
      setNoteMsg(t('play.sidebar.noteSaved'));
      setTimeout(() => setNoteMsg(null), 2000);
    } catch {
      setNoteMsg(t('play.sidebar.noteSaveFailed'));
    } finally {
      setNoteBusy(false);
      savingRef.current = false;
    }
  };

  if (!currentPage || isReadOnlyProcessing) return null;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-300">📝 {t('play.sidebar.pageNote')}</h2>
        <button
          type="button"
          onClick={handleCopyAllNotes}
          className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          title={t('play.sidebar.copyAllNotes')}
        >
          {copyMsg ?? t('play.sidebar.copyAllNotes')}
        </button>
      </div>
      <div className="p-3">
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => void handleBlur()}
          placeholder={t('play.sidebar.pageNotePlaceholder')}
          rows={3}
          maxLength={5000}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-indigo-400"
        />
        {noteBusy ? (
          <p className="mt-1 text-[11px] text-slate-400">…</p>
        ) : noteMsg ? (
          <p className="mt-1 text-[11px] text-emerald-300">{noteMsg}</p>
        ) : null}
      </div>
    </section>
  );
}

export function PlayPageSidebar() {
  const {
    activeTab,
    qaPanelExpanded, setQaPanelExpanded,
    isReadOnlyProcessing,
    detail,
    currentPage, currentIdx, deckPages, totalPages,
    watchProgressByPage,
    slideBusy, slideError,
    regenJobRunning, regenAllBusy,
    setRegenAllMsg,
    setRegenScriptMaxCharsPerPage,
    setRegenAllDialogOpen,
    regenSelectedPages, setRegenSelectedPages,
    handleAddSlideAfterCurrent,
    handleDeleteCurrentSlide,
    handleMoveSlide,
    handleUpdateCoverFromCurrentPage,
    setShowAddPagesModal,
    draggingPage, setDraggingPage,
    thumbLoadUntilIdx, setThumbLoadUntilIdx,
    withImageBust, handleReplaceImageFile,
    setCurrentIdx,
    pagePolls, pollQuestion, setPollQuestion,
    pollOptionsText, setPollOptionsText,
    pollBusy, aiPollBusy, pollError, pollVotes,
    pollSettingsOpen, setPollSettingsOpen,
    pollStarted,
    syncEnabled, syncRole,
    syncDisplayedPollId,
    syncPollShowResults, setSyncPollShowResults,
    handleStartPoll, handleStopPoll,
    handleVotePoll, handleResetPollVotes,
    handleDeletePoll, handleCreatePoll, handleGeneratePollDraft,
    handleSelectDisplayedPoll,
    chatHistory,
    chatInput, setChatInput,
    chatBusy, chatError,
    hasChatInput,
    chatPastedImage, setChatPastedImage,
    chatPastedImageUrl, setChatPastedImageUrl,
    clearChatPastedImage,
    chatInpaintBusy, chatInpaintError,
    imageEditSelectMode, setImageEditSelectMode,
    imageEditRegion, clearImageEditRegion,
    handleSendChat, handleClearChat,
    handleInpaintImage, handleRegenerateImageWithPrompt,
    handleRewriteScript,
    rewriteBusy, rewriteError,
    setImagePreviewUrl,
    setImagePreviewPageNumber,
    setImagePreviewOpen,
    bookmarks, toggleBookmark,
  } = usePlayPageContext();

  const { t } = useI18n();
  const formatMessage = (key: Parameters<typeof t>[0], values: Record<string, string | number>) =>
    Object.entries(values).reduce(
      (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
      t(key),
    );

  return (
    <aside
      className={`max-h-[calc(100vh-7rem)] w-full shrink-0 flex-col gap-3 overflow-y-auto md:flex md:w-[360px] ${
        activeTab === 'qa' ? 'flex' : 'hidden'
      }`}
    >
      <section className={`rounded-lg border border-slate-800 bg-slate-900/40 ${qaPanelExpanded ? 'md:hidden' : ''}`}>
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-300">🧩 {t('play.sidebar.slideManagement')}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isReadOnlyProcessing) return;
                  // 若非執行中才清掉舊訊息；執行中時保留以便顯示進度。
                  if (!regenJobRunning) {
                    setRegenAllMsg(null);
                  }
                  const fallback = 350;
                  const fromDetail = detail?.script_max_chars_per_page;
                  const nextMaxChars =
                    typeof fromDetail === 'number' && Number.isFinite(fromDetail)
                      ? Math.max(80, Math.min(2000, Math.round(fromDetail)))
                      : fallback;
                  setRegenScriptMaxCharsPerPage(nextMaxChars);
                  setRegenAllDialogOpen(true);
                }}
                disabled={isReadOnlyProcessing}
                className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-2 py-1 text-xs text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                title={t('play.sidebar.regenerateTitle')}
              >
                {regenJobRunning
                  ? t('play.sidebar.regenerating')
                  : regenAllBusy
                    ? t('play.sidebar.starting')
                    : t('play.sidebar.regenerate')}
              </button>
              <button
                type="button"
                onClick={() => void handleAddSlideAfterCurrent()}
                disabled={isReadOnlyProcessing || slideBusy || !currentPage}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200 disabled:opacity-40"
              >
                {t('play.sidebar.add')}
              </button>
              <button
                type="button"
                onClick={() => setShowAddPagesModal(true)}
                disabled={isReadOnlyProcessing || slideBusy}
                className="rounded-md border border-indigo-500/50 bg-indigo-500/15 px-2 py-1 text-xs text-indigo-200 disabled:opacity-40"
                title={t('play.sidebar.addMultipleTitle')}
              >
                {t('play.sidebar.addMultiple')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteCurrentSlide()}
                disabled={isReadOnlyProcessing || slideBusy || !currentPage || totalPages <= 1}
                className="rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-xs text-rose-200 disabled:opacity-40"
              >
                {t('play.sidebar.delete')}
              </button>
            </div>
          </div>
          {slideError ? <p className="mt-2 text-xs text-rose-300">{slideError}</p> : null}
        </div>
        <div
          className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto p-3"
          onDragOver={(e) => {
            e.preventDefault();
            if (isReadOnlyProcessing) return;
            e.dataTransfer.dropEffect = 'move';
          }}
          onDropCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isReadOnlyProcessing) return;
            const fromText =
              e.dataTransfer.getData('application/x-page-number') ||
              e.dataTransfer.getData('text/plain');
            const fromPage = Number(fromText);
            const targetEl = (e.target as HTMLElement | null)?.closest('[data-page-number]') as HTMLElement | null;
            const toPage = Number(targetEl?.dataset.pageNumber || '');
            debugLog('[reorder][drop-capture]', { fromText, fromPage, toPage, hasTarget: !!targetEl });
            if (Number.isFinite(fromPage) && fromPage > 0 && Number.isFinite(toPage) && toPage > 0 && fromPage !== toPage) {
              void handleMoveSlide(fromPage, toPage);
            }
          }}
          onPaste={(e) => {
            debugLog('[paste][thumb-grid] event fired', {
              itemCount: e.clipboardData.items.length,
              items: Array.from(e.clipboardData.items).map((it) => ({ kind: it.kind, type: it.type })),
            });
            if (isReadOnlyProcessing) return;
            const file = Array.from(e.clipboardData.items)
              .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
              .find((f): f is File => !!f);
            if (!file) {
              debugWarn('[paste][thumb-grid] no file found');
            }
            if (file) void handleReplaceImageFile(file);
          }}
          tabIndex={0}
        >
          {deckPages.map((p, idx) => (
            <div
              key={p.page_number}
              data-page-number={p.page_number}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  setRegenSelectedPages((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.page_number)) next.delete(p.page_number);
                    else next.add(p.page_number);
                    return next;
                  });
                } else if (e.shiftKey) {
                  e.preventDefault();
                  const from = Math.min(currentIdx, idx);
                  const to = Math.max(currentIdx, idx);
                  setRegenSelectedPages((prev) => {
                    const next = new Set(prev);
                    for (let i = from; i <= to; i++) {
                      const page = deckPages[i];
                      if (page) next.add(page.page_number);
                    }
                    return next;
                  });
                } else {
                  setCurrentIdx(idx);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (isReadOnlyProcessing) return;
                // Reorder is handled by parent onDropCapture to avoid double requests.
                const f = e.dataTransfer.files?.[0];
                if (f) void handleReplaceImageFile(f, p.page_number);
              }}
              onPaste={(e) => {
                if (isReadOnlyProcessing) return;
                const file = Array.from(e.clipboardData.items)
                  .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
                  .find((f): f is File => !!f);
                if (file) void handleReplaceImageFile(file, p.page_number);
              }}
              className={`relative overflow-hidden rounded border ${
                regenSelectedPages.has(p.page_number)
                  ? 'border-fuchsia-400 ring-1 ring-fuchsia-500/50'
                  : idx === currentIdx
                    ? 'border-cyan-400'
                    : 'border-slate-700'
              } ${draggingPage === p.page_number ? 'opacity-50' : ''}`}
              title={t('play.sidebar.thumbnailTitle')
                .replace('{page}', String(p.page_number))
                .replace('{selected}', regenSelectedPages.has(p.page_number) ? t('play.sidebar.thumbnailSelectedSuffix') : '')}
            >
              <button
                type="button"
                draggable={!isReadOnlyProcessing && !slideBusy}
                onDragStart={(e) => {
                  if (isReadOnlyProcessing) {
                    e.preventDefault();
                    return;
                  }
                  setDraggingPage(p.page_number);
                  e.dataTransfer.setData('application/x-page-number', String(p.page_number));
                  e.dataTransfer.setData('text/plain', String(p.page_number));
                  e.dataTransfer.effectAllowed = 'move';
                  debugLog('[reorder][dragstart]', { page: p.page_number });
                }}
                onDragEnd={() => {
                  setDraggingPage(null);
                  debugLog('[reorder][dragend]', { page: p.page_number });
                }}
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-0 z-10 rounded-bl bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-200 cursor-grab active:cursor-grabbing"
                title={t('play.sidebar.dragToReorder')}
              >
                ↕
              </button>
              {(() => {
                const thumbSrc = isReadOnlyProcessing
                  ? p.image_url
                  : (p.thumbnail_url ?? p.image_url);
                const shouldLoadThumb = idx <= thumbLoadUntilIdx || idx === currentIdx;
                return thumbSrc && shouldLoadThumb ? (
                <img
                  src={withImageBust(thumbSrc) ?? thumbSrc}
                  alt={t('play.sidebar.thumbnailAlt').replace('{page}', String(p.page_number))}
                  className="h-14 w-full object-cover"
                  onLoad={() => {
                    setThumbLoadUntilIdx((prev) => {
                      const next = idx + 1;
                      if (next >= deckPages.length) return prev;
                      return Math.max(prev, next);
                    });
                  }}
                  onError={(e) => {
                    setThumbLoadUntilIdx((prev) => {
                      const next = idx + 1;
                      if (next >= deckPages.length) return prev;
                      return Math.max(prev, next);
                    });
                    const img = e.currentTarget;
                    const fallback = p.image_url;
                    if (!fallback || img.dataset.fallbackApplied === 'true') {
                      img.style.display = 'none';
                      return;
                    }
                    img.dataset.fallbackApplied = 'true';
                    img.src = withImageBust(fallback) ?? fallback;
                  }}
                />
                ) : (
                <div className="flex h-14 w-full items-center justify-center bg-slate-800 text-[10px] text-slate-400">
                  {thumbSrc ? t('play.sidebar.loading') : t('play.sidebar.noImage')}
                </div>
                );
              })()}
              {p.render_type === 'gsap-image' ? (
                <span className="absolute bottom-0 left-0 z-10 rounded-tr bg-fuchsia-600/80 px-1 text-[9px] text-white">
                  {t('play.animation.badge')}
                </span>
              ) : null}
              {(() => {
                if (!detail?.is_owner) return null;
                const stats = watchProgressByPage.get(p.page_number);
                if (!stats || stats.total_viewers <= 0) return null;
                const badgeText = formatWatchProgressBadgeCount(stats);
                if (badgeText == null) return null;
                const percent = calculateWatchProgressPercent(stats);
                const avgListenedPercent = stats.avg_listened_ratio != null
                  ? Math.round(stats.avg_listened_ratio * 100)
                  : null;
                const tooltip = formatMessage('play.sidebar.watchProgress.tooltip', {
                  total: stats.total_viewers,
                  completed: stats.completed_viewers,
                  percent: percent ?? 0,
                  avgListenedPercent: avgListenedPercent ?? 0,
                });
                return (
                  <span
                    className="absolute bottom-0 right-0 z-10 rounded-tl bg-emerald-600/80 px-1 text-[9px] text-white"
                    title={tooltip}
                  >
                    {formatMessage('play.sidebar.watchProgress.badge', { count: badgeText })}
                  </span>
                );
              })()}
            </div>
          ))}
        </div>
        {regenSelectedPages.size > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5">
            <span className="text-xs text-fuchsia-300">
              {t('play.sidebar.selectedRegenerate').replace('{count}', String(regenSelectedPages.size))}
            </span>
            <button
              type="button"
              onClick={() => setRegenSelectedPages(new Set())}
              className="text-xs text-fuchsia-400 hover:text-fuchsia-200"
            >
              {t('play.sidebar.clear')}
            </button>
          </div>
        ) : (
          <div className="border-t border-slate-800/50 px-3 py-1">
            <p className="text-[10px] text-slate-600">{t('play.sidebar.multiSelectHint')}</p>
          </div>
        )}
        <div className="border-t border-slate-800 px-3 py-2">
          <button
            type="button"
            onClick={() => void handleUpdateCoverFromCurrentPage()}
            disabled={slideBusy || !currentPage?.image_url}
            className="w-full rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={t('play.sidebar.setCoverTitle')}
          >
            {t('play.sidebar.setCover')}
          </button>
        </div>
      </section>

      <PageNoteSection />

      <section className={`rounded-lg border border-slate-800 bg-slate-900/40 ${qaPanelExpanded ? 'md:hidden' : ''}`}>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-300">📊 Realtime Poll</h2>
            <p className="text-[11px] text-slate-500">
              {pollStarted
                ? formatMessage('play.sidebar.poll.activePage', { page: currentPage?.page_number ?? '-' })
                : t('play.sidebar.poll.notStarted')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPollSettingsOpen((v) => !v)}
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {pollSettingsOpen ? t('play.sidebar.poll.collapseSettings') : t('play.sidebar.poll.settings')}
            </button>
            {pollStarted ? (
              <button
                type="button"
                onClick={handleStopPoll}
                className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
              >
                {t('play.sidebar.poll.stop')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartPoll}
                disabled={!currentPage}
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('play.sidebar.poll.start')}
              </button>
            )}
            {syncEnabled && syncRole === 'master' && pollStarted ? (
              <button
                type="button"
                onClick={() => setSyncPollShowResults((v) => !v)}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20"
              >
                {syncPollShowResults ? t('play.sidebar.poll.hideResults') : t('play.sidebar.poll.showResults')}
              </button>
            ) : null}
          </div>
        </div>
        {(pollSettingsOpen || pollStarted || pollError) && (
          <div className="space-y-2 border-t border-slate-800 p-2">
            {pollSettingsOpen && (
              <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                <button
                  type="button"
                  onClick={() => void handleGeneratePollDraft()}
                  disabled={aiPollBusy || !currentPage}
                  className="mb-2 w-full rounded-md border border-violet-500/50 bg-violet-500/10 px-2 py-1 text-xs text-violet-300 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {aiPollBusy ? t('play.sidebar.poll.aiDraftGenerating') : t('play.sidebar.poll.aiDraft')}
                </button>
                <input
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  maxLength={300}
                  placeholder={t('play.sidebar.poll.questionPlaceholder')}
                  className="mb-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-500 focus:ring"
                />
                <textarea
                  value={pollOptionsText}
                  onChange={(e) => setPollOptionsText(e.target.value)}
                  rows={2}
                  placeholder={t('play.sidebar.poll.optionsPlaceholder')}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-500 focus:ring"
                />
                <button
                  type="button"
                  onClick={() => void handleCreatePoll()}
                  disabled={pollBusy || !currentPage}
                  className="mt-2 w-full rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pollBusy ? t('play.sidebar.poll.processing') : t('play.sidebar.poll.createAndStart')}
                </button>
              </div>
            )}
            {pollError ? <p className="text-xs text-rose-300">{pollError}</p> : null}

            {(pollStarted || pollSettingsOpen) && (
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {pagePolls.length === 0 ? (
                  <div className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-xs text-slate-500">
                    {pollStarted ? t('play.sidebar.poll.emptyStarted') : t('play.sidebar.poll.empty')}
                  </div>
                ) : (
                  pagePolls.map((poll) => (
                    <div key={poll.id} className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="text-xs font-medium text-slate-200">{poll.question}</h3>
                        <span className="shrink-0 rounded-full border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {formatMessage('play.sidebar.poll.voteCount', { count: poll.total_votes })}
                        </span>
                      </div>
                      {syncEnabled && syncRole === 'master' ? (
                        <div className="mb-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSelectDisplayedPoll(poll.id)}
                            className={`rounded border px-2 py-1 text-[11px] ${
                              syncDisplayedPollId === poll.id
                                ? 'border-cyan-300/80 bg-cyan-500/30 text-cyan-50'
                                : 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                            }`}
                          >
                            {syncDisplayedPollId === poll.id
                              ? t('play.sidebar.poll.currentlyDisplayed')
                              : t('play.sidebar.poll.showOnFullscreen')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResetPollVotes(poll.id)}
                            disabled={pollBusy || poll.total_votes === 0}
                            className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('play.sidebar.poll.clearResults')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePoll(poll.id)}
                            disabled={pollBusy}
                            className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('play.sidebar.poll.deleteQuestion')}
                          </button>
                        </div>
                      ) : null}
                      <div className="space-y-1.5">
                        {poll.options.map((option, idx) => {
                          const ratio = poll.total_votes > 0 ? Math.round((option.votes / poll.total_votes) * 100) : 0;
                          const selected = pollVotes[poll.id] === idx;
                          return (
                            <button
                              key={`${poll.id}-${idx}`}
                              type="button"
                              onClick={() => void handleVotePoll(poll.id, idx)}
                              disabled={pollBusy || !poll.is_active}
                              className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${selected ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100' : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800'} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="truncate">{option.text}</span>
                                <span className="font-mono text-[10px] text-slate-400">{option.votes} · {ratio}%</span>
                              </div>
                              <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                                <div className="h-full rounded-full bg-cyan-400" style={{ width: `${ratio}%` }} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className={`rounded-lg border border-slate-800 bg-slate-900/40 ${qaPanelExpanded ? 'md:hidden' : ''}`}>
        <div className="border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-300">{t('play.sidebar.bookmarksTitle')}</h2>
        </div>
        <div className="px-4 py-3">
          {bookmarks.length === 0 ? (
            <p className="text-xs text-slate-500">{t('play.sidebar.bookmarksEmpty')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {bookmarks.map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentIdx(pageNum - 1)}
                  className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/20"
                  title={t('play.sidebar.bookmarkRemove')}
                >
                  <span>🔖 第 {pageNum} 頁</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(pageNum); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleBookmark(pageNum); } }}
                    className="ml-0.5 text-amber-400/60 hover:text-amber-300"
                    aria-label={t('play.sidebar.bookmarkRemove')}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <OutlineSection />

      <PageAskPanel />

      <QualityCheckPanel />

      <PageNoteSection />

      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-slate-300">
          💬 {t('play.sidebar.qa.title')}
        </h2>
        <button
          type="button"
          onClick={() => setQaPanelExpanded((v) => !v)}
          className="hidden shrink-0 rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 md:inline-flex"
          aria-pressed={qaPanelExpanded}
          title={qaPanelExpanded ? t('play.sidebar.qa.restoreSidebarTitle') : t('play.sidebar.qa.expandSidebarTitle')}
        >
          {qaPanelExpanded ? t('play.sidebar.qa.restore') : t('play.sidebar.qa.expand')}
        </button>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleClearChat()}
          disabled={isReadOnlyProcessing || chatBusy || chatHistory.length === 0}
          className="rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('play.sidebar.qa.clearAllMessages')}
        </button>
      </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {chatHistory.length === 0 ? (
          <div className="text-slate-500">{t('play.sidebar.qa.emptyChat')}</div>
        ) : (
          chatHistory.map((m, idx) => (
            <div key={idx} className={m.role === 'user' ? 'text-slate-100' : 'text-emerald-200'}>
              <span className="mr-2 text-xs uppercase opacity-70">{m.role === 'user' ? t('play.sidebar.qa.roleUser') : t('play.sidebar.qa.roleAssistant')}</span>
              {m.role === 'assistant' && m.content.startsWith(IMAGE_MSG_PREFIX) ? (
                <button
                  type="button"
                  onClick={() => {
                    const url = m.content.slice(IMAGE_MSG_PREFIX.length).trim();
                    if (!url) return;
                    setImagePreviewUrl(url);
                    setImagePreviewPageNumber(currentPage?.page_number ?? null);
                    setImagePreviewOpen(true);
                  }}
                  className="inline-block overflow-hidden rounded-md border border-cyan-500/40 hover:border-cyan-300"
                  title={t('play.sidebar.qa.previewImageTitle')}
                >
                  <img src={m.content.slice(IMAGE_MSG_PREFIX.length).trim()} alt={t('play.sidebar.qa.generatedImageAlt')} className="max-h-36 w-auto" />
                </button>
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="border-t border-slate-800 p-3">
        <div className="flex flex-col gap-2">
          {/* Reference image thumbnail (paste from clipboard) */}
          {chatPastedImageUrl && (
            <div className="flex items-center gap-2">
              <div className="relative inline-block shrink-0">
                <img
                  src={chatPastedImageUrl}
                  alt={t('play.sidebar.qa.referenceImageAlt')}
                  className="max-h-16 w-auto rounded border border-slate-600 object-contain"
                />
                <button
                  type="button"
                  onClick={clearChatPastedImage}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[10px] text-slate-200 hover:bg-rose-600"
                  title={t('play.sidebar.qa.removeReferenceImage')}
                >✕</button>
              </div>
              <p className="text-xs text-slate-400">{t('play.sidebar.qa.referenceImageLabel')}</p>
            </div>
          )}
          {/* Region selection status */}
          {imageEditRegion && (
            <div className="flex items-center gap-2 text-xs text-cyan-400">
              <span>{t('play.sidebar.qa.regionSelected')}</span>
              <button
                type="button"
                onClick={clearImageEditRegion}
                className="text-slate-400 hover:text-rose-400"
              >{t('play.sidebar.qa.clearRegion')}</button>
            </div>
          )}
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (isReadOnlyProcessing) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSendChat();
              }
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items ?? []);
              const imgItem = items.find((it) => it.kind === 'file' && /^image\//i.test(it.type));
              if (!imgItem) return;
              e.preventDefault();
              const file = imgItem.getAsFile();
              if (!file) return;
              clearChatPastedImage();
              setChatPastedImage(file);
              setChatPastedImageUrl(URL.createObjectURL(file));
            }}
            rows={3}
            disabled={isReadOnlyProcessing}
            placeholder={isReadOnlyProcessing ? t('play.sidebar.qa.readOnlyPlaceholder') : t('play.sidebar.qa.inputPlaceholder')}
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Region select toggle */}
            {!isReadOnlyProcessing && currentPage?.image_url && (
              <button
                type="button"
                onClick={() => {
                  setImageEditSelectMode((v) => {
                    if (v) clearImageEditRegion();
                    return !v;
                  });
                }}
                aria-pressed={imageEditSelectMode}
                className={`rounded-md border px-3 py-2 text-sm ${
                  imageEditSelectMode
                    ? 'border-cyan-400/70 bg-cyan-500/25 text-cyan-100'
                    : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
                }`}
                title={t('play.sidebar.qa.selectRegionTitle')}
              >
                {imageEditSelectMode ? t('play.sidebar.qa.cancelRegionSelection') : t('play.sidebar.qa.selectRegion')}
              </button>
            )}
            {/* Inpaint or regenerate */}
            {(imageEditRegion || chatPastedImage) ? (
              <button
                type="button"
                onClick={() => void handleInpaintImage()}
                disabled={isReadOnlyProcessing || chatInpaintBusy || !currentPage}
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {chatInpaintBusy ? t('play.sidebar.qa.editing') : t('play.sidebar.qa.editImage')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRegenerateImageWithPrompt()}
                disabled={isReadOnlyProcessing || slideBusy || !currentPage}
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('play.sidebar.qa.editImage')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleRewriteScript()}
              disabled={isReadOnlyProcessing || rewriteBusy || !hasChatInput}
              className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rewriteBusy ? t('play.sidebar.qa.editing') : t('play.sidebar.qa.editTranscript')}
            </button>
            <button
              type="button"
              onClick={() => void handleSendChat()}
              disabled={isReadOnlyProcessing || chatBusy || !hasChatInput}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chatBusy ? t('play.sidebar.qa.asking') : t('play.sidebar.qa.ask')}
            </button>
          </div>
        </div>
        {chatError ? <p className="mt-1 text-xs text-rose-300">{chatError}</p> : null}
        {rewriteError ? <p className="mt-1 text-xs text-rose-300">{rewriteError}</p> : null}
        {chatInpaintError ? <p className="mt-1 text-xs text-rose-300">{chatInpaintError}</p> : null}
      </div>
      </section>
    </aside>
  );
}
