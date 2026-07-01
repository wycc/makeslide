import test from 'node:test';
import assert from 'node:assert/strict';
import { essayPhotoFilename, clampEssayScore, buildEssayUserText } from '../src/services/quizEssayGrading';

test('essayPhotoFilename sanitizes segments and includes the index', () => {
  assert.equal(essayPhotoFilename(3, 'sess-1', 'client-2', 'q1', 0), '3_sess-1_client-2_q1_0.jpg');
  assert.equal(essayPhotoFilename(3, '../x', 'y/z', 'q/../a', 1), '3_.._x_y_z_q_.._a_1.jpg');
});

test('clampEssayScore clamps into range and rounds to one decimal', () => {
  assert.equal(clampEssayScore(7.26, 10), 7.3);
  assert.equal(clampEssayScore(12, 10), 10);
  assert.equal(clampEssayScore(-5, 10), 0);
  assert.equal(clampEssayScore(NaN, 10), 0);
  assert.equal(clampEssayScore('x', 10), 0);
  assert.equal(clampEssayScore(5, -3), 0);
});

test('buildEssayUserText includes reference answer when present and a fallback otherwise', () => {
  const withRef = buildEssayUserText({ question: 'Q', referenceAnswer: '重點A', maxScore: 8 });
  assert.match(withRef, /本題滿分：8/);
  assert.match(withRef, /重點A/);
  const noRef = buildEssayUserText({ question: 'Q', referenceAnswer: '   ', maxScore: 8 });
  assert.match(noRef, /未提供參考答案/);
});
