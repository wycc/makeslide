import test from 'node:test';
import assert from 'node:assert/strict';
import { canSaveScript } from './scriptSaveState';

const base = { hasScriptChanges: false, audioOutdated: false, busy: false, readOnly: false };

test('沒有任何變更時不能按', () => {
  assert.equal(canSaveScript(base), false);
});

test('手改逐字稿後可以按', () => {
  assert.equal(canSaveScript({ ...base, hasScriptChanges: true }), true);
});

test('改寫過但文字已落檔（語音還沒重生）也要可以按', () => {
  // 這就是使用者回報的情境：rewrite-script 端點已把稿子寫進檔案，文字比對看不出差別，
  // 但語音還是改寫前那一段，此時按鈕必須是 enabled。
  assert.equal(canSaveScript({ ...base, audioOutdated: true }), true);
});

test('唯讀或忙碌時一律不能按', () => {
  assert.equal(canSaveScript({ ...base, hasScriptChanges: true, readOnly: true }), false);
  assert.equal(canSaveScript({ ...base, audioOutdated: true, readOnly: true }), false);
  assert.equal(canSaveScript({ ...base, hasScriptChanges: true, busy: true }), false);
  assert.equal(canSaveScript({ ...base, audioOutdated: true, busy: true }), false);
});

// ── 接線的守門斷言 ────────────────────────────────────────────────────────────
// 旗標本身好測，但「哪裡標記、哪裡清掉」是跨檔案的組裝關係，漏掉任何一處都會讓按鈕
// 回到使用者回報的壞狀態（改寫後仍是灰的），或反過來永遠亮著。此專案沒有渲染測試環境。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

test('每個改寫入口都會標記語音落後', () => {
  // AI 改寫（套用草稿）、對話式改寫（送出與復原）、側欄聊天改寫。
  assert.match(
    read('pages/play/PlayPageSlidePanel.tsx'),
    /setEditingScript\(aiRewriteDraft\); markScriptAudioOutdated\(\);/,
    'AI 改寫套用後要標記語音落後',
  );
  const dialog = read('pages/play/ScriptRewriteDialog.tsx');
  assert.equal(
    (dialog.match(/markScriptAudioOutdated\(\)/g) ?? []).length,
    2,
    '對話式改寫的送出與復原都要標記語音落後',
  );
  assert.ok(
    read('pages/play/useScriptEditor.ts').includes('markScriptAudioOutdated();'),
    '側欄聊天改寫也要標記語音落後',
  );
});

test('存檔／重生成功後才清掉旗標，換頁也清', () => {
  const playPage = read('pages/PlayPage.tsx');
  assert.equal(
    (playPage.match(/clearScriptAudioOutdated\(\)/g) ?? []).length,
    2,
    '只存檔與重生語音兩條路徑都要清掉旗標',
  );
  // 清除只跟著頁碼跑：跟 currentScript 綁在一起的話，改寫造成的 detail 更新會把旗標洗掉，
  // 按鈕又會變回灰的。
  assert.match(
    read('pages/play/useScriptEditor.ts'),
    /setScriptAudioOutdated\(false\);\n  \}, \[currentPage\?\.page_number\]\);/,
    '換頁清除旗標的 effect 只能相依 page_number',
  );
});

test('兩顆「儲存並重生語音」按鈕用同一套判斷', () => {
  for (const f of ['pages/play/PlayPageSlidePanel.tsx', 'pages/play/PlayPageFullscreen.tsx']) {
    assert.ok(read(f).includes('canSaveScript({'), `${f} 要用共用的 canSaveScript`);
    assert.ok(!read(f).includes('|| !hasScriptChanges}'), `${f} 不該只看文字有沒有變`);
  }
});
