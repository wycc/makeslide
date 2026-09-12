import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The deck image style is sent with every redraw as "整份圖片風格（固定套用）". A default value
 * here is not a default *setting* — it is an instruction attached to every redraw of every deck
 * that never saved a style (122 of 132 decks when this was found), which is how decks generated
 * light came back dark: the old default said 「以深色系為主」 while the initial generation used
 * IMAGE_PROMPT_TEMPLATES[0] (soft neutral background).
 *
 * Source-level, because the failure is silent: the redraw still succeeds, it just quietly restyles
 * the page.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the deck image style starts empty — no style is smuggled into every redraw', () => {
  assert.match(read('./useImageStyle.ts'), /useState\(''\);/, 'useImageStyle state starts empty');
  assert.match(read('../PlayPage.tsx'), /deckImageStylePromptRef = useRef\(''\)/, 'and so does the mirror ref');
});

test('no redraw path hardcodes a colour scheme of its own', () => {
  for (const file of ['./useImageStyle.ts', '../PlayPage.tsx', './useChatAndImageEdit.ts', './useRegeneration.ts']) {
    const src = read(file).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /深色系|dark (theme|palette|background)/i, `${file} must not choose a look for the user`);
  }
});

test('an unset deck style sends no style section at all, rather than an empty one', () => {
  for (const file of ['./useChatAndImageEdit.ts', './useRegeneration.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /整份圖片風格（固定套用）：\\n\$\{[^}]*\|\| '\(無\)'\}/, `${file}: no "(無)" style block`);
    // The section is built conditionally, so with no style the prompt simply doesn't mention one.
    assert.match(src, /\.\.\.\([\s\S]{0,200}?整份圖片風格（固定套用）/, `${file}: style section is conditional`);
  }
});
