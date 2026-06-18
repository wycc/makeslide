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

test('VersionHistoryDialog locale keys are complete', () => {
  const requiredKeys = [
    'play.versionHistory.titleImage',
    'play.versionHistory.titleScript',
    'play.versionHistory.pageSuffix',
    'play.versionHistory.loading',
    'play.versionHistory.empty',
    'play.versionHistory.selectPrompt',
    'play.versionHistory.imageAlt',
    'play.versionHistory.close',
    'play.versionHistory.restoring',
    'play.versionHistory.restore',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('ShareDialog locale keys are complete', () => {
  const requiredKeys = [
    'play.shareDialog.title',
    'play.shareDialog.description',
    'play.shareDialog.copyLink',
    'play.shareDialog.copied',
    'play.shareDialog.copyFailed',
    'play.shareDialog.close',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('PlayPageSlidePanel playback control/settings locale keys are complete', () => {
  const requiredKeys = [
    'play.slidePanel.playbackSettingsTitle',
    'play.slidePanel.shareQrAlt',
    'play.slidePanel.pauseAudioOverlay',
    'play.slidePanel.resumeAudioOverlay',
    'play.slidePanel.viewImageHistory',
    'play.slidePanel.versionButton',
    'play.slidePanel.pageImageAlt',
    'play.slidePanel.pageGenerationFailed',
    'play.slidePanel.awaitingSplitConfirmation',
    'play.slidePanel.imageGenerating',
    'play.slidePanel.finished',
    'play.slidePanel.classroomAwaitingNextMessage',
    'play.slidePanel.prevPage',
    'play.slidePanel.nextPage',
    'play.slidePanel.audioRetry',
    'play.slidePanel.noAudio',
    'play.slidePanel.nextAndPlay',
    'play.slidePanel.pause',
    'play.slidePanel.play',
    'play.slidePanel.shareQrAriaLabel',
    'play.slidePanel.shareQrTitle',
    'play.slidePanel.progressBarAriaLabel',
    'play.slidePanel.settingsToggle',
    'play.slidePanel.localMuted',
    'play.slidePanel.localUnmuted',
    'play.slidePanel.classroomModeBadge',
    'play.slidePanel.continuousPlaybackBadge',
    'play.slidePanel.interactiveModeBadge',
    'play.slidePanel.followerAudioStatusLabel',
    'play.slidePanel.followerAudioUnlockedShort',
    'play.slidePanel.followerAudioLockedShort',
    'play.slidePanel.teacherForcedMute',
    'play.slidePanel.audioSectionTitle',
    'play.slidePanel.audioStatusTeacherForced',
    'play.slidePanel.audioStatusMutedLocal',
    'play.slidePanel.audioStatusUnmutedLocal',
    'play.slidePanel.playbackSpeedTitle',
    'play.slidePanel.subtitleTitle',
    'play.slidePanel.subtitleDescription',
    'play.slidePanel.studentAudioControlTitle',
    'play.slidePanel.studentAudioUnlocked',
    'play.slidePanel.studentAudioLocked',
    'play.slidePanel.forceAllMuted',
    'play.slidePanel.unlockStudentPlayback',
    'play.slidePanel.classroomModeOnDesc',
    'play.slidePanel.classroomModeOffDesc',
    'play.slidePanel.toggleOn',
    'play.slidePanel.toggleOff',
    'play.slidePanel.interactiveModeOnDesc',
    'play.slidePanel.interactiveModeOffDesc',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('PlayPageSlidePanel transcript/prompt editor locale keys are complete', () => {
  const requiredKeys = [
    'play.slidePanel.transcriptTab',
    'play.slidePanel.promptTab',
    'play.slidePanel.focusModeRestore',
    'play.slidePanel.focusModeEnlarge',
    'play.slidePanel.transcript.heading',
    'play.slidePanel.transcript.viewHistory',
    'play.slidePanel.transcript.versionButton',
    'play.slidePanel.transcript.placeholder',
    'play.slidePanel.transcript.saveHint',
    'play.slidePanel.transcript.regenerating',
    'play.slidePanel.transcript.saveAndRegenerate',
    'play.slidePanel.prompt.heading',
    'play.slidePanel.prompt.placeholder',
    'play.slidePanel.prompt.updateHint',
    'play.slidePanel.prompt.saving',
    'play.slidePanel.prompt.save',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});
