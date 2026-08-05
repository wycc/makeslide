import test from 'node:test';
import assert from 'node:assert/strict';
import { menuPanelPosition, type Rect } from './menuPosition';

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const VIEWPORT = { width: 1440, height: 900 };
const PANEL = { width: 200, height: 160 };

test('預設開在觸發按鈕正下方', () => {
  const pos = menuPanelPosition(rect(100, 50, 80, 36), PANEL, VIEWPORT, 'left');
  assert.equal(pos.top, 50 + 36 + 4);
  assert.equal(pos.left, 100);
});

test('靠右對齊時面板右緣切齊觸發按鈕右緣', () => {
  const pos = menuPanelPosition(rect(1000, 50, 80, 36), PANEL, VIEWPORT, 'right');
  assert.equal(pos.left, 1080 - 200);
});

test('靠右對齊但按鈕在版面最右側時，面板不會超出視窗', () => {
  // 這是實際會發生的情況：帳號選單就在版面右緣。
  const pos = menuPanelPosition(rect(1400, 50, 36, 36), PANEL, VIEWPORT, 'right');
  assert.ok(pos.left + PANEL.width <= VIEWPORT.width, `面板右緣超出視窗：${pos.left + PANEL.width}`);
});

test('靠左對齊但按鈕太靠右時，面板也會被拉回視窗內', () => {
  const pos = menuPanelPosition(rect(1380, 50, 40, 36), PANEL, VIEWPORT, 'left');
  assert.ok(pos.left + PANEL.width <= VIEWPORT.width);
});

test('面板不會貼死在視窗左緣', () => {
  const pos = menuPanelPosition(rect(0, 50, 36, 36), PANEL, VIEWPORT, 'right');
  assert.ok(pos.left >= 8, `left 應該留邊界：${pos.left}`);
});

test('面板比視窗還寬時退回左邊界，而不是算出負值', () => {
  // 先夾上界再夾下界的順序在這裡才看得出差別：反過來會得到負的 left。
  const pos = menuPanelPosition(rect(10, 50, 36, 36), { width: 2000, height: 160 }, VIEWPORT, 'left');
  assert.equal(pos.left, 8);
});

test('下方空間不足且上方較寬裕時改為往上開', () => {
  // 按鈕在視窗底部附近：往下開會被切掉。
  const pos = menuPanelPosition(rect(100, 820, 80, 36), PANEL, VIEWPORT, 'left');
  assert.ok(pos.top < 820, `應該往上開，實際 top=${pos.top}`);
});

test('下方空間夠就維持往下開', () => {
  const pos = menuPanelPosition(rect(100, 300, 80, 36), PANEL, VIEWPORT, 'left');
  assert.equal(pos.top, 340);
});

test('上下都不夠時仍給得出可用的高度，面板自己捲動', () => {
  const pos = menuPanelPosition(rect(100, 400, 80, 36), { width: 200, height: 5000 }, { width: 1440, height: 500 }, 'left');
  assert.ok(pos.maxHeight >= 120, `maxHeight 太小：${pos.maxHeight}`);
  assert.ok(pos.top >= 0, `top 不該是負的：${pos.top}`);
});
