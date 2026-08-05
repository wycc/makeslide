import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { menuKeyAction, menuOpenAction, shouldPreventDefault } from './menuNavigation';

/**
 * 一顆按鈕加一個下拉選單（WAI-ARIA menu button）。
 *
 * 全庫原本沒有可重用的選單元件，於是每個「一堆按鈕」的地方都只能平鋪——首頁清單上方
 * 因此在 1440px 下就已經擠到折行。這個元件是把那一區收斂起來的前提。
 *
 * 無障礙從一開始就做進來（role/aria、方向鍵、Esc 還焦點），不留給之後補：全庫目前
 * 只有 174 個 aria-*，事後補的成本遠高於現在寫進去。
 */

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** 破壞性動作（例如刪除）會以警示色呈現。 */
  danger?: boolean;
  /** 顯示在項目左側的小圖示或 emoji。 */
  icon?: ReactNode;
  /** 在這個項目之上畫一條分隔線，用來把不同性質的動作分組。 */
  separatorBefore?: boolean;
}

interface MenuProps {
  /** 觸發按鈕的內容。 */
  trigger: ReactNode;
  items: MenuItem[];
  /** 觸發按鈕的可及名稱；trigger 只有圖示時必填。 */
  label: string;
  /** 觸發按鈕的樣式，預設為次要樣式。 */
  triggerClassName?: string;
  /** 選單相對於觸發按鈕靠左或靠右對齊，預設靠右（適合放在版面右側的按鈕）。 */
  align?: 'left' | 'right';
  /** 整顆停用（例如正在上傳時）。停用時連選單都打不開，而不是打開後每一項都是灰的。 */
  disabled?: boolean;
}

export default function Menu({ trigger, items, label, triggerClassName, align = 'right', disabled = false }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // 點選單以外的地方關閉。用 pointerdown 而不是 click，否則在按下去到放開之間
  // 版面若有變動，click 可能落在別的元素上而收不到。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // 焦點跟著 activeIndex 走，讓螢幕閱讀器唸出目前停在哪一項。
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (open || disabled) return; // 開啟時由選單自己處理
    const action = menuOpenAction(event.key, items.length);
    if (!action.open) return;
    if (shouldPreventDefault(event.key) || event.key === 'Enter') event.preventDefault();
    setOpen(true);
    setActiveIndex(action.index);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const action = menuKeyAction(event.key, activeIndex, items.length);
    if (action.kind === 'none') return;
    if (shouldPreventDefault(event.key)) event.preventDefault();
    if (action.kind === 'move') {
      setActiveIndex(action.index);
      return;
    }
    if (action.kind === 'close') {
      close(action.restoreFocus);
      return;
    }
    if (action.kind === 'activate') {
      // Enter/Space 讓瀏覽器自己觸發按鈕的 click，行為與滑鼠一致。
      return;
    }
  };

  const select = (item: MenuItem): void => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={handleTriggerKeyDown}
        className={
          triggerClassName
          ?? 'inline-flex items-center gap-1 rounded-md border border-border bg-surface/70 px-3 py-2 text-sm text-text hover:bg-border hover:text-bg dark:text-white'
        }
      >
        {trigger}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          className={`absolute z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item, index) => (
            <div key={item.key}>
              {item.separatorBefore && <div role="separator" className="my-1 h-px bg-border" />}
              <button
                ref={(el) => { itemRefs.current[index] = el; }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                // 選單自己管焦點：只有目前這一項在 Tab 序列上，其餘用方向鍵到達。
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => select(item)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.danger
                    ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
                    : 'text-text hover:bg-border hover:text-bg dark:text-white dark:hover:text-white'
                }`}
              >
                {item.icon && <span aria-hidden="true">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
