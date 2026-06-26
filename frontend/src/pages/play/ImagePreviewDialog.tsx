import { useI18n } from '../../i18n';
import { useOverlayDismiss } from '../../components/useOverlayDismiss';

interface ImagePreviewDialogProps {
  imagePreviewUrl: string;
  isReadOnlyProcessing: boolean;
  onClose: () => void;
  onApply: () => void;
}

export function ImagePreviewDialog({ imagePreviewUrl, isReadOnlyProcessing, onClose, onApply }: ImagePreviewDialogProps) {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onBackdropClick}>
      <div role="dialog" aria-modal="true" aria-label={t('play.imagePreviewDialog.title')} className="w-full max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">{t('play.imagePreviewDialog.title')}</h3>
        <div className="mb-4 flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2">
          <img src={imagePreviewUrl} alt={t('play.imagePreviewDialog.imageAlt')} className="max-h-[64vh] w-auto rounded" />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.imagePreviewDialog.close')}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={isReadOnlyProcessing}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('play.imagePreviewDialog.applyReplace')}
          </button>
        </div>
      </div>
    </div>
  );
}
