import { useI18n, type AppLanguage } from '../i18n';
import ContentLanguagePicker from './ContentLanguagePicker';

export interface PptxImportOptions {
  /** The deck's standing style instruction, followed by every narration it ever writes. */
  userPrompt: string;
  /** Target length of an ordinary page's narration; empty = the product default. */
  scriptMaxCharsPerPage: string;
  /** Target length of one step on an animated page; empty = fall back to the per-page target. */
  scriptCharsPerStep: string;
  /** Write the narration as soon as the pictures are ready. */
  narrate: boolean;
  contentLanguage: AppLanguage;
}

interface Props {
  options: PptxImportOptions;
  onChange: (next: PptxImportOptions) => void;
  onConfirm: () => void;
  onClose: () => void;
  llmDisabled: boolean;
}

/**
 * What to ask before importing a .pptx.
 *
 * Not the prompt dialog the PDF flow uses: that one asks how to *generate* a deck, and a pptx
 * already has its pages. What is still open is how it will be narrated — the style, how long each
 * page's narration should be, and, for a page that builds in steps, how long each step should be.
 * Asked here because these are the deck's standing settings: set them now and every narration
 * written later follows them, rather than being discovered after the first one comes out too
 * short.
 */
export default function UploadPptxDialog({ options, onChange, onConfirm, onClose, llmDisabled }: Props) {
  const { t } = useI18n();
  const set = <K extends keyof PptxImportOptions>(key: K, value: PptxImportOptions[K]) =>
    onChange({ ...options, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-text">{t('upload.pptxDialog.title')}</h2>
        <p className="mt-1 text-xs text-muted">{t('upload.pptxDialog.intro')}</p>

        <label className="mt-4 block text-sm font-medium text-text" htmlFor="pptx-style">
          {t('upload.pptxDialog.styleLabel')}
        </label>
        <textarea
          id="pptx-style"
          value={options.userPrompt}
          onChange={(e) => set('userPrompt', e.target.value)}
          rows={3}
          placeholder={t('upload.pptxDialog.stylePlaceholder')}
          className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
        />
        <p className="mt-1 text-[11px] text-muted">{t('upload.pptxDialog.styleHint')}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-text" htmlFor="pptx-page-chars">
              {t('upload.pptxDialog.pageCharsLabel')}
            </label>
            <input
              id="pptx-page-chars"
              type="number"
              min={80}
              max={2000}
              value={options.scriptMaxCharsPerPage}
              onChange={(e) => set('scriptMaxCharsPerPage', e.target.value)}
              placeholder={t('upload.pptxDialog.defaultPlaceholder')}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
            />
            <p className="mt-1 text-[11px] text-muted">{t('upload.pptxDialog.pageCharsHint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text" htmlFor="pptx-step-chars">
              {t('upload.pptxDialog.stepCharsLabel')}
            </label>
            <input
              id="pptx-step-chars"
              type="number"
              min={40}
              max={2000}
              value={options.scriptCharsPerStep}
              onChange={(e) => set('scriptCharsPerStep', e.target.value)}
              placeholder={t('upload.pptxDialog.defaultPlaceholder')}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
            />
            {/* The one that decides how long an animated page talks for: the page's total is this
                times its step count, so a 24-step build is a long explanation by construction. */}
            <p className="mt-1 text-[11px] text-muted">{t('upload.pptxDialog.stepCharsHint')}</p>
          </div>
        </div>

        <div className="mt-4">
          <ContentLanguagePicker
            value={options.contentLanguage}
            onChange={(language) => set('contentLanguage', language)}
            variant="cards"
          />
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={options.narrate && !llmDisabled}
            disabled={llmDisabled}
            onChange={(e) => set('narrate', e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t('upload.pptxDialog.narrateLabel')}
            <span className="mt-0.5 block text-[11px] text-muted">
              {llmDisabled ? t('providerDisabled.llmHint') : t('upload.pptxDialog.narrateHint')}
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text transition hover:bg-border"
          >
            {t('upload.pptxDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400"
          >
            {t('upload.pptxDialog.choose')}
          </button>
        </div>
      </div>
    </div>
  );
}
