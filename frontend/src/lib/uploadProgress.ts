import { clamp } from './clamp';

/**
 * 將「已傳輸 / 總量」換算為 0–100 的整數百分比。
 *
 * 先前 `UploadButton`、`ImportTextPage`、`HomePage`(zip 匯入) 與
 * `AddPagesFromPromptModal` 各自內嵌 `Math.round((loaded / total) * 100)`，
 * 公式重複且未統一處理分母為 0 的情況。收斂為共用純函式：
 *
 * - `total <= 0`（含 0、負值、`NaN`）時回傳 0，避免除以 0 產生 `NaN`/`Infinity`。
 * - 其餘情況四捨五入後夾在 [0, 100]，避免 `loaded > total` 時超過 100。
 *
 * 注意：各呼叫端原本對「分母無效」有各自的外層處理（略過更新、或顯示為
 * `null`），本函式僅統一內層計算，呼叫端可保留自身的 fallback 語意。
 */
export function uploadProgressPercent(loaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return clamp(Math.round((loaded / total) * 100), 0, 100);
}
