// 觸發瀏覽器「下載檔案」的共用工具（去重自多處 `document.createElement('a')` 樣板）。
//
// 兩個入口：`triggerDownload` 下載一個已知 URL（伺服器端點或 object URL）；`downloadBlob`
// 把 Blob 建成 object URL 後下載並釋放。沿用專案 `clipboard.ts` 的依賴注入風格（可傳入
// document／URL 以便測試），預設用全域 document/URL；在無 DOM 環境（如 SSR）則為 no-op。

interface AnchorLike {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove(): void;
}
interface DocumentLike {
  createElement(tag: 'a'): AnchorLike;
  body: { appendChild(node: AnchorLike): void };
}
interface UrlLike {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const defaultDocument = (): DocumentLike | undefined =>
  typeof document === 'undefined' ? undefined : (document as unknown as DocumentLike);
const defaultUrl = (): UrlLike | undefined => (typeof URL === 'undefined' ? undefined : URL);

export function triggerDownload(
  href: string,
  filename: string,
  documentLike: DocumentLike | undefined = defaultDocument(),
): void {
  if (!documentLike) return;
  const a = documentLike.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  documentLike.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(
  blob: Blob,
  filename: string,
  documentLike: DocumentLike | undefined = defaultDocument(),
  urlLike: UrlLike | undefined = defaultUrl(),
): void {
  if (!urlLike) return;
  const objectUrl = urlLike.createObjectURL(blob);
  try {
    triggerDownload(objectUrl, filename, documentLike);
  } finally {
    urlLike.revokeObjectURL(objectUrl);
  }
}
