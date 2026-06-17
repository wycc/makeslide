import test from 'node:test';
import assert from 'node:assert/strict';
import { isMinimalSlideStyleRequested } from '../src/worker/steps/generateScript';

test('isMinimalSlideStyleRequested detects Takahashi and one-or-two-point prompts', () => {
  assert.equal(isMinimalSlideStyleRequested('請用高橋流，每一頁只放一兩個重點，字要大'), true);
  assert.equal(isMinimalSlideStyleRequested('Use Takahashi style with one or two key points per slide'), true);
  assert.equal(isMinimalSlideStyleRequested('做成極簡大字投影片，文字越少越好'), true);
  assert.equal(isMinimalSlideStyleRequested('每頁最多兩個重點，不要塞太多細節'), true);
});

test('isMinimalSlideStyleRequested keeps normal detailed prompts in regular mode', () => {
  assert.equal(isMinimalSlideStyleRequested('請用清楚教學語氣，補充例子並完整解釋流程'), false);
  assert.equal(isMinimalSlideStyleRequested('Academic style with detailed explanation and examples'), false);
  assert.equal(isMinimalSlideStyleRequested(null), false);
  assert.equal(isMinimalSlideStyleRequested('   '), false);
});
