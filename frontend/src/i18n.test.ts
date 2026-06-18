import test from 'node:test';
import assert from 'node:assert/strict';

import { en } from './locales/en';
import { zhTW } from './locales/zh-TW';

test('English and Traditional Chinese locale dictionaries expose the same keys', () => {
  const zhKeys = Object.keys(zhTW).sort();
  const enKeys = Object.keys(en).sort();

  assert.deepEqual(enKeys, zhKeys);
});

test('play page header and sync locale keys are complete', () => {
  const requiredKeys = [
    'play.header.back',
    'play.header.updateTitle',
    'play.header.regenerateTitle',
    'play.header.pageCounter',
    'play.sync.mode',
    'play.sync.questionPlaceholder',
    'play.sync.aiAnswer',
    'play.header.fullscreen',
    'play.header.downloadHandoutPdf',
    'play.header.syncToGithub',
    'play.share.createLink',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('source management copy/collapse locale keys are complete', () => {
  const requiredKeys = [
    'play.source.copyContent',
    'play.source.copyContentSuccess',
    'play.source.copyContentFailed',
    'play.source.collapseAll',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('TtsDialog locale keys are complete', () => {
  const requiredKeys = [
    'play.ttsDialog.title',
    'play.ttsDialog.voice',
    'play.ttsDialog.hostMode',
    'play.ttsDialog.hostModeSolo',
    'play.ttsDialog.hostModeDual',
    'play.ttsDialog.hostModeHint',
    'play.ttsDialog.speed',
    'play.ttsDialog.scriptMaxChars',
    'play.ttsDialog.scriptMaxCharsHint',
    'play.ttsDialog.scriptMaxCharsPlaceholder',
    'play.ttsDialog.close',
    'play.ttsDialog.saving',
    'play.ttsDialog.save',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('ImageStyleDialog locale keys are complete', () => {
  const requiredKeys = [
    'play.imageStyleDialog.title',
    'play.imageStyleDialog.description',
    'play.imageStyleDialog.applyTemplate',
    'play.imageStyleDialog.promptPlaceholder',
    'play.imageStyleDialog.close',
    'play.imageStyleDialog.save',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});
