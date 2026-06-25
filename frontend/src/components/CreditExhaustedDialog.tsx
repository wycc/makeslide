import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import {
  ApiError,
  CREDIT_EXHAUSTED_EVENT,
  mapApiErrorToHumanMessage,
  type CreditExhaustedEventDetail,
} from '../lib/api';

export default function CreditExhaustedDialog() {
  const { t } = useI18n();
  const [detail, setDetail] = useState<CreditExhaustedEventDetail | null>(null);

  useEffect(() => {
    const onCreditExhausted = (event: Event) => {
      const customEvent = event as CustomEvent<CreditExhaustedEventDetail>;
      setDetail(customEvent.detail);
    };
    window.addEventListener(CREDIT_EXHAUSTED_EVENT, onCreditExhausted);
    return () => window.removeEventListener(CREDIT_EXHAUSTED_EVENT, onCreditExhausted);
  }, []);

  if (!detail) return null;

  const human = mapApiErrorToHumanMessage(new ApiError('', detail.code, detail.status), t);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-exhausted-title"
        className="w-full max-w-md rounded-xl border border-amber-400/40 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-xl text-amber-200">
            !
          </div>
          <div>
            <h2 id="credit-exhausted-title" className="text-lg font-semibold text-amber-100">
              {human.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">{human.message}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
          <p className="font-medium text-slate-100">{t('creditExhausted.suggestedNextStep')}</p>
          <p className="mt-1 text-slate-300">{human.nextStep}</p>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {t('creditExhausted.errorCode').replaceAll('{code}', detail.code).replaceAll('{status}', String(detail.status))}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <a
            href="/settings"
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            onClick={() => setDetail(null)}
          >
            {t('creditExhausted.goToSettings')}
          </a>
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="rounded-md bg-amber-300 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-200"
          >
            {t('creditExhausted.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}
