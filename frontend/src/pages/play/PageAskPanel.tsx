import { useState } from 'react';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { updatePageNote } from '../../lib/api/pdfs';

export function PageAskPanel() {
  const { t } = useI18n();
  const {
    canAskPage,
    pageAskInput, setPageAskInput,
    pageAskMessages,
    pageAskBusy, pageAskError,
    handleAskPage, clearPageAsk,
    pdfId, currentPage,
  } = usePlayPageContext();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');

  const hasConversation = pageAskMessages.length > 0;
  const lastAnswer = [...pageAskMessages].reverse().find((m) => m.role === 'assistant')?.content ?? null;
  const lastQuestion = [...pageAskMessages].reverse().find((m) => m.role === 'user')?.content ?? null;

  const handleSaveAsNote = async () => {
    if (!pdfId || !currentPage || !lastAnswer || !lastQuestion) return;
    setSaveStatus('saving');
    try {
      const existing = currentPage.page_notes?.trim() ?? '';
      const appended = `Q: ${lastQuestion.trim()}\nA: ${lastAnswer.trim()}`;
      const newNote = existing ? `${existing}\n\n${appended}` : appended;
      await updatePageNote(pdfId, currentPage.page_number, newNote);
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
    <section className="rounded-lg border border-border bg-surface">
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
        <div className="max-h-96 space-y-2 overflow-y-auto border-b border-border p-3">
          {pageAskMessages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user'
                ? 'ml-6 rounded-md bg-surface-muted px-3 py-2 text-sm text-text'
                : 'mr-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'}
            >
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">
                {m.role === 'user' ? t('play.sidebar.pageAsk.you') : t('play.sidebar.pageAsk.tutor')}
              </p>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
          {pageAskBusy && <p className="text-xs text-muted">{t('play.sidebar.pageAsk.asking')}</p>}
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
        <button
          type="button"
          onClick={() => void handleAskPage()}
          disabled={pageAskBusy || !pageAskInput.trim()}
          className="w-full rounded-md border border-transparent bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pageAskBusy ? t('play.sidebar.pageAsk.asking') : hasConversation ? t('play.sidebar.pageAsk.followUp') : t('play.sidebar.pageAsk.ask')}
        </button>
      </div>
    </section>
  );
}
