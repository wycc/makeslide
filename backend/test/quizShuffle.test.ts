import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffleChoices, shuffleSingleChoice } from '../src/services/quizShuffle';

/** 可預測的亂數來源：依序回傳指定的值（超出後回 0），讓洗牌結果可斷言。 */
function scriptedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

test('shuffleChoices 打亂選項後正解跟著移動到新位置', () => {
  const options = ['A', 'B', 'C', 'D'];
  const result = shuffleChoices(options, [0], scriptedRng([0.99, 0.5, 0.5]));
  // 正解的內容仍然是原本那一個，只是位置變了
  assert.equal(result.options[result.answerIndices[0]], 'A');
  assert.deepEqual([...result.options].sort(), ['A', 'B', 'C', 'D']);
});

test('shuffleChoices 對任何亂數序列都保持「正解索引指向原正解內容」', () => {
  const options = ['甲', '乙', '丙', '丁'];
  for (let seed = 0; seed < 50; seed += 1) {
    let n = seed;
    const rng = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const result = shuffleChoices(options, [2], rng);
    assert.equal(result.options[result.answerIndices[0]], '丙', `seed ${seed}`);
    assert.equal(result.options.length, 4);
    assert.equal(new Set(result.options).size, 4, '不得重複或漏掉選項');
  }
});

test('shuffleChoices 支援複選：每個正解都對到自己原本的內容', () => {
  const options = ['A', 'B', 'C', 'D'];
  const result = shuffleChoices(options, [1, 3], scriptedRng([0.7, 0.2, 0.9]));
  assert.equal(result.answerIndices.length, 2);
  assert.equal(result.options[result.answerIndices[0]], 'B');
  assert.equal(result.options[result.answerIndices[1]], 'D');
});

test('shuffleChoices 對壞掉的資料原樣回傳，不會把題目弄得更錯', () => {
  // 正解索引超出範圍
  assert.deepEqual(shuffleChoices(['A', 'B'], [5]).answerIndices, [5]);
  // 沒有正解
  assert.deepEqual(shuffleChoices(['A', 'B'], []).options, ['A', 'B']);
  // 選項不足兩個
  assert.deepEqual(shuffleChoices(['A'], [0]).options, ['A']);
  assert.deepEqual(shuffleChoices([], [0]).options, []);
});

test('shuffleChoices 不修改傳入的陣列', () => {
  const options = ['A', 'B', 'C', 'D'];
  const answers = [0];
  shuffleChoices(options, answers, scriptedRng([0.9, 0.8, 0.7]));
  assert.deepEqual(options, ['A', 'B', 'C', 'D']);
  assert.deepEqual(answers, [0]);
});

test('shuffleChoices 會真的把正解散開，而不是總是留在原位', () => {
  // 這是這支函式存在的理由：模型幾乎都把正解放在第一個，重排後 A 的比例應該接近 1/4
  const options = ['A', 'B', 'C', 'D'];
  let n = 12345;
  const rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
  const positions = new Map<number, number>();
  for (let i = 0; i < 400; i += 1) {
    const idx = shuffleChoices(options, [0], rng).answerIndices[0];
    positions.set(idx, (positions.get(idx) ?? 0) + 1);
  }
  assert.equal(positions.size, 4, '四個位置都要出現過');
  for (const [, count] of positions) {
    assert.ok(count > 400 * 0.15, `每個位置都該有相當比例，實得 ${count}/400`);
    assert.ok(count < 400 * 0.35, `沒有任何位置該壓倒性偏多，實得 ${count}/400`);
  }
});

test('shuffleSingleChoice 回傳單一正解索引', () => {
  const result = shuffleSingleChoice(['A', 'B', 'C', 'D'], 0, scriptedRng([0.99, 0.5, 0.5]));
  assert.equal(result.options[result.correctIndex], 'A');
});
