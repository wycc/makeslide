import { useCallback, useEffect, useState } from 'react';
import { listPageComments, type PageComment } from '../../lib/api/pdfs';
import { MarkdownMath } from '../../components/MarkdownMath';
import { useI18n } from '../../i18n';
import { buildRelativeTimeLabels, formatRelativeTime } from '../../lib/relativeTime';
import { countUnresolvedComments, sortCommentsUnresolvedFirst } from '../../lib/commentStats';
import { interpolateTemplate } from '../../lib/interpolateTemplate';

/** 全螢幕留言徽章／面板共用的一份頁面留言狀態（由 `useFullscreenPageComments` 提供）。 */
export interface FullscreenPageComments {
  comments: PageComment[];
  loading: boolean;
  failed: boolean;
  /** 未解決留言數（徽章用來決定是否加強提示）。 */
  unresolvedCount: number;
  reload: () => void;
}

/**
 * 載入目前頁面的留言，供全螢幕的 💬 徽章（顯示則數）與點開後的留言面板共用同一份資料，
 * 避免兩者各抓一次。`enabled` 為 false（此頁沒有留言）時不發請求並清空狀態。
 */
export function useFullscreenPageComments(
  pdfId: string | undefined,
  pageNumber: number | null,
  enabled: boolean,
  shareToken?: string,
): FullscreenPageComments {
  const [comments, setComments] = useState<PageComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled || !pdfId || !pageNumber) {
      setComments([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    listPageComments(pdfId, pageNumber, shareToken)
      .then((list) => {
        if (cancelled) return;
        setComments(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setComments([]);
        setFailed(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [pdfId, pageNumber, enabled, shareToken, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { comments, loading, failed, unresolvedCount: countUnresolvedComments(comments), reload };
}

/**
 * 全螢幕模式的唯讀留言面板：點頂端 💬 徽章後展開，列出本頁留言（未解決在前）。
 * 全螢幕以觀看／授課為主，故不提供新增／編輯／解決等操作——那些仍在側邊欄的留言區。
 */
export function FullscreenCommentsPanel({
  pageNumber,
  state,
  onClose,
}: {
  pageNumber: number;
  state: FullscreenPageComments;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const relativeTimeLabels = buildRelativeTimeLabels(t);
  const { comments, loading, failed, reload } = state;
  const visible = sortCommentsUnresolvedFirst(comments);

  return (
    <div
      className="absolute left-1/2 top-16 z-40 flex max-h-[70vh] w-[min(34rem,92vw)] -translate-x-1/2 flex-col rounded-xl border border-sky-400/40 bg-surface-muted text-text shadow-2xl backdrop-blur dark:bg-slate-900/95 dark:text-slate-100"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={interpolateTemplate(t('play.fullscreen.commentsTitle'), { page: pageNumber })}
    >
      <div className="flex items-center justify-between gap-2 border-b border-sky-400/25 px-4 py-2">
        <h3 className="text-sm font-semibold text-sky-700 dark:text-sky-200">
          💬 {interpolateTemplate(t('play.fullscreen.commentsTitle'), { page: pageNumber })}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={reload}
            className="rounded border border-sky-300/50 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-500/10 dark:border-sky-700/50 dark:text-sky-300"
            title={t('play.fullscreen.commentsRefresh')}
            aria-label={t('play.fullscreen.commentsRefresh')}
          >
            ⟳
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-sky-300/50 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-500/10 dark:border-sky-700/50 dark:text-sky-300"
            title={t('play.fullscreen.commentsClose')}
            aria-label={t('play.fullscreen.commentsClose')}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? <p className="text-xs text-muted">{t('play.fullscreen.commentsLoading')}</p> : null}
        {!loading && failed ? <p className="text-xs text-red-500 dark:text-red-400">{t('play.fullscreen.commentsFailed')}</p> : null}
        {!loading && !failed && visible.length === 0 ? (
          <p className="text-xs text-muted">{t('play.fullscreen.commentsEmpty')}</p>
        ) : null}
        <ul className="space-y-2">
          {visible.map((c) => (
            <li
              key={c.id}
              className={`rounded-md border px-2.5 py-2 text-[13px] ${c.resolved ? 'border-border bg-surface-muted opacity-60' : 'border-sky-200 bg-sky-50 dark:border-sky-500/20 dark:bg-sky-500/10'}`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="font-medium text-sky-800 dark:text-sky-200">{c.author}</span>
                <span className="text-[0.85em] text-sky-600 dark:text-sky-400/50" title={new Date(c.created_at).toLocaleString()}>
                  {formatRelativeTime(c.created_at, relativeTimeLabels)}
                </span>
                {c.resolved ? (
                  <span className="text-[0.85em] text-muted">{t('play.fullscreen.commentsResolvedTag')}</span>
                ) : null}
              </div>
              <MarkdownMath
                content={c.text}
                className={`mt-0.5 break-words text-sky-900/90 dark:text-sky-100/80 ${c.resolved ? 'text-muted line-through' : ''}`}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
