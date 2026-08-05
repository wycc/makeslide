import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { menuKeyAction, menuOpenAction, shouldPreventDefault } from './menuNavigation';
import { menuPanelPosition, type PanelPosition } from './menuPosition';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
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
      const target = event.target as Node;
      // 面板 portal 到 body 之後就不再是 containerRef 的 DOM 子孫了——只檢查 container
      // 的話，點選單項目會被當成「點到外面」而先把選單關掉。
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  /*
    面板量到實際尺寸後才定位（`useLayoutEffect`，在瀏覽器繪製前完成，不會看到跳動）。
    先以 visibility:hidden 渲染一次拿到寬高，再算座標——不然靠右對齊、或視窗下方空間
    不足時，第一幀會出現在錯的位置。
  */
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const t = trigger.getBoundingClientRect();
    setPosition(menuPanelPosition(
      { top: t.top, left: t.left, right: t.right, bottom: t.bottom, width: t.width, height: t.height },
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      align,
    ));
  }, [open, align, items.length]);

  /*
    捲動或改變視窗大小時直接關閉，而不是重算位置。
    面板是 fixed 定位在 body 上，頁面一捲它就會留在原地、和觸發按鈕分家；
    重算會需要追蹤所有可捲動的祖先，對一個選單來說不值得——關掉它更符合預期。
  */
  useEffect(() => {
    if (!open) return;
    const onViewportChange = (): void => close(false);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open, close]);

  // 焦點跟著 activeIndex 走，讓螢幕閱讀器唸出目前停在哪一項。
  // 必須等 position 算出來：面板在定位前是 visibility:hidden，而隱藏的元素聚焦不了，
  // 用鍵盤開啟時第一項就不會拿到焦點。
  useEffect(() => {
    if (!open || activeIndex < 0 || !position) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex, position]);

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

      {open && createPortal(
        /*
          掛到 document.body：留在原地的話，面板會被祖先的 stacking context 關住。
          首頁 header 有 `backdrop-blur`，而 `backdrop-filter` 會建立 stacking context——
          面板的 z-50 只在 header 內部有效，於是被頁面稍後出現的內容（例如篩選列的輸入框）
          蓋住。portal 之後就沒有這個問題，也不必要求每個放 Menu 的容器自己去調 z-index。
        */
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            maxHeight: position?.maxHeight,
            // 還沒量到尺寸前先藏起來，避免第一幀閃在左上角。
            visibility: position ? 'visible' : 'hidden',
          }}
          ref={panelRef}
          className="fixed z-[200] min-w-[12rem] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
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
        </div>,
        document.body,
      )}
    </div>
  );
}
