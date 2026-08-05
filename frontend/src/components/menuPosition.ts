/**
 * 下拉面板的定位計算。
 *
 * 面板改用 portal 掛到 `document.body`（見 Menu.tsx 的說明），因此不再能靠
 * `absolute` 相對於觸發按鈕排版，得自己算座標。這裡是純算術，抽出來單獨測——
 * 邊界情況（貼著視窗右緣、下方空間不足）用眼睛看很難全部涵蓋。
 */

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PanelPosition {
  top: number;
  left: number;
  /** 面板可用的最大高度；下方空間不足時會縮小並讓面板自己捲動。 */
  maxHeight: number;
}

const GAP = 4;
/** 與視窗邊緣至少留這麼多，免得面板貼死在邊上。 */
const MARGIN = 8;
/** 低於這個高度就不值得往下開了，改為往上開。 */
const MIN_BELOW = 120;

/**
 * 算出面板該放在哪裡。
 *
 * - 預設開在觸發按鈕下方；下方空間不足且上方比較寬裕時改為往上開。
 * - 水平方向依 `align` 對齊觸發按鈕的左緣或右緣，再夾回視窗範圍內——
 *   靠右對齊的選單放在版面右側時，很容易算出負的或超出視窗的 left。
 */
export function menuPanelPosition(
  trigger: Rect,
  panel: { width: number; height: number },
  viewport: Viewport,
  align: 'left' | 'right',
): PanelPosition {
  const spaceBelow = viewport.height - trigger.bottom - GAP - MARGIN;
  const spaceAbove = trigger.top - GAP - MARGIN;
  const openUpwards = spaceBelow < Math.min(panel.height, MIN_BELOW) && spaceAbove > spaceBelow;

  const maxHeight = Math.max(MIN_BELOW, openUpwards ? spaceAbove : spaceBelow);
  const height = Math.min(panel.height, maxHeight);
  const top = openUpwards ? trigger.top - GAP - height : trigger.bottom + GAP;

  const rawLeft = align === 'right' ? trigger.right - panel.width : trigger.left;
  const maxLeft = viewport.width - panel.width - MARGIN;
  // maxLeft 可能是負的（面板比視窗還寬），所以先夾上界再夾下界，順序不能反。
  const left = Math.max(MARGIN, Math.min(rawLeft, maxLeft));

  return { top, left, maxHeight };
}
