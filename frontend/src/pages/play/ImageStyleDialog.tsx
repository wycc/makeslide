import type { ImagePromptTemplate } from '../../lib/api';

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">整份簡報圖片風格設定</h3>
        <p className="mb-3 text-xs text-slate-400">
          這個風格會套用在後續的單張與多張圖片重生。可填入你偏好的風格模板並自行調整。
        </p>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <select
            value={selectedImageStyleTemplateKey}
            onChange={(e) => onSelectedImageStyleTemplateKeyChange(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            {imageStyleTemplates.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onApplyTemplate(selectedImageStyleTemplateKey)}
            disabled={isReadOnlyProcessing}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25"
          >
            套用模板
          </button>
        </div>
        <textarea
          value={deckImageStylePrompt}
          onChange={(e) => onDeckImageStylePromptChange(e.target.value)}
          disabled={isReadOnlyProcessing}
          rows={8}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
          placeholder="例如：academic minimalist style, clean layout..."
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            關閉
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isReadOnlyProcessing}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200"
          >
            儲存設定
          </button>
        </div>
      </div>
    </div>
  );
}
