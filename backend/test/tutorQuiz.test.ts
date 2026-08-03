import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_ASSESSMENT_INTERVAL,
  TUTOR_DEFAULT_LEVEL,
  TUTOR_MAX_CHARS_PER_PAGE,
  TUTOR_MAX_CONTEXT_CHARS,
  TUTOR_MAX_TOPICS,
  TUTOR_MAX_TOPIC_CHARS,
  abilityTrend,
  buildAssessmentPrompt,
  buildDeckContext,
  buildQuestionPrompt,
  buildTopicsPrompt,
  formatTopicFocus,
  normalizeTopics,
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
    topics: ['遞迴'],
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
  const prompt = buildQuestionPrompt({ level: 2, context: '內容', topics: [], askedQuestions: asked });
  assert.ok(!prompt.includes('題目1\n'), '最早的題目應被截掉');
  assert.ok(prompt.includes('題目30'), '最新的題目應保留');
});

test('buildQuestionPrompt 複選主題時全部列出，並要求在主題之間輪流', () => {
  const prompt = buildQuestionPrompt({
    level: 3,
    context: '內容',
    topics: ['遞迴的終止條件', '尾遞迴最佳化', '堆疊溢位'],
    askedQuestions: [],
  });
  assert.ok(prompt.includes('「遞迴的終止條件」'));
  assert.ok(prompt.includes('「尾遞迴最佳化」'));
  assert.ok(prompt.includes('「堆疊溢位」'));
  // 不講「輪流」的話模型會每題都黏在第一個主題上
  assert.ok(prompt.includes('輪流'));
  assert.ok(prompt.includes('跨主題整合'));
});

test('formatTopicFocus 單選與複選用不同措辭，空清單完全不輸出', () => {
  assert.equal(formatTopicFocus([]), '');
  assert.equal(formatTopicFocus(['  ', '']), '');
  assert.ok(formatTopicFocus(['遞迴']).includes('只出與「遞迴」相關'));
  assert.ok(!formatTopicFocus(['遞迴']).includes('輪流'), '只有一個主題時不該叫模型輪流');
  assert.ok(formatTopicFocus(['遞迴', '排序']).includes('輪流'));
});

test('buildQuestionPrompt 沒有主題時不輸出主題段落', () => {
  const prompt = buildQuestionPrompt({ level: 1, context: '內容', topics: ['   '], askedQuestions: [] });
  assert.ok(!prompt.includes('主題聚焦'));
});

test('buildDeckContext 逐頁標上頁碼，讓模型能回報依據頁', () => {
  const context = buildDeckContext([
    { page_number: 1, text: '遞迴需要終止條件。' },
    { page_number: 2, text: '尾遞迴可以被最佳化。' },
  ]);
  assert.ok(context.includes('第 1 頁：遞迴需要終止條件。'));
  assert.ok(context.includes('第 2 頁：尾遞迴可以被最佳化。'));
});

test('buildDeckContext 跳過沒有逐字稿的頁，全空時回空字串', () => {
  const context = buildDeckContext([
    { page_number: 1, text: '   ' },
    { page_number: 2, text: '有內容' },
  ]);
  assert.ok(!context.includes('第 1 頁'));
  assert.ok(context.includes('第 2 頁'));
  assert.equal(buildDeckContext([{ page_number: 1, text: '' }]), '');
});

test('buildDeckContext 頁數多時每頁縮短配額，最後一頁仍然進得來', () => {
  // 100 頁 × 每頁 400 字遠超過總上限；若是「填滿就停」的作法，後半會整段消失。
  const pages = Array.from({ length: 100 }, (_, i) => ({ page_number: i + 1, text: 'ㄅ'.repeat(400) }));
  const context = buildDeckContext(pages);
  assert.ok(context.includes('第 1 頁'));
  assert.ok(context.includes('第 100 頁'), '最後一頁也必須有機會被出到題');
  assert.ok(context.length <= TUTOR_MAX_CONTEXT_CHARS);
});

test('buildDeckContext 頁數少時每頁用滿上限，不會被無謂縮短', () => {
  const pages = [
    { page_number: 1, text: 'ㄅ'.repeat(1000) },
    { page_number: 2, text: 'ㄆ'.repeat(1000) },
  ];
  const context = buildDeckContext(pages);
  assert.ok(context.includes('ㄅ'.repeat(TUTOR_MAX_CHARS_PER_PAGE)));
  assert.ok(!context.includes('ㄅ'.repeat(TUTOR_MAX_CHARS_PER_PAGE + 1)), '每頁仍以 400 字為上限');
});

test('normalizeTopics 去掉空白項並保留原順序', () => {
  assert.deepEqual(normalizeTopics(['  遞迴  ', '', '   ', '排序']), ['遞迴', '排序']);
});

test('normalizeTopics 去除重複（不分大小寫與前後空白）', () => {
  // 模型很常回出只差空白或大小寫的同一個主題，那在選單上是雜訊不是選擇。
  assert.deepEqual(normalizeTopics(['Recursion', 'recursion ', ' RECURSION', '排序']), ['Recursion', '排序']);
});

test('normalizeTopics 截斷過長的主題並限制總數', () => {
  const long = 'ㄅ'.repeat(80);
  assert.equal(normalizeTopics([long])[0].length, TUTOR_MAX_TOPIC_CHARS);
  const many = Array.from({ length: 30 }, (_, i) => `主題${i + 1}`);
  assert.equal(normalizeTopics(many).length, TUTOR_MAX_TOPICS);
});

test('normalizeTopics 全空時回空陣列', () => {
  assert.deepEqual(normalizeTopics(['', '   ']), []);
  assert.deepEqual(normalizeTopics([]), []);
});

test('buildTopicsPrompt 帶入簡報內容', () => {
  assert.ok(buildTopicsPrompt('第 1 頁：遞迴').includes('第 1 頁：遞迴'));
});

test('buildAssessmentPrompt 帶入落點、正確率、趨勢與逐題對錯', () => {
  const prompt = buildAssessmentPrompt({
    estimate: { level_estimate: 3.2, correct_count: 6, total: 10, accuracy: 0.6 },
    trend: 'up',
    topics: ['排序演算法'],
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
