import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 頁面備註是一份 Markdown 文件。編輯它的地方有兩個——側邊欄的備註區與全螢幕的備註面板，
// 兩者必須共用同一塊內容區與同一份狀態機，否則「在哪裡改」會決定「能不能預覽、存不存得
// 起來」。投影片下方的「內容」分頁則相反：它是這一頁的唯讀總結（有備註給備註、沒有給
// 逐字稿），刻意不放編輯 UI。這些都是跨元件的組裝關係，沒有渲染測試環境可驗，故比照
// floatingLayerOrder.test.ts 用原始碼層級斷言釘住。

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

test('備註的兩個編輯入口共用同一塊內容區與同一份狀態機', () => {
  // 編輯只在側邊欄與全螢幕面板；投影片下方的「內容」分頁是唯讀總結（見下一個測試）。
  assert.ok(SIDEBAR.includes('usePageNoteEditor'), '側邊欄要用共用的備註狀態機');
  assert.ok(SIDEBAR.includes('<PageNoteBody'), '側邊欄要用共用的備註內容區');
  assert.ok(!SIDEBAR.includes('updatePageNote'), '側邊欄不該自己打儲存 API——存檔邏輯集中在 usePageNoteEditor');
  assert.ok(EDITOR.includes('MarkdownMath'), '備註內容要走 MarkdownMath 渲染');
});

test('「內容」是投影片下方分頁列的第一個分頁，也是預設分頁', () => {
  const contentPos = SLIDE_PANEL.indexOf("setEditTab('content')");
  const scriptPos = SLIDE_PANEL.indexOf("setEditTab('script')");
  assert.ok(contentPos >= 0 && scriptPos >= 0, '內容與逐字稿分頁都要在');
  assert.ok(contentPos < scriptPos, '內容分頁要排在逐字稿之前');
  assert.match(
    read('useScriptEditor.ts'),
    /useState<[^>]*>\('content'\)/,
    '一進來預設停在內容分頁（這一頁的總結）',
  );
});

test('分頁只由使用者點擊切換，上一頁／下一頁不會把它換掉', () => {
  // 曾經有一版會在換頁時依「這一頁有沒有備註」自動選分頁，結果按下一頁就被切走——
  // 使用者回報「tab 的位置應該不受下一頁上一頁影響」。每個 setEditTab 都必須來自 onClick。
  const calls = [...SLIDE_PANEL.matchAll(/setEditTab\(/g)];
  assert.ok(calls.length > 0, '找不到任何分頁切換');
  for (const m of calls) {
    const before = SLIDE_PANEL.slice(Math.max(0, (m.index ?? 0) - 200), m.index);
    assert.ok(before.includes('onClick'), '分頁只能由使用者點擊切換，不能由 effect 自動換');
  }
});

test('「內容」分頁只顯示內容：有備註給備註，沒有給逐字稿，且沒有任何編輯 UI', () => {
  const start = SLIDE_PANEL.indexOf("{editTab === 'content' ?");
  const end = SLIDE_PANEL.indexOf("{editTab === 'script' ?", start);
  assert.ok(start >= 0 && end > start, '找不到內容分頁的區塊');
  const block = SLIDE_PANEL.slice(start, end);
  assert.ok(block.includes('pageNoteText ?'), '有備註時顯示備註');
  assert.ok(block.includes('editingScript'), '沒有備註時顯示逐字稿');
  for (const editUi of ['<textarea', 'PageNoteBody', 'PageNoteEditButton', 'PageNoteEditorFields', 'onChange']) {
    assert.ok(
      !block.includes(editUi),
      `內容分頁不該有 ${editUi}——它只是這一頁的總結，要修改請回側邊欄／全螢幕的備註區或隔壁的逐字稿分頁`,
    );
  }
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
