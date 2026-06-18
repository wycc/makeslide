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

test('AddPagesFromPromptModal locale keys are complete', () => {
  const requiredKeys = [
    'play.addPages.title',
    'play.addPages.close',
    'play.addPages.cancel',
    'play.addPages.back',
    'play.addPages.backToEdit',
    'play.addPages.previewOutline',
    'play.addPages.startGeneration',
    'play.addPages.starting',
    'play.addPages.done',
    'play.addPages.modeSelectDescription',
    'play.addPages.manualModeTitle',
    'play.addPages.manualModeDescription',
    'play.addPages.aiModeTitle',
    'play.addPages.aiModeDescription',
    'play.addPages.manualInstructionsPrefix',
    'play.addPages.manualInstructionsSuffix',
    'play.addPages.manualExampleTitle1',
    'play.addPages.manualExampleBullet1',
    'play.addPages.manualExampleBullet2',
    'play.addPages.manualExampleTitle2',
    'play.addPages.manualExampleBullet3',
    'play.addPages.manualExampleBullet4',
    'play.addPages.manualPlaceholder',
    'play.addPages.aiInstructions',
    'play.addPages.chatRoleUser',
    'play.addPages.chatRoleAi',
    'play.addPages.aiThinking',
    'play.addPages.outlinePreview',
    'play.addPages.aiPlaceholder',
    'play.addPages.send',
    'play.addPages.reviewDescription',
    'play.addPages.cancelling',
    'play.addPages.processing',
    'play.addPages.generatingPreview',
    'play.addPages.pageAlt',
    'play.addPages.pageBadge',
    'play.addPages.scriptGenerating',
    'play.addPages.success',
    'play.addPages.cancelled',
    'play.addPages.failed',
    'play.addPages.unknownError',
    'play.addPages.cancelingButton',
    'play.addPages.abortGeneration',
    'play.addPages.step.generatingOutline',
    'play.addPages.step.renderingImages',
    'play.addPages.step.generatingScripts',
    'play.addPages.step.synthesizingAudio',
    'play.addPages.error.addFailed',
    'play.addPages.error.aiFailed',
    'play.addPages.error.outlineRequired',
    'play.addPages.error.outlineEmpty',
    'play.addPages.error.startFailed',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('PlayPageFullscreen locale keys are complete', () => {
  const requiredKeys = [
    'play.fullscreen.audioPaused',
    'play.fullscreen.noSubtitle',
    'play.fullscreen.editTranscriptHeading',
    'play.fullscreen.exit',
    'play.fullscreen.layout.image',
    'play.fullscreen.layout.split',
    'play.fullscreen.layout.edit',
    'play.fullscreen.layout.title',
    'play.fullscreen.drawing.pen',
    'play.fullscreen.drawing.penMode',
    'play.fullscreen.drawing.cursor',
    'play.fullscreen.drawing.cursorMode',
    'play.fullscreen.drawing.eraser',
    'play.fullscreen.drawing.eraserMode',
    'play.fullscreen.drawing.clearAll',
    'play.fullscreen.drawing.clear',
    'play.fullscreen.drawing.closeWithShortcut',
    'play.fullscreen.drawing.close',
    'play.fullscreen.drawing.color.red',
    'play.fullscreen.drawing.color.blue',
    'play.fullscreen.drawing.color.black',
    'play.fullscreen.drawing.color.yellow',
    'play.fullscreen.drawing.color.green',
    'play.fullscreen.drawing.color.white',
    'play.fullscreen.drawing.width.thin',
    'play.fullscreen.drawing.width.medium',
    'play.fullscreen.drawing.width.thick',
    'play.fullscreen.askQuestion',
    'play.fullscreen.questionDialogTitle',
    'play.fullscreen.questionDialogDescription',
    'play.fullscreen.close',
    'play.fullscreen.questionPlaceholder',
    'play.fullscreen.questionCountHint',
    'play.fullscreen.submittingQuestion',
    'play.fullscreen.submitQuestion',
    'play.fullscreen.pollControlTitle',
    'play.fullscreen.pollControlDescription',
    'play.fullscreen.startPoll',
    'play.fullscreen.stopPoll',
    'play.fullscreen.hidePollResults',
    'play.fullscreen.showPollResults',
    'play.fullscreen.noPolls',
    'play.fullscreen.waitingNextPage',
    'play.fullscreen.pollVotes',
    'play.fullscreen.pollTotalVotes',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('QuizBuilderPage locale keys are complete', () => {
  const requiredKeys = [
    'quiz.defaultTitle',
    'quiz.defaultPrompt',
    'quiz.loadFailed',
    'quiz.syncLoadFailed',
    'quiz.masterOnlyStart',
    'quiz.startDone',
    'quiz.startFailed',
    'quiz.masterOnlyShowAnswers',
    'quiz.showAnswersDone',
    'quiz.showAnswersFailed',
    'quiz.masterOnlyEnd',
    'quiz.endDone',
    'quiz.endFailed',
    'quiz.historyLoadFailed',
    'quiz.generateDone',
    'quiz.generateFailed',
    'quiz.saveDone',
    'quiz.saveFailed',
    'quiz.totalScore',
    'quiz.inProgressTitle',
    'quiz.answersVisibleHint',
    'quiz.answerBeforeEndHint',
    'quiz.questionScoreHeading',
    'quiz.correctAnswer',
    'quiz.questionEarnedScore',
    'quiz.explanation',
    'quiz.noExplanation',
    'quiz.backToPlay',
    'quiz.pageTitle',
    'quiz.loadingPresentation',
    'quiz.newQuiz',
    'quiz.savedQuizzes',
    'quiz.syncRole',
    'quiz.noSavedQuizzes',
    'quiz.questionCount',
    'quiz.startTitle',
    'quiz.start',
    'quiz.showAnswersTitle',
    'quiz.showAnswers',
    'quiz.endTitle',
    'quiz.end',
    'quiz.historyTitle',
    'quiz.history',
    'quiz.followerReadonlyHint',
    'quiz.studentsInQuiz',
    'quiz.noStudentProgress',
    'quiz.anonymousStudent',
    'quiz.completed',
    'quiz.historyHeading',
    'quiz.close',
    'quiz.loading',
    'quiz.noHistory',
    'quiz.sessionTime',
    'quiz.attemptCount',
    'quiz.scorePoints',
    'quiz.notScored',
    'quiz.collapse',
    'quiz.viewAnswers',
    'quiz.correctAnswerParen',
    'quiz.selectedWrongParen',
    'quiz.historyQuestionMissing',
    'quiz.titleLabel',
    'quiz.promptLabel',
    'quiz.busy',
    'quiz.generate',
    'quiz.save',
    'quiz.addQuestion',
    'quiz.hideEditorAnswers',
    'quiz.showEditorAnswers',
    'quiz.questionHeading',
    'quiz.delete',
    'quiz.singleChoice',
    'quiz.multipleChoice',
    'quiz.questionPlaceholder',
    'quiz.scoreLabel',
    'quiz.scorePlaceholder',
    'quiz.optionPlaceholder',
    'quiz.explanationPlaceholder',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});

test('PromptModal and HomePage loose-end locale keys are complete', () => {
  const requiredKeys = [
    'promptModal.applyTemplate',
    'home.importingZip',
    'home.importZipProgressAriaLabel',
  ] as const;

  for (const key of requiredKeys) {
    assert.equal(typeof zhTW[key], 'string');
    assert.equal(typeof en[key], 'string');
    assert.notEqual(zhTW[key].trim(), '');
    assert.notEqual(en[key].trim(), '');
  }
});
