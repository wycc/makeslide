// 從 HTTP `Content-Disposition` 標頭取出 `filename="..."`，取不到時回傳 fallback（共用純函式）。
// 供下載類 api 呼叫（如課程包 ZIP）從回應標頭決定存檔檔名。

export function filenameFromContentDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? fallback;
}
