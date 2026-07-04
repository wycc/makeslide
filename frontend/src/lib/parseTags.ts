// 把逗號分隔的標籤字串解析成去空白、非空的標籤陣列（共用純函式）。
//
// 去重自 `HomePage`／`PdfCard` 多處內聯 `(tags ?? '').split(',').map(t => t.trim()).filter(Boolean)`
// （標籤晶片、標籤過濾、加標籤等）。null/undefined/空字串回空陣列。

export function parseTags(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
