// 系統資料頁（SystemDataPage）數值卡片的格式化純函式。
// 原先以 page-local function 內嵌於 SystemDataPage，無測試且未處理非有限值；
// 抽出於此並補上 NaN/Infinity 防呆與單元測試。

/**
 * 將平均耗時（毫秒）格式化為卡片顯示字串。
 * - `null` 或非有限值（NaN／Infinity）視為無資料，回 `—`（原本 NaN 會顯示成 `NaN{suffix}`）。
 * - 小於 1000ms 顯示為 `{ms} ms`；否則換算成秒、保留 1 位小數並接上 i18n 的秒數後綴。
 */
export function formatMetricDurationMs(ms: number | null, secondsSuffix: string): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${Math.round(ms / 100) / 10}${secondsSuffix}`;
}

/**
 * 將估算成本（美元）格式化為卡片顯示字串。
 * - `null` 或非有限值視為未知，回傳呼叫端提供的 `unknownLabel`。
 * - 其餘以 `US$` 前綴、固定 6 位小數顯示。
 */
export function formatMetricCostUsd(value: number | null, unknownLabel: string): string {
  if (value == null || !Number.isFinite(value)) return unknownLabel;
  return `US$${value.toFixed(6)}`;
}
