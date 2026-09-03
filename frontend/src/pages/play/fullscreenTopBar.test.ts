import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 全螢幕頂端原本有三組各自 absolute 的疊層釘在同一條水平線上：中央的指示徽章列
// （🗳／📝／💬，left-1/2 top-4）、右上的投票鈕與版面工具列（都是 right-4 top-4）、
// 以及 follower 的提問按鈕（left-4 top-4）。視窗一窄或工具列一長就會互相壓住——
// 使用者回報「投票和頁面評論的圖示會重疊」。修法是把它們收進同一條三欄格線，
// 由 layout 保證彼此推開，而不是靠座標剛好不撞。這個專案沒有渲染測試環境、幾何是否
// 重疊又隨視窗寬度而變，因此比照 floatingLayerOrder.test.ts 用原始碼層級斷言釘住修法本身。

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'PlayPageFullscreen.tsx'),
  'utf8',
);
const LINES = SRC.split('\n');

const BAR_START = LINES.findIndex(
  (l) => l.includes('absolute inset-x-0 top-0') && l.includes('grid-cols-[1fr_auto_1fr]'),
);

/** 頂端格線容器的行範圍：容器本身縮排 6 格，往後第一個同縮排的 </div> 就是它的結尾。 */
function topBarSource(): string {
  assert.ok(BAR_START >= 0, '找不到全螢幕頂端的三欄格線容器');
  const end = LINES.findIndex((l, i) => i > BAR_START && l === '      </div>');
  assert.ok(end > BAR_START, '抓不到頂端格線容器的結尾');
  return LINES.slice(BAR_START, end + 1).join('\n');
}

test('全螢幕頂端沒有各自釘在同一條水平線上的浮動元素', () => {
  assert.ok(BAR_START >= 0, '找不到全螢幕頂端的三欄格線容器');
  for (const pinned of [
    /absolute left-1\/2 top-4(?!\d)/,
    /absolute right-4 top-4(?!\d)/,
    /absolute left-4 top-4(?!\d)/,
  ]) {
    assert.ok(
      !pinned.test(SRC),
      `${pinned} 又出現了：頂端元素各自釘座標，視窗一窄就會互相重疊`,
    );
  }
});

test('指示徽章、投票鈕與版面工具列都排在同一條頂端格線裡', () => {
  const bar = topBarSource();
  for (const marker of [
    'commentBadgeLabel',
    "t('play.fullscreen.startPoll')",
    "t('play.fullscreen.pollButton')",
    'FULLSCREEN_LAYOUTS.map',
    "t('play.fullscreen.exit')",
  ]) {
    assert.ok(bar.includes(marker), `${marker} 不在頂端格線容器內——搬出去就會再度壓到鄰居`);
  }
});

test('頂端格線本身不吃點擊，互動元素各自開啟 pointer-events', () => {
  const bar = topBarSource();
  assert.ok(
    (LINES[BAR_START] ?? '').includes('pointer-events-none'),
    '頂端格線橫跨整個畫面寬度，若會吃點擊就會擋住底下的上一頁／下一頁區與播放切換',
  );
  // 徽章、投票鈕、版面工具列、離開按鈕各一，加上 follower 的提問按鈕。
  const autos = bar.match(/pointer-events-auto/g) ?? [];
  assert.ok(autos.length >= 5, `頂端格線裡只有 ${autos.length} 個 pointer-events-auto，按鈕會點不到`);
});
