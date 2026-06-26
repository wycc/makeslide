// WCAG 2.x 對比度計算（純函式）。供主題色彩 token 的對比驗證重用，
// 不依賴瀏覽器環境（可於 node 測試直接執行）。
//
// 參考：https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
// AA 一般文字需 ≥ 4.5:1；AA 大型文字 / UI 元件需 ≥ 3:1。

export type Rgb = readonly [number, number, number];

/** 把單一 sRGB 通道（0–255）轉成線性值。 */
function channelToLinear(value8bit: number): number {
  const c = Math.min(255, Math.max(0, value8bit)) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 相對亮度（relative luminance），輸入為 0–255 的 RGB 三元組。 */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** 兩色之間的對比度（1–21）。順序無關。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 解析「空白分隔的 RGB 三元組」字串（如 index.css 的 token 值 `71 85 105`）。
 * 可容忍多餘空白、逗號與尾端分號/註解殘留的非數字字元；解析不到 3 個數字時回 null。
 */
export function parseRgbTriple(raw: string): Rgb | null {
  const nums = (raw.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).slice(0, 3);
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2]] as Rgb;
}
