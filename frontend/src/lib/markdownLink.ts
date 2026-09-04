// Markdown 連結 `[文字](網址)` 的網址把關。
//
// 這些 Markdown 來自使用者輸入（頁面備註、留言、AI 回答），在加入連結之前，MarkdownMath
// 渲染出來的文字一律是 React text node，等於沒有注入面；`href` 是第一個「使用者寫什麼就
// 進到 DOM 屬性」的地方，所以在這裡就把 scheme 收斂到安全的幾種，而不是交給瀏覽器判斷。

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * 回傳可以放進 `href` 的網址；不接受的一律回 null（呼叫端原樣顯示那段文字，
 * 讓寫的人看得出來自己寫了什麼、而不是靜靜消失）。
 *
 * 接受：`http(s)://…`、`mailto:…`、以及站內絕對路徑 `/play/xxx`。
 * 不接受：`javascript:`／`data:` 等有執行或內容偽造風險的 scheme、`//example.com`
 * （protocol-relative，看起來像站內路徑其實會連到外站），以及沒有 scheme 的相對路徑
 * （`www.example.com` 這種寫法瀏覽器會當成相對路徑，連出去的地方多半不是作者想的那個）。
 */
export function safeMarkdownLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  // 站內絕對路徑；`//host` 排除在外——它是 protocol-relative URL，不是站內路徑。
  if (href.startsWith('/')) return href.startsWith('//') ? null : href;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
  if (!scheme) return null;
  return SAFE_SCHEMES.has(scheme) ? href : null;
}

/** 連結要不要開新分頁：站內路徑留在原分頁，外部連結另開，免得授課到一半整頁被導走。 */
export function opensInNewTab(href: string): boolean {
  return !href.startsWith('/');
}
