/**
 * 課後輔導測試「使用記錄」的顯示側純函式。統計本身（誰是同一個人、使用時間怎麼算、
 * 哪一週哪一月）全部由後端決定，見 backend/src/services/tutorQuizUsage.ts；這裡只把數字
 * 轉成畫面上的字。
 */

export interface DurationUnitLabels {
  hour: string;
  minute: string;
  second: string;
}

/**
 * 把秒數寫成人讀的長度：不到一分鐘寫秒，不到一小時寫「分 秒」，一小時以上寫「時 分」——
 * 統計表裡「3 小時 12 分 07 秒」的那個 07 秒沒有人在意，只會讓欄位變寬。
 */
export function formatUsageDuration(totalSeconds: number, labels: DurationUnitLabels): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h} ${labels.hour} ${m} ${labels.minute}` : `${h} ${labels.hour}`;
  if (m > 0) return s > 0 ? `${m} ${labels.minute} ${s} ${labels.second}` : `${m} ${labels.minute}`;
  return `${s} ${labels.second}`;
}

/** 平均每次的使用秒數；沒有任何一次時回 0 而不是 NaN。 */
export function averageSeconds(totalSeconds: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.round(totalSeconds / count);
}

/**
 * 週統計的期別是「那一週週一的日期」；顯示成起訖區間（`09/07–09/13`）才看得出是一整週。
 * 純日曆運算，用 UTC 承載以免被瀏覽器時區或日光節約挪動一天。格式不對就原樣回傳。
 */
export function weekRangeLabel(mondayIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mondayIso);
  if (!match) return mondayIso;
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);
  const md = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${start.getUTCFullYear()} ${md(start)}–${md(end)}`;
}

/**
 * 記錄上要顯示的名字。登入者用姓名；未登入者沒有姓名可用，退回「匿名＋裝置末碼」，
 * 讓老師至少分得出哪幾輪是同一台裝置。
 */
export function learnerDisplayName(
  learner: { display_name: string | null; signed_in: boolean; device_hint: string },
  labels: { anonymous: string; unnamed: string },
): string {
  const name = learner.display_name?.trim();
  if (name) return name;
  const base = learner.signed_in ? labels.unnamed : labels.anonymous;
  return learner.device_hint ? `${base} (${learner.device_hint})` : base;
}
