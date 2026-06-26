import { useState } from 'react';
import type { PdfListItem } from '../types';
import StatusBadge from './StatusBadge';
import { useI18n } from '../i18n';
import { formatAudioDuration } from '../lib/audioDuration';
import { formatRelativeTime, buildRelativeTimeLabels } from '../lib/relativeTime';
import { createPdfShare } from '../lib/api/pdfs';
import { copyTextToClipboard } from '../lib/clipboard';
import { shouldShowCoverImage } from './pdfCardCover';

const PROGRESS_LABEL_KEYS: Record<string, Parameters<ReturnType<typeof useI18n>['t']>[0]> = {
  rendering: 'progress.rendering',
  extracting_text: 'progress.extractingText',
  text_extracted: 'progress.textExtracted',
  scripting: 'progress.scripting',
  script_ready: 'progress.scriptReady',
  synthesizing: 'progress.synthesizing',
};

interface PdfCardProps {
  pdf: PdfListItem;
  categories: string[];
  onDelete: (id: string) => Promise<void> | void;
  onDuplicate: (id: string) => Promise<void> | void;
  onExport: (id: string) => Promise<void> | void;
  onCategoryChange: (id: string, category: string) => Promise<void> | void;
  onTagsEdit?: (id: string, tags: string) => Promise<void> | void;
  onContinue?: (pdf: PdfListItem) => Promise<void> | void;
  continuing?: boolean;
  onClick?: (pdf: PdfListItem) => void;
  /** The logged-in viewer's own sub, so cards for other people's presentations can show the owner's name. */
  currentUserSub?: string | null;
  isFavorited?: boolean;
  onToggleFavorite?: (id: string) => void;
  onTagFilter?: (tag: string) => void;
  activeTagFilters?: Set<string>;
}

function GitHubMarkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}


function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PdfCard({ pdf, categories, onDelete, onDuplicate, onExport, onCategoryChange, onTagsEdit, onContinue, continuing = false, onClick, currentUserSub, isFavorited = false, onToggleFavorite, onTagFilter, activeTagFilters }: PdfCardProps) {
  const { t } = useI18n();
  const relativeTimeLabels = buildRelativeTimeLabels(t);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isChangingCategory, setIsChangingCategory] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [copyShareStatus, setCopyShareStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [failedCoverSrc, setFailedCoverSrc] = useState<string | null>(null);
  // `uploaded` / `processing` 都允許刪除；
  // `isProcessing` 僅用於限制「複製」與「改類別」這類非刪除操作。
  const isProcessing = pdf.status === 'processing';

  const handleCopyShareLink = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    try {
      const res = await createPdfShare(pdf.id, 'read_only');
      const url = res.share_url.startsWith('http')
        ? res.share_url
        : `${window.location.origin}${res.share_url.startsWith('/') ? '' : '/'}${res.share_url}`;
      const ok = await copyTextToClipboard(url);
      setCopyShareStatus(ok ? 'ok' : 'fail');
    } catch {
      setCopyShareStatus('fail');
    }
    setTimeout(() => setCopyShareStatus('idle'), 2000);
  };

  const progressTotal = pdf.progress_total ?? 0;
  const progressCurrentRaw = pdf.progress_current ?? 0;
  const progressCurrent = Math.max(0, Math.min(progressCurrentRaw, progressTotal || progressCurrentRaw));
  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;
  const progressStepLabel =
      pdf.progress_step != null
      ? t(PROGRESS_LABEL_KEYS[pdf.progress_step] ?? 'card.processing')
      : t('card.processing');
  const showProcessingOverlay = pdf.status === 'processing';

  const livePagePreviewUrl =
    pdf.status === 'processing' &&
    pdf.progress_step === 'rendering' &&
    (pdf.progress_current ?? 0) > 0
      ? `api/pdfs/${encodeURIComponent(pdf.id)}/pages/${encodeURIComponent(String(pdf.progress_current))}/thumbnail?t=${encodeURIComponent(String(pdf.progress_current))}`
      : null;
  const coverSrc = livePagePreviewUrl ?? pdf.cover_thumbnail_url ?? pdf.cover_url;
  const totalAudioDuration = formatAudioDuration(pdf.total_audio_duration_seconds);

  const handleDelete = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (isDeleting) return;
    const ok = window.confirm(t('card.confirmDelete').replace('{title}', pdf.title ?? pdf.id));
    if (!ok) return;
    setIsDeleting(true);
    try {
      await onDelete(pdf.id);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCardClick = () => {
    onClick?.(pdf);
  };

  const handleContinue = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!onContinue || continuing) return;
    await onContinue(pdf);
  };

  const handleDuplicate = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (isProcessing || isDuplicating) return;
    setIsDuplicating(true);
    try {
      await onDuplicate(pdf.id);
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleCategoryChange = async (ev: React.ChangeEvent<HTMLSelectElement>) => {
    ev.stopPropagation();
    if (isProcessing) return;
    const value = ev.target.value;
    let nextCategory = value;
    if (value === '__new__') {
      const entered = window.prompt(t('card.enterNewCategory'));
      nextCategory = entered?.trim() ?? '';
      if (!nextCategory) return;
    }
    if (nextCategory === (pdf.category?.trim() || 'general')) return;
    setIsChangingCategory(true);
    try {
      await onCategoryChange(pdf.id, nextCategory);
    } finally {
      setIsChangingCategory(false);
    }
  };

  const handleExport = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (isExporting) return;
    setIsExporting(true);
    try {
      await onExport(pdf.id);
    } finally {
      setIsExporting(false);
    }
  };

  const handleEditTagsClick = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    setTagInput(pdf.tags ?? '');
    setIsEditingTags(true);
  };

  const handleSaveTags = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!onTagsEdit || isSavingTags) return;
    setIsSavingTags(true);
    try {
      await onTagsEdit(pdf.id, tagInput);
      setIsEditingTags(false);
    } finally {
      setIsSavingTags(false);
    }
  };

  const handleCancelEditTags = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    setIsEditingTags(false);
  };

  return (
    <div
      onClick={handleCardClick}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-800 bg-surface/70 shadow transition hover:border-slate-600 hover:shadow-lg"
    >
      {/* Cover */}
      <div className="relative aspect-[4/3] w-full bg-slate-800">
        {shouldShowCoverImage(coverSrc, failedCoverSrc) ? (
          <img
            src={coverSrc}
            alt={pdf.title ?? pdf.id}
            loading="lazy"
            onError={() => setFailedCoverSrc(coverSrc)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-12 w-12"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <span className="text-xs tracking-wide uppercase">PDF</span>
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-full bg-surface/60 p-0.5 backdrop-blur-sm">
          <StatusBadge
            status={pdf.status}
            progressStep={pdf.progress_step}
            progressCurrent={pdf.progress_current}
            progressTotal={pdf.progress_total}
          />
        </div>
        {onToggleFavorite ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(pdf.id); }}
            className={`absolute bottom-2 right-2 rounded-full bg-surface/70 p-1 text-base leading-none backdrop-blur-sm transition hover:scale-110 ${isFavorited ? 'text-amber-400' : 'text-muted hover:text-amber-300'}`}
            title={isFavorited ? t('card.unfavorite') : t('card.favorite')}
            aria-label={isFavorited ? t('card.unfavorite') : t('card.favorite')}
          >
            {isFavorited ? '★' : '☆'}
          </button>
        ) : null}
        {(pdf.visibility === 'public' || pdf.visibility === 'public_editable') ? (
          <button
            type="button"
            onClick={(ev) => { void handleCopyShareLink(ev); }}
            className={`absolute bottom-2 left-2 rounded-full bg-surface/70 px-1.5 py-1 text-[11px] leading-none backdrop-blur-sm transition opacity-0 group-hover:opacity-100 ${copyShareStatus === 'ok' ? 'text-emerald-400' : copyShareStatus === 'fail' ? 'text-rose-400' : 'text-slate-300 hover:text-sky-300'}`}
            title={copyShareStatus === 'ok' ? t('card.copyShareLinkDone') : copyShareStatus === 'fail' ? t('card.copyShareLinkFail') : t('card.copyShareLink')}
            aria-label={t('card.copyShareLink')}
          >
            {copyShareStatus === 'ok' ? '✓' : copyShareStatus === 'fail' ? '✗' : '🔗'}
          </button>
        ) : null}
        {pdf.github_sync_dirty ? (
          <div
            className="absolute left-2 top-2 rounded-full bg-surface/60 p-1 text-rose-400 backdrop-blur-sm"
            title={t('card.githubUnsynced')}
          >
            <GitHubMarkIcon className="h-3.5 w-3.5" />
          </div>
        ) : pdf.github_synced_at ? (
          <div
            className="absolute left-2 top-2 rounded-full bg-surface/60 p-1 text-text backdrop-blur-sm"
            title={t('card.githubSynced')}
          >
            <GitHubMarkIcon className="h-3.5 w-3.5" />
          </div>
        ) : null}
        {!showProcessingOverlay && (pdf.page_count != null || totalAudioDuration || (pdf.play_count != null && pdf.play_count > 0)) && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-surface/70 px-2 py-0.5 text-[11px] text-text opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
            {pdf.page_count != null && <span>{t('card.pageCount').replace('{count}', String(pdf.page_count))}</span>}
            {totalAudioDuration && <span>{totalAudioDuration}</span>}
            {pdf.play_count != null && pdf.play_count > 0 && <span>▶ {pdf.play_count}</span>}
          </div>
        )}
        {showProcessingOverlay && (
          <div className="absolute inset-x-0 bottom-0 bg-surface/75 px-2 py-2 backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-100">
              <span className="truncate">{progressStepLabel}</span>
              {progressTotal > 0 && (
                <span className="shrink-0 text-text">
                  {progressCurrent}/{progressTotal}
                </span>
              )}
            </div>
            {progressTotal > 0 && (
              <div className="h-1.5 w-full rounded-full bg-slate-700/90">
                <div
                  className="h-full rounded-full bg-amber-300 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-100" title={pdf.title ?? ''}>
          {pdf.title ?? t('card.untitled')}
        </h3>
        {pdf.description?.trim() && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted" title={pdf.description}>
            {pdf.description}
          </p>
        )}
        {pdf.owner_sub && pdf.owner_sub !== currentUserSub && (
          <span className="truncate text-[11px] text-indigo-300" title={pdf.owner_name ?? undefined}>
            {t('card.ownerLabel').replace('{name}', pdf.owner_name?.trim() || t('card.ownerUnknown'))}
          </span>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-muted" onClick={(ev) => ev.stopPropagation()}>
          {t('card.category')}
          <select
            value={pdf.category?.trim() || 'general'}
            onChange={handleCategoryChange}
            disabled={isProcessing || isChangingCategory}
            title={isProcessing ? t('card.cannotChangeCategoryWhileProcessing') : undefined}
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text outline-none transition hover:border-slate-500 disabled:opacity-60"
          >
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
            <option value="__new__">{t('card.addCategory')}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span title={`${t('card.createdAtLabel')}：${formatDate(pdf.created_at)}`}>
            {t('card.createdAt').replace('{time}', formatRelativeTime(pdf.created_at, relativeTimeLabels))}
          </span>
          {pdf.page_count != null && (
            <span>{t('card.pageCount').replace('{count}', String(pdf.page_count))}</span>
          )}
          {totalAudioDuration && (
            <span title={t('card.totalAudioDurationLabel')}>
              {t('card.totalAudioDuration').replace('{duration}', totalAudioDuration)}
            </span>
          )}
          {pdf.last_played_at && (
            <span title={t('card.lastPlayedLabel')} className="text-slate-500">
              {t('card.lastPlayed').replace('{time}', formatRelativeTime(pdf.last_played_at, relativeTimeLabels))}
            </span>
          )}
        </div>
        {isEditingTags ? (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder={t('card.tagsPlaceholder')}
              className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-400"
              autoFocus
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleSaveTags}
                disabled={isSavingTags}
                className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {isSavingTags ? '…' : t('card.saveTags')}
              </button>
              <button
                type="button"
                onClick={handleCancelEditTags}
                className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-700"
              >
                {t('card.cancelEditTags')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {(pdf.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
              onTagFilter ? (
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTagFilter(tag); }}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition active:scale-95 ${activeTagFilters?.has(tag) ? 'border-indigo-400 bg-indigo-500/30 text-indigo-200' : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:border-indigo-400 hover:bg-indigo-500/25'}`}
                >
                  {tag}
                </button>
              ) : (
                <span key={tag} className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">
                  {tag}
                </span>
              )
            ))}
            {onTagsEdit && (
              <button
                type="button"
                onClick={handleEditTagsClick}
                title={t('card.editTags')}
                className="rounded-full border border-slate-600 px-2 py-0.5 text-[11px] text-muted transition hover:border-slate-400 hover:text-text"
              >
                {(pdf.tags ?? '').trim() ? '✎' : `+ ${t('card.editTags')}`}
              </button>
            )}
          </div>
        )}

        {pdf.status === 'awaiting_prompt' && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
            {t('card.awaitingPrompt')}
          </p>
        )}
        {pdf.status === 'failed' && pdf.progress_step == null && (
          <p
            className="line-clamp-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200"
            title={t('card.failedTitle')}
          >
            {t('card.failedMessage')}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {pdf.status === 'awaiting_prompt' ? (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onClick?.(pdf);
              }}
              className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-200 transition hover:bg-sky-500/20"
            >
              {t('card.inputPrompt')}
            </button>
          ) : pdf.status === 'awaiting_script_confirmation' ? (
            <button
              type="button"
              onClick={(ev) => void handleContinue(ev)}
              disabled={continuing}
              className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {continuing ? t('card.continuing') : t('card.continueGeneration')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="rounded-md border border-indigo-500/40 px-2 py-1 text-xs text-indigo-300 transition hover:bg-indigo-500/10 disabled:opacity-50"
            >
              {isExporting ? t('card.exporting') : t('card.export')}
            </button>
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={isProcessing || isDuplicating}
              title={isProcessing ? t('card.cannotDuplicateWhileProcessing') : undefined}
              className="rounded-md border border-cyan-500/40 px-2 py-1 text-xs text-cyan-300 transition hover:bg-cyan-500/10 disabled:opacity-50"
            >
              {isDuplicating ? t('card.duplicating') : t('card.duplicate')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
            >
              {isDeleting ? t('card.deleting') : t('card.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
