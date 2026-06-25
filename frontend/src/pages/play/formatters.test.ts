import test from 'node:test';
import assert from 'node:assert/strict';

import type { TranslationKey } from '../../i18n';
import { zhTW } from '../../locales/zh-TW';
import {
  formatCostUsd,
  formatDurationMs,
  formatRegenerateEta,
  formatRegenerateJobStatus,
  formatRegenerateStepStatus,
  formatRegenSelectedPagesSummary,
  sumCompletedDurationMs,
} from './formatters';

const t = (key: TranslationKey) => zhTW[key];

test('formatDurationMs formats milliseconds and seconds', () => {
  assert.equal(formatDurationMs(123), '123ms');
  assert.equal(formatDurationMs(1500), '1.5s');
  assert.equal(formatDurationMs(12_345), '12s');
});

test('formatDurationMs returns placeholder for missing or invalid values', () => {
  assert.equal(formatDurationMs(null), '尚無紀錄');
  assert.equal(formatDurationMs(undefined), '尚無紀錄');
  assert.equal(formatDurationMs(Number.NaN), '尚無紀錄');
});

test('formatCostUsd formats dollar amounts and uses the provided unknown label', () => {
  assert.equal(formatCostUsd(0), '$0');
  assert.equal(formatCostUsd(0.004), '<$0.01');
  assert.equal(formatCostUsd(1.2345), '$1.23');
  assert.equal(formatCostUsd(null, t('play.system.costUnknown')), '未知');
  assert.equal(formatCostUsd(null), 'Unknown');
});

test('sumCompletedDurationMs sums only succeeded finite artifact durations', () => {
  assert.equal(
    sumCompletedDurationMs([
      { status: 'succeeded', duration_ms: 500 },
      { status: 'running', duration_ms: 1000 },
      { status: 'succeeded', duration_ms: 1500 },
      { status: 'failed', duration_ms: 700 },
      { status: 'succeeded', duration_ms: Number.NaN },
    ]),
    2000,
  );
});

test('sumCompletedDurationMs returns null when no completed duration exists', () => {
  assert.equal(
    sumCompletedDurationMs([
      { status: 'running', duration_ms: 500 },
      { status: 'failed', duration_ms: 1000 },
      { status: 'succeeded', duration_ms: null },
      null,
      undefined,
    ]),
    null,
  );
});

test('formatRegenerateJobStatus formats running/completed/failed status labels', () => {
  assert.equal(formatRegenerateJobStatus('running', t), '執行中');
  assert.equal(formatRegenerateJobStatus('completed', t), '已完成');
  assert.equal(formatRegenerateJobStatus('failed', t), '失敗');
});

test('formatRegenerateStepStatus formats running/completed/failed step text', () => {
  assert.equal(
    formatRegenerateStepStatus('running', t, {
      completed: 2,
      total: 5,
      ratio: 40,
      eta: '約 10 秒',
    }),
    '2/5 (40%) · 剩 約 10 秒',
  );
  assert.equal(
    formatRegenerateStepStatus('completed', t, {
      completed: 5,
      total: 5,
      ratio: 100,
      eta: null,
    }),
    '5/5 (100%)',
  );
  assert.equal(
    formatRegenerateStepStatus('failed', t, {
      completed: 1,
      total: 5,
      ratio: 20,
      eta: null,
      error: '圖片生成失敗',
    }),
    '失敗：圖片生成失敗',
  );
});

test('formatRegenerateEta formats localized regenerate ETA text', () => {
  assert.equal(formatRegenerateEta(10, t), '約 10 秒');
  assert.equal(formatRegenerateEta(125, t), '約 2 分 5 秒');
  assert.equal(formatRegenerateEta(7200, t), '約 2 小時');
});

test('formatRegenSelectedPagesSummary formats empty selection as all pages', () => {
  assert.equal(
    formatRegenSelectedPagesSummary({ deckPagesCount: 12, selectedPages: new Set(), t }),
    '重生全部 12 張投影片',
  );
});

test('formatRegenSelectedPagesSummary formats a single selected page', () => {
  assert.equal(
    formatRegenSelectedPagesSummary({ deckPagesCount: 12, selectedPages: new Set([3]), t }),
    '僅重生第 3 頁',
  );
});

test('formatRegenSelectedPagesSummary sorts and de-duplicates multiple selected pages', () => {
  assert.equal(
    formatRegenSelectedPagesSummary({ deckPagesCount: 12, selectedPages: [5, 2, 5, 4], t }),
    '僅重生已選取的 3 張投影片（第 2、4、5 頁）',
  );
});
