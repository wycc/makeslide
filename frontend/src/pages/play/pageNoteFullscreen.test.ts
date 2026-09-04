import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 頁面備註是一份 Markdown 文件：讀的時候渲染、按「編輯」才進原始碼模式，而全螢幕的
// 編輯要能邊改邊看渲染結果（使用者要求的即時預覽）。這兩件事都是跨元件的組裝關係，
// 沒有渲染測試環境可驗，故比照 floatingLayerOrder.test.ts 用原始碼層級斷言釘住。

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string): string => fs.readFileSync(path.join(DIR, f), 'utf8');

const EDITOR = read('PageNoteEditor.tsx');
const FULLSCREEN = read('PlayPageFullscreen.tsx');
const SIDEBAR = read('PlayPageSidebar.tsx');

test('兩個編輯入口都帶即時預覽', () => {
  assert.match(
    EDITOR,
    /editor\.editing \? <PageNoteEditorFields editor=\{editor\} preview/,
    '全螢幕面板的編輯模式必須傳入 preview，否則就沒有即時預覽了',
  );
  // 側邊欄一開始沒給預覽，使用者回報「似乎沒有看到預覽」——編輯 Markdown 卻看不到
  // 渲染結果等於盲打，所以側邊欄也要有（用 stack 版面，窄側欄不會被擠成兩條細長欄）。
  assert.match(
    SIDEBAR,
    /<PageNoteEditorFields editor=\{editor\} preview="stack"/,
    '側邊欄的編輯模式也要帶即時預覽',
  );
  assert.ok(
    EDITOR.includes("t('play.pageNote.previewLabel')"),
    '預覽區要有標題，使用者才知道右半邊是預覽而不是另一個輸入框',
  );
});

test('備註以 Markdown 渲染，不是純文字直出', () => {
  assert.ok(EDITOR.includes('MarkdownMath'), '備註內容要走 MarkdownMath 渲染');
  assert.ok(
    !SIDEBAR.includes('updatePageNote'),
    '側邊欄不該再自己打儲存 API——存檔邏輯集中在 usePageNoteEditor，兩處行為才一致',
  );
  assert.ok(
    SIDEBAR.includes('usePageNoteEditor') && SIDEBAR.includes('PageNoteView'),
    '側邊欄要用共用的備註檢視／編輯元件',
  );
});

test('全螢幕的 📝 徽章是可點的按鈕，且與留言面板互斥', () => {
  assert.ok(
    FULLSCREEN.includes('setFullscreenNotesOpen') && FULLSCREEN.includes('FullscreenPageNotePanel'),
    '全螢幕要能開關備註面板',
  );
  // 兩個面板都停在頂端置中的同一個位置，同時打開就會疊在一起。
  assert.match(
    FULLSCREEN,
    /setFullscreenNotesOpen\(\(o\) => \{[\s\S]*?setFullscreenCommentsOpen\(false\)/,
    '打開備註面板時要收掉留言面板',
  );
  assert.match(
    FULLSCREEN,
    /setFullscreenCommentsOpen\(\(o\) => \{[\s\S]*?setFullscreenNotesOpen\(false\)/,
    '打開留言面板時要收掉備註面板',
  );
});
