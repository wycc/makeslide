import { parseErrorBody } from './common';

/**
 * 課後輔導測試（自適應練習）的 API client。與 `api/pdfs.ts` 裡的正式測驗端點分開：
 * 那組操作的是老師出好的整份 quiz_sets，這裡是一題一題出、難度隨作答升降的個人練習。
 */

export interface TutorQuizSession {
  id: number;
  /** 這輪練習聚焦的主題；空陣列代表整份簡報。 */
  topics: string[];
  current_level: number;
  asked_count: number;
  correct_count: number;
  status: 'active' | 'ended';
  created_at: string;
  updated_at: string;
}

export interface TutorQuizQuestion {
  seq: number;
  level: number;
  question: string;
  options: string[];
  page_number: number | null;
  /** 以下欄位只有「已作答」的題目才有——未作答前正解留在後端。 */
  answered_index?: number | null;
  is_correct?: boolean;
  correct_index?: number;
  explanation?: string;
}

export type TutorQuizTrend = 'up' | 'down' | 'flat' | 'first';

export interface TutorQuizAssessment {
  through_seq: number;
  level_estimate: number;
  correct_count: number;
  total?: number;
  accuracy?: number;
  trend?: TutorQuizTrend;
  summary: string;
  weak_topics: string[];
  created_at: string;
}

export interface TutorQuizState {
  session: TutorQuizSession | null;
  questions: TutorQuizQuestion[];
  assessments: TutorQuizAssessment[];
}

export interface TutorQuizAnswerResult {
  correct: boolean;
  correct_index: number;
  explanation: string;
  page_number: number | null;
  level: number;
  next_level: number;
  answered_count: number;
  correct_count: number;
  until_assessment: number;
  assessment: TutorQuizAssessment | null;
}

const base = (id: string) => `api/pdfs/${encodeURIComponent(id)}/tutor-quiz`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as T;
}

export interface TutorQuizTopic {
  topic: string;
  /** 這位使用者在這個主題上答過幾題、對幾題（跨所有練習輪次）。 */
  answered: number;
  correct: number;
}

export interface TutorQuizTopics {
  topics: TutorQuizTopic[];
  /** 這次呼叫是否重新分析過（第一次取用或 refresh）。 */
  generated: boolean;
}

/**
 * 這份簡報的主題清單。第一次呼叫時後端會就地分析並存下來，之後直接回快取，
 * 所以呼叫端不需要自己判斷是不是第一次。`refresh` 用於簡報改寫後重新分析。
 */
export async function fetchTutorQuizTopics(id: string, clientId: string, refresh = false): Promise<TutorQuizTopics> {
  const params = new URLSearchParams({ client_id: clientId });
  if (refresh) params.set('refresh', '1');
  const resp = await fetch(`${base(id)}/topics?${params.toString()}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as TutorQuizTopics;
}

/** 取回進行中的練習（沒有就回 session: null）。 */
export async function fetchTutorQuizSession(id: string, clientId: string): Promise<TutorQuizState> {
  const resp = await fetch(`${base(id)}/session?client_id=${encodeURIComponent(clientId)}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as TutorQuizState;
}

/** 開始一輪新的練習（會把先前未結束的收掉）。`topics` 為空陣列時從整份簡報出題。 */
export async function startTutorQuizSession(id: string, clientId: string, topics: string[]): Promise<TutorQuizState> {
  return postJson<TutorQuizState>(`${base(id)}/session`, { client_id: clientId, topics });
}

/** 出下一題；上一題未作答時回同一題。 */
export async function fetchNextTutorQuizQuestion(id: string, sessionId: number, clientId: string): Promise<TutorQuizQuestion> {
  const data = await postJson<{ question: TutorQuizQuestion }>(`${base(id)}/session/${sessionId}/next`, { client_id: clientId });
  return data.question;
}

export async function submitTutorQuizAnswer(
  id: string,
  sessionId: number,
  clientId: string,
  seq: number,
  answerIndex: number,
): Promise<TutorQuizAnswerResult> {
  return postJson<TutorQuizAnswerResult>(`${base(id)}/session/${sessionId}/answer`, {
    client_id: clientId,
    seq,
    answer_index: answerIndex,
  });
}

export async function endTutorQuizSession(id: string, sessionId: number, clientId: string): Promise<void> {
  await postJson<{ ok: boolean }>(`${base(id)}/session/${sessionId}/end`, { client_id: clientId });
}

// ── 使用記錄（擁有者）────────────────────────────────────────────────────────

export interface TutorQuizUsageTotals {
  /** 使用次數：開始過幾輪練習。 */
  sessions: number;
  learners: number;
  answered: number;
  correct: number;
  active_seconds: number;
}

export interface TutorQuizUsagePeriod extends TutorQuizUsageTotals {
  /** 週：該週週一的日期（YYYY-MM-DD）；月：YYYY-MM。 */
  period: string;
}

export interface TutorQuizUsageRound {
  id: number;
  topics: string[];
  status: 'active' | 'ended';
  current_level: number;
  level_estimate: number | null;
  answered: number;
  correct: number;
  active_seconds: number;
  created_at: string;
  last_active_at: string;
}

export interface TutorQuizUsageLearner {
  key: string;
  display_name: string | null;
  code: string | null;
  signed_in: boolean;
  device_hint: string;
  sessions_count: number;
  answered: number;
  correct: number;
  active_seconds: number;
  latest_level: number;
  first_at: string;
  last_active_at: string;
  sessions: TutorQuizUsageRound[];
}

export interface TutorQuizUsage {
  /** 相鄰兩次操作相隔超過這個秒數就不算使用時間。 */
  idle_gap_seconds: number;
  time_zone: string;
  totals: TutorQuizUsageTotals;
  weekly: TutorQuizUsagePeriod[];
  monthly: TutorQuizUsagePeriod[];
  learners: TutorQuizUsageLearner[];
}

export interface TutorQuizUsageRoundDetail {
  session: TutorQuizSession;
  /** 記錄檢視：每一題都帶正解；`is_correct` 為 null 代表那一題還沒作答。 */
  questions: Array<Omit<TutorQuizQuestion, 'is_correct'> & { is_correct: boolean | null }>;
  assessments: TutorQuizAssessment[];
}

/** 這份簡報的課後輔導測試使用記錄。只有擁有者拿得到（其他人 403）。 */
export async function fetchTutorQuizUsage(id: string, timeZone: string): Promise<TutorQuizUsage> {
  const resp = await fetch(`${base(id)}/usage?tz=${encodeURIComponent(timeZone)}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as TutorQuizUsage;
}

/** 某一輪練習的逐題內容與難度評估。 */
export async function fetchTutorQuizUsageRound(id: string, sessionId: number): Promise<TutorQuizUsageRoundDetail> {
  const resp = await fetch(`${base(id)}/usage/sessions/${sessionId}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as TutorQuizUsageRoundDetail;
}
