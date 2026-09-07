// 首頁（也就是登入頁）的分享網址，與它能不能被別的裝置掃到。
//
// 站上原本就有 QR code（播放時讓聽眾掃描加入投票／同步，見 joinQr.ts），但那是「這一份簡報」
// 的分享連結。這裡要的是另一件事：把**這個站本身**交給別人——上課前請學生自己連進來登入。

/** 登入頁就是首頁：整個站沒有獨立的 /login 路由，Google 登入按鈕在 HomePage 上。 */
export function loginPageUrl(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '');
  return trimmed ? `${trimmed}/` : '/';
}

/**
 * 這個網址在別台裝置上是否連不到。
 *
 * 掃 QR code 的是別人的手機，而 `localhost:3000` 在那支手機上指的是那支手機自己。伺服器不知道
 * 自己對外的網址，網址列裡是什麼就是什麼——所以不能替使用者修好，但可以在他把畫面轉向全班之前
 * 講清楚。判斷條件是**主機名**，不是通訊協定：區網 IP（`http://192.168.x.x:3000`）掃得到，
 * 是可用的。
 */
export function isLocalOnlyOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '127.0.0.1' || host.startsWith('127.')) return true;
  if (host === '::1' || host === '[::1]') return true;
  return false;
}
