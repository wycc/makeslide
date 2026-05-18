import { useState } from 'react';
import type { PdfListItem } from '../types';
import StatusBadge from './StatusBadge';

const PROGRESS_LABELS: Record<string, string> = {
  rendering: '產生投影片圖片',
  extracting_text: '抽取文字',
  text_extracted: '文字已抽取',
  scripting: '產生逐字稿',
  script_ready: '逐字稿完成',
  synthesizing: '合成語音',
};

interface PdfCardProps {
  pdf: PdfListItem;
  categories: string[];
  onDelete: (id: string) => Promise<void> | void;
  onDuplicate: (id: string) => Promise<void> | void;
  onCategoryChange: (id: string, category: string) => Promise<void> | void;
  onClick?: (pdf: PdfListItem) => void;
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

export default function PdfCard({ pdf, categories, onDelete, onDuplicate, onCategoryChange, onClick }: PdfCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isChangingCategory, setIsChangingCategory] = useState(false);
  // `uploaded` / `processing` 都允許刪除；
  // `isProcessing` 僅用於限制「複製」與「改類別」這類非刪除操作。
  const isProcessing = pdf.status === 'processing';

  const progressTotal = pdf.progress_total ?? 0;
  const progressCurrentRaw = pdf.progress_current ?? 0;
  const progressCurrent = Math.max(0, Math.min(progressCurrentRaw, progressTotal || progressCurrentRaw));
  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;
  const progressStepLabel =
    pdf.progress_step != null
      ? (PROGRESS_LABELS[pdf.progress_step] ?? '處理中')
      : '處理中';
  const showProcessingOverlay = pdf.status === 'processing';

  const livePagePreviewUrl =
    pdf.status === 'processing' &&
    pdf.progress_step === 'rendering' &&
    (pdf.progress_current ?? 0) > 0
      ? `api/pdfs/${encodeURIComponent(pdf.id)}/pages/${encodeURIComponent(String(pdf.progress_current))}/thumbnail?t=${encodeURIComponent(String(pdf.progress_current))}`
      : null;
  const coverSrc = livePagePreviewUrl ?? pdf.cover_thumbnail_url ?? pdf.cover_url;

  const handleDelete = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (isDeleting) return;
    const ok = window.confirm(`確定刪除「${pdf.title ?? pdf.id}」？此動作無法復原。`);
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
      const entered = window.prompt('請輸入新類別名稱');
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

  return (
    <div
      onClick={handleCardClick}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow transition hover:border-slate-600 hover:shadow-lg"
    >
      {/* Cover */}
      <div className="relative aspect-[4/3] w-full bg-slate-800">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={pdf.title ?? pdf.id}
            loading="lazy"
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
        <div className="absolute right-2 top-2 rounded-full bg-slate-900/60 p-0.5 backdrop-blur-sm">
          <StatusBadge
            status={pdf.status}
            progressStep={pdf.progress_step}
            progressCurrent={pdf.progress_current}
            progressTotal={pdf.progress_total}
          />
        </div>
        {showProcessingOverlay && (
          <div className="absolute inset-x-0 bottom-0 bg-slate-900/75 px-2 py-2 backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-100">
              <span className="truncate">{progressStepLabel}</span>
              {progressTotal > 0 && (
                <span className="shrink-0 text-slate-200">
                  {progressCurrent}/{progressTotal} ({progressPct}%)
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
          {pdf.title ?? '(未命名)'}
        </h3>
        <label className="flex flex-col gap-1 text-[11px] text-slate-400" onClick={(ev) => ev.stopPropagation()}>
          類別
          <select
            value={pdf.category?.trim() || 'general'}
            onChange={handleCategoryChange}
            disabled={isProcessing || isChangingCategory}
            title={isProcessing ? '產生過程中暫停更改類別' : undefined}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none transition hover:border-slate-500 disabled:opacity-60"
          >
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
            <option value="__new__">＋新增類別…</option>
          </select>
        </label>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{formatDate(pdf.created_at)}</span>
          <span>{pdf.page_count != null ? `${pdf.page_count} 頁` : ''}</span>
        </div>

        {pdf.status === 'awaiting_prompt' && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
            尚未開始 — 點擊卡片以輸入風格提示詞。
          </p>
        )}
        {pdf.status === 'failed' && pdf.progress_step == null && (
          <p
            className="line-clamp-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200"
            title="處理失敗"
          >
            處理失敗，可點擊重試或刪除
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
              輸入提示詞
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={isProcessing || isDuplicating}
              title={isProcessing ? '產生過程中暫停複製' : undefined}
              className="rounded-md border border-cyan-500/40 px-2 py-1 text-xs text-cyan-300 transition hover:bg-cyan-500/10 disabled:opacity-50"
            >
              {isDuplicating ? '複製中…' : '複製'}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
            >
              {isDeleting ? '刪除中…' : '刪除'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
