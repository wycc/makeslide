import test from 'node:test';
import assert from 'node:assert/strict';

import type { TranslationKey } from '../i18n';
import { zhTW } from '../locales/zh-TW';
import {
  PDF_STATUS_LABEL_KEYS,
  PROGRESS_LABEL_KEYS,
  formatGeneratingStatusLabel,
} from './statusLabels';

const t = (key: TranslationKey) => zhTW[key];

test('formatGeneratingStatusLabel translates the status when there is no progress step', () => {
  assert.equal(formatGeneratingStatusLabel('processing', null, t), zhTW['status.processing']);
});

test('formatGeneratingStatusLabel joins translated status and step (no raw enum leak)', () => {
  const label = formatGeneratingStatusLabel('processing', 'rendering_video', t);
  assert.equal(label, `${zhTW['status.processing']} / ${zhTW['progress.renderingVideo']}`);
  // The raw backend enum values must not appear in the user-facing label.
  assert.ok(!label.includes('processing'));
  assert.ok(!label.includes('rendering_video'));
});

test('every PDF status and progress step label key resolves to a non-empty string', () => {
  for (const key of Object.values(PDF_STATUS_LABEL_KEYS)) {
    assert.equal(typeof zhTW[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
  }
  for (const key of Object.values(PROGRESS_LABEL_KEYS)) {
    assert.equal(typeof zhTW[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
  }
});
