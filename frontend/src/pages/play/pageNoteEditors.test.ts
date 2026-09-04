import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 頁面備註是一份 Markdown 文件，現在有三個入口：側邊欄的備註區、投影片下方的備註分頁、
// 全螢幕的備註面板。三者必須共用同一塊內容區與同一份狀態機，否則「在哪裡改」會決定
// 「能不能預覽、存不存得起來」。這些都是跨元件的組裝關係，沒有渲染測試環境可驗，
// 故比照 floatingLayerOrder.test.ts 用原始碼層級斷言釘住。

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string): string => fs.readFileSync(path.join(DIR, f), 'utf8');

const EDITOR = read('PageNoteEditor.tsx');
const FULLSCREEN = read('PlayPageFullscreen.tsx');
const SIDEBAR = read('PlayPageSidebar.tsx');
const SLIDE_PANEL = read('PlayPageSlidePanel.tsx');

test('編輯備註一定看得到即時預覽', () => {
  // 使用者回報過「似乎沒有看到預覽」：編輯 Markdown 卻看不到渲染結果等於盲打。
  // 預覽掛在共用的 PageNoteBody 上，所以每個入口都有，不會漏掉其中一個。
  assert.match(
    EDITOR,
    /<PageNoteEditorFields editor=\{editor\} preview /,
    'PageNoteBody 的編輯模式必須帶 preview',
  );
  assert.ok(
    EDITOR.includes("t('play.pageNote.previewLabel')"),
    '預覽區要有標題，使用者才知道那半邊是預覽而不是另一個輸入框',
  );
});

test('預覽與編輯區左右分割，且依容器寬度決定', () => {
  assert.ok(
    EDITOR.includes('grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]'),
    '使用者要的是左右分割',
  );
  // 這個編輯器會被放進寬度差很多的容器（全螢幕面板 vs. 可收合的側邊欄），
  // viewport 斷點分欄會在寬螢幕的窄側欄裡擠成兩條細長欄。
  assert.ok(!EDITOR.includes('md:grid-cols-2'), '分欄要看容器寬度而不是 viewport 斷點');
});

test('三個備註入口共用同一塊內容區與同一份狀態機', () => {
  for (const [name, src] of [['側邊欄', SIDEBAR], ['投影片下方的備註分頁', SLIDE_PANEL]] as const) {
    assert.ok(src.includes('usePageNoteEditor'), `${name}要用共用的備註狀態機`);
    assert.ok(src.includes('<PageNoteBody'), `${name}要用共用的備註內容區`);
    assert.ok(!src.includes('updatePageNote'), `${name}不該自己打儲存 API——存檔邏輯集中在 usePageNoteEditor`);
  }
  assert.ok(EDITOR.includes('MarkdownMath'), '備註內容要走 MarkdownMath 渲染');
});

test('備註是投影片下方分頁列的第一個分頁', () => {
  const notePos = SLIDE_PANEL.indexOf("setEditTab('note')");
  const scriptPos = SLIDE_PANEL.indexOf("setEditTab('script')");
  assert.ok(notePos >= 0 && scriptPos >= 0, '備註與逐字稿分頁都要在');
  assert.ok(notePos < scriptPos, '備註分頁要排在逐字稿之前');
});

test('換頁時：有備註先看備註，沒有就看逐字稿', () => {
  assert.match(
    SLIDE_PANEL,
    /setEditTab\(\(prev\) => \(prev === 'note' \|\| prev === 'script' \? \(pageNoteRef\.current \? 'note' : 'script'\) : prev\)\)/,
    '預設分頁要依這一頁有沒有備註決定，且不打斷刻意選了其他分頁的人',
  );
  // 相依只放 pageNumber：把備註內容也放進去的話，在備註分頁裡清空備註的當下就會被踢回逐字稿。
  assert.match(SLIDE_PANEL, /\}, \[notePageNumber, setEditTab\]\);/, '自動選分頁只跟著換頁跑');
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
