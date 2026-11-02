import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The model setting is a menu of what is installed, and picking from it configures the family too.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the settings page offers installed models instead of a bare text box', () => {
  const page = read('../SettingsPage.tsx');
  assert.match(page, /<AudioCppModelField/);
  assert.doesNotMatch(page, /<input value=\{audiocppTtsModel\}/, '不該再只是一個要手打路徑的輸入框');
});

test('picking a model sets its family, so the two cannot disagree', () => {
  const page = read('../SettingsPage.tsx');
  assert.match(page, /onPick=\{\(\{ model, family \}\) => \{\s*\n\s*setAudiocppTtsModel\(model\);[\s\S]{0,300}if \(family\) setAudiocppTtsFamily\(family\);/);
  const field = read('./AudioCppModelField.tsx');
  assert.match(field, /if \(picked\) onPick\(\{ model: picked\.path, family: picked\.family \}\)/);
});

test('a stored path the list does not know is kept as typed, and a missing list still lets you type', () => {
  const field = read('./AudioCppModelField.tsx');
  assert.match(field, /const showCustom = custom \|\| \(trimmed !== '' && models !== null && !known\)/, '清單裡沒有的舊路徑要原樣保留');
  assert.match(field, /const noList = failed \|\| \(models !== null && models\.length === 0\)/);
  assert.match(field, /if \(noList\) \{[\s\S]{0,200}\{textBox\}/, '讀不到清單時退回手打路徑');
});
