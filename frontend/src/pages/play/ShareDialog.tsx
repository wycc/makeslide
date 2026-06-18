import { useState } from 'react';
import { copyTextToClipboard } from '../../lib/clipboard';
import { useI18n } from '../../i18n';

interface ShareDialogProps {
  shareUrl: string;
  onCopySuccess: () => void;
  onCopyError: () => void;
  onClose: () => void;
}

export function ShareDialog({ shareUrl, onCopySuccess, onCopyError, onClose }: ShareDialogProps) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-100">{t('play.shareDialog.title')}</h3>
        <p className="mt-2 text-sm text-slate-300">{t('play.shareDialog.description')}</p>
        <textarea
          readOnly
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 h-24 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-200 outline-none"
        />
        {copyStatus === 'error' ? <p className="mt-2 text-xs text-rose-300">{t('play.shareDialog.copyFailed')}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!shareUrl) return;
              const result = await copyTextToClipboard(shareUrl);
              if (result.ok) {
                setCopyStatus('success');
                onCopySuccess();
              } else {
                setCopyStatus('error');
                onCopyError();
              }
            }}
            className="rounded border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/25"
          >
            {copyStatus === 'success' ? t('play.shareDialog.copied') : t('play.shareDialog.copyLink')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.shareDialog.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
