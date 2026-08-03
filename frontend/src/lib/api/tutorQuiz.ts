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

export interface TutorQuizTopics {
  topics: string[];
  /** 這次呼叫是否重新分析過（第一次取用或 refresh）。 */
  generated: boolean;
}

/**
 * 這份簡報的主題清單。第一次呼叫時後端會就地分析並存下來，之後直接回快取，
 * 所以呼叫端不需要自己判斷是不是第一次。`refresh` 用於簡報改寫後重新分析。
 */
export async function fetchTutorQuizTopics(id: string, refresh = false): Promise<TutorQuizTopics> {
  const resp = await fetch(`${base(id)}/topics${refresh ? '?refresh=1' : ''}`);
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
