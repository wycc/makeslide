import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImagePrompt,
  IMAGE_PROMPT_GENERAL_RULES,
  IMAGE_PROMPT_TEMPLATES,
} from '../src/services/imagePromptTemplates';

test('buildImagePrompt with no params returns only the general rules', () => {
  assert.equal(buildImagePrompt({}), IMAGE_PROMPT_GENERAL_RULES.join('\n\n'));
});

test('buildImagePrompt appends a trimmed style template line', () => {
  const out = buildImagePrompt({ stylePrompt: '  水彩風  ' });
  assert.ok(out.includes('生圖風格模板：水彩風'));
});

test('buildImagePrompt ignores whitespace-only optional prompts', () => {
  assert.equal(
    buildImagePrompt({ stylePrompt: '   ', userAdjustmentPrompt: '\n\t', figureNotes: '  ' }),
    buildImagePrompt({}),
  );
});

test('buildImagePrompt adds the deck-consistency line before the deck adjustment requirement', () => {
  const sections = buildImagePrompt({ deckAdjustmentPrompt: 'darker tone' }).split('\n\n');
  const consistencyIdx = sections.indexOf('請保持全份簡報視覺風格一致。');
  const requirementIdx = sections.indexOf('整份調整需求：\ndarker tone');
  assert.ok(consistencyIdx >= 0, 'consistency line present');
  assert.ok(requirementIdx >= 0, 'requirement line present');
  assert.ok(consistencyIdx < requirementIdx, 'consistency precedes requirement');
});

test('buildImagePrompt distinguishes an omitted pageText from an empty/null one', () => {
  // omitted -> the section is absent entirely
  assert.ok(!buildImagePrompt({}).includes('頁面文字內容'));
  // present-but-empty -> the section appears with a "(無)" placeholder
  assert.ok(buildImagePrompt({ pageText: '' }).includes('頁面文字內容（參考）：\n(無)'));
  assert.ok(buildImagePrompt({ pageText: null }).includes('頁面文字內容（參考）：\n(無)'));
  // present with text -> trimmed text is embedded
  assert.ok(buildImagePrompt({ pageText: '  Hello  ' }).includes('頁面文字內容（參考）：\nHello'));
});

test('buildImagePrompt applies the same omitted/empty rule to pageScript', () => {
  assert.ok(!buildImagePrompt({}).includes('頁面逐字稿'));
  assert.ok(buildImagePrompt({ pageScript: '' }).includes('頁面逐字稿（參考）：\n(無)'));
  assert.ok(buildImagePrompt({ pageScript: 'narration' }).includes('頁面逐字稿（參考）：\nnarration'));
});

test('buildImagePrompt embeds slide label, user adjustment, figure notes and text body', () => {
  const out = buildImagePrompt({
    slideLabel: ' Slide A ',
    userAdjustmentPrompt: ' make it blue ',
    figureNotes: ' figure: chart ',
    textBody: ' body text ',
  });
  assert.ok(out.includes('頁面標記：Slide A。請依該頁主題做視覺化總結。'));
  assert.ok(out.includes('使用者修改需求：\nmake it blue'));
  assert.ok(out.includes('figure: chart'));
  assert.ok(out.includes('body text'));
});

test('IMAGE_PROMPT_TEMPLATES entries are well-formed and have unique keys', () => {
  const keys = new Set<string>();
  for (const tpl of IMAGE_PROMPT_TEMPLATES) {
    assert.ok(tpl.key.length > 0, 'key non-empty');
    assert.equal(keys.has(tpl.key), false, `duplicate key: ${tpl.key}`);
    keys.add(tpl.key);
    assert.ok(tpl.label.trim().length > 0, `${tpl.key} label non-empty`);
    assert.ok(tpl.description.trim().length > 0, `${tpl.key} description non-empty`);
    assert.ok(tpl.prompt_en.trim().length > 0, `${tpl.key} prompt_en non-empty`);
    assert.ok(tpl.prompt_zh.trim().length > 0, `${tpl.key} prompt_zh non-empty`);
  }
  assert.equal(keys.size, IMAGE_PROMPT_TEMPLATES.length);
});
