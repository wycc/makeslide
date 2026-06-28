import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, type TranslationKey } from '../../i18n';
import { debugLog, debugWarn } from '../../lib/debugLog';
import { calculateWatchProgressPercent, calculateAvgListenedPercent, formatWatchProgressBadgeCount } from '../../lib/watchProgress';
import { updatePageNote, listPageComments, listAllComments, createPageComment, resolvePageComment, editPageComment, deletePageComment, fetchSimilarPages, type PageComment, type SimilarPage } from '../../lib/api/pdfs';
import { usePlayPageContext } from './PlayPageContext';
import { PageAskPanel } from './PageAskPanel';
import { QualityCheckPanel } from './QualityCheckPanel';
import { copyTextToClipboard } from '../../lib/clipboard';
import { formatAudioDuration } from '../../lib/audioDuration';
import { cleanTranscriptForReview } from '../../lib/transcriptReview';
import { getReviewItems, removeReviewItem, formatReviewListMarkdown, type ReviewItem } from '../../lib/reviewList';
import { filterComments } from '../../lib/commentFilter';
import { countUnresolvedComments, sortCommentsUnresolvedFirst } from '../../lib/commentStats';
import { formatCommentsMarkdown } from '../../lib/commentMarkdown';
import { formatPollResultsMarkdown } from '../../lib/pollResultsMarkdown';
import { pollOptionPercent } from '../../lib/pollPercent';
import { formatNotesMarkdown } from '../../lib/notesMarkdown';
import { formatPageListText } from '../../lib/pageListText';
import { getStoredCommentAuthor, setStoredCommentAuthor } from '../../lib/commentAuthor';
import { getTextLengthHint } from '../../lib/textLengthHint';
import { normalizeScriptMaxChars } from '../../lib/scriptMaxChars';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { formatRelativeTime, buildRelativeTimeLabels } from '../../lib/relativeTime';
import { NOTEBOOK_TABS, computeNotebookTabCounts, getAdjacentNotebookTab, getEdgeNotebookTab, getStoredNotebookTab, setStoredNotebookTab, type NotebookTab } from './notebookTabs';

const IMAGE_MSG_PREFIX = '[image] ';

function SimilarPagesSection() {
  const { t } = useI18n();
  const { pdfId, currentPage } = usePlayPageContext();
  const navigate = useNavigate();
  const [items, setItems] = useState<SimilarPage[]>([]);
  const [indexed, setIndexed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pdfId || !currentPage) { setItems([]); setIndexed(false); return; }
    setLoading(true);
    fetchSimilarPages(pdfId, currentPage.page_number)
      .then((res) => { setItems(res.similar); setIndexed(res.indexed); })
      .catch(() => { setItems([]); setIndexed(false); })
      .finally(() => setLoading(false));
  }, [pdfId, currentPage?.page_number]);

  // Hide entirely when the page is not indexed (e.g. anonymous viewer or not
  // yet vector-indexed). When indexed but empty, fall through to an empty state.
  if (!pdfId || !currentPage || (!loading && !indexed)) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold text-text">{t('play.sidebar.similarPages')}</h3>
      {loading ? (
        <p className="text-xs text-muted">{t('play.sidebar.similarPagesLoading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted">{t('play.sidebar.similarPagesEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={`${it.pdf_id}-${it.page_number}`}>
              <button
                type="button"
                onClick={() => navigate(`/play/${encodeURIComponent(it.pdf_id)}?page=${it.page_number}`)}
                className="flex w-full items-center gap-2 rounded border border-border bg-surface-muted p-1.5 text-left hover:bg-surface-muted"
              >
                <img
                  src={`api/pdfs/${encodeURIComponent(it.pdf_id)}/pages/${it.page_number}/image`}
                  alt=""
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="h-10 w-14 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-text">{it.pdf_title || it.pdf_id}</p>
                  <p className="text-[10px] text-muted">
                    {t('play.sidebar.similarPagesPage').replace('{n}', String(it.page_number))} · {Math.round(it.score * 100)}%
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentsSection() {
  const { t } = useI18n();
  const relativeTimeLabels = buildRelativeTimeLabels(t);
  const { pdfId, currentPage, setCurrentIdx } = usePlayPageContext();
  const [showAll, setShowAll] = useState(false);
  const [comments, setComments] = useState<PageComment[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [unresolvedFirst, setUnresolvedFirst] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [author, setAuthor] = useState(() => getStoredCommentAuthor());
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(() => {
    if (!pdfId || !currentPage) return;
    const fetcher = showAll ? listAllComments(pdfId) : listPageComments(pdfId, currentPage.page_number);
    fetcher.then(setComments).catch(() => setComments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId, currentPage?.page_number, showAll]);

  useEffect(() => { loadComments(); }, [loadComments]);

  if (!pdfId || !currentPage) return null;

  const submitComment = async () => {
    const trimmedText = text.trim();
    if (!trimmedText || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createPageComment(pdfId, currentPage.page_number, author.trim() || 'anonymous', trimmedText);
      setComments((prev) => [...prev, created]);
      setStoredCommentAuthor(author);
      setText('');
    } catch {
      setError(t('play.sidebar.commentPostFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitComment();
  };

  const handleResolve = async (c: PageComment) => {
    try {
      const updated = await resolvePageComment(pdfId, c.id, !c.resolved);
      setComments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch { /* ignore */ }
  };

  const handleDelete = async (commentId: number) => {
    try {
      await deletePageComment(pdfId, commentId);
      setComments((prev) => prev.filter((x) => x.id !== commentId));
    } catch { /* ignore */ }
  };

  const handleSaveEdit = async (commentId: number) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    try {
      const updated = await editPageComment(pdfId, commentId, trimmed);
      setComments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingId(null);
      setEditingText('');
    } catch { /* ignore */ }
  };

  // 批次把所有未解決評論標記為已解決（複用既有 resolvePageComment，無需新後端端點）。
  const handleResolveAll = async () => {
    const unresolved = comments.filter((c) => !c.resolved);
    if (unresolved.length === 0) return;
    const results = await Promise.allSettled(unresolved.map((c) => resolvePageComment(pdfId, c.id, true)));
    const resolvedIds = new Set<number>();
    results.forEach((r, i) => { if (r.status === 'fulfilled') resolvedIds.add(unresolved[i]!.id); });
    if (resolvedIds.size > 0) {
      setComments((prev) => prev.map((x) => (resolvedIds.has(x.id) ? { ...x, resolved: true } : x)));
    }
  };

  const filteredComments = filterComments(comments, filterQuery);
  const visibleComments = unresolvedFirst ? sortCommentsUnresolvedFirst(filteredComments) : filteredComments;
  const unresolvedCount = countUnresolvedComments(comments);

  const handleCopyComments = async () => {
    const md = formatCommentsMarkdown(visibleComments, {
      heading: t('play.sidebar.commentsTitle'),
      page: t('play.sidebar.reviewListPage'),
      resolved: t('play.sidebar.commentsResolvedTag'),
    });
    const ok = await copyTextToClipboard(md);
    setCopyMsg(ok ? t('play.sidebar.commentsCopyDone') : t('play.sidebar.commentsCopyFail'));
    window.setTimeout(() => setCopyMsg(null), 2000);
  };
  // 有未解決且非全部未解決時，徽章顯示「未解決 / 總數」凸顯待處理；否則只顯示總數。
  const showSplitBadge = unresolvedCount > 0 && unresolvedCount < comments.length;

  return (
    <section className="rounded-lg border border-sky-200 dark:border-sky-800/40 bg-sky-50 dark:bg-sky-900/20">
      <div className="border-b border-sky-200 dark:border-sky-800/30 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-sky-800 dark:text-sky-300">
            {t('play.sidebar.commentsTitle')}
            {comments.length > 0 && (
              <span
                className="rounded-full bg-sky-100 dark:bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-normal text-sky-800 dark:text-sky-300"
                title={t('play.sidebar.commentsUnresolvedTitle').replace('{unresolved}', String(unresolvedCount)).replace('{total}', String(comments.length))}
              >
                {showSplitBadge ? `${unresolvedCount}/${comments.length}` : comments.length}
              </span>
            )}
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => loadComments()}
              className="rounded border border-sky-200 dark:border-sky-800/40 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-400/80 hover:text-sky-800 dark:text-sky-300"
              title={t('play.sidebar.commentsRefresh')}
              aria-label={t('play.sidebar.commentsRefresh')}
            >
              ↻
            </button>
            {visibleComments.length > 0 && (
              <button
                type="button"
                onClick={() => void handleCopyComments()}
                className="rounded border border-sky-200 dark:border-sky-800/40 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-400/80 hover:text-sky-800 dark:text-sky-300"
              >
                {copyMsg ?? t('play.sidebar.commentsCopy')}
              </button>
            )}
            {comments.length > 0 && (
              <a
                href={`api/pdfs/${encodeURIComponent(pdfId)}/comments.csv`}
                download
                className="rounded border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400/80 hover:text-emerald-300"
              >
                {t('play.sidebar.commentsExportCsv')}
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={`rounded border px-2 py-0.5 text-[10px] ${showAll ? 'border-sky-400 dark:border-sky-600/60 bg-sky-200 dark:bg-sky-700/40 text-sky-800 dark:text-sky-200' : 'border-sky-200 dark:border-sky-800/40 text-sky-700 dark:text-sky-400/70 hover:text-sky-800 dark:text-sky-300'}`}
            >
              {showAll ? t('play.sidebar.commentsThisPage') : t('play.sidebar.commentsAll')}
            </button>
            {comments.length > 1 && (
              <button
                type="button"
                onClick={() => setUnresolvedFirst((v) => !v)}
                aria-pressed={unresolvedFirst}
                className={`rounded border px-2 py-0.5 text-[10px] ${unresolvedFirst ? 'border-sky-400 dark:border-sky-600/60 bg-sky-200 dark:bg-sky-700/40 text-sky-800 dark:text-sky-200' : 'border-sky-200 dark:border-sky-800/40 text-sky-700 dark:text-sky-400/70 hover:text-sky-800 dark:text-sky-300'}`}
              >
                {t('play.sidebar.commentsUnresolvedFirst')}
              </button>
            )}
            {unresolvedCount > 0 && (
              <button
                type="button"
                onClick={() => void handleResolveAll()}
                className="rounded border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400/80 hover:text-emerald-300"
              >
                {t('play.sidebar.commentsResolveAll')}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        {comments.length === 0 && (
          <p className="text-[11px] text-sky-700 dark:text-sky-400/60">{t('play.sidebar.commentsEmpty')}</p>
        )}
        {comments.length > 0 && (
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t('play.sidebar.commentsFilterPlaceholder')}
            className="w-full rounded-md border border-sky-200 dark:border-sky-800/40 bg-white dark:bg-sky-950/30 px-2 py-1 text-[11px] text-sky-900 dark:text-sky-100 placeholder:text-sky-500 dark:placeholder:text-sky-400/40 focus:border-sky-400 dark:focus:border-sky-600/60 focus:outline-none"
          />
        )}
        {comments.length > 0 && visibleComments.length === 0 && (
          <p className="text-[11px] text-sky-700 dark:text-sky-400/60">{t('play.sidebar.commentsNoMatch')}</p>
        )}
        <ul className="space-y-2">
          {visibleComments.map((c) => (
            <li key={c.id} className={`rounded-md border px-2.5 py-2 text-[11px] ${c.resolved ? 'border-border bg-surface-muted opacity-60' : 'border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10'}`}>
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  {showAll && (
                    <button
                      type="button"
                      onClick={() => setCurrentIdx(c.page_number - 1)}
                      className="mb-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400/70 hover:text-sky-800 dark:text-sky-300"
                    >
                      {t('play.sidebar.reviewListPage').replace('{n}', String(c.page_number))}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFilterQuery(c.author)}
                    className="font-medium text-sky-800 dark:text-sky-200 hover:text-sky-900 dark:text-sky-100 hover:underline"
                    title={t('play.sidebar.commentsFilterByAuthor').replace('{author}', c.author)}
                  >
                    {c.author}
                  </button>
                  <span className="ml-1.5 text-sky-600 dark:text-sky-400/50 text-[10px]" title={new Date(c.created_at).toLocaleString()}>{formatRelativeTime(c.created_at, relativeTimeLabels)}</span>
                  {editingId === c.id ? (
                    <div className="mt-0.5 space-y-1">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        className="w-full resize-none rounded border border-sky-200 dark:border-sky-700/40 bg-white dark:bg-sky-900/30 px-2 py-1 text-[11px] text-sky-900 dark:text-sky-100 focus:outline-none focus:ring-1 focus:ring-sky-600/60"
                      />
                      {(() => {
                        const hint = getTextLengthHint(editingText.length, 2000);
                        return (
                          <div className="flex justify-end">
                            <span className={`text-[10px] tabular-nums ${hint.nearLimit ? 'text-amber-400' : 'text-sky-600 dark:text-sky-400/50'}`}>
                              {hint.label}
                            </span>
                          </div>
                        );
                      })()}
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit(c.id)}
                          disabled={!editingText.trim()}
                          className="rounded bg-sky-600 px-2 py-0.5 text-[10px] text-white hover:bg-sky-500 disabled:opacity-40 dark:bg-sky-700/60 dark:hover:bg-sky-600/70"
                        >
                          {t('play.sidebar.commentEditSave')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditingText(''); }}
                          className="rounded border border-sky-200 dark:border-sky-800/40 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-400/70 hover:text-sky-800 dark:text-sky-300"
                        >
                          {t('play.sidebar.commentEditCancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={`mt-0.5 break-words text-sky-900/90 dark:text-sky-100/80 ${c.resolved ? 'line-through text-muted' : ''}`}>{c.text}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleResolve(c)}
                    className={`text-[11px] ${c.resolved ? 'text-muted hover:text-muted' : 'text-sky-700 dark:text-sky-500/60 hover:text-sky-800 dark:text-sky-300'}`}
                    title={c.resolved ? t('play.sidebar.commentUnresolve') : t('play.sidebar.commentResolve')}
                  >
                    {c.resolved ? '↩' : '✓'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingId(c.id); setEditingText(c.text); }}
                    className="text-[11px] text-muted hover:text-sky-800 dark:text-sky-300"
                    title={t('play.sidebar.commentEdit')}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="text-[11px] text-muted hover:text-red-400"
                    title={t('play.sidebar.commentDelete')}
                  >
                    ×
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={handleSubmit} className="space-y-1.5">
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder={t('play.sidebar.commentAuthorPlaceholder')}
            className="w-full rounded border border-sky-200 dark:border-sky-700/40 bg-white dark:bg-sky-900/30 px-2 py-1 text-[11px] text-sky-900 dark:text-sky-100 placeholder-sky-400 dark:placeholder-sky-700/60 focus:outline-none focus:ring-1 focus:ring-sky-600/60"
            maxLength={80}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void submitComment();
              }
            }}
            placeholder={t('play.sidebar.commentTextPlaceholder')}
            title={t('play.sidebar.commentSubmitHint')}
            rows={2}
            className="w-full resize-none rounded border border-sky-200 dark:border-sky-700/40 bg-white dark:bg-sky-900/30 px-2 py-1 text-[11px] text-sky-900 dark:text-sky-100 placeholder-sky-400 dark:placeholder-sky-700/60 focus:outline-none focus:ring-1 focus:ring-sky-600/60"
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-2">
            {error ? <p className="text-[10px] text-red-400">{error}</p> : <span />}
            {(() => {
              const hint = getTextLengthHint(text.length, 2000);
              return (
                <span className={`shrink-0 text-[10px] tabular-nums ${hint.nearLimit ? 'text-amber-400' : 'text-sky-600 dark:text-sky-400/50'}`}>
                  {hint.label}
                </span>
              );
            })()}
          </div>
          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="w-full rounded bg-sky-600 px-2 py-1 text-[11px] text-white hover:bg-sky-500 disabled:opacity-40 dark:bg-sky-700/60 dark:hover:bg-sky-600/70"
          >
            {submitting ? t('play.sidebar.commentPosting') : t('play.sidebar.commentPost')}
          </button>
        </form>
      </div>
    </section>
  );
}

function ReviewListSection() {
  const { t } = useI18n();
  const { pdfId, setCurrentIdx } = usePlayPageContext();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!pdfId) return;
    setItems(getReviewItems().filter((item) => item.pdfId === pdfId));
  }, [pdfId]);

  if (!pdfId || items.length === 0) return null;

  const handleRemove = (pageNumber: number, questionText: string) => {
    removeReviewItem(pdfId, pageNumber, questionText);
    setItems((prev) =>
      prev.filter((item) => !(item.pdfId === pdfId && item.pageNumber === pageNumber && item.questionText === questionText)),
    );
  };

  const handleCopy = async () => {
    const md = formatReviewListMarkdown(items, {
      heading: t('play.sidebar.reviewListTitle'),
      page: t('play.sidebar.reviewListPage'),
    });
    const ok = await copyTextToClipboard(md);
    setCopyMsg(ok ? t('play.sidebar.reviewListCopyDone') : t('play.sidebar.reviewListCopyFail'));
    window.setTimeout(() => setCopyMsg(null), 2000);
  };

  // 只清除目前 PDF 的複習項目（removeReviewItem 省略 questionText 時整頁移除），
  // 不影響其他 PDF 的複習清單。
  const handleClearAll = () => {
    for (const pageNumber of new Set(items.map((i) => i.pageNumber))) {
      removeReviewItem(pdfId, pageNumber);
    }
    setItems([]);
  };

  return (
    <section className="rounded-lg border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20">
      <div className="border-b border-rose-200 dark:border-rose-800/30 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-300">
            {t('play.sidebar.reviewListTitle')}
            <span className="rounded-full bg-rose-100 dark:bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-normal text-rose-800 dark:text-rose-300">{items.length}</span>
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded border border-rose-200 dark:border-rose-800/40 px-2 py-0.5 text-[10px] text-rose-700 hover:text-rose-800 dark:text-rose-300/80 dark:hover:text-rose-200"
            >
              {copyMsg ?? t('play.sidebar.reviewListCopy')}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded border border-rose-200 dark:border-rose-800/40 px-2 py-0.5 text-[10px] text-rose-700 dark:text-rose-400/70 hover:text-rose-800 dark:text-rose-300"
            >
              {t('play.sidebar.reviewListClearAll')}
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-400/70">{t('play.sidebar.reviewListHint')}</p>
      </div>
      <div className="px-4 py-3">
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.pdfId}-${item.pageNumber}-${item.questionText.slice(0, 10)}`} className="flex items-start gap-2 rounded-md border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 px-2.5 py-2">
              <button
                type="button"
                onClick={() => setCurrentIdx(item.pageNumber - 1)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-[11px] font-medium text-rose-800 dark:text-rose-200">
                  {t('play.sidebar.reviewListPage').replace('{n}', String(item.pageNumber))}
                </span>
                <span className="block truncate text-[10px] text-rose-700 dark:text-rose-300/70">{item.questionText}</span>
              </button>
              <button
                type="button"
                onClick={() => handleRemove(item.pageNumber, item.questionText)}
                className="shrink-0 text-rose-600 dark:text-rose-500/60 hover:text-rose-400"
                aria-label={t('play.sidebar.reviewListRemove')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PageNoteSection() {
  const { t } = useI18n();
  const { currentPage, deckPages, pdfId, isReadOnlyProcessing, setDetail } = usePlayPageContext();
  const [noteText, setNoteText] = useState(currentPage?.page_notes ?? '');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const savingRef = useRef(false);

  const handleCopyAllNotes = () => {
    const md = formatNotesMarkdown(deckPages, { pagePrefix: t('play.sidebar.copyAllNotesPagePrefix') });
    if (!md) {
      setCopyMsg(t('play.sidebar.noNotesToCopy'));
      setTimeout(() => setCopyMsg(null), 2000);
      return;
    }
    void copyTextToClipboard(md).then((ok) => {
      setCopyMsg(ok ? t('play.sidebar.copyAllNotesDone') : t('play.sidebar.copyAllNotesFail'));
      setTimeout(() => setCopyMsg(null), 2000);
    });
  };

  // 換頁、或 page_notes 從外部變動（例如在 AI 導師裡「存成筆記」）時，重新同步編輯框內容。
  useEffect(() => {
    setNoteText(currentPage?.page_notes ?? '');
    setNoteMsg(null);
  }, [currentPage?.page_number, currentPage?.page_notes]);

  const handleBlur = async () => {
    if (!pdfId || !currentPage || savingRef.current) return;
    const trimmed = noteText.trim();
    if (trimmed === (currentPage.page_notes ?? '')) return;
    savingRef.current = true;
    setNoteBusy(true);
    try {
      await updatePageNote(pdfId, currentPage.page_number, trimmed);
      // 同步更新本地 detail，讓「有筆記」綠點與其他讀 page_notes 的地方即時反映。
      setDetail((prev) => prev ? {
        ...prev,
        pages: prev.pages.map((p) => p.page_number === currentPage.page_number ? { ...p, page_notes: trimmed } : p),
      } : prev);
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
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          📝 {t('play.sidebar.pageNote')}
          {currentPage?.page_notes?.trim() ? (
            <span className="h-2 w-2 rounded-full bg-emerald-400" title={t('play.sidebar.hasNotesTitle')} />
          ) : null}
        </h2>
        <button
          type="button"
          onClick={handleCopyAllNotes}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-muted hover:text-text"
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
          className="w-full resize-none rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs text-text outline-none focus:border-indigo-400"
        />
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span>
            {noteBusy ? (
              <span className="text-muted">…</span>
            ) : noteMsg ? (
              <span className="text-emerald-600 dark:text-emerald-300">{noteMsg}</span>
            ) : null}
          </span>
          {noteText.length > 0 && (
            <span className={noteText.length > 4500 ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}>{noteText.length} / 5000</span>
          )}
        </div>
      </div>
    </section>
  );
}

export function PlayPageSidebar() {
  const {
    activeTab,
    sidebarExpanded, setSidebarExpanded,
    isReadOnlyProcessing,
    detail,
    currentPage, currentIdx, deckPages, totalPages,
    visitedIdxSet, scripts,
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
    setImagePreviewUrl,
    setImagePreviewPageNumber,
    setImagePreviewOpen,
    bookmarks, toggleBookmark,
    importantPages, toggleImportantPage,
    pdfId,
  } = usePlayPageContext();

  const { t } = useI18n();
  const formatMessage = (key: Parameters<typeof t>[0], values: Record<string, string | number>) =>
    interpolateTemplate(t(key), values);
  const [bookmarkCopyMsg, setBookmarkCopyMsg] = useState<string | null>(null);
  const [importantCopyMsg, setImportantCopyMsg] = useState<string | null>(null);
  const [pollCopyMsg, setPollCopyMsg] = useState<string | null>(null);
  const handleCopyPollResults = async () => {
    const md = formatPollResultsMarkdown(pagePolls, {
      heading: t('play.sidebar.poll.copyHeading'),
      votesUnit: t('play.sidebar.poll.votesUnit'),
    });
    const ok = await copyTextToClipboard(md);
    setPollCopyMsg(ok ? t('play.sidebar.poll.copyDone') : t('play.sidebar.poll.copyFail'));
    window.setTimeout(() => setPollCopyMsg(null), 2000);
  };
  const [notebookTab, setNotebookTab] = useState<NotebookTab>(() => getStoredNotebookTab());
  // 「AI 助手」分頁底下的子分頁，一次只顯示一個功能、讓各自有較大顯示高度。
  const [aiSubTab, setAiSubTab] = useState<'tutor' | 'quality' | 'chat'>('tutor');
  const AI_SUBTABS: ReadonlyArray<{ id: 'tutor' | 'quality' | 'chat'; labelKey: TranslationKey }> = [
    { id: 'tutor', labelKey: 'play.sidebar.aiSubTab.tutor' },
    { id: 'quality', labelKey: 'play.sidebar.aiSubTab.quality' },
    { id: 'chat', labelKey: 'play.sidebar.aiSubTab.chat' },
  ];
  const selectNotebookTab = (tab: NotebookTab) => {
    setNotebookTab(tab);
    setStoredNotebookTab(tab);
  };
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    let next: NotebookTab | null = null;
    if (e.key === 'ArrowRight') next = getAdjacentNotebookTab(notebookTab, 1);
    else if (e.key === 'ArrowLeft') next = getAdjacentNotebookTab(notebookTab, -1);
    else if (e.key === 'Home') next = getEdgeNotebookTab('first');
    else if (e.key === 'End') next = getEdgeNotebookTab('last');
    if (!next) return;
    e.preventDefault();
    selectNotebookTab(next);
    const nextIdx = NOTEBOOK_TABS.findIndex((tab) => tab.id === next);
    tabButtonRefs.current[nextIdx]?.focus();
  };
  // Per-tab count badges: "slides" shows the deck page count and "class
  // interaction" surfaces the user's saved markers, live polls, and review-list
  // items so both tabs' contents are discoverable without switching.
  const reviewItemCount = pdfId ? getReviewItems().filter((x) => x.pdfId === pdfId).length : 0;
  const notebookTabCounts = computeNotebookTabCounts({
    slides: deckPages.length,
    bookmarks: bookmarks.length,
    important: importantPages.length,
    polls: pagePolls.length,
    reviewItems: reviewItemCount,
  });

  return (
    <aside
      className={`max-h-[calc(100vh-7rem)] w-full flex-col gap-3 overflow-y-auto md:flex ${
        sidebarExpanded ? 'md:w-full md:flex-1' : 'shrink-0 md:w-[360px]'
      } ${activeTab === 'qa' ? 'flex' : 'hidden'}`}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1" role="tablist">
        {NOTEBOOK_TABS.map((tab, idx) => {
          const count = notebookTabCounts[tab.id] ?? 0;
          return (
          <button
            key={tab.id}
            ref={(el) => { tabButtonRefs.current[idx] = el; }}
            type="button"
            role="tab"
            aria-selected={notebookTab === tab.id}
            tabIndex={notebookTab === tab.id ? 0 : -1}
            onClick={() => selectNotebookTab(tab.id)}
            onKeyDown={handleTabKeyDown}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              notebookTab === tab.id
                ? 'bg-primary/15 text-primary dark:bg-primary/20'
                : 'text-muted hover:bg-surface-muted hover:text-text'
            }`}
          >
            <span>{tab.icon} {t(tab.labelKey)}</span>
            {count > 0 ? (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-normal text-primary">{count}</span>
            ) : null}
          </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSidebarExpanded((v) => !v)}
          className="hidden shrink-0 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text hover:bg-surface-muted md:inline-flex"
          aria-pressed={sidebarExpanded}
          title={sidebarExpanded ? t('play.sidebar.qa.restoreSidebarTitle') : t('play.sidebar.qa.expandSidebarTitle')}
        >
          {sidebarExpanded ? t('play.sidebar.qa.restore') : t('play.sidebar.qa.expand')}
        </button>
      </div>

      {notebookTab === 'slides' && (
      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text">🧩 {t('play.sidebar.slideManagement')}</h2>
              {deckPages.length > 0 && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-normal text-muted">
                  {detail?.total_audio_duration_seconds != null && detail.total_audio_duration_seconds > 0 && (
                    <span>⏱ {formatAudioDuration(detail.total_audio_duration_seconds)}</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {t('play.sidebar.slideViewedProgress')
                      .replace('{viewed}', String(Math.min(visitedIdxSet.size, deckPages.length)))
                      .replace('{total}', String(deckPages.length))}
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
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
                      ? normalizeScriptMaxChars(fromDetail)
                      : fallback;
                  setRegenScriptMaxCharsPerPage(nextMaxChars);
                  setRegenAllDialogOpen(true);
                }}
                disabled={isReadOnlyProcessing}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
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
                className="rounded-md border border-transparent bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {t('play.sidebar.add')}
              </button>
              <button
                type="button"
                onClick={() => setShowAddPagesModal(true)}
                disabled={isReadOnlyProcessing || slideBusy}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:bg-surface-muted disabled:opacity-40"
                title={t('play.sidebar.addMultipleTitle')}
              >
                {t('play.sidebar.addMultiple')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteCurrentSlide()}
                disabled={isReadOnlyProcessing || slideBusy || !currentPage || totalPages <= 1}
                className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200"
              >
                {t('play.sidebar.delete')}
              </button>
            </div>
          </div>
          {slideError ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{slideError}</p> : null}
        </div>
        {sidebarExpanded ? (
          <div className="grid max-h-[calc(100vh-16rem)] grid-cols-1 gap-2 overflow-y-auto p-3 lg:grid-cols-2">
            {deckPages.map((p, idx) => {
              const isActive = idx === currentIdx;
              const imgSrc = p.thumbnail_url ?? p.image_url;
              const reviewText = cleanTranscriptForReview(scripts[p.page_number]);
              const pageLabel = `${t('play.common.pagePrefix')}${p.page_number}${t('play.common.pageSuffix')}`;
              return (
                <button
                  key={p.page_number}
                  type="button"
                  data-page-number={p.page_number}
                  onClick={() => setCurrentIdx(idx)}
                  className={`flex gap-3 rounded-lg border p-2 text-left transition-colors ${
                    isActive ? 'border-primary/50 bg-primary/10' : 'border-border bg-surface hover:bg-surface-muted'
                  }`}
                >
                  <div className="relative w-40 shrink-0 self-start overflow-hidden rounded border border-border bg-surface-muted">
                    {imgSrc ? (
                      <img
                        src={withImageBust(imgSrc) ?? imgSrc}
                        alt={pageLabel}
                        className="h-auto w-full object-contain"
                      />
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center text-xs text-muted">{p.page_number}</div>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{p.page_number}</span>
                  </div>
                  <p className="min-w-0 flex-1 break-words text-xs leading-relaxed text-text">
                    {reviewText || <span className="text-muted">{t('play.sidebar.reviewNoScript')}</span>}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
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
                    : 'border-border'
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
                className="absolute right-0 top-0 z-10 rounded-bl bg-surface px-1.5 py-0.5 text-[10px] text-text cursor-grab active:cursor-grabbing"
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
                <div className="flex h-14 w-full items-center justify-center bg-surface-muted text-[10px] text-muted">
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
                const avgListenedPercent = calculateAvgListenedPercent(stats.avg_listened_ratio);
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
        )}
        {regenSelectedPages.size > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-indigo-200 bg-indigo-50 px-3 py-1.5 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10">
            <span className="text-xs text-indigo-700 dark:text-fuchsia-300">
              {t('play.sidebar.selectedRegenerate').replace('{count}', String(regenSelectedPages.size))}
            </span>
            <button
              type="button"
              onClick={() => setRegenSelectedPages(new Set())}
              className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-fuchsia-400 dark:hover:text-fuchsia-200"
            >
              {t('play.sidebar.clear')}
            </button>
          </div>
        ) : (
          <div className="border-t border-border-light px-3 py-1">
            <p className="text-[10px] text-muted">{t('play.sidebar.multiSelectHint')}</p>
          </div>
        )}
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => void handleUpdateCoverFromCurrentPage()}
            disabled={slideBusy || !currentPage?.image_url}
            className="w-full rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={t('play.sidebar.setCoverTitle')}
          >
            {t('play.sidebar.setCover')}
          </button>
        </div>
      </section>
      )}

      {notebookTab === 'notes' && <PageNoteSection />}

      {notebookTab === 'interact' && (
      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text">📊 Realtime Poll</h2>
            <p className="text-[11px] text-muted">
              {pollStarted
                ? formatMessage('play.sidebar.poll.activePage', { page: currentPage?.page_number ?? '-' })
                : t('play.sidebar.poll.notStarted')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pagePolls.length > 0 && (
              <button
                type="button"
                onClick={() => void handleCopyPollResults()}
                className="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-surface-muted"
              >
                {pollCopyMsg ?? t('play.sidebar.poll.copyResults')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPollSettingsOpen((v) => !v)}
              className="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-surface-muted"
            >
              {pollSettingsOpen ? t('play.sidebar.poll.collapseSettings') : t('play.sidebar.poll.settings')}
            </button>
            {pollStarted ? (
              <button
                type="button"
                onClick={handleStopPoll}
                className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-200 hover:bg-rose-500/20"
              >
                {t('play.sidebar.poll.stop')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartPoll}
                disabled={!currentPage}
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('play.sidebar.poll.start')}
              </button>
            )}
            {syncEnabled && syncRole === 'master' && pollStarted ? (
              <button
                type="button"
                onClick={() => setSyncPollShowResults((v) => !v)}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/20"
              >
                {syncPollShowResults ? t('play.sidebar.poll.hideResults') : t('play.sidebar.poll.showResults')}
              </button>
            ) : null}
          </div>
        </div>
        {(pollSettingsOpen || pollStarted || pollError) && (
          <div className="space-y-2 border-t border-border p-2">
            {pollSettingsOpen && (
              <div className="rounded-md border border-border bg-surface-muted p-2">
                <button
                  type="button"
                  onClick={() => void handleGeneratePollDraft()}
                  disabled={aiPollBusy || !currentPage}
                  className="mb-2 w-full rounded-md border border-violet-500/50 bg-violet-500/10 px-2 py-1 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {aiPollBusy ? t('play.sidebar.poll.aiDraftGenerating') : t('play.sidebar.poll.aiDraft')}
                </button>
                <input
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  maxLength={300}
                  placeholder={t('play.sidebar.poll.questionPlaceholder')}
                  className="mb-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none ring-cyan-500/40 placeholder:text-muted focus:ring"
                />
                <textarea
                  value={pollOptionsText}
                  onChange={(e) => setPollOptionsText(e.target.value)}
                  rows={2}
                  placeholder={t('play.sidebar.poll.optionsPlaceholder')}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none ring-cyan-500/40 placeholder:text-muted focus:ring"
                />
                <button
                  type="button"
                  onClick={() => void handleCreatePoll()}
                  disabled={pollBusy || !currentPage}
                  className="mt-2 w-full rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pollBusy ? t('play.sidebar.poll.processing') : t('play.sidebar.poll.createAndStart')}
                </button>
              </div>
            )}
            {pollError ? <p className="text-xs text-rose-700 dark:text-rose-300">{pollError}</p> : null}

            {(pollStarted || pollSettingsOpen) && (
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {pagePolls.length === 0 ? (
                  <div className="rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs text-muted">
                    {pollStarted ? t('play.sidebar.poll.emptyStarted') : t('play.sidebar.poll.empty')}
                  </div>
                ) : (
                  pagePolls.map((poll) => (
                    <div key={poll.id} className="rounded-md border border-border bg-surface-muted p-2">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="text-xs font-medium text-text">{poll.question}</h3>
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
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
                                ? 'border-cyan-300/80 bg-cyan-500/30 text-cyan-800 dark:text-cyan-50'
                                : 'border-cyan-500/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25'
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
                            className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('play.sidebar.poll.clearResults')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePoll(poll.id)}
                            disabled={pollBusy}
                            className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('play.sidebar.poll.deleteQuestion')}
                          </button>
                        </div>
                      ) : null}
                      <div className="space-y-1.5">
                        {poll.options.map((option, idx) => {
                          const ratio = pollOptionPercent(option.votes, poll.total_votes);
                          const selected = pollVotes[poll.id] === idx;
                          return (
                            <button
                              key={`${poll.id}-${idx}`}
                              type="button"
                              onClick={() => void handleVotePoll(poll.id, idx)}
                              disabled={pollBusy || !poll.is_active}
                              className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${selected ? 'border-emerald-400 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100' : 'border-border bg-surface text-text hover:bg-surface-muted'} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="truncate">{option.text}</span>
                                <span className="font-mono text-[10px] text-muted">{option.votes} · {ratio}%</span>
                              </div>
                              <div className="h-1 overflow-hidden rounded-full bg-surface-muted">
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
      )}

      {notebookTab === 'interact' && (
      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            {t('play.sidebar.bookmarksTitle')}
            {bookmarks.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-normal text-amber-700 dark:text-amber-300">{bookmarks.length}</span>
            )}
          </h2>
          {bookmarks.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const text = formatPageListText(bookmarks, { prefix: t('play.common.pagePrefix'), suffix: t('play.common.pageSuffix'), separator: t('play.sidebar.pageListSeparator') });
                void copyTextToClipboard(text).then((ok) => {
                  setBookmarkCopyMsg(ok ? t('play.sidebar.copyListDone') : t('play.sidebar.copyListFail'));
                  setTimeout(() => setBookmarkCopyMsg(null), 2000);
                });
              }}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-muted hover:text-text"
            >
              {bookmarkCopyMsg ?? t('play.sidebar.copyList')}
            </button>
          )}
        </div>
        <div className="px-4 py-3">
          {bookmarks.length === 0 ? (
            <p className="text-xs text-muted">{t('play.sidebar.bookmarksEmpty')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...bookmarks].sort((a, b) => a - b).map((pageNum) => {
                const bookmarkPage = deckPages.find((p) => p.page_number === pageNum);
                const thumbSrc = bookmarkPage?.thumbnail_url ?? bookmarkPage?.image_url;
                return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentIdx(pageNum - 1)}
                  className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-200 hover:bg-amber-500/20"
                  title={t('play.sidebar.bookmarkRemove')}
                >
                  {thumbSrc && (
                    <img src={withImageBust(thumbSrc) ?? thumbSrc} alt={`${t('play.common.pagePrefix')}${pageNum}${t('play.common.pageSuffix')}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-6 w-10 shrink-0 rounded object-cover" />
                  )}
                  <span>🔖 {t('play.common.pagePrefix')}{pageNum}{t('play.common.pageSuffix')}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(pageNum); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleBookmark(pageNum); } }}
                    className="ml-0.5 text-amber-600 hover:text-amber-700 dark:text-amber-400/60 dark:hover:text-amber-300"
                    aria-label={t('play.sidebar.bookmarkRemove')}
                  >
                    ×
                  </span>
                </button>
              );
              })}
            </div>
          )}
        </div>
      </section>
      )}

      {notebookTab === 'interact' && (
      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            {t('play.sidebar.importantTitle')}
            {importantPages.length > 0 && (
              <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-normal text-yellow-300">{importantPages.length}</span>
            )}
          </h2>
          {importantPages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const text = formatPageListText(importantPages, { prefix: t('play.common.pagePrefix'), suffix: t('play.common.pageSuffix'), separator: t('play.sidebar.pageListSeparator') });
                void copyTextToClipboard(text).then((ok) => {
                  setImportantCopyMsg(ok ? t('play.sidebar.copyListDone') : t('play.sidebar.copyListFail'));
                  setTimeout(() => setImportantCopyMsg(null), 2000);
                });
              }}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-muted hover:text-text"
            >
              {importantCopyMsg ?? t('play.sidebar.copyList')}
            </button>
          )}
          </div>
        </div>
        <div className="px-4 py-3">
          {importantPages.length === 0 ? (
            <p className="text-xs text-muted">{t('play.sidebar.importantEmpty')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...importantPages].sort((a, b) => a - b).map((pageNum) => {
                const importantPage = deckPages.find((p) => p.page_number === pageNum);
                const thumbSrc = importantPage?.thumbnail_url ?? importantPage?.image_url;
                return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentIdx(pageNum - 1)}
                  className="flex items-center gap-1.5 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-200 hover:bg-yellow-500/20"
                >
                  {thumbSrc && (
                    <img src={withImageBust(thumbSrc) ?? thumbSrc} alt={`${t('play.common.pagePrefix')}${pageNum}${t('play.common.pageSuffix')}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-6 w-10 shrink-0 rounded object-cover" />
                  )}
                  <span>★ {t('play.common.pagePrefix')}{pageNum}{t('play.common.pageSuffix')}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); toggleImportantPage(pageNum); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleImportantPage(pageNum); } }}
                    className="ml-0.5 text-yellow-400/60 hover:text-yellow-300"
                    aria-label={t('play.sidebar.unmarkImportant')}
                  >
                    ×
                  </span>
                </button>
              );
              })}
            </div>
          )}
        </div>
      </section>
      )}

      {notebookTab === 'notes' && <CommentsSection />}

      {notebookTab === 'slides' && <SimilarPagesSection />}

      {notebookTab === 'interact' && <ReviewListSection />}

      {notebookTab === 'ai' && (
        <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface p-1" role="tablist">
          {AI_SUBTABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={aiSubTab === tab.id}
              onClick={() => setAiSubTab(tab.id)}
              className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                aiSubTab === tab.id
                  ? 'bg-primary/15 text-primary dark:bg-primary/20'
                  : 'text-muted hover:bg-surface-muted hover:text-text'
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      )}

      {notebookTab === 'ai' && aiSubTab === 'tutor' && <PageAskPanel />}

      {notebookTab === 'ai' && aiSubTab === 'quality' && <QualityCheckPanel />}

      {notebookTab === 'notes' && <PageNoteSection />}

      {notebookTab === 'ai' && aiSubTab === 'chat' && (
      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-text">
          💬 {t('play.sidebar.qa.title')}
        </h2>
      </div>
      <p className="mb-2 text-xs text-muted">{t('play.sidebar.qa.usageNote')}</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleClearChat()}
          disabled={isReadOnlyProcessing || chatBusy || chatHistory.length === 0}
          className="rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-xs text-rose-700 dark:text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('play.sidebar.qa.clearAllMessages')}
        </button>
      </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {chatHistory.length === 0 ? (
          <div className="text-muted">{t('play.sidebar.qa.emptyChat')}</div>
        ) : (
          chatHistory.map((m, idx) => (
            <div key={idx} className={m.role === 'user' ? 'text-text' : 'text-emerald-700 dark:text-emerald-200'}>
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
      <div className="border-t border-border p-3">
        <div className="flex flex-col gap-2">
          {/* Reference image thumbnail (paste from clipboard) */}
          {chatPastedImageUrl && (
            <div className="flex items-center gap-2">
              <div className="relative inline-block shrink-0">
                <img
                  src={chatPastedImageUrl}
                  alt={t('play.sidebar.qa.referenceImageAlt')}
                  className="max-h-16 w-auto rounded border border-border object-contain"
                />
                <button
                  type="button"
                  onClick={clearChatPastedImage}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-[10px] text-text hover:bg-rose-600"
                  title={t('play.sidebar.qa.removeReferenceImage')}
                >✕</button>
              </div>
              <p className="text-xs text-muted">{t('play.sidebar.qa.referenceImageLabel')}</p>
            </div>
          )}
          {/* Region selection status */}
          {imageEditRegion && (
            <div className="flex items-center gap-2 text-xs text-cyan-400">
              <span>{t('play.sidebar.qa.regionSelected')}</span>
              <button
                type="button"
                onClick={clearImageEditRegion}
                className="text-muted hover:text-rose-400"
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
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none ring-emerald-500/40 placeholder:text-muted focus:ring"
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
                    ? 'border-cyan-400/70 bg-cyan-500/25 text-cyan-800 dark:text-cyan-100'
                    : 'border-border bg-surface-muted text-text hover:bg-surface-muted'
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
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {chatInpaintBusy ? t('play.sidebar.qa.editing') : t('play.sidebar.qa.editImage')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRegenerateImageWithPrompt()}
                disabled={isReadOnlyProcessing || slideBusy || !currentPage}
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('play.sidebar.qa.editImage')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSendChat()}
              disabled={isReadOnlyProcessing || chatBusy || !hasChatInput}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chatBusy ? t('play.sidebar.qa.asking') : t('play.sidebar.qa.ask')}
            </button>
          </div>
        </div>
        {chatError ? <p className="mt-1 text-xs text-rose-300">{chatError}</p> : null}
        {chatInpaintError ? <p className="mt-1 text-xs text-rose-300">{chatInpaintError}</p> : null}
      </div>
      </section>
      )}
    </aside>
  );
}
