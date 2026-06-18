import type { ImagePromptTemplate } from '../../lib/api';
import { useI18n } from '../../i18n';

interface ImageStyleDialogProps {
  imageStyleTemplates: ImagePromptTemplate[];
  selectedImageStyleTemplateKey: string;
  onSelectedImageStyleTemplateKeyChange: (key: string) => void;
  onApplyTemplate: (key: string) => void;
  deckImageStylePrompt: string;
  onDeckImageStylePromptChange: (value: string) => void;
  isReadOnlyProcessing: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function ImageStyleDialog({
  imageStyleTemplates,
  selectedImageStyleTemplateKey,
  onSelectedImageStyleTemplateKeyChange,
  onApplyTemplate,
  deckImageStylePrompt,
  onDeckImageStylePromptChange,
  isReadOnlyProcessing,
  onClose,
  onSave,
}: ImageStyleDialogProps) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">{t('play.imageStyleDialog.title')}</h3>
        <p className="mb-3 text-xs text-slate-400">
          {t('play.imageStyleDialog.description')}
        </p>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <select
            value={selectedImageStyleTemplateKey}
            onChange={(e) => onSelectedImageStyleTemplateKeyChange(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            {imageStyleTemplates.map((template) => (
              <option key={template.key} value={template.key}>{template.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onApplyTemplate(selectedImageStyleTemplateKey)}
            disabled={isReadOnlyProcessing}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25"
          >
            {t('play.imageStyleDialog.applyTemplate')}
          </button>
        </div>
        <textarea
          value={deckImageStylePrompt}
          onChange={(e) => onDeckImageStylePromptChange(e.target.value)}
          disabled={isReadOnlyProcessing}
          rows={8}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
          placeholder={t('play.imageStyleDialog.promptPlaceholder')}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.imageStyleDialog.close')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isReadOnlyProcessing}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200"
          >
            {t('play.imageStyleDialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
