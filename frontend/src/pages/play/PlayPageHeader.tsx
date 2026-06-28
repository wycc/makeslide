import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RegenerateProgress } from './RegenerateProgress';
import type { ShareAccessMode } from '../../lib/api';
import { fetchSyncAttendees, generatePdfDescription } from '../../lib/api';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { SyncQuestionsPanel } from './SyncQuestionsPanel';
import { copyTextToClipboard } from '../../lib/clipboard';
import { progressPercent } from '../../lib/progressPercent';
import {
  stepSlideImageScale,
  SLIDE_IMAGE_SCALE_MIN,
  SLIDE_IMAGE_SCALE_MAX,
  SLIDE_IMAGE_SCALE_STEP,
} from '../../lib/slideImageScale';
import { shouldCloseOnOutsidePointer, isDropdownDismissKey } from './headerDropdownDismiss';

function CopyLinkButton({ shareUrl }: { shareUrl?: string }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState<string | null>(null);
  const handleCopy = () => {
    const url = shareUrl || window.location.href;
    void copyTextToClipboard(url).then((ok) => {
      setMsg(ok ? t('play.header.copyLinkDone') : t('play.header.copyLinkFail'));
      setTimeout(() => setMsg(null), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 text-sm text-sky-100 hover:bg-sky-500/25"
      title={t('play.header.copyLink')}
    >
      {msg ?? t('play.header.copyLink')}
    </button>
  );
}

function ShortcutsButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Global "?" hotkey toggles the help overlay, ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shortcuts: [string, string][] = [
    ['?', t('play.shortcuts.showHelp')],
    ['← / →', t('play.shortcuts.prevPage') + ' / ' + t('play.shortcuts.nextPage')],
    ['Space', t('play.shortcuts.spaceFullscreen')],
    ['Space', t('play.shortcuts.spaceNormal')],
    ['G', t('play.shortcuts.gotoPage')],
    ['B', t('play.shortcuts.nextBookmark')],
    ['Shift + B', t('play.shortcuts.prevBookmark')],
    ['N', t('play.shortcuts.nextImportant')],
    ['Shift + N', t('play.shortcuts.prevImportant')],
    ['I', t('play.shortcuts.toggleImportant')],
    ['W', t('play.shortcuts.toggleDraw')],
    ['P', t('play.shortcuts.pollControl')],
    ['A', t('play.shortcuts.aiAnswer')],
    ['Esc', t('play.shortcuts.exitEsc')],
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        title={t('play.header.keyboardShortcutsTitle')}
      >
        ? {t('play.header.keyboardShortcuts')}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-semibold text-text">
              {t('play.header.keyboardShortcutsTitle')}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {shortcuts.map(([key, desc]) => (
                  <tr key={key + desc} className="border-b border-border-light">
                    <td className="py-1.5 pr-4 font-mono text-primary dark:text-cyan-300">{key}</td>
                    <td className="py-1.5 text-muted">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 rounded-md border border-border px-4 py-1.5 text-sm text-muted hover:bg-surface-muted dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('play.shortcuts.close')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function HeaderDropdown({
  id,
  label,
  children,
  accent = 'slate',
  open,
  onOpenChange,
}: {
  id: string;
  label: string;
  children: ReactNode;
  accent?: 'slate' | 'cyan' | 'violet' | 'emerald' | 'amber';
  open: boolean;
  onOpenChange: (id: string | null) => void;
}) {
  const accentClass = {
    slate:
      'border-border bg-surface text-text hover:bg-surface-muted md:bg-transparent ' +
      'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:md:bg-transparent dark:md:hover:bg-slate-800/80',
    cyan:
      'border-cyan-300 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 ' +
      'dark:border-cyan-500/60 dark:bg-cyan-950 dark:text-cyan-100 dark:hover:bg-cyan-900 dark:md:bg-cyan-500/10 dark:md:hover:bg-cyan-500/20',
    violet:
      'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 ' +
      'dark:border-violet-500/60 dark:bg-violet-950 dark:text-violet-100 dark:hover:bg-violet-900 dark:md:bg-violet-500/10 dark:md:hover:bg-violet-500/20',
    emerald:
      'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 ' +
      'dark:border-emerald-500/60 dark:bg-emerald-950 dark:text-emerald-100 dark:hover:bg-emerald-900 dark:md:bg-emerald-500/10 dark:md:hover:bg-emerald-500/20',
    amber:
      'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 ' +
      'dark:border-amber-500/60 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900 dark:md:bg-amber-500/10 dark:md:hover:bg-amber-500/20',
  }[accent];
  const rootRef = useRef<HTMLDetailsElement>(null);

  // Close on Escape or a pointer-down outside the menu — a controlled <details>
  // does neither on its own, so an open dropdown would otherwise linger.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      const inside = !!root && event.target instanceof Node && root.contains(event.target);
      if (shouldCloseOnOutsidePointer(open, inside)) onOpenChange(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (isDropdownDismissKey(event.key)) onOpenChange(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <details
      ref={rootRef}
      open={open}
      className="group relative z-[100]"
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(open ? null : id);
        }}
        className={`flex cursor-pointer list-none items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors [&::-webkit-details-marker]:hidden ${accentClass}`}
      >
        {label}
        <span className="text-[10px] opacity-70 transition-transform group-open:rotate-180">▼</span>
      </summary>
      <div
        className="static z-[100] mt-2 w-full translate-x-0 rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-2xl shadow-black/40 md:absolute md:left-1/2 md:w-72 md:-translate-x-1/2 md:bg-slate-950/95 md:backdrop-blur"
        onClick={(event) => {
          const target = event.target as HTMLElement | null;
          const menuItem = target?.closest('button,a');
          if (!menuItem) return;
          if (menuItem instanceof HTMLButtonElement && menuItem.disabled) return;
          onOpenChange(null);
        }}
      >
        <div className="grid gap-2">
          {children}
        </div>
      </div>
    </details>
  );
}

export function PlayPageHeader() {
  const { t } = useI18n();
  const {
    currentShareToken,
    titleInput, setTitleInput,
    titleBusy, titleMsg,
    tagsInput, setTagsInput, tagsBusy, tagsMsg, handleSaveTags,
    descriptionInput, setDescriptionInput, descriptionBusy, descriptionMsg, handleSaveDescription,
    videoError,
    shareMessage, shareError,
    githubSyncMessage, githubSyncError,
    currentIdx, totalPages,
    syncEnabled, syncRole, syncError,
    handleSyncEnabledChange,
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
    shareExpiresDays, setShareExpiresDays,
    shareBusy,
    scripts,
    handleCreateShareLink,
    handleMakeSharePrivate,
    canViewPostClassReport,
    openPostClassReport,
    shareUrl,
    githubSyncBusy, handleSyncToGithub,
    regenJob, regenAllMsg,
    regenJobRunning, regenJobTerminal,
    regenStopBusy, regenRollbackBusy,
    setRegenBannerDismissed,
    showRegenBanner,
    handleStopRegenerate, handleRollbackRegenerate,
  } = usePlayPageContext();

  const [editingTitle, setEditingTitle] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptCopyDone, setPromptCopyDone] = useState(false);
  const [descCopyDone, setDescCopyDone] = useState(false);
  const [genDescBusy, setGenDescBusy] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const titleBeforeEdit = useRef('');
  const inlineTitleRef = useRef<HTMLInputElement>(null);

  const startEditTitle = () => {
    if (isReadOnlyProcessing || currentShareToken) return;
    titleBeforeEdit.current = titleInput;
    setEditingTitle(true);
    setTimeout(() => inlineTitleRef.current?.select(), 0);
  };

  const commitTitleEdit = () => {
    setEditingTitle(false);
    if (titleInput.trim()) {
      void handleSaveTitle();
    } else {
      setTitleInput(titleBeforeEdit.current);
    }
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
    setTitleInput(titleBeforeEdit.current);
  };

  const pageCounterText = t('play.header.pageCounter')
    .replace('{current}', String(currentIdx + 1))
    .replace('{total}', String(totalPages));
  const currentRegenPageText = regenJob?.last_processed_page != null
    ? t('play.regenBanner.currentPage').replace('{page}', String(regenJob.last_processed_page))
    : '';

  const [copyScriptStatus, setCopyScriptStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [copyAllScriptsStatus, setCopyAllScriptsStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [coursePackageBusy, setCoursePackageBusy] = useState(false);

  const [attendeeCount, setAttendeeCount] = useState<number | null>(null);
  const attendeePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!syncEnabled || syncRole !== 'master' || !pdfId) {
      setAttendeeCount(null);
      if (attendeePollRef.current != null) clearInterval(attendeePollRef.current);
      return;
    }
    const fetchCount = () => {
      void fetchSyncAttendees(pdfId).then((list) => setAttendeeCount(list.length)).catch(() => {});
    };
    fetchCount();
    attendeePollRef.current = setInterval(fetchCount, 30_000);
    return () => {
      if (attendeePollRef.current != null) clearInterval(attendeePollRef.current);
    };
  }, [syncEnabled, syncRole, pdfId]);
  const handleDownloadCoursePackage = async () => {
    if (!pdfId || coursePackageBusy) return;
    setCoursePackageBusy(true);
    try {
      const resp = await fetch(`api/pdfs/${encodeURIComponent(pdfId)}/course-package`, { method: 'POST' });
      if (!resp.ok) { setCoursePackageBusy(false); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = resp.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(cd);
      a.download = match?.[1] ?? 'course-package.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCoursePackageBusy(false);
    }
  };

  return (
    <header className="relative z-[1000] border-b border-border-light bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3">
        {!currentShareToken ? (
          <Link
            to="/"
            className="shrink-0 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted sm:px-3 sm:text-sm"
          >
            ← {t('play.header.back')}
          </Link>
        ) : (
          <div className="w-16 shrink-0 sm:w-20" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-2">
          {editingTitle ? (
            <>
              <input
                ref={inlineTitleRef}
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={commitTitleEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitTitleEdit(); }
                  if (e.key === 'Escape') { cancelTitleEdit(); }
                }}
                placeholder={t('play.header.editTitlePlaceholder')}
                maxLength={200}
                className="min-w-0 flex-1 rounded-md border border-primary/60 bg-surface px-1.5 py-1 text-center text-xs text-text sm:px-2 sm:text-sm"
              />
              <span className={`shrink-0 text-[11px] tabular-nums ${titleInput.length > 150 ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}`}>
                {titleInput.length}/200
              </span>
            </>
          ) : (
            <span
              onDoubleClick={startEditTitle}
              title={(!isReadOnlyProcessing && !currentShareToken) ? t('play.header.editTitleHint') : undefined}
              className={`min-w-0 flex-1 truncate text-center text-xs text-text sm:text-sm ${(!isReadOnlyProcessing && !currentShareToken) ? 'cursor-text' : ''}`}
            >
              {titleInput || '—'}
            </span>
          )}
          {titleBusy && (
            <span className="shrink-0 text-[11px] text-muted">{t('play.header.savingTitle')}</span>
          )}
          <button
            type="button"
            onClick={() => void handleRegenerateTitle()}
            disabled={isReadOnlyProcessing || titleBusy}
            className="shrink-0 whitespace-nowrap rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] text-muted hover:bg-surface-muted disabled:opacity-40 sm:px-2 sm:text-xs"
          >
            {titleBusy ? t('play.header.processing') : t('play.header.regenerateTitle')}
          </button>
        </div>
          <div className="shrink-0 whitespace-nowrap text-right text-xs text-muted sm:w-20 sm:text-sm">
            {pageCounterText}
            {totalPages > 1 && (
              <div className="text-[10px] text-muted">{progressPercent(currentIdx + 1, totalPages)}%</div>
            )}
          </div>
          <label className="ml-2 inline-flex items-center gap-1 text-xs text-text">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(e) => handleSyncEnabledChange(e.target.checked)}
            />
            {t('play.sync.mode')}
            {syncEnabled ? `(${syncRole === 'master' ? 'master' : 'follower'})` : ''}
            {syncEnabled && syncRole === 'master' && attendeeCount != null && (
              <span className="ml-1 rounded-full bg-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-200">
                {attendeeCount}
              </span>
            )}
          </label>
        </div>
        {detail?.description?.trim() ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-2">
            <button
              type="button"
              onClick={() => setDescExpanded((v) => !v)}
              aria-expanded={descExpanded}
              className="text-xs text-muted hover:text-text"
            >
              {descExpanded ? `▲ ${t('play.header.hideDescription')}` : `▼ ${t('play.header.showDescription')}`}
            </button>
            {descExpanded ? (
              <div className="mt-1">
                <p className="whitespace-pre-wrap rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-text">
                  {detail.description}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void copyTextToClipboard(detail.description ?? '').then((r) => {
                      if (r.ok) {
                        setDescCopyDone(true);
                        setTimeout(() => setDescCopyDone(false), 2000);
                      }
                    });
                  }}
                  className="mt-1 text-[11px] text-muted hover:text-text"
                >
                  {descCopyDone ? t('play.header.copyDescriptionDone') : t('play.header.copyDescription')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        
        {syncError ? <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">{syncError}</div> : null}
        {syncEnabled ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <div className="rounded-md border border-border bg-surface-muted p-3 text-xs text-text dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
              <SyncQuestionsPanel />
            </div>
          </div>
        ) : null}
      {readOnlyReason ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            {readOnlyReason}
          </div>
        </div>
      ) : null}
      {detail?.status === 'failed' && detail.error_message ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-rose-400/50 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            <span className="font-medium">{t('play.header.generationFailed')}</span>
            <span className="whitespace-pre-wrap">{detail.error_message}</span>
          </div>
        </div>
      ) : null}
      {currentPage?.status === 'failed' && currentPage.error_message ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-rose-400/50 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            <span className="font-medium">{t('play.header.pageGenerationFailed').replace('{page}', String(currentPage.page_number))}</span>
            <span className="whitespace-pre-wrap">{currentPage.error_message}</span>
          </div>
        </div>
      ) : null}
      {detail?.status === 'awaiting_script_confirmation' ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="flex flex-col gap-3 rounded-md border border-emerald-400/50 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{t('play.header.scriptReadyTitle')}</p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-200/80 mt-0.5">
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
        <div className="space-y-1 text-xs text-muted">
          {videoError ? <span className="text-rose-700 dark:text-rose-300">{videoError}</span> : null}
          {!videoError && titleMsg ? <span className="text-text">{titleMsg}</span> : null}
          {shareMessage ? <div className="text-emerald-700 dark:text-emerald-300">{shareMessage}</div> : null}
          {shareError ? <div className="text-rose-700 dark:text-rose-300">{shareError}</div> : null}
          {githubSyncMessage ? <div className="text-emerald-700 dark:text-emerald-300">{githubSyncMessage}</div> : null}
          {githubSyncError ? <div className="text-rose-700 dark:text-rose-300">{githubSyncError}</div> : null}
        </div>
        <div className="flex flex-col items-stretch gap-2 md:items-end">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-muted md:hidden"
            aria-expanded={mobileMenuOpen}
            aria-label={t('play.header.menuToggle')}
          >
            <span className="text-lg leading-none">☰</span>
            <span>{t('play.header.menu')}</span>
          </button>
          <nav className={`${mobileMenuOpen ? 'grid' : 'hidden'} grid-cols-1 gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-xl md:flex md:border-0 md:bg-transparent md:p-0 md:shadow-none`} aria-label="PlayPage actions">
          {!isReadOnlyProcessing ? (
          <HeaderDropdown id="metadata" label={t('play.header.groupInfo')} accent="slate" open={openMenuId === 'metadata'} onOpenChange={setOpenMenuId}>
            <div className="grid gap-2">
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder={t('play.metadata.tagsLabel')}
                className="min-w-0 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                maxLength={500}
              />
              <button
                type="button"
                onClick={() => void handleSaveTags()}
                disabled={tagsBusy}
                className="whitespace-nowrap rounded-md border border-indigo-500/50 bg-indigo-500/15 px-2 py-1.5 text-xs text-indigo-200 disabled:opacity-40"
              >
                {tagsBusy ? '…' : t('play.header.saveTags')}
              </button>
              {tagsMsg ? <span className="text-xs text-emerald-300">{tagsMsg}</span> : null}
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder={t('play.metadata.descriptionPlaceholder')}
                rows={3}
                className="min-w-0 resize-none rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                maxLength={2000}
              />
              {descriptionInput.trim() === '' && pdfId ? (
                <button
                  type="button"
                  onClick={() => {
                    setGenDescBusy(true);
                    void generatePdfDescription(pdfId)
                      .then((res) => setDescriptionInput(res.description))
                      .catch(() => { /* non-fatal: leave field empty */ })
                      .finally(() => setGenDescBusy(false));
                  }}
                  disabled={genDescBusy}
                  className="whitespace-nowrap rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-2 py-1.5 text-xs text-fuchsia-200 disabled:opacity-40"
                >
                  {genDescBusy ? t('play.metadata.generatingDescription') : t('play.metadata.aiGenerateDescription')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSaveDescription()}
                disabled={descriptionBusy}
                className="whitespace-nowrap rounded-md border border-indigo-500/50 bg-indigo-500/15 px-2 py-1.5 text-xs text-indigo-200 disabled:opacity-40"
              >
                {descriptionBusy ? '…' : t('play.metadata.descriptionLabel')}
              </button>
              {descriptionMsg ? <span className="text-xs text-emerald-300">{descriptionMsg}</span> : null}
              {!currentShareToken && detail?.user_prompt?.trim() ? (
                <div className="rounded-md border border-slate-700/80 bg-slate-900/60 p-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPromptExpanded((v) => !v);
                    }}
                    aria-expanded={promptExpanded}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    {promptExpanded ? `▲ ${t('play.header.hidePrompt')}` : `▼ ${t('play.header.showPrompt')}`}
                  </button>
                  {promptExpanded ? (
                    <div className="mt-2">
                      <p className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                        {detail.user_prompt}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void copyTextToClipboard(detail.user_prompt ?? '').then((r) => {
                            if (r.ok) {
                              setPromptCopyDone(true);
                              setTimeout(() => setPromptCopyDone(false), 2000);
                            }
                          });
                        }}
                        className="mt-1 text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        {promptCopyDone ? t('play.header.copyPromptDone') : t('play.header.copyPrompt')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </HeaderDropdown>
          ) : null}
          <HeaderDropdown id="playback" label={t('play.header.groupPlayback')} accent="slate" open={openMenuId === 'playback'} onOpenChange={setOpenMenuId}>
            <ShortcutsButton />
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
          <div className="flex items-center justify-center gap-1 rounded-md border border-slate-700 px-2 py-1" title={t('play.header.imageScaleTitle')}>
            <button
              type="button"
              onClick={() => setSlideImageScale((scale) => stepSlideImageScale(scale, -SLIDE_IMAGE_SCALE_STEP))}
              className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={slideImageScale <= SLIDE_IMAGE_SCALE_MIN}
              aria-label={t('play.header.decreaseImageScale')}
            >
              −
            </button>
            <span className="w-10 text-center text-xs tabular-nums text-slate-400">{Math.round(slideImageScale * 100)}%</span>
            <button
              type="button"
              onClick={() => setSlideImageScale((scale) => stepSlideImageScale(scale, SLIDE_IMAGE_SCALE_STEP))}
              className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={slideImageScale >= SLIDE_IMAGE_SCALE_MAX}
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
          </HeaderDropdown>
          <HeaderDropdown id="generate" label={t('play.header.groupGenerate')} accent="amber" open={openMenuId === 'generate'} onOpenChange={setOpenMenuId}>
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
            className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-center text-sm text-fuchsia-100 hover:bg-fuchsia-500/25"
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
          <CopyLinkButton shareUrl={shareUrl} />
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (
            <button
              type="button"
              onClick={() => {
                const url = shareUrl || window.location.href;
                void navigator.share({ title: titleInput.trim() || 'MakeSlide', url });
              }}
              className="rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 text-sm text-sky-100 hover:bg-sky-500/25"
              title={t('play.header.nativeShare')}
            >
              {t('play.header.nativeShare')}
            </button>
          ) : null}
          </HeaderDropdown>
          <HeaderDropdown id="download" label={t('play.header.groupDownload')} accent="cyan" open={openMenuId === 'download'} onOpenChange={setOpenMenuId}>
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
          {currentPage?.image_url ? (
            <a
              href={currentPage.image_url}
              download={`slide-${currentPage.page_number}.png`}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
            >
              {t('play.header.downloadCurrentImage')}
            </a>
          ) : null}
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
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/subtitles.txt`}
            download="transcript.txt"
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadTxt')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/slides.pptx`}
            download
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadPptx')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/scripts.txt`}
            download
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadScriptsTxt')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/notes.txt`}
            download
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-100 hover:bg-cyan-500/25"
          >
            {t('play.header.downloadNotesTxt')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/export.scorm`}
            download
            className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-center text-sm text-violet-100 hover:bg-violet-500/25"
          >
            {t('play.header.downloadScorm')}
          </a>
          <a
            href={`api/pdfs/${encodeURIComponent(pdfId ?? '')}/export.h5p`}
            download
            className="rounded-md border border-teal-500/50 bg-teal-500/15 px-3 py-1.5 text-center text-sm text-teal-100 hover:bg-teal-500/25"
          >
            {t('play.header.downloadH5p')}
          </a>
          </HeaderDropdown>
          <HeaderDropdown id="script" label={t('play.header.groupScript')} accent="violet" open={openMenuId === 'script'} onOpenChange={setOpenMenuId}>
          <button
            type="button"
            disabled={!currentPage || !scripts[currentPage.page_number]}
            onClick={async () => {
              const script = currentPage ? (scripts[currentPage.page_number] ?? '') : '';
              if (!script) return;
              const result = await copyTextToClipboard(script);
              setCopyScriptStatus(result.ok ? 'ok' : 'fail');
              setTimeout(() => setCopyScriptStatus('idle'), 2000);
            }}
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copyScriptStatus === 'ok' ? t('play.header.copyScriptDone') : copyScriptStatus === 'fail' ? t('play.header.copyScriptFail') : t('play.header.copyScript')}
          </button>
          <button
            type="button"
            disabled={!detail?.pages?.length}
            onClick={async () => {
              const pages = detail?.pages ?? [];
              const text = pages
                .slice()
                .sort((a, b) => a.page_number - b.page_number)
                .map((p) => `## ${t('play.common.pagePrefix')}${p.page_number}${t('play.common.pageSuffix')}\n${scripts[p.page_number] ?? ''}`)
                .join('\n\n');
              const result = await copyTextToClipboard(text);
              setCopyAllScriptsStatus(result.ok ? 'ok' : 'fail');
              setTimeout(() => setCopyAllScriptsStatus('idle'), 2000);
            }}
            className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copyAllScriptsStatus === 'ok' ? t('play.header.copyAllScriptsDone') : copyAllScriptsStatus === 'fail' ? t('play.header.copyScriptFail') : t('play.header.copyAllScripts')}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadCoursePackage()}
            disabled={coursePackageBusy || isReadOnlyProcessing}
            className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-100 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {coursePackageBusy ? t('play.header.coursePackageGenerating') : t('play.header.downloadCoursePackage')}
          </button>
          </HeaderDropdown>
          <HeaderDropdown id="share" label={t('play.header.groupShare')} accent="emerald" open={openMenuId === 'share'} onOpenChange={setOpenMenuId}>
          <button
            type="button"
            onClick={() => void handleSyncToGithub()}
            disabled={githubSyncBusy || isReadOnlyProcessing}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={isReadOnlyProcessing ? t('play.header.githubSyncReadOnly') : t('play.header.githubSyncTitle')}
          >
            {githubSyncBusy ? t('play.header.syncing') : `⤴ ${t('play.header.syncToGithub')}`}
          </button>
          {!currentShareToken && detail && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${detail.visibility === 'public_editable' ? 'border-emerald-500/40 text-emerald-300' : detail.visibility === 'public' ? 'border-sky-500/40 text-sky-300' : 'border-slate-600 text-slate-400'}`}>
              {detail.visibility === 'public_editable' ? `✏️ ${t('play.share.statusEditable')}` : detail.visibility === 'public' ? `🌐 ${t('play.share.statusPublic')}` : `🔒 ${t('play.share.statusPrivate')}`}
            </span>
          )}
          {!currentShareToken ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700/80 px-2 py-1">
              <select
                value={shareAccess}
                onChange={(e) => setShareAccess((e.target.value as ShareAccessMode) || 'read_only')}
                disabled={isReadOnlyProcessing}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <option value="read_only">{t('play.share.readOnlyVisible')}</option>
                <option value="editable">{t('play.share.readWriteVisible')}</option>
              </select>
              <select
                value={shareExpiresDays ?? ''}
                onChange={(e) => setShareExpiresDays(e.target.value ? Number(e.target.value) : undefined)}
                disabled={isReadOnlyProcessing}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t('play.share.expiryLabel')}
              >
                <option value="">{t('play.share.expiryForever')}</option>
                <option value="7">{t('play.share.expiry7days')}</option>
                <option value="30">{t('play.share.expiry30days')}</option>
                <option value="90">{t('play.share.expiry90days')}</option>
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
          </HeaderDropdown>
          </nav>
        </div>
      </div>
      {showRegenBanner ? (
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-text dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10 dark:text-slate-200">
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
                    className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-200"
                  >
                    {regenStopBusy ? t('play.regenBanner.stoppingBusy') : t('play.regenBanner.stopGeneration')}
                  </button>
                ) : null}
                {regenJobTerminal && regenJob?.rollback_available ? (
                  <button
                    type="button"
                    onClick={() => void handleRollbackRegenerate()}
                    disabled={regenRollbackBusy}
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200"
                  >
                    {regenRollbackBusy ? t('play.regenBanner.rollbackBusy') : t('play.regenBanner.rollback')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRegenBannerDismissed(true)}
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-muted"
                >
                  {t('play.regenBanner.close')}
                </button>
              </div>
            </div>
            <RegenerateProgress job={regenJob} />
            {regenAllMsg ? <p className="mt-1 text-[11px] text-muted">{regenAllMsg}</p> : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
