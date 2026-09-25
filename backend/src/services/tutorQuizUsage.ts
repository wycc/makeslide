/**
 * 課後輔導測試的使用記錄（給簡報擁有者看）：誰用了、用了多久、答得如何，以及整體每週／每月／
 * 全部的使用次數與時間。純函式——路由只負責查資料庫與權限。
 *
 * 「使用時間」不是存下來的欄位，而是從事件時間戳推算的：一輪練習留下的時間點有「開始」、
 * 每一題的「出題」與「作答」。把相鄰時間點的間隔加總就是使用時間，但**超過閒置門檻的間隔
 * 不算**——練習可以隔天接著做，直接用「最後更新 − 建立」會把中間離開的二十個小時也算進去。
 */

import { TUTOR_ASSESSMENT_INTERVAL, estimateAbility } from './tutorQuiz';

/** 相鄰兩個事件相隔超過這個時間就視為離開了，這段間隔不計入使用時間。 */
export const TUTOR_USAGE_IDLE_GAP_MS = 10 * 60 * 1000;
/** 週／月統計各保留最近幾期（只列有使用的期別）。 */
export const TUTOR_USAGE_MAX_PERIODS = 12;

export interface UsageSessionInput {
  id: number;
  sub: string | null;
  client_id: string;
  topics: string[];
  status: string;
  current_level: number;
  created_at: string;
  updated_at: string;
}

export interface UsageQuestionInput {
  session_id: number;
  created_at: string;
  answered_at: string | null;
  is_correct: number | null;
}

export interface UsageAssessmentInput {
  session_id: number;
  through_seq: number;
  level_estimate: number;
}

export interface UsageTotals {
  /** 使用次數：開始過幾輪練習。 */
  sessions: number;
  learners: number;
  answered: number;
  correct: number;
  active_seconds: number;
}

export interface UsagePeriod extends UsageTotals {
  /** 週：該週週一的日期（YYYY-MM-DD）；月：YYYY-MM。皆以請求者的時區計。 */
  period: string;
}

export interface UsageSessionSummary {
  id: number;
  topics: string[];
  status: string;
  current_level: number;
  /** 最近一次難度評估的能力落點；還沒做過評估（未滿一輪）時為 null。 */
  level_estimate: number | null;
  answered: number;
  correct: number;
  active_seconds: number;
  created_at: string;
  last_active_at: string;
}

export interface UsageLearner {
  key: string;
  display_name: string | null;
  code: string | null;
  signed_in: boolean;
  /** 未登入者沒有姓名，用裝置代碼的末幾碼讓老師至少能分辨「這幾輪是同一台裝置」。 */
  device_hint: string;
  sessions_count: number;
  answered: number;
  correct: number;
  active_seconds: number;
  latest_level: number;
  first_at: string;
  last_active_at: string;
  sessions: UsageSessionSummary[];
}

export interface TutorQuizUsage {
  idle_gap_seconds: number;
  time_zone: string;
  totals: UsageTotals;
  weekly: UsagePeriod[];
  monthly: UsagePeriod[];
  learners: UsageLearner[];
}

/** 同一個人的判定：登入者用 sub（換裝置仍是同一人），未登入者只能用裝置代碼。 */
export function learnerKey(session: Pick<UsageSessionInput, 'sub' | 'client_id'>): string {
  return session.sub ? `sub:${session.sub}` : `client:${session.client_id}`;
}

/**
 * 把一串事件時間切成「有在使用」的區段：每個相鄰間隔一段，超過閒置門檻的丟掉。
 * 回傳每段的起點與長度——起點用來決定這段時間算在哪一週／哪一月。
 */
export function activeIntervals(
  timestamps: readonly number[],
  idleGapMs: number = TUTOR_USAGE_IDLE_GAP_MS,
): Array<{ start: number; ms: number }> {
  const sorted = timestamps.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const out: Array<{ start: number; ms: number }> = [];
  let prev: number | undefined;
  for (const at of sorted) {
    if (prev !== undefined) {
      const gap = at - prev;
      if (gap > 0 && gap <= idleGapMs) out.push({ start: prev, ms: gap });
    }
    prev = at;
  }
  return out;
}

/** 指定時區的當地日期（年、月、日）。 */
function localDateParts(ms: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 該時間點所屬月份，`YYYY-MM`。 */
export function monthKey(ms: number, timeZone: string): string {
  const { y, m } = localDateParts(ms, timeZone);
  return `${y}-${pad2(m)}`;
}

/** 該時間點所屬那一週的週一日期，`YYYY-MM-DD`（週一起算，與校曆一致）。 */
export function weekKey(ms: number, timeZone: string): string {
  const { y, m, d } = localDateParts(ms, timeZone);
  // 只拿當地的年月日做日曆運算，用 UTC 承載以避開執行環境自己的時區與日光節約。
  const date = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

interface Bucket {
  sessions: number;
  learners: Set<string>;
  answered: number;
  correct: number;
  activeMs: number;
}

function emptyBucket(): Bucket {
  return { sessions: 0, learners: new Set(), answered: 0, correct: 0, activeMs: 0 };
}

function bucketOf(map: Map<string, Bucket>, key: string): Bucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = emptyBucket();
    map.set(key, bucket);
  }
  return bucket;
}

function toTotals(bucket: Bucket): UsageTotals {
  return {
    sessions: bucket.sessions,
    learners: bucket.learners.size,
    answered: bucket.answered,
    correct: bucket.correct,
    active_seconds: Math.round(bucket.activeMs / 1000),
  };
}

function toPeriods(map: Map<string, Bucket>): UsagePeriod[] {
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, TUTOR_USAGE_MAX_PERIODS)
    .map(([period, bucket]) => ({ period, ...toTotals(bucket) }));
}

export function buildTutorQuizUsage(input: {
  sessions: readonly UsageSessionInput[];
  questions: readonly UsageQuestionInput[];
  assessments: readonly UsageAssessmentInput[];
  /** sub → 顯示名稱 */
  names: ReadonlyMap<string, string>;
  /** sub → 學生代碼 */
  codes: ReadonlyMap<string, string>;
  timeZone: string;
}): TutorQuizUsage {
  const { sessions, questions, assessments, names, codes, timeZone } = input;

  const questionsBySession = new Map<number, UsageQuestionInput[]>();
  for (const q of questions) {
    const list = questionsBySession.get(q.session_id);
    if (list) list.push(q);
    else questionsBySession.set(q.session_id, [q]);
  }
  const latestEstimate = new Map<number, { through: number; estimate: number }>();
  for (const a of assessments) {
    const seen = latestEstimate.get(a.session_id);
    if (!seen || a.through_seq > seen.through) latestEstimate.set(a.session_id, { through: a.through_seq, estimate: a.level_estimate });
  }

  const total = emptyBucket();
  const weekly = new Map<string, Bucket>();
  const monthly = new Map<string, Bucket>();
  const learners = new Map<string, UsageLearner>();

  for (const session of sessions) {
    const key = learnerKey(session);
    const qs = questionsBySession.get(session.id) ?? [];
    const createdMs = Date.parse(session.created_at);

    // 「最後更新」刻意不當事件：結束練習也會更新它，而按下結束之前人可能早就離開了。
    const stamps = [createdMs];
    let answered = 0;
    let correct = 0;
    let lastMs = createdMs;
    for (const q of qs) {
      const asked = Date.parse(q.created_at);
      stamps.push(asked);
      if (Number.isFinite(asked) && asked > lastMs) lastMs = asked;
      if (q.answered_at) {
        const at = Date.parse(q.answered_at);
        stamps.push(at);
        if (Number.isFinite(at) && at > lastMs) lastMs = at;
        answered += 1;
        if (q.is_correct === 1) correct += 1;
        // 答題算在作答當下那一期，不是開始練習那一期——跨週續答的題目屬於後面那一週。
        const when = Number.isFinite(at) ? at : createdMs;
        for (const bucket of [total, bucketOf(weekly, weekKey(when, timeZone)), bucketOf(monthly, monthKey(when, timeZone))]) {
          bucket.answered += 1;
          if (q.is_correct === 1) bucket.correct += 1;
          bucket.learners.add(key);
        }
      }
    }

    const intervals = activeIntervals(stamps);
    let activeMs = 0;
    for (const iv of intervals) {
      activeMs += iv.ms;
      for (const bucket of [total, bucketOf(weekly, weekKey(iv.start, timeZone)), bucketOf(monthly, monthKey(iv.start, timeZone))]) {
        bucket.activeMs += iv.ms;
      }
    }

    // 使用次數算在開始那一期：一輪練習只算一次，不因為跨週而重複計。
    for (const bucket of [total, bucketOf(weekly, weekKey(createdMs, timeZone)), bucketOf(monthly, monthKey(createdMs, timeZone))]) {
      bucket.sessions += 1;
      bucket.learners.add(key);
    }

    const lastActiveAt = Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : session.created_at;
    const summary: UsageSessionSummary = {
      id: session.id,
      topics: session.topics,
      status: session.status,
      current_level: session.current_level,
      level_estimate: latestEstimate.get(session.id)?.estimate ?? null,
      answered,
      correct,
      active_seconds: Math.round(activeMs / 1000),
      created_at: session.created_at,
      last_active_at: lastActiveAt,
    };

    let learner = learners.get(key);
    if (!learner) {
      learner = {
        key,
        display_name: session.sub ? names.get(session.sub) ?? null : null,
        code: session.sub ? codes.get(session.sub) || null : null,
        signed_in: Boolean(session.sub),
        device_hint: session.client_id.slice(-6),
        sessions_count: 0,
        answered: 0,
        correct: 0,
        active_seconds: 0,
        latest_level: session.current_level,
        first_at: session.created_at,
        last_active_at: lastActiveAt,
        sessions: [],
      };
      learners.set(key, learner);
    }
    learner.sessions_count += 1;
    learner.answered += answered;
    learner.correct += correct;
    learner.active_seconds += summary.active_seconds;
    if (session.created_at < learner.first_at) learner.first_at = session.created_at;
    if (lastActiveAt >= learner.last_active_at) {
      learner.last_active_at = lastActiveAt;
      learner.latest_level = session.current_level;
    }
    learner.sessions.push(summary);
  }

  const learnerList = Array.from(learners.values());
  for (const learner of learnerList) {
    learner.sessions.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  learnerList.sort((a, b) => (a.last_active_at < b.last_active_at ? 1 : -1));

  return {
    idle_gap_seconds: TUTOR_USAGE_IDLE_GAP_MS / 1000,
    time_zone: timeZone,
    totals: toTotals(total),
    weekly: toPeriods(weekly),
    monthly: toPeriods(monthly),
    learners: learnerList,
  };
}

// ── 合併到測驗記錄用的快照 ──────────────────────────────────────────────────

export interface TutorSnapshot {
  /** 這位學生在這份簡報的課後輔導測試總共答了幾題（所有輪次）。 */
  answered: number;
  /** 能力落點；一題都沒答過時為 null。 */
  level_estimate: number | null;
}

export interface SnapshotAnswer {
  sub: string;
  level: number;
  is_correct: number | null;
  answered_at: string;
}

/**
 * 每位登入學生（依 sub）的課後輔導快照，供「合併課後輔導」寫進測驗記錄。
 *
 * 能力落點取**最近 10 題**、套用與難度評估完全相同的公式（`estimateAbility`）。不直接拿最後一次
 * 存下的評估：評估只在每答滿 10 題時產生，之後又練了幾題、或開了新的一輪，那個數字就過時了；
 * 而還沒答滿 10 題的學生根本沒有評估。最近 10 題則任何時候都有，也就是「合併當下」的程度。
 * 跨輪次合併計算——換一輪練習不代表程度歸零。
 */
export function tutorSnapshotsBySub(answers: readonly SnapshotAnswer[]): Map<string, TutorSnapshot> {
  const bySub = new Map<string, SnapshotAnswer[]>();
  for (const a of answers) {
    const list = bySub.get(a.sub);
    if (list) list.push(a);
    else bySub.set(a.sub, [a]);
  }
  const out = new Map<string, TutorSnapshot>();
  for (const [sub, list] of bySub) {
    const sorted = [...list].sort((a, b) => (a.answered_at < b.answered_at ? -1 : a.answered_at > b.answered_at ? 1 : 0));
    const recent = sorted.slice(-TUTOR_ASSESSMENT_INTERVAL).map((a) => ({ level: a.level, is_correct: a.is_correct === 1 }));
    out.set(sub, {
      answered: sorted.length,
      level_estimate: recent.length > 0 ? estimateAbility(recent).level_estimate : null,
    });
  }
  return out;
}
