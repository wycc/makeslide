import { useCallback, useState } from 'react';
import { useI18n } from '../i18n';
import { buildJoinQrImageUrl } from '../lib/joinQr';
import { isLocalOnlyOrigin, loginPageUrl } from '../lib/loginQr';
import { useOverlayDismiss } from './useOverlayDismiss';

/**
 * 把「這個站的登入頁」變成一張可以投影出去的 QR code。
 *
 * 上課前要讓一整班連進來，唸網址是最慢的一種做法。QR 圖沿用播放頁分享用的同一個產生器
 * （`buildJoinQrImageUrl`），所以站上只有一套 QR 產法。
 */
export default function LoginQrDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);
  const [copied, setCopied] = useState(false);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const url = loginPageUrl(origin);
  const localOnly = isLocalOnlyOrigin(origin);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  }, [url]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-qr-title"
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 text-text shadow-2xl"
      >
        <h2 id="login-qr-title" className="text-lg font-semibold">
          {t('home.loginQrTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('home.loginQrDescription')}</p>

        {/* 白底不是裝飾：QR 掃描靠的是明暗對比，深色模式下把黑色的碼放在深色面板上會掃不到。 */}
        <div className="mt-4 flex justify-center rounded-lg bg-white p-3">
          <img
            src={buildJoinQrImageUrl(url)}
            alt={t('home.loginQrImageAlt')}
            width={220}
            height={220}
            className="h-[220px] w-[220px]"
          />
        </div>

        {/* 掃不到的人還是要能把網址打進去，所以網址本身也要看得見。 */}
        <p className="mt-3 break-all text-center font-mono text-xs text-muted">{url}</p>

        {localOnly && (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
            {t('home.loginQrLocalWarning')}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/40"
          >
            {copied ? t('home.loginQrCopied') : t('home.loginQrCopy')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            {t('home.loginQrClose')}
          </button>
        </div>
      </div>
    </div>
  );
}
