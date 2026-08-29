import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 分離出去的編輯視窗（`⧉`）是使用者自己拖到哪就該待在哪的東西，但它原本是 z-[135]，
// 而播放頁 header 是 z-[1000]：把視窗拖到畫面上緣，標題列連同「靠回原位」的按鈕就整段
// 消失在 header 底下，看起來像視窗壞了。這裡用原始碼層級的斷言把層級順序釘住——問題是
// 各檔案之間的相對關係，不是任何單一函式的行為，而這個專案沒有渲染測試環境。

const DIR = path.dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return fs.readFileSync(path.join(DIR, file), 'utf8');
}

/** 抓出檔案中第一個符合的 Tailwind z-index 類別（z-[123] 或 z-50）的數值。 */
function zIndexOf(source: string, marker: string): number {
  const line = source.split('\n').find((l) => l.includes(marker));
  assert.ok(line, `找不到含 ${marker} 的那一行——元件改寫過的話這個測試也要跟著更新`);
  const m = line.match(/z-\[(\d+)\]|z-(\d+)/);
  assert.ok(m, `${marker} 那一行沒有 z-index 類別：${line}`);
  return Number(m[1] ?? m[2]);
}

const HEADER = read('PlayPageHeader.tsx');
const SLIDE_PANEL = read('PlayPageSlidePanel.tsx');
const INSPECTOR = read('ReactSlideInspectorPanel.tsx');
const ANIMATION = read('AnimationEditorTab.tsx');

const headerZ = zIndexOf(HEADER, '<header className=');
const detachedZ = zIndexOf(SLIDE_PANEL, "? 'fixed z-[");
const inspectorZ = zIndexOf(INSPECTOR, 'className="fixed z-[');

test('分離的編輯視窗浮在播放頁 header 之上', () => {
  assert.ok(
    detachedZ > headerZ,
    `編輯視窗 z-index 是 ${detachedZ}，header 是 ${headerZ}——拖到畫面上緣就會被 header 蓋住`,
  );
});

test('元素編輯面板浮在分離的編輯視窗之上', () => {
  assert.ok(
    inspectorZ > detachedZ,
    `元素編輯面板 z-index 是 ${inspectorZ}，編輯視窗是 ${detachedZ}——面板會被編輯視窗蓋住`,
  );
});

test('最上層的對話框仍高於所有浮動視窗', () => {
  // AnimationEditorTab 的對話框已經 portal 到 body，是刻意的「最上層」。
  const dialogZ = zIndexOf(ANIMATION, 'className="fixed inset-0 z-[');
  assert.ok(
    dialogZ > inspectorZ && dialogZ > detachedZ,
    `對話框 z-index 是 ${dialogZ}，必須高於編輯視窗 ${detachedZ} 與元素編輯面板 ${inspectorZ}`,
  );
});

test('header 內的快捷鍵對話框 portal 到 body，才不會被 header 自己的層級封住', () => {
  // header 建立了自己的 stacking context（z-[1000]），留在裡面的對話框寫多大的 z-index
  // 都只在那個 context 內比較，整塊仍以 1000 與編輯視窗相比，於是被蓋掉半個。
  assert.match(HEADER, /createPortal/, 'header 的快捷鍵對話框必須 portal 出去');
  const shortcutDialogZ = zIndexOf(HEADER, 'className="fixed inset-0 z-[');
  assert.ok(
    shortcutDialogZ > detachedZ,
    `快捷鍵對話框 z-index 是 ${shortcutDialogZ}，必須高於編輯視窗 ${detachedZ}`,
  );
});
