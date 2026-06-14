import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImagePrompt } from '../src/services/imagePromptTemplates';

test('buildImagePrompt includes figureNotes when provided', () => {
  const prompt = buildImagePrompt({
    stylePrompt: 'academic minimalist style',
    pageText: '本頁說明營收成長趨勢',
    figureNotes: '本頁對應的原始 PDF 內含以下圖表，並已作為額外參考圖片附加於本次請求：\n- 參考圖表 1：Figure 1: revenue growth',
  });
  assert.match(prompt, /參考圖表 1：Figure 1: revenue growth/);
  // figureNotes should appear after the page text/script reference sections.
  assert.ok(prompt.indexOf('頁面文字內容') < prompt.indexOf('參考圖表 1'));
});

test('buildImagePrompt omits figure section when figureNotes is null/empty', () => {
  const prompt = buildImagePrompt({ pageText: 'hello', figureNotes: null });
  assert.doesNotMatch(prompt, /參考圖表/);

  const promptEmpty = buildImagePrompt({ pageText: 'hello', figureNotes: '   ' });
  assert.doesNotMatch(promptEmpty, /參考圖表/);
});
