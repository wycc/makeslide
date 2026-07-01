// 純函式：由 quiz/session/client 識別子組出安全的錄影檔名，避免路徑穿越與非法字元。

/** 只保留英數、底線、連字號與點；其餘一律換成底線，並限制長度。 */
export function sanitizeQuizRecordingSegment(value: string, maxLength = 80): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : 'x';
}

/**
 * 組出錄影檔名：`<quizId>_<sessionId>_<clientId>.webm`。session/client 為前端產生的
 * 字串，故經 sanitizeQuizRecordingSegment 消毒後才併入路徑。
 */
export function quizRecordingFilename(quizId: number, sessionId: string, clientId: string): string {
  const s = sanitizeQuizRecordingSegment(sessionId);
  const c = sanitizeQuizRecordingSegment(clientId);
  return `${quizId}_${s}_${c}.webm`;
}
