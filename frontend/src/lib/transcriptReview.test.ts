import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanTranscriptForReview } from './transcriptReview';

test('removes Speaker prefixes, emotion tags and newlines', () => {
  const input =
    'Speaker 1: [seriously] 權重參數 w 是決定各特徵在預測中重要性的關鍵。\n' +
    'Speaker 2: [excitedly] 沒錯！權重的調整不僅影響模型的預測結果。';
  assert.equal(
    cleanTranscriptForReview(input),
    '權重參數 w 是決定各特徵在預測中重要性的關鍵。 沒錯！權重的調整不僅影響模型的預測結果。',
  );
});

test('handles full-width colon and brackets', () => {
  assert.equal(
    cleanTranscriptForReview('Speaker 2：【興奮】大家好。'),
    '大家好。',
  );
});

test('collapses internal whitespace and trims', () => {
  assert.equal(cleanTranscriptForReview('  你好   世界 \n\n 再見  '), '你好 世界 再見');
});

test('empty / nullish input returns empty string', () => {
  assert.equal(cleanTranscriptForReview(''), '');
  assert.equal(cleanTranscriptForReview(null), '');
  assert.equal(cleanTranscriptForReview(undefined), '');
});

test('plain text without tags is preserved (only whitespace normalised)', () => {
  assert.equal(cleanTranscriptForReview('一句沒有標記的話'), '一句沒有標記的話');
});
