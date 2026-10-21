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

export type SaveFileResult = 'downloaded' | 'shared' | 'opened' | 'cancelled';

/**
 * 由使用者點擊呼叫：iOS 先試分享選單、再退回新分頁開啟；其他平台直接下載。
 * `url` 是同一個 blob 的 object URL（呼叫端負責釋放）。
 */
export async function saveFileOnDevice(blob: Blob, url: string, filename: string): Promise<SaveFileResult> {
  if (!isIosDevice()) {
    triggerDownload(url, filename);
    return 'downloaded';
  }
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      // 學生關掉分享選單：不要接著開新分頁，讓他再按一次就好。
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  window.open(url, '_blank', 'noopener');
  return 'opened';
}
