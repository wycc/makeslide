import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_ASSESSMENT_INTERVAL,
  TUTOR_DEFAULT_LEVEL,
  abilityTrend,
  buildAssessmentPrompt,
  buildQuestionPrompt,
  clampLevel,
  estimateAbility,
  nextLevel,
  segmentRecords,
  shouldAssess,
} from '../src/services/tutorQuiz';

test('nextLevel 答對升一級、答錯降一級', () => {
  assert.equal(nextLevel(2, true), 3);
  assert.equal(nextLevel(3, false), 2);
});

test('nextLevel 夾在 L1–L5，頂／底再答對答錯都停在原地', () => {
  assert.equal(nextLevel(5, true), 5);
  assert.equal(nextLevel(1, false), 1);
  // 髒資料（DB 被手動改壞、舊資料）不應算出 L0 或 L7
  assert.equal(nextLevel(9, true), 5);
  assert.equal(nextLevel(-3, false), 1);
  assert.equal(clampLevel(Number.NaN), TUTOR_DEFAULT_LEVEL);
});

test('shouldAssess 每十題觸發一次，零題不觸發', () => {
  assert.equal(shouldAssess(0), false);
  assert.equal(shouldAssess(9), false);
  assert.equal(shouldAssess(10), true);
  assert.equal(shouldAssess(11), false);
  assert.equal(shouldAssess(20), true);
  assert.equal(shouldAssess(30), true);
});

test('estimateAbility：全對時落點等於題目難度平均', () => {
  const result = estimateAbility([
    { level: 3, is_correct: true },
    { level: 3, is_correct: true },
    { level: 3, is_correct: true },
  ]);
  assert.equal(result.level_estimate, 3);
  assert.equal(result.correct_count, 3);
  assert.equal(result.accuracy, 1);
});

test('estimateAbility：全錯時落點低於題目難度一級', () => {
  const result = estimateAbility([
    { level: 4, is_correct: false },
    { level: 4, is_correct: false },
  ]);
  assert.equal(result.level_estimate, 3);
  assert.equal(result.accuracy, 0);
});

test('estimateAbility：一半一半時落在中間並保留一位小數', () => {
  const result = estimateAbility([
    { level: 3, is_correct: true },
    { level: 3, is_correct: false },
    { level: 4, is_correct: true },
  ]);
  // (3 + 2 + 4) / 3 = 3
  assert.equal(result.level_estimate, 3);
  assert.equal(result.correct_count, 2);
  assert.ok(Math.abs(result.accuracy - 2 / 3) < 1e-9);
});

test('estimateAbility：落點不會低於 1（L1 全錯）', () => {
  const result = estimateAbility([
    { level: 1, is_correct: false },
    { level: 1, is_correct: false },
  ]);
  assert.equal(result.level_estimate, 1);
});

test('estimateAbility：沒有作答時回預設難度而不是 NaN', () => {
  const result = estimateAbility([]);
  assert.equal(result.level_estimate, TUTOR_DEFAULT_LEVEL);
  assert.equal(result.total, 0);
  assert.equal(result.accuracy, 0);
});

test('segmentRecords 只取最近十題，不把早期題目算進這一輪', () => {
  const records = Array.from({ length: 25 }, (_, i) => i + 1);
  assert.deepEqual(segmentRecords(records, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(segmentRecords(records, 20), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(segmentRecords(records, 20).length, TUTOR_ASSESSMENT_INTERVAL);
});

test('abilityTrend 以 0.25 級為門檻判斷進步／退步', () => {
  assert.equal(abilityTrend(3, null), 'first');
  assert.equal(abilityTrend(3.5, 3), 'up');
  assert.equal(abilityTrend(2.5, 3), 'down');
  assert.equal(abilityTrend(3.1, 3), 'flat');
});

test('buildQuestionPrompt 帶入難度描述、主題與已出過的題目', () => {
  const prompt = buildQuestionPrompt({
    level: 4,
    context: '第 1 頁：遞迴需要終止條件。',
    topic: '遞迴',
    askedQuestions: ['什麼是遞迴？', '遞迴與迴圈的差別？'],
  });
  assert.ok(prompt.includes('L4 分析'), '應說明 L4 的出題要求');
  assert.ok(prompt.includes('遞迴'), '應帶入主題聚焦');
  assert.ok(prompt.includes('什麼是遞迴？'), '應列出已出過的題目');
  assert.ok(prompt.includes('不得重複'), '應要求不得重複出題');
  assert.ok(prompt.includes('第 1 頁'), '應帶入簡報內容');
});

test('buildQuestionPrompt 只列最近 20 題已出題目，避免擠掉簡報內容', () => {
  const asked = Array.from({ length: 30 }, (_, i) => `題目${i + 1}`);
  const prompt = buildQuestionPrompt({ level: 2, context: '內容', topic: '', askedQuestions: asked });
  assert.ok(!prompt.includes('題目1\n'), '最早的題目應被截掉');
  assert.ok(prompt.includes('題目30'), '最新的題目應保留');
});

test('buildQuestionPrompt 沒有主題時不輸出主題段落', () => {
  const prompt = buildQuestionPrompt({ level: 1, context: '內容', topic: '   ', askedQuestions: [] });
  assert.ok(!prompt.includes('主題聚焦'));
});

test('buildAssessmentPrompt 帶入落點、正確率、趨勢與逐題對錯', () => {
  const prompt = buildAssessmentPrompt({
    estimate: { level_estimate: 3.2, correct_count: 6, total: 10, accuracy: 0.6 },
    trend: 'up',
    topic: '排序演算法',
    segment: [
      { question: '快速排序的平均複雜度？', level: 3, is_correct: true },
      { question: '合併排序為何穩定？', level: 4, is_correct: false },
    ],
  });
  assert.ok(prompt.includes('L3.2'));
  assert.ok(prompt.includes('6/10'));
  assert.ok(prompt.includes('相較上一輪有進步'));
  assert.ok(prompt.includes('[L4] 答錯：合併排序為何穩定？'));
  assert.ok(prompt.includes('排序演算法'));
});
