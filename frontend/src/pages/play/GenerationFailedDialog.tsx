import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useOverlayDismiss } from '../../components/useOverlayDismiss';
import { usePlayPageContext } from './PlayPageContext';

/**
 * Pops up once per deck the moment `detail.status` is observed as `'failed'`, surfacing the
 * real backend `error_message` (e.g. an upstream quota/billing error) instead of requiring the
 * user to notice the inline banner in the header. Dismissal is remembered per pdfId so it
 * doesn't reappear on every poll tick while the failed state persists.
 */
export function GenerationFailedDialog() {
  const { t } = useI18n();
  const { pdfId, detail } = usePlayPageContext();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const close = () => setDismissedFor(pdfId ?? null);
  const { onBackdropClick } = useOverlayDismiss(close);

  const open = !!pdfId && !!detail?.error_message && detail.status === 'failed' && dismissedFor !== pdfId;
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="generation-failed-title"
        className="w-full max-w-md rounded-xl border border-rose-400/40 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-xl text-rose-200">
            !
          </div>
          <div>
            <h2 id="generation-failed-title" className="text-lg font-semibold text-rose-100">
              {t('play.header.generationFailedDialogTitle')}
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{detail?.error_message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-rose-300 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-rose-200"
          >
            {t('play.header.generationFailedDialogOk')}
          </button>
        </div>
      </div>
    </div>
  );
}
