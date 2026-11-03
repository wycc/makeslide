import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zhTW } from '../locales/zh-TW';
import { en } from '../locales/en';

/** 「測驗中的學員」放大成全螢幕、兩欄列出所有學員。沒有渲染測試環境，以原始碼層級釘住接線。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'QuizBuilderPage.tsx'), 'utf8');

test('放大時名單是兩欄，且面板鋪滿畫面', () => {
  assert.ok(page.includes("studentsExpanded ? 'mt-3 grid grid-cols-2 gap-2' : 'mt-2 space-y-2'"));
  assert.ok(page.includes("studentsExpanded ? 'fixed inset-0 z-[200] overflow-y-auto"));
  assert.ok(page.includes('ref={studentsPanelRef}'));
});

test('進出全螢幕都有路：Esc、瀏覽器退出全螢幕、測驗結束', () => {
  assert.ok(page.includes("e.key === 'Escape'"));
  assert.ok(page.includes("addEventListener('fullscreenchange', onFullscreenChange)"));
  assert.ok(page.includes('if (!showStudentsPanel) setStudentsExpanded(false)'));
  assert.ok(page.includes('document.exitFullscreen()'));
});

test('按鈕文字兩種語言都有', () => {
  for (const key of ['quiz.studentsExpand', 'quiz.studentsExpandTitle', 'quiz.studentsCollapse', 'quiz.studentsCollapseTitle'] as const) {
    assert.ok(zhTW[key]);
    assert.ok(en[key]);
  }
});
