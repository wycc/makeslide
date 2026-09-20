import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The playback badge has to describe what happens when the page ends.
 *
 * It used to read only `classroomMode`, so with classroom mode off it said "continuous playback"
 * whatever the auto-advance setting was — and auto-advance was off by default. A deck therefore
 * stopped at the end of every page while the panel promised it would play on, which reads as the
 * page being broken rather than as a setting. Reported on the last step of an animated page, where
 * the steps run one after another and then everything stops.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8');

test('the badge names the third state instead of claiming continuous playback', () => {
  const panel = read('./PlayPageSlidePanel.tsx');
  const at = panel.indexOf("t('play.slidePanel.classroomModeBadge')");
  assert.ok(at > 0, 'the badge is still there');
  const badge = panel.slice(at, at + 300);
  assert.match(badge, /: autoAdvance\s*\n\s*\? t\('play\.slidePanel\.continuousPlaybackBadge'\)/, '只有真的會自動換頁時才說連續播放');
  assert.match(badge, /: t\('play\.slidePanel\.stopEachPageBadge'\)/, '否則要說清楚會停在本頁');
  // Both languages carry the new wording, or one of them renders the key itself.
  for (const locale of ['zh-TW', 'en']) {
    assert.match(read(`../../locales/${locale}.ts`), /'play\.slidePanel\.stopEachPageBadge':/, `${locale} 少了字串`);
  }
});

test('a deck plays on to the next page unless the viewer turned that off', () => {
  const i18n = read('../../i18n.ts');
  const fn = i18n.slice(i18n.indexOf('export function getStoredAutoAdvance'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(raw == null\) return true;/, '沒設定過＝會接著播下一頁');
  assert.match(body, /return !\(raw === '0' \|\| raw\.toLowerCase\(\) === 'false'\);/, '只有明確關掉才停');
  // The page-end path still honours it, so the setting keeps meaning what it says.
  assert.match(read('../PlayPage.tsx'), /if \(!autoAdvance\) return;/);
});
