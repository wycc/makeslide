import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_USAGE_IDLE_GAP_MS,
  TUTOR_USAGE_MAX_PERIODS,
  activeIntervals,
  buildTutorQuizUsage,
  learnerKey,
  monthKey,
  weekKey,
  type UsageQuestionInput,
  type UsageSessionInput,
} from '../src/services/tutorQuizUsage';

const TZ = 'Asia/Taipei';
const at = (iso: string) => Date.parse(iso);

function session(over: Partial<UsageSessionInput> & { id: number; created_at: string }): UsageSessionInput {
  return {
    sub: null,
    client_id: `client-${over.id}`,
    topics: [],
    status: 'ended',
    current_level: 2,
    updated_at: over.created_at,
    ...over,
  };
}

/** 從 start 起每 stepSec 秒出一題、再 stepSec 秒後作答。 */
function questions(sessionId: number, start: string, count: number, stepSec: number, correct: boolean[] = []): UsageQuestionInput[] {
  const out: UsageQuestionInput[] = [];
  let cursor = at(start);
  for (let i = 0; i < count; i += 1) {
    cursor += stepSec * 1000;
    const created = new Date(cursor).toISOString();
    cursor += stepSec * 1000;
    out.push({ session_id: sessionId, created_at: created, answered_at: new Date(cursor).toISOString(), is_correct: correct[i] === false ? 0 : 1 });
  }
  return out;
}

const build = (sessions: UsageSessionInput[], qs: UsageQuestionInput[], extra: { names?: Map<string, string>; codes?: Map<string, string> } = {}) =>
  buildTutorQuizUsage({
    sessions,
    questions: qs,
    assessments: [],
    names: extra.names ?? new Map(),
    codes: extra.codes ?? new Map(),
    timeZone: TZ,
  });

test('activeIntervals 加總相鄰間隔，超過閒置門檻的那一段不算', () => {
  const t0 = at('2026-09-01T02:00:00Z');
  const min = 60_000;
  const intervals = activeIntervals([t0, t0 + 2 * min, t0 + 5 * min, t0 + 5 * min + TUTOR_USAGE_IDLE_GAP_MS + 1, t0 + 5 * min + TUTOR_USAGE_IDLE_GAP_MS + 1 + min]);
  assert.deepEqual(intervals.map((i) => i.ms / min), [2, 3, 1]);
  // 剛好等於門檻還算在用；亂序輸入要先排序；單一時間點沒有長度。
  assert.equal(activeIntervals([t0, t0 + TUTOR_USAGE_IDLE_GAP_MS]).length, 1);
  assert.deepEqual(activeIntervals([t0 + min, t0]), [{ start: t0, ms: min }]);
  assert.deepEqual(activeIntervals([t0]), []);
  assert.deepEqual(activeIntervals([t0, Number.NaN]), []);
});

test('隔天續答的練習不會把中間離開的時間算進使用時間', () => {
  const s = session({ id: 1, created_at: '2026-09-01T02:00:00Z', updated_at: '2026-09-02T02:10:00Z' });
  const qs = [
    ...questions(1, '2026-09-01T02:00:00Z', 2, 30), // 第一天 2 分鐘
    ...questions(1, '2026-09-02T02:00:00Z', 2, 30).map((q) => q), // 隔天再 2 分鐘（與前一天的間隔被丟掉）
  ];
  const usage = build([s], qs);
  // 第一天 4 段 × 30 秒＝120 秒；隔天第一題「出題」與前一天最後一次作答相隔近一天→不算，
  // 其後 3 段 × 30 秒＝90 秒。
  assert.equal(usage.totals.active_seconds, 210);
  assert.equal(usage.learners[0]?.sessions[0]?.active_seconds, 210);
  assert.equal(usage.learners[0]?.sessions[0]?.last_active_at, '2026-09-02T02:02:00.000Z');
});

test('weekKey 以週一為一週的開始，並依時區決定日期', () => {
  // 2026-09-06 是週日；台北時間週一 00:30 在 UTC 還是週日 16:30。
  assert.equal(weekKey(at('2026-09-06T16:30:00Z'), TZ), '2026-09-07');
  assert.equal(weekKey(at('2026-09-06T16:30:00Z'), 'UTC'), '2026-08-31');
  assert.equal(weekKey(at('2026-09-13T15:59:00Z'), TZ), '2026-09-07'); // 台北週日 23:59
  assert.equal(weekKey(at('2026-01-01T04:00:00Z'), TZ), '2025-12-29'); // 跨年的那一週
  assert.equal(monthKey(at('2026-08-31T16:30:00Z'), TZ), '2026-09');
  assert.equal(monthKey(at('2026-08-31T16:30:00Z'), 'UTC'), '2026-08');
});

test('登入者依 sub 合併（換裝置仍是同一人），未登入者依裝置分開', () => {
  assert.equal(learnerKey({ sub: 'u1', client_id: 'a' }), learnerKey({ sub: 'u1', client_id: 'b' }));
  assert.notEqual(learnerKey({ sub: null, client_id: 'a' }), learnerKey({ sub: null, client_id: 'b' }));

  const sessions = [
    session({ id: 1, sub: 'u1', client_id: 'laptop-aaaaaa', created_at: '2026-09-01T02:00:00Z', current_level: 2 }),
    session({ id: 2, sub: 'u1', client_id: 'phone-bbbbbb', created_at: '2026-09-03T02:00:00Z', current_level: 4 }),
    session({ id: 3, client_id: 'anon-cccccc', created_at: '2026-09-02T02:00:00Z' }),
  ];
  const qs = [
    ...questions(1, '2026-09-01T02:00:00Z', 3, 20, [true, false, true]),
    ...questions(2, '2026-09-03T02:00:00Z', 2, 20),
    ...questions(3, '2026-09-02T02:00:00Z', 1, 20, [false]),
  ];
  const usage = build(sessions, qs, { names: new Map([['u1', '王小明']]), codes: new Map([['u1', 'B1234567']]) });

  assert.equal(usage.learners.length, 2);
  const [first, second] = usage.learners;
  // 依最後使用時間新到舊。
  assert.equal(first?.display_name, '王小明');
  assert.equal(first?.code, 'B1234567');
  assert.equal(first?.signed_in, true);
  assert.equal(first?.sessions_count, 2);
  assert.equal(first?.answered, 5);
  assert.equal(first?.correct, 4);
  assert.equal(first?.active_seconds, (6 + 4) * 20);
  assert.equal(first?.latest_level, 4, '目前等級取最後使用的那一輪');
  assert.deepEqual(first?.sessions.map((s) => s.id), [2, 1], '同一人的各輪新到舊');
  assert.equal(second?.display_name, null);
  assert.equal(second?.code, null);
  assert.equal(second?.device_hint, 'cccccc');

  assert.deepEqual(usage.totals, { sessions: 3, learners: 2, answered: 6, correct: 4, active_seconds: (6 + 4 + 2) * 20 });
});

test('週／月統計：次數算在開始那一期，答題與時間算在發生那一期', () => {
  const sessions = [
    // 台北 9/6（週日）23:59 開始，跨過午夜進入 9/7（週一）——同一輪跨週。
    session({ id: 1, sub: 'u1', created_at: '2026-09-06T15:59:00Z' }),
    session({ id: 2, sub: 'u2', created_at: '2026-08-20T02:00:00Z' }),
  ];
  const qs = [
    ...questions(1, '2026-09-06T15:59:00Z', 2, 20), // 作答落在 15:59:40（週日）與 16:00:20（週一）
    ...questions(2, '2026-08-20T02:00:00Z', 1, 30),
  ];
  const usage = build(sessions, qs);

  assert.deepEqual(usage.weekly.map((w) => w.period), ['2026-09-07', '2026-08-31', '2026-08-17'], '新到舊');
  const byWeek = new Map(usage.weekly.map((w) => [w.period, w]));
  assert.equal(byWeek.get('2026-08-31')?.sessions, 1, '次數算在開始的那一週');
  assert.equal(byWeek.get('2026-09-07')?.sessions, 0);
  assert.equal(byWeek.get('2026-08-31')?.answered, 1);
  assert.equal(byWeek.get('2026-09-07')?.answered, 1);
  assert.equal(byWeek.get('2026-09-07')?.learners, 1, '只有答題、沒有新開一輪的人也算這週的使用者');
  assert.equal(byWeek.get('2026-08-31')?.active_seconds, 60, '起點在午夜前的三段');
  assert.equal(byWeek.get('2026-09-07')?.active_seconds, 20);

  assert.deepEqual(usage.monthly.map((m) => m.period), ['2026-09', '2026-08']);
  assert.deepEqual(usage.monthly[0], { period: '2026-09', sessions: 1, learners: 1, answered: 2, correct: 2, active_seconds: 80 });
  assert.deepEqual(usage.monthly[1], { period: '2026-08', sessions: 1, learners: 1, answered: 1, correct: 1, active_seconds: 60 });

  // 各期加總＝全部。
  const sum = (key: 'sessions' | 'answered' | 'active_seconds') => usage.monthly.reduce((n, m) => n + m[key], 0);
  assert.equal(sum('sessions'), usage.totals.sessions);
  assert.equal(sum('answered'), usage.totals.answered);
  assert.equal(sum('active_seconds'), usage.totals.active_seconds);
});

test('只保留最近的期別；沒有任何練習時全部為零而不是壞掉', () => {
  const sessions = Array.from({ length: TUTOR_USAGE_MAX_PERIODS + 3 }, (_, i) =>
    session({ id: i + 1, created_at: new Date(Date.UTC(2025, i, 10, 2)).toISOString() }),
  );
  const usage = build(sessions, []);
  assert.equal(usage.monthly.length, TUTOR_USAGE_MAX_PERIODS);
  assert.equal(usage.monthly[0]?.period, '2026-03');
  assert.equal(usage.totals.sessions, TUTOR_USAGE_MAX_PERIODS + 3, '全部統計不受期數上限影響');

  const empty = build([], []);
  assert.deepEqual(empty.totals, { sessions: 0, learners: 0, answered: 0, correct: 0, active_seconds: 0 });
  assert.deepEqual([empty.weekly, empty.monthly, empty.learners], [[], [], []]);
});

test('最近一次難度評估的落點跟著那一輪；沒評估過是 null', () => {
  const usage = buildTutorQuizUsage({
    sessions: [session({ id: 1, created_at: '2026-09-01T02:00:00Z' }), session({ id: 2, created_at: '2026-09-01T03:00:00Z', client_id: 'client-1' })],
    questions: [],
    assessments: [
      { session_id: 1, through_seq: 20, level_estimate: 3.8 },
      { session_id: 1, through_seq: 10, level_estimate: 2.6 },
    ],
    names: new Map(),
    codes: new Map(),
    timeZone: TZ,
  });
  const rounds = usage.learners[0]?.sessions ?? [];
  assert.equal(rounds.find((s) => s.id === 1)?.level_estimate, 3.8);
  assert.equal(rounds.find((s) => s.id === 2)?.level_estimate, null);
});
