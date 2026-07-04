// 課後報告「作答時間軸」：把每位學生的作答攤平成單一串、依送出時間升冪排序（共用純函式）。
//
// 去重自 `PostClassReportPanel` 時間軸區塊的內聯 IIFE：`students.flatMap(把該學生 client_id
// 貼到每筆 attempt).sort(依 submitted_at)`。抽出以便測試攤平＋排序＋掛 client_id。

export interface StudentLike<A> {
  client_id: string;
  attempts: readonly A[];
}

export function flattenAttemptsChronologically<A extends { submitted_at: string }>(
  students: readonly StudentLike<A>[],
): (A & { client_id: string })[] {
  return students
    .flatMap((s) => s.attempts.map((a) => ({ ...a, client_id: s.client_id })))
    .sort((x, y) => new Date(x.submitted_at).getTime() - new Date(y.submitted_at).getTime());
}
