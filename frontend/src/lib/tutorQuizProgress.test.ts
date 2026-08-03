import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_ASSESSMENT_INTERVAL,
  TUTOR_MAX_SELECTED_TOPICS,
  accuracyPercent,
  countAnswered,
  findPendingQuestion,
  isTopicSelected,
  latestAssessment,
  levelBarPercent,
  levelToneClass,
  toggleTopic,
  untilNextAssessment,
} from './tutorQuizProgress';
import type { TutorQuizAssessment, TutorQuizQuestion } from './api/tutorQuiz';

function question(seq: number, answered: number | null): TutorQuizQuestion {
  return { seq, level: 3, question: `Q${seq}`, options: ['A', 'B', 'C', 'D'], page_number: 1, answered_index: answered };
}

function assessment(throughSeq: number): TutorQuizAssessment {
  return { through_seq: throughSeq, level_estimate: 3, correct_count: 5, summary: '', weak_topics: [], created_at: '2026-08-03T00:00:00.000Z' };
}

test('untilNextAssessment 從 10 倒數到 1，答滿一輪後重新從 10 起算', () => {
  assert.equal(untilNextAssessment(0), 10);
  assert.equal(untilNextAssessment(1), 9);
  assert.equal(untilNextAssessment(9), 1);
  assert.equal(untilNextAssessment(10), TUTOR_ASSESSMENT_INTERVAL);
  assert.equal(untilNextAssessment(13), 7);
});

test('countAnswered 只算已作答的題目（未作答的 answered_index 可能是 null 或未定義）', () => {
  const qs: TutorQuizQuestion[] = [
    question(1, 0),
    question(2, 2),
    { seq: 3, level: 3, question: 'Q3', options: [], page_number: null },
  ];
  assert.equal(countAnswered(qs), 2);
  assert.equal(countAnswered([]), 0);
});

test('countAnswered 把選了第 0 個選項當成已作答', () => {
  // answered_index === 0 是 falsy，用 truthy 判斷會把「選了 A」誤判成未作答。
  assert.equal(countAnswered([question(1, 0)]), 1);
});

test('findPendingQuestion 回傳唯一未作答的題目，全部答完時回 null', () => {
  const pending = findPendingQuestion([question(1, 1), question(2, null)]);
  assert.equal(pending?.seq, 2);
  assert.equal(findPendingQuestion([question(1, 1)]), null);
  assert.equal(findPendingQuestion([]), null);
});

test('accuracyPercent 四捨五入成整數，零題不會變成 NaN', () => {
  assert.equal(accuracyPercent(6, 10), 60);
  assert.equal(accuracyPercent(2, 3), 67);
  assert.equal(accuracyPercent(0, 0), 0);
  assert.equal(accuracyPercent(3, -1), 0);
});

test('latestAssessment 取 through_seq 最大的一筆，而不是陣列最後一筆', () => {
  assert.equal(latestAssessment([assessment(10), assessment(30), assessment(20)])?.through_seq, 30);
  assert.equal(latestAssessment([]), null);
});

test('levelBarPercent 把 L1–L5 映射到 0–100%，超界值被夾住', () => {
  assert.equal(levelBarPercent(1), 0);
  assert.equal(levelBarPercent(3), 50);
  assert.equal(levelBarPercent(5), 100);
  assert.equal(levelBarPercent(4.4), 85);
  assert.equal(levelBarPercent(0), 0);
  assert.equal(levelBarPercent(9), 100);
  assert.equal(levelBarPercent(Number.NaN), 0);
});

test('toggleTopic 新增未選的主題並保持順序，再點一次取消', () => {
  assert.deepEqual(toggleTopic([], '遞迴'), ['遞迴']);
  assert.deepEqual(toggleTopic(['遞迴'], '排序'), ['遞迴', '排序']);
  assert.deepEqual(toggleTopic(['遞迴', '排序'], '遞迴'), ['排序']);
});

test('toggleTopic 比對前先 trim，同一個主題不會被選成兩個', () => {
  // 選單點一次、自己又打一次同樣的字，不該變成重複的兩項
  assert.deepEqual(toggleTopic(['遞迴'], '  遞迴  '), []);
  assert.deepEqual(toggleTopic([], '  遞迴  '), ['遞迴']);
});

test('toggleTopic 忽略空字串，並在達到上限後不再新增', () => {
  assert.deepEqual(toggleTopic(['遞迴'], '   '), ['遞迴']);
  const full = Array.from({ length: TUTOR_MAX_SELECTED_TOPICS }, (_, i) => `主題${i + 1}`);
  assert.deepEqual(toggleTopic(full, '再一個'), full);
  // 上限後仍然可以取消既有的
  assert.equal(toggleTopic(full, '主題1').length, TUTOR_MAX_SELECTED_TOPICS - 1);
});

test('isTopicSelected 忽略前後空白', () => {
  assert.equal(isTopicSelected(['遞迴', '排序'], '排序'), true);
  assert.equal(isTopicSelected(['遞迴'], ' 遞迴 '), true);
  assert.equal(isTopicSelected(['遞迴'], '堆疊'), false);
  assert.equal(isTopicSelected([], '遞迴'), false);
});

test('levelToneClass 每一級都有配色，且不同級不同色', () => {
  const tones = [1, 2, 3, 4, 5].map(levelToneClass);
  assert.equal(new Set(tones).size, 5);
  // 小數落點（評估用）也要拿得到顏色
  assert.equal(levelToneClass(4.4), levelToneClass(4));
});
