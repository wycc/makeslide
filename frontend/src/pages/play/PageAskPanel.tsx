import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';

export function PageAskPanel() {
  const { t } = useI18n();
  const {
    canAskPage,
    pageAskInput, setPageAskInput,
    pageAskAnswer,
    pageAskBusy, pageAskError,
    handleAskPage, clearPageAsk,
  } = usePlayPageContext();

  if (!canAskPage) {
    return (
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">{t('play.sidebar.pageAsk.title')}</h2>
        <p className="text-xs text-slate-500">{t('play.sidebar.pageAsk.loginRequired')}</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">{t('play.sidebar.pageAsk.title')}</h2>
          {(pageAskAnswer || pageAskError) && (
            <button
              type="button"
              onClick={clearPageAsk}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              {t('play.sidebar.pageAsk.clear')}
            </button>
          )}
        </div>
      </div>

      {pageAskAnswer && (
        <div className="border-b border-slate-800 p-3">
          <p className="whitespace-pre-wrap text-sm text-emerald-200">{pageAskAnswer}</p>
        </div>
      )}

      {pageAskError && (
        <div className="border-b border-slate-800 p-3">
          <p className="text-xs text-rose-300">{pageAskError}</p>
        </div>
      )}

      <div className="p-3">
        <textarea
          className="mb-2 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
          rows={3}
          placeholder={t('play.sidebar.pageAsk.inputPlaceholder')}
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
          className="w-full rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pageAskBusy ? t('play.sidebar.pageAsk.asking') : t('play.sidebar.pageAsk.ask')}
        </button>
      </div>
    </section>
  );
}
