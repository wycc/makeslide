import { useState } from 'react';
import type { SlideRenderType } from '../../types';
import { useI18n } from '../../i18n';

/** The three kinds a page can be switched between. `gsap-image` is a variant of `image`, not a choice. */
export type PageTypeChoice = 'image' | 'react' | 'notebook';

/** Maps a stored render_type to the choice this dialog shows as current. */
export function pageTypeChoiceOf(renderType: SlideRenderType | undefined): PageTypeChoice {
  if (renderType === 'react') return 'react';
  if (renderType === 'notebook') return 'notebook';
  return 'image';
}

interface PageTypeDialogProps {
  pageNumber: number;
  current: PageTypeChoice;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (choice: PageTypeChoice) => void;
}

/**
 * Switch one page between the three kinds of slide it can be.
 *
 * This replaced a single "To Notebook" button, which could only ever add a kind and never take one
 * away — with three page types that framing stops working: the useful question is "what should
 * this page be?", and the answer has to include coming back. Each option therefore states what
 * happens to the page's existing content, because the honest answer differs per direction: nothing
 * is deleted (the JPG, the `.ipynb` and the React code all stay on disk), but only one of them is
 * what the audience sees.
 */
export function PageTypeDialog({ pageNumber, current, busy, error, onClose, onApply }: PageTypeDialogProps) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<PageTypeChoice>(current);

  const options: Array<{ value: PageTypeChoice; label: string; description: string }> = [
    { value: 'image', label: t('play.pageType.image'), description: t('play.pageType.imageDescription') },
    { value: 'react', label: t('play.pageType.react'), description: t('play.pageType.reactDescription') },
    { value: 'notebook', label: t('play.pageType.notebook'), description: t('play.pageType.notebookDescription') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-1 text-sm font-semibold text-slate-200">
          {t('play.pageType.title').replace('{page}', String(pageNumber))}
        </h3>
        <p className="mb-3 text-xs text-slate-400">{t('play.pageType.description')}</p>

        <div className="space-y-2">
          {options.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${
                choice === option.value
                  ? 'border-cyan-500/60 bg-cyan-500/10'
                  : 'border-slate-700 bg-slate-900 hover:bg-slate-800'
              }`}
            >
              <input
                type="radio"
                name="page-type"
                className="mt-1"
                checked={choice === option.value}
                disabled={busy}
                onChange={() => setChoice(option.value)}
              />
              <span>
                <span className="block text-sm text-slate-100">
                  {option.label}
                  {option.value === current ? (
                    <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                      {t('play.pageType.currentBadge')}
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-slate-400">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-slate-500">{t('play.pageType.keepsContentHint')}</p>
        {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {t('play.pageType.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onApply(choice)}
            disabled={busy || choice === current}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
          >
            {busy ? t('play.pageType.applying') : t('play.pageType.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
