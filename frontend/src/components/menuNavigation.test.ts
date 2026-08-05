import test from 'node:test';
import assert from 'node:assert/strict';
import { menuKeyAction, menuOpenAction, shouldPreventDefault } from './menuNavigation';

test('ArrowDown 往下移動並在最後一項環繞回第一項', () => {
  assert.deepEqual(menuKeyAction('ArrowDown', 0, 4), { kind: 'move', index: 1 });
  assert.deepEqual(menuKeyAction('ArrowDown', 3, 4), { kind: 'move', index: 0 });
});

test('ArrowUp 往上移動並在第一項環繞到最後一項', () => {
  assert.deepEqual(menuKeyAction('ArrowUp', 1, 4), { kind: 'move', index: 0 });
  assert.deepEqual(menuKeyAction('ArrowUp', 0, 4), { kind: 'move', index: 3 });
});

test('尚未選定任何項目時 ArrowUp 落在最後一項', () => {
  // -1 代表焦點還在觸發按鈕上；往上應該是最後一項，不是 -2。
  assert.deepEqual(menuKeyAction('ArrowUp', -1, 3), { kind: 'move', index: 2 });
});

test('Home/End 跳到頭尾', () => {
  assert.deepEqual(menuKeyAction('Home', 2, 4), { kind: 'move', index: 0 });
  assert.deepEqual(menuKeyAction('End', 0, 4), { kind: 'move', index: 3 });
});

test('Escape 關閉並把焦點還給觸發按鈕', () => {
  // 不還焦點的話，鍵盤使用者得從頁面開頭重新 Tab 一次。
  assert.deepEqual(menuKeyAction('Escape', 1, 4), { kind: 'close', restoreFocus: true });
});

test('Tab 關閉但不搶焦點', () => {
  // menu 不是 dialog，不該把使用者困在裡面；讓瀏覽器把焦點帶到下一個元素。
  assert.deepEqual(menuKeyAction('Tab', 1, 4), { kind: 'close', restoreFocus: false });
});

test('Enter/Space 只有在已經選到項目時才觸發', () => {
  assert.deepEqual(menuKeyAction('Enter', 2, 4), { kind: 'activate' });
  assert.deepEqual(menuKeyAction(' ', 2, 4), { kind: 'activate' });
  assert.deepEqual(menuKeyAction('Enter', -1, 4), { kind: 'none' });
});

test('無關的鍵不做任何事', () => {
  assert.deepEqual(menuKeyAction('a', 1, 4), { kind: 'none' });
  assert.deepEqual(menuKeyAction('PageDown', 1, 4), { kind: 'none' });
});

test('空選單只認 Escape，不會算出 NaN 或負數索引', () => {
  assert.deepEqual(menuKeyAction('ArrowDown', -1, 0), { kind: 'none' });
  assert.deepEqual(menuKeyAction('Escape', -1, 0), { kind: 'close', restoreFocus: true });
});

test('關閉狀態下 ArrowDown/Enter/Space 開啟選單並落在第一項', () => {
  assert.deepEqual(menuOpenAction('ArrowDown', 4), { open: true, index: 0 });
  assert.deepEqual(menuOpenAction('Enter', 4), { open: true, index: 0 });
  assert.deepEqual(menuOpenAction(' ', 4), { open: true, index: 0 });
});

test('關閉狀態下 ArrowUp 開啟選單並落在最後一項', () => {
  assert.deepEqual(menuOpenAction('ArrowUp', 4), { open: true, index: 3 });
});

test('關閉狀態下其他鍵不開啟選單', () => {
  assert.deepEqual(menuOpenAction('a', 4), { open: false, index: -1 });
  assert.deepEqual(menuOpenAction('Escape', 4), { open: false, index: -1 });
});

test('沒有項目的選單不會被鍵盤開啟', () => {
  assert.deepEqual(menuOpenAction('ArrowDown', 0), { open: false, index: -1 });
});

test('會捲動頁面或送出表單的鍵要 preventDefault', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', ' ']) {
    assert.equal(shouldPreventDefault(key), true, `${key} 應該 preventDefault`);
  }
  // Enter 要讓 click handler 正常跑；Escape/Tab 交給瀏覽器預設行為。
  for (const key of ['Enter', 'Escape', 'Tab', 'a']) {
    assert.equal(shouldPreventDefault(key), false, `${key} 不該 preventDefault`);
  }
});
