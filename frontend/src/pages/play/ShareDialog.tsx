import { useEffect, useState } from 'react';
import { copyTextToClipboard } from '../../lib/clipboard';
import { useI18n } from '../../i18n';

/** Builds the iframe embed snippet for a share URL, or '' when there is no URL yet. */
export function buildEmbedCode(shareUrl: string): string {
  return shareUrl
    ? `<iframe src="${shareUrl}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`
    : '';
}

interface ShareDialogProps {
  shareUrl: string;
  expiresAt?: string | null;
  selectedExpiresDays: number | undefined;
  onExpiresDaysChange: (days: number | undefined) => void;
  onCopySuccess: () => void;
  onCopyError: () => void;
  onClose: () => void;
}

export function ShareDialog({ shareUrl, expiresAt, selectedExpiresDays, onExpiresDaysChange, onCopySuccess, onCopyError, onClose }: ShareDialogProps) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [activeTab, setActiveTab] = useState<'link' | 'embed'>('link');
  const [embedCopyStatus, setEmbedCopyStatus] = useState<'idle' | 'success'>('idle');

  const embedCode = buildEmbedCode(shareUrl);

  // Close on Escape, matching the other play-page overlays.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const EXPIRY_OPTIONS: Array<{ label: string; value: number | undefined }> = [
    { label: t('play.shareDialog.expiryNever'), value: undefined },
    { label: t('play.shareDialog.expiry7days'), value: 7 },
    { label: t('play.shareDialog.expiry30days'), value: 30 },
    { label: t('play.shareDialog.expiry90days'), value: 90 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('play.shareDialog.title')}
        className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
      >
        <h3 className="text-base font-semibold text-slate-100">{t('play.shareDialog.title')}</h3>
        <div className="mt-3 flex gap-1 border-b border-slate-700">
          {(['link', 'embed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium ${activeTab === tab ? 'border-b-2 border-violet-400 text-violet-200' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t(tab === 'link' ? 'play.shareDialog.tabLink' : 'play.shareDialog.embedTab')}
            </button>
          ))}
        </div>

        {activeTab === 'link' ? (
          <>
            <p className="mt-3 text-sm text-slate-300">{t('play.shareDialog.description')}</p>
            <textarea
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 h-24 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-200 outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-slate-400">{t('play.shareDialog.expiryLabel')}</label>
              <select
                value={selectedExpiresDays ?? ''}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  onExpiresDaysChange(val === '' ? undefined : Number(val));
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={String(opt.value)} value={opt.value ?? ''}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {expiresAt ? (
                <span className="text-xs text-amber-300">
                  {t('play.shareDialog.expiresAt').replace('{date}', new Date(expiresAt).toLocaleDateString())}
                </span>
              ) : null}
            </div>
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
              <button type="button" onClick={onClose} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
                {t('play.shareDialog.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-300">{t('play.shareDialog.embedCode')}</p>
            <textarea
              readOnly
              value={embedCode}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 h-24 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-cyan-200 outline-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!embedCode) return;
                  const result = await copyTextToClipboard(embedCode);
                  if (result.ok) {
                    setEmbedCopyStatus('success');
                    setTimeout(() => setEmbedCopyStatus('idle'), 2000);
                  }
                }}
                className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/25"
              >
                {embedCopyStatus === 'success' ? t('play.shareDialog.embedCopied') : t('play.shareDialog.copyEmbed')}
              </button>
              <button type="button" onClick={onClose} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
                {t('play.shareDialog.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
