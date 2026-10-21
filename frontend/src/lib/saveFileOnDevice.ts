// 把產生的檔案存到學生的裝置（使用者回報，2026-10-22：iPhone 交卷後不會下載作答證明，而是直接把
// PDF 開成一個頁面）。
//
// iOS 上所有瀏覽器都是 WebKit：`<a download>` 指向 blob URL 時不下載，而是在目前分頁顯示 PDF，
// 作答頁就被換掉了。iOS 也不讓非使用者點擊的時機（例如上傳完成後）開分享選單。所以 iOS 不自動
// 下載，改讓學生按按鈕：能分享檔案就開分享選單（可選「儲存到檔案」），否則在新分頁開啟 PDF，
// 不會蓋掉作答頁。其他平台照舊用 `<a download>`。

import { triggerDownload } from './download';

interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** iPhone／iPad／iPod（含 iPadOS 13+ 偽裝成 Mac 的 Safari）。 */
export function isIosDevice(nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** 這個裝置能否用程式自動下載（不需要使用者點擊）。 */
export function canAutoDownload(nav?: NavigatorLike): boolean {
  return !isIosDevice(nav);
}

export type SaveFileResult =
  | { kind: 'downloaded' }
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  /** 分享選單失敗（不是學生取消）：此時已不在點擊當下，不能接著下載，請學生再按一次（改走下載）。 */
  | { kind: 'shareFailed'; error: string };

/**
 * 由使用者點擊呼叫，而且在點擊當下同步執行到真正動作為止（iOS 只在使用者手勢內允許分享與下載）。
 * iOS：`preferShare` 且裝置能分享檔案 → 分享選單（可選「儲存到檔案」）；否則直接用 `<a download>`
 *（iOS 13+ Safari 在點擊當下會跳下載提示，存到「檔案 › 下載項目」）。不開新分頁——那在 iOS 上
 * 只會把 PDF 顯示成一頁（使用者回報，2026-10-22）。其他平台直接下載。
 * `url` 是同一個 blob 的 object URL（呼叫端負責釋放）。
 */
export async function saveFileOnDevice(blob: Blob, url: string, filename: string, preferShare = true): Promise<SaveFileResult> {
  if (isIosDevice() && preferShare) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
        return { kind: 'shared' };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'cancelled' };
        return { kind: 'shareFailed', error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
      }
    }
  }
  triggerDownload(url, filename);
  return { kind: 'downloaded' };
}
