import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { createPageComment } from '../../lib/api/pdfs';
import { getAuthStatus } from '../../lib/api/system';
import { getStoredCommentAuthor } from '../../lib/commentAuthor';
import { MAX_COMMENT_LENGTH } from '../../lib/commentLimits';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { extractCitedPages } from '../../lib/extractCitedPages';
import { MarkdownMath } from '../../components/MarkdownMath';

export function PageAskPanel() {
  const { t } = useI18n();
  const {
    canAskPage,
    pageAskInput, setPageAskInput,
    pageAskMessages,
    pageAskBusy, pageAskError,
    handleAskPage, clearPageAsk, cancelAskPage,
    pdfId, currentPage, currentShareToken,
    deckPages, setCurrentIdx,
    pageAskVerbosity, setPageAskVerbosity,
    openTutorProposal,
  } = usePlayPageContext();

  // 把 AI 導師答案中引用的「第 N 頁」轉成可點擊捷徑：只保留實際存在、且非目前頁的頁碼，
  // 點擊即切換到該頁（透過 deckPages 對應的索引）。
  const citedPagesFor = (answer: string): number[] => {
    const currentNumber = currentPage?.page_number ?? null;
    return extractCitedPages(answer).filter(
      (n) => n !== currentNumber && deckPages.some((p) => p.page_number === n),
    );
  };
  const jumpToPage = (pageNumber: number) => {
    const idx = deckPages.findIndex((p) => p.page_number === pageNumber);
    if (idx >= 0) setCurrentIdx(idx);
  };
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');
  // 登入使用者的顯示名稱，作為「存這則 AI 導師回答的人」的預設名稱（未設暱稱時用）。
  const [authName, setAuthName] = useState('');
  useEffect(() => {
    let alive = true;
    void getAuthStatus()
      .then((s) => { if (alive) setAuthName((s.user?.name || s.user?.email || '').trim()); })
      .catch(() => { /* 未登入或舊後端：維持空字串 */ });
    return () => { alive = false; };
  }, []);

  const hasConversation = pageAskMessages.length > 0;
  const lastAnswer = [...pageAskMessages].reverse().find((m) => m.role === 'assistant')?.content ?? null;
  const lastQuestion = [...pageAskMessages].reverse().find((m) => m.role === 'user')?.content ?? null;
  // While streaming, the assistant bubble fills in live; only show the "thinking…" hint
  // until the first streamed token arrives (assistant placeholder still empty).
  const lastMessage = pageAskMessages[pageAskMessages.length - 1];
  const awaitingFirstToken = pageAskBusy && lastMessage?.role === 'assistant' && lastMessage.content === '';

  const handleSaveAsNote = async () => {
    if (!pdfId || !currentPage || !lastAnswer || !lastQuestion) return;
    setSaveStatus('saving');
    try {
      // 存成「頁面評論」的一則（多筆、可單獨刪除），而非覆蓋單一的頁面備註。
      // 超過評論長度上限才截斷以免後端 400（上限已放寬，通常整段 Q&A 都能完整保留）。
      const combined = `Q: ${lastQuestion.trim()}\nA: ${lastAnswer.trim()}`;
      const text = combined.length > MAX_COMMENT_LENGTH ? `${combined.slice(0, MAX_COMMENT_LENGTH - 1)}…` : combined;
      // 標示這則評論是誰存的：優先用評論暱稱，否則用登入帳號名稱；仍保留「AI 導師」表示內容來源。
      const saver = (getStoredCommentAuthor() || authName).trim().slice(0, 60);
      const author = saver
        ? interpolateTemplate(t('play.sidebar.aiTutorAuthorWithName'), { name: saver })
        : t('play.sidebar.aiTutorAuthor');
      await createPageComment(pdfId, currentPage.page_number, author, text, currentShareToken);
      setSaveStatus('ok');
    } catch {
      setSaveStatus('fail');
    } finally {
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  if (!canAskPage) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-text">{t('play.sidebar.pageAsk.title')}</h2>
        <p className="text-xs text-muted">{t('play.sidebar.pageAsk.loginRequired')}</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t('play.sidebar.pageAsk.title')}</h2>
          {(hasConversation || pageAskError) && (
            <button
              type="button"
              onClick={clearPageAsk}
              className="rounded-md border border-border bg-surface-muted px-2 py-1 text-xs text-text hover:bg-surface-muted"
            >
              {t('play.sidebar.pageAsk.clear')}
            </button>
          )}
        </div>
      </div>

      {hasConversation && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-b border-border p-3">
          {pageAskMessages.map((m, i) => (
            // Skip the empty assistant placeholder shown before the first streamed token
            // (the "thinking…" hint covers that state instead) — unless it already has
            // tool-call notes to show while the tutor looks things up.
            m.role === 'assistant' && m.content === '' && !(m.toolNotes && m.toolNotes.length) ? null : (
            <div
              key={i}
              className={m.role === 'user'
                ? 'ml-6 rounded-md bg-surface-muted px-3 py-2 text-sm text-text'
                : 'mr-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'}
            >
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">
                {m.role === 'user' ? t('play.sidebar.pageAsk.you') : t('play.sidebar.pageAsk.tutor')}
              </p>
              {m.role === 'assistant' && m.toolNotes && m.toolNotes.length > 0 && (
                <ul className="mb-1.5 space-y-0.5 border-b border-emerald-200/60 pb-1.5 dark:border-emerald-800/40">
                  {m.toolNotes.map((note, j) => (
                    <li key={j} className="flex items-center gap-1 text-[11px] text-emerald-700/90 dark:text-emerald-300/90">
                      <span aria-hidden>🔍</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              )}
              {m.role === 'user'
                ? <p className="whitespace-pre-wrap">{m.content}</p>
                : m.content
                  ? <MarkdownMath content={m.content} />
                  : <p className="text-xs text-muted">{t('play.sidebar.pageAsk.asking')}</p>}
              {/* Edits the tutor offered with this answer. Nothing has changed yet — each card is a
                  thing to review, which is why the label says so rather than reading as a receipt. */}
              {m.role === 'assistant' && m.proposals && m.proposals.length > 0 && (
                <div className="mt-2 space-y-2 border-t border-emerald-200/60 pt-2 dark:border-emerald-800/40">
                  {m.proposals.map((proposal, j) => (
                    <div
                      key={`${proposal.kind}-${j}`}
                      className="rounded-md border border-amber-300/70 bg-amber-50/80 p-2 dark:border-amber-700/60 dark:bg-amber-950/30"
                    >
                      <p className="text-[11px] font-medium text-amber-900 dark:text-amber-100">
                        {proposal.kind === 'image'
                          ? t('play.tutorProposal.imageCard').replace('{page}', String(proposal.page))
                          : t('play.tutorProposal.scriptCard').replace('{page}', String(proposal.page))}
                      </p>
                      <p className="mt-0.5 text-[11px] text-amber-800/90 dark:text-amber-200/90">{proposal.instruction}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{t('play.tutorProposal.notAppliedYet')}</p>
                      <button
                        type="button"
                        onClick={() => openTutorProposal(proposal)}
                        className="mt-1.5 rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-800/60"
                      >
                        {t('play.tutorProposal.review')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && citedPagesFor(m.content).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-emerald-200/60 pt-2 dark:border-emerald-800/40">
                  <span className="text-[10px] uppercase tracking-wide text-muted">
                    {t('play.sidebar.pageAsk.citedPagesLabel')}
                  </span>
                  {citedPagesFor(m.content).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => jumpToPage(n)}
                      className="rounded border border-emerald-300 bg-emerald-100/70 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-200 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-800/60"
                    >
                      {interpolateTemplate(t('play.sidebar.pageAsk.jumpToPage'), { page: n })}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )
          ))}
          {awaitingFirstToken && <p className="text-xs text-muted">{t('play.sidebar.pageAsk.asking')}</p>}
          {lastAnswer && !pageAskBusy && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleSaveAsNote()}
                disabled={saveStatus === 'saving'}
                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveStatus === 'ok'
                  ? t('play.sidebar.saveAsNoteDone')
                  : saveStatus === 'fail'
                    ? t('play.sidebar.saveAsNoteFail')
                    : saveStatus === 'saving'
                      ? '…'
                      : t('play.sidebar.saveAsNote')}
              </button>
            </div>
          )}
        </div>
      )}

      {pageAskError && (
        <div className="border-b border-border p-3">
          <p className="text-xs text-rose-700 dark:text-rose-300">{pageAskError}</p>
        </div>
      )}

      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] text-muted">{t('play.sidebar.pageAsk.verbosityLabel')}</span>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(['brief', 'detailed'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setPageAskVerbosity(v)}
                disabled={pageAskBusy}
                aria-pressed={pageAskVerbosity === v}
                className={`px-2 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
                  pageAskVerbosity === v
                    ? 'bg-indigo-600 text-white'
                    : 'bg-surface text-text hover:bg-surface-muted'
                }`}
              >
                {v === 'brief'
                  ? t('play.sidebar.pageAsk.verbosityBrief')
                  : t('play.sidebar.pageAsk.verbosityDetailed')}
              </button>
            ))}
          </div>
        </div>
        <textarea
          className="mb-2 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none disabled:opacity-50"
          rows={3}
          placeholder={hasConversation ? t('play.sidebar.pageAsk.followUpPlaceholder') : t('play.sidebar.pageAsk.inputPlaceholder')}
          maxLength={500}
          value={pageAskInput}
          disabled={pageAskBusy}
          onChange={(e) => setPageAskInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleAskPage();
            }
          }}
        />
        {pageAskBusy ? (
          <button
            type="button"
            onClick={cancelAskPage}
            className="w-full rounded-md border border-transparent bg-slate-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-500"
          >
            {t('play.sidebar.pageAsk.cancel')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleAskPage()}
            disabled={!pageAskInput.trim()}
            className="w-full rounded-md border border-transparent bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {hasConversation ? t('play.sidebar.pageAsk.followUp') : t('play.sidebar.pageAsk.ask')}
          </button>
        )}
      </div>
    </section>
  );
}
