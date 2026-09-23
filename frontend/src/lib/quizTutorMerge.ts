import type { QuizAttemptSession } from '../types';

/**
 * 這份測驗最近一次「合併課後輔導」的時間（ISO）；沒合併過回 null。
 *
 * 每次合併會把同一個時間戳寫進所有比對得到的作答列，所以取最大值就是最近一次。之後才交卷的
 * 作答沒有這個欄位，不影響結果——那正是老師需要再按一次的情況。
 */
export function latestTutorMerge(sessions: readonly QuizAttemptSession[]): string | null {
  let latest: string | null = null;
  for (const session of sessions) {
    for (const attempt of session.attempts) {
      const at = attempt.tutor_merged_at;
      if (at && (latest === null || at > latest)) latest = at;
    }
  }
  return latest;
}
