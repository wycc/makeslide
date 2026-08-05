/**
 * 選單鍵盤巡覽的決策邏輯。
 *
 * 抽成純函式是因為這裡的規則比看起來多（環繞、Home/End、哪些鍵該吃掉而不讓頁面捲動），
 * 而且一旦寫錯，症狀是「鍵盤使用者被困在選單裡」——這種 bug 用眼睛看畫面是看不出來的。
 */

/** 一次鍵盤操作對選單的影響。 */
export type MenuKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'close'; restoreFocus: boolean }
  | { kind: 'activate' }
  | { kind: 'none' };

/**
 * 選單開啟時按下某個鍵要做什麼。
 *
 * - ↑/↓ 在項目間移動並**環繞**（最後一項再按 ↓ 回到第一項）——選單項目少，環繞比停在邊界快。
 * - Home/End 跳到頭尾。
 * - Escape 關閉並把焦點還給觸發按鈕，否則焦點會掉回 body，鍵盤使用者得從頭 Tab 一次。
 * - Tab 關閉但**不**搶焦點，讓瀏覽器把焦點帶到下一個元素——這是 menu 而不是 dialog，
 *   不該把使用者困在裡面。
 */
export function menuKeyAction(key: string, currentIndex: number, itemCount: number): MenuKeyAction {
  if (itemCount <= 0) {
    return key === 'Escape' ? { kind: 'close', restoreFocus: true } : { kind: 'none' };
  }
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', index: (currentIndex + 1) % itemCount };
    case 'ArrowUp':
      // 尚未選定任何項目時（currentIndex 為 -1，焦點還在觸發按鈕上）往上應該落在
      // 最後一項。走一般的環繞算式會得到 itemCount-2，也就是倒數第二項——在三項的
      // 選單上看起來只是「跳錯一格」，很難察覺。
      return { kind: 'move', index: currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount };
    case 'Home':
      return { kind: 'move', index: 0 };
    case 'End':
      return { kind: 'move', index: itemCount - 1 };
    case 'Escape':
      return { kind: 'close', restoreFocus: true };
    case 'Tab':
      return { kind: 'close', restoreFocus: false };
    case 'Enter':
    case ' ':
      return currentIndex >= 0 ? { kind: 'activate' } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

/**
 * 選單關閉時，觸發按鈕上按下某個鍵是否該開啟選單，以及開啟後焦點落在哪一項。
 *
 * ↑ 開啟時落在**最後一項**是既有慣例（WAI-ARIA menu button），對「最後一個選項是常用的」
 * 這種選單特別省事。用滑鼠點開時回 -1，讓焦點留在按鈕上——否則點開選單會看到一個
 * 沒人要求的 focus ring。
 */
export function menuOpenAction(key: string, itemCount: number): { open: boolean; index: number } {
  if (itemCount <= 0) return { open: false, index: -1 };
  if (key === 'ArrowDown' || key === 'Enter' || key === ' ') return { open: true, index: 0 };
  if (key === 'ArrowUp') return { open: true, index: itemCount - 1 };
  return { open: false, index: -1 };
}

/** 這個鍵在選單開啟時是否該 preventDefault（避免頁面跟著捲動或送出表單）。 */
export function shouldPreventDefault(key: string): boolean {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End' || key === ' ';
}
