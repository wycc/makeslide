import { useI18n } from '../../i18n';
import { useOverlayDismiss } from '../../components/useOverlayDismiss';
import { AccessControlPanel } from './AccessControlPanel';
import type { PdfVisibilityMode } from '../../lib/api/pdfs';

interface AccessControlDialogProps {
  pdfId: string;
  visibility?: PdfVisibilityMode;
  onClose: () => void;
}

/**
 * Owner-only modal for managing who can access the presentation (default permission + per-user /
 * group ACL). Deliberately separate from the share-link dialog: access management is an identity
 * concern and must not require first minting a share link / QR code.
 */
export function AccessControlDialog({ pdfId, visibility, onClose }: AccessControlDialogProps) {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('play.access.tab')}
        className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-100">{t('play.access.tab')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.shareDialog.close')}
          </button>
        </div>
        <AccessControlPanel pdfId={pdfId} initialVisibility={visibility ?? 'private'} />
      </div>
    </div>
  );
}
