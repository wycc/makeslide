import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ImgHTMLAttributes, ReactNode, Ref } from 'react';
import katex from 'katex';
import type { SlideAnimationEffect, SlideAnimationSpec, SlideRenderType } from '../../types';
import type { ReactSlideConfig, SlideElementSelection, SlideTheme } from '../../lib/reactSlide';
import { ReactSlideFrame } from './ReactSlideFrame';
import {
  OVERLAY_EFFECT_TYPES,
  buildCustomScriptSandboxDoc,
  customScriptDurationSeconds,
  getFocusEffectParams,
  getShapeKind,
  hasPlayableAnimation,
} from '../../lib/animationSpec';
import { useI18n } from '../../i18n';
import { useGsapSlideTimeline } from './useGsapSlideTimeline';
import { WRAPPING_OVERLAY_TEXT_STYLE } from './overlayTextStyle';
import { NotebookPanel } from './NotebookPanel';
import {
  activeNotebookHost,
  registerNotebookHost,
  subscribeNotebookHosts,
} from './notebookHostStore';

// Overlay animation text uses `em`/em-derived sizes that inherit the stage's
// font-size. We set the stage font-size proportional to its rendered width so
// text keeps the same proportion across resolutions (editor preview, normal
// playback, fullscreen). At this reference width the scale is 1 (i.e. 1em≈16px).
const ANIMATION_TEXT_REFERENCE_WIDTH = 960;
const ANIMATION_TEXT_BASE_PX = 16;

const TEXT_CALLOUT_PADDING: Record<NonNullable<SlideAnimationEffect['textCalloutPadding']>, string> = {
  sm: '0.25em 0.5em',
  md: '0.5em 0.75em',
  lg: '0.75em 1.25em',
};

/** 套用 highlight-box / spotlight / text-callout 效果的疊加層，由 buildGsapTimeline 透過 data-effect-id 抓取並控制淡入。 */
function EffectOverlay({
  effect,
  resolveFigureImageUrl,
}: {
  effect: SlideAnimationEffect;
  /** 將 `overlay-image` 效果的 `figureId` 解析為可顯示的圖片網址；未提供時 `overlay-image` 不會渲染。 */
  resolveFigureImageUrl?: (figureId: string) => string;
}) {
  const { t } = useI18n();
  const { xPct, yPct, widthPct, heightPct } = getFocusEffectParams(effect);
  const position: CSSProperties = {
    position: 'absolute',
    left: `${xPct}%`,
    top: `${yPct}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    opacity: 0,
    pointerEvents: 'none',
  };
  if (effect.type === 'highlight-box') {
    const hColor = effect.highlightColor ?? '#ef4444';
    const hBw = effect.highlightBorderWidth ?? 4;
    const hBr = effect.highlightBorderRadius ?? 8;
    const hOuter = effect.highlightOuterColor;
    const hFill = effect.highlightFillColor ?? 'transparent';
    const hStyle = effect.highlightBorderStyle ?? 'solid';
    const hDropShadow = effect.highlightShadow ? ', 0 0 20px rgba(0,0,0,0.5)' : '';
    const boxShadow = hOuter
      ? `0 0 0 2px ${hOuter}, 0 0 ${hBw * 4}px ${hColor}b3${hDropShadow}`
      : `0 0 ${hBw * 4}px ${hColor}b3${hDropShadow}`;
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          border: `${hBw}px ${hStyle} ${hColor}`,
          borderRadius: `${hBr}px`,
          boxShadow,
          backgroundColor: hFill,
        }}
      />
    );
  }
  if (effect.type === 'spotlight') {
    const spColor = effect.spotlightColor ?? '#000000';
    const spOpacity = effect.spotlightOpacity ?? 0.6;
    const spSoft = effect.spotlightSoftEdge ?? 0;
    const spShape = effect.spotlightShape ?? 'circle';
    const spBr = spShape === 'rect' ? `${effect.spotlightBorderRadius ?? 8}px` : '50%';
    const spR = parseInt(spColor.slice(1, 3), 16);
    const spG = parseInt(spColor.slice(3, 5), 16);
    const spB = parseInt(spColor.slice(5, 7), 16);
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          borderRadius: spBr,
          boxShadow: `0 0 0 9999px rgba(${spR}, ${spG}, ${spB}, ${spOpacity})`,
          ...(spSoft > 0 ? { filter: `blur(${spSoft}px)` } : {}),
        }}
      />
    );
  }
  if (effect.type === 'pointer') {
    const angleDeg = effect.angle ?? 0;
    const pColor = effect.pointerColor ?? '#f43f5e';
    const pSize = `${effect.pointerSize ?? 2.5}rem`;
    const pShape = effect.pointerShape ?? 'arrow';
    const pR = parseInt(pColor.slice(1, 3), 16);
    const pG = parseInt(pColor.slice(3, 5), 16);
    const pB = parseInt(pColor.slice(5, 7), 16);
    const svgContent = pShape === 'dot'
      ? <circle cx="12" cy="12" r="10" fill={`rgba(${pR},${pG},${pB},0.95)`} />
      : pShape === 'cross'
        ? (
          <>
            <line x1="2" y1="12" x2="22" y2="12" stroke={`rgba(${pR},${pG},${pB},0.95)`} strokeWidth="2.5" strokeLinecap="round" />
            <line x1="12" y1="2" x2="12" y2="22" stroke={`rgba(${pR},${pG},${pB},0.95)`} strokeWidth="2.5" strokeLinecap="round" />
          </>
        )
        : <path d="M4 0 L4 20 L8 16 L11 23 L13 22 L10 15 L15 15 Z" fill={`rgba(${pR},${pG},${pB},0.95)`} />;
    return (
      <div
        data-effect-id={effect.id}
        style={{
          position: 'absolute',
          left: `${xPct}%`,
          top: `${yPct}%`,
          width: pSize,
          height: pSize,
          transform: `translate(-50%, -50%)${pShape === 'arrow' ? ` rotate(${angleDeg}deg)` : ''}`,
          opacity: 0,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 24 24" width="100%" height="100%" style={{ filter: `drop-shadow(0 0 6px rgba(${pR},${pG},${pB},0.9))` }}>
          {svgContent}
        </svg>
      </div>
    );
  }
  if (effect.type === 'text-callout') {
    const tcBg = effect.textCalloutBgColor ?? '#0f172a';
    const tcText = effect.textCalloutTextColor ?? '#f8fafc';
    const tcFontSize = `${effect.textCalloutFontSize ?? 1.25}em`;
    const tcBr = `${effect.textCalloutBorderRadius ?? 8}px`;
    const tcAlign = effect.textCalloutAlign ?? 'center';
    const tcJustify = tcAlign === 'left' ? 'flex-start' : tcAlign === 'right' ? 'flex-end' : 'center';
    const tcBorder = effect.textCalloutBorderColor ? `2px solid ${effect.textCalloutBorderColor}` : undefined;
    const tcShadow = effect.textCalloutShadow ? '0 4px 16px rgba(0,0,0,0.4)' : undefined;
    const tcMaxW = effect.textCalloutMaxWidth ? `${effect.textCalloutMaxWidth}vw` : undefined;
    const tcPadding = TEXT_CALLOUT_PADDING[effect.textCalloutPadding ?? 'md'];
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          justifyContent: tcJustify,
          padding: tcPadding,
          borderRadius: tcBr,
          background: tcBg,
          color: tcText,
          fontSize: tcFontSize,
          fontWeight: 600,
          textAlign: tcAlign,
          overflow: 'hidden',
          ...WRAPPING_OVERLAY_TEXT_STYLE,
          ...(tcBorder ? { border: tcBorder } : {}),
          ...(tcShadow ? { boxShadow: tcShadow } : {}),
          ...(tcMaxW ? { maxWidth: tcMaxW } : {}),
        }}
      >
        {effect.text}
      </div>
    );
  }
  if (effect.type === 'shape') {
    const shapeKind = getShapeKind(effect);
    const stroke = effect.color ?? '#f43f5e';
    const sw = effect.strokeWidth ?? 5;
    const fill = effect.shapeFillColor ?? 'none';
    const shapeOp = effect.shapeOpacity ?? 1;
    const sda = effect.shapeDashArray && effect.shapeDashArray.trim() ? effect.shapeDashArray.trim() : undefined;
    const shapeFilter = effect.shapeGlow ? `drop-shadow(0 0 8px ${stroke})` : undefined;
    const markerId = `shape-arrowhead-${effect.id}`;
    let preserveAspectRatio = 'none';
    let shapeContent: ReactNode;
    if (shapeKind === 'circle') {
      preserveAspectRatio = 'xMidYMid meet';
      shapeContent = <circle cx="50" cy="50" r="46" fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={sda} />;
    } else if (shapeKind === 'ellipse') {
      shapeContent = <ellipse cx="50" cy="50" rx="46" ry="46" fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={sda} />;
    } else if (shapeKind === 'arrow') {
      shapeContent = (
        <>
          <defs>
            <marker id={markerId} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill={stroke} />
            </marker>
          </defs>
          <line x1="8" y1="92" x2="88" y2="8" stroke={stroke} strokeWidth={sw + 1} strokeDasharray={sda} markerEnd={`url(#${markerId})`} />
        </>
      );
    } else if (shapeKind === 'line') {
      shapeContent = <line x1="8" y1="92" x2="92" y2="8" stroke={stroke} strokeWidth={sw} strokeDasharray={sda} strokeLinecap="round" />;
    } else if (shapeKind === 'triangle') {
      shapeContent = <polygon points="50,4 96,92 4,92" fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={sda} strokeLinejoin="round" />;
    } else if (shapeKind === 'star') {
      shapeContent = <polygon points="50,4 60.58,35.44 93.75,35.79 67.12,55.56 77.04,87.21 50,68 22.96,87.21 32.88,55.56 6.25,35.79 39.42,35.44" fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={sda} strokeLinejoin="round" />;
    } else if (shapeKind === 'hexagon') {
      shapeContent = <polygon points="50,4 89.84,27 89.84,73 50,96 10.16,73 10.16,27" fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={sda} strokeLinejoin="round" />;
    } else {
      shapeContent = <rect x="4" y="4" width="92" height="92" rx={effect.shapeRectRadius ?? 6} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={sda} />;
    }
    return (
      <svg
        data-effect-id={effect.id}
        viewBox="0 0 100 100"
        preserveAspectRatio={preserveAspectRatio}
        style={{ ...position, overflow: 'visible', opacity: shapeOp, ...(shapeFilter ? { filter: shapeFilter } : {}) }}
      >
        {shapeContent}
      </svg>
    );
  }
  if (effect.type === 'step-list') {
    const items = (effect.items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    const bgColor = effect.stepListBgColor ?? '#1e293b';
    const textColor = effect.stepListTextColor ?? '#f1f5f9';
    const slFontSize = `${effect.stepListFontSize ?? 1.1}em`;
    const slBr = `${effect.stepListBorderRadius ?? 8}px`;
    const slBorder = effect.stepListBorderColor ? `2px solid ${effect.stepListBorderColor}` : undefined;
    const slBullet = effect.stepListBulletStyle ?? 'disc';
    const highlightIndex = effect.stepListHighlightIndex;
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          padding: '0.5em 0.75em',
          borderRadius: slBr,
          background: bgColor,
          color: textColor,
          overflow: 'hidden',
          ...WRAPPING_OVERLAY_TEXT_STYLE,
          ...(slBorder ? { border: slBorder } : {}),
        }}
      >
        <ul style={{ margin: 0, paddingLeft: slBullet === 'none' ? 0 : '1.25em', listStyle: slBullet, fontSize: slFontSize, fontWeight: 600, lineHeight: 1.5, minWidth: 0 }}>
          {items.map((item, index) => {
            const isHighlighted = index === highlightIndex;
            return (
              <li
                key={index}
                style={{
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  ...(isHighlighted
                    ? {
                      borderLeft: `3px solid ${textColor}`,
                      color: textColor,
                      fontWeight: 800,
                      paddingLeft: '0.5em',
                    }
                    : {}),
                }}
              >
                {item}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (effect.type === 'overlay-image') {
    const url = effect.figureId ? resolveFigureImageUrl?.(effect.figureId) : undefined;
    if (!url) return null;
    const imgOpacity = effect.overlayImageOpacity ?? 1;
    const imgBr = effect.overlayImageBorderRadius ? `${effect.overlayImageBorderRadius}px` : undefined;
    const imgShadow = effect.overlayImageShadow ? '0 4px 20px rgba(0,0,0,0.5)' : undefined;
    return (
      <img
        data-effect-id={effect.id}
        src={url}
        alt=""
        draggable={false}
        style={{ ...position, objectFit: 'contain', opacity: imgOpacity, ...(imgBr ? { borderRadius: imgBr } : {}), ...(imgShadow ? { boxShadow: imgShadow } : {}) }}
      />
    );
  }
  if (effect.type === 'formula') {
    const fontSizeEm = effect.formulaFontSize ?? 1.5;
    const fBg = effect.formulaBgColor ?? '#0f172a';
    const fText = effect.formulaTextColor ?? '#f8fafc';
    const fBr = `${effect.formulaBorderRadius ?? 8}px`;
    const fBorder = effect.formulaBorderColor ? `2px solid ${effect.formulaBorderColor}` : undefined;
    const fShadow = effect.formulaShadow ? '0 4px 16px rgba(0,0,0,0.4)' : undefined;
    const html = katex.renderToString(effect.formula ?? '', { throwOnError: false, displayMode: true });
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.5em 0.75em',
          borderRadius: fBr,
          background: fBg,
          color: fText,
          overflow: 'hidden',
          fontSize: `${fontSizeEm}em`,
          ...(fBorder ? { border: fBorder } : {}),
          ...(fShadow ? { boxShadow: fShadow } : {}),
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (effect.type === 'pause-playback') {
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.75em 1em',
          borderRadius: 14,
          border: '2px solid rgba(125, 211, 252, 0.75)',
          background: 'rgba(15, 23, 42, 0.88)',
          color: '#e0f2fe',
          fontSize: '1.6em',
          fontWeight: 800,
          textAlign: 'center',
          ...WRAPPING_OVERLAY_TEXT_STYLE,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 28px rgba(56,189,248,0.35)',
        }}
      >
        {effect.text?.trim() || t('play.animation.defaultPausePlaybackText')}
      </div>
    );
  }
  if (effect.type === 'realtime-poll') {
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.75em 1em',
          borderRadius: 14,
          border: '2px solid rgba(232, 121, 249, 0.75)',
          background: 'rgba(15, 23, 42, 0.88)',
          color: '#fdf4ff',
          fontSize: '1.6em',
          fontWeight: 800,
          textAlign: 'center',
          ...WRAPPING_OVERLAY_TEXT_STYLE,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 28px rgba(217,70,239,0.35)',
        }}
      >
        {effect.text?.trim() || t('play.animation.defaultRealtimePollText')}
      </div>
    );
  }
  if (effect.type === 'custom-script') {
    return (
      <iframe
        key={`${effect.id}:${effect.code ?? ''}`}
        data-effect-id={effect.id}
        title="custom-script animation"
        sandbox="allow-scripts"
        srcDoc={buildCustomScriptSandboxDoc(effect.code ?? '', customScriptDurationSeconds(effect))}
        style={{ ...position, border: 'none', background: 'transparent' }}
      />
    );
  }
  return null;
}

export interface SlideRendererProps {
  renderType: SlideRenderType | undefined;
  /** 動畫規格；由呼叫端（context）提供，renderer 不自行 fetch。 */
  spec: SlideAnimationSpec | null;
  /** 換頁時變更（例如 `${pdfId}:${page_number}`），用於重建 timeline。 */
  pageKey: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  /** 將 `overlay-image` 效果的 `figureId` 解析為可顯示的圖片網址；未提供時 `overlay-image` 不會渲染。 */
  resolveFigureImageUrl?: (figureId: string) => string;
  onAnimationError?: () => void;
  wrapperClassName?: string;
  wrapperStyle?: CSSProperties;
  src: string;
  alt: string;
  imgClassName?: string;
  imgStyle?: CSSProperties;
  imgRef?: Ref<HTMLImageElement>;
  onImgClick?: () => void;
  imgProps?: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className' | 'style' | 'onClick'>;
  /**
   * 投票 UI 是否已經接手：為 true 時不渲染 `realtime-poll` 的預告 overlay。
   *
   * 那個 overlay 的用途是「即將投票」的預告，內容就是題目本身；投票對話框一開，畫面上
   * 會同時出現兩個寫著同一個問題的框——follower 那端尤其明顯，因為它的播放被停在
   * overlay 完全顯示的那一刻，退場動畫還沒開始跑。
   */
  pollUiActive?: boolean;
  /** 疊在投影片上、需跟著動畫移動的內容（手寫層、選取框）。 */
  children?: ReactNode;
  /** 固定在外框、不跟著動畫移動的內容（例如版本按鈕）。 */
  overlay?: ReactNode;
  /** 掛在最外框的 pointermove（透過事件冒泡收到畫筆層的移動而不攔截它），供旁白錄製記錄游標。 */
  onWrapperPointerMove?: (e: import('react').PointerEvent<HTMLDivElement>) => void;
  /** notebook 頁（render_type==='notebook'）以此判定要顯示 notebook slot；缺任一項時退回圖片。
   *  資料相關 props（shareToken、可否編輯）由 PlayPage 直接交給 NotebookPanelSingleton。 */
  pdfId?: string;
  pageNumber?: number;
  /**
   * React 頁（render_type==='react'）要渲染的內容；與 notebook 相同由呼叫端提供，renderer 不自行 fetch。
   * 缺少 `compiled`（尚未載入或該頁沒有程式碼）時退回圖片。
   */
  reactSlide?: {
    compiled: string;
    theme: SlideTheme;
    config: ReactSlideConfig;
    backgroundUrl?: string;
    /** 編輯區的「點選元素」模式；播放中一律 false，點擊才會落到播放器。 */
    inspect?: boolean;
    onSelect?: (selection: SlideElementSelection) => void;
  };
  /** 沙箱回報執行錯誤時通知呼叫端（編輯區顯示錯誤訊息）。 */
  onReactSlideError?: (message: string) => void;
}

export function SlideRenderer({
  renderType,
  spec,
  pageKey,
  currentTime,
  isPlaying,
  playbackRate,
  resolveFigureImageUrl,
  onAnimationError,
  wrapperClassName,
  wrapperStyle,
  src,
  alt,
  imgClassName,
  imgStyle,
  imgRef,
  onImgClick,
  imgProps,
  pollUiActive = false,
  children,
  overlay,
  onWrapperPointerMove,
  pdfId,
  pageNumber,
  reactSlide,
  onReactSlideError,
}: SlideRendererProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const animated = renderType === 'gsap-image' && hasPlayableAnimation(spec);
  const { animationFailed } = useGsapSlideTimeline({
    stageRef,
    spec: animated ? spec : null,
    pageKey,
    currentTime,
    isPlaying,
    playbackRate,
    onError: onAnimationError,
  });

  // A React page whose sandbox failed falls back to the image until the code changes, so a
  // broken slide never leaves the viewer staring at an empty frame.
  const [reactSlideFailed, setReactSlideFailed] = useState(false);
  useEffect(() => {
    setReactSlideFailed(false);
  }, [reactSlide?.compiled]);
  const handleReactSlideError = useCallback(
    (message: string) => {
      setReactSlideFailed(true);
      onReactSlideError?.(message);
    },
    [onReactSlideError],
  );

  // Track the stage's rendered width so overlay text scales proportionally.
  const [stageWidth, setStageWidth] = useState(0);
  const showStage = animated && !animationFailed;
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !showStage) return;
    if (typeof ResizeObserver === 'undefined') {
      setStageWidth(el.getBoundingClientRect().width);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      setStageWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showStage, pageKey]);
  const stageFontScale = stageWidth > 0 ? stageWidth / ANIMATION_TEXT_REFERENCE_WIDTH : 1;

  const img = (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={imgClassName}
      style={imgStyle}
      onClick={onImgClick}
      draggable={false}
      {...imgProps}
    />
  );

  // Notebook pages render their `.ipynb` instead of the slide image. Requires pdfId +
  // pageNumber to locate the asset; without them we fall through to the image (safe default).
  // Placed after all hooks so hook order stays stable across render-type changes.
  if (renderType === 'notebook' && pdfId && pageNumber != null) {
    // The fullscreen overlay and the always-mounted normal panel must show the SAME
    // NotebookPanel instance (editing drafts, kernel session, cell position live in its
    // state), so this branch only renders an empty slot; NotebookPanelSingleton — mounted
    // once at the PlayPage level — portals the one panel into the active slot.
    const isFullscreen = !wrapperStyle?.maxHeight;
    // In the normal panel the page-corner bookmark/important buttons sit absolutely at the
    // stage's top-left; the notebook fills the stage, so leave a left gutter or they'd cover
    // the toolbar's leftmost controls. Fullscreen has no corner buttons.
    return (
      <div
        className={`${wrapperClassName ?? ''} w-full${isFullscreen ? '' : ' pl-12'}`}
        style={wrapperStyle}
        onPointerMove={onWrapperPointerMove}
      >
        <NotebookSlot fullscreen={isFullscreen} maxHeight={wrapperStyle?.maxHeight} />
        {overlay}
        {children}
      </div>
    );
  }

  // React slide pages render a sandboxed component instead of the image. If the sandbox reported
  // an error (reactSlideFailed) or the compiled code hasn't loaded yet, we fall through to the
  // image — the page keeps its JPG precisely so this fallback shows the slide, not a blank box.
  if (renderType === 'react' && reactSlide?.compiled && !reactSlideFailed) {
    return (
      <div
        className={wrapperClassName}
        // `display: block` + an explicit width overrides the image path's `inline-block`, whose
        // width is decided by its content — with an iframe container asking for `width: 100%`
        // that resolves to zero and the slide renders at scale 0 (present in the DOM, invisible
        // on screen). The height cap moves onto the frame, which fits the canvas to both axes.
        style={{ ...wrapperStyle, display: 'block', width: '100%', maxHeight: undefined }}
        onPointerMove={onWrapperPointerMove}
      >
        <ReactSlideFrame
          compiled={reactSlide.compiled}
          theme={reactSlide.theme}
          config={reactSlide.config}
          backgroundUrl={reactSlide.backgroundUrl}
          inspect={reactSlide.inspect}
          onSelect={reactSlide.onSelect}
          onError={handleReactSlideError}
          maxHeight={wrapperStyle?.maxHeight}
        />
        {children}
        {overlay}
      </div>
    );
  }

  if (!animated || animationFailed) {
    return (
      <div className={wrapperClassName} style={wrapperStyle} onPointerMove={onWrapperPointerMove}>
        {img}
        {overlay}
        {children}
      </div>
    );
  }

  return (
    <div className={`${wrapperClassName ?? ''} overflow-hidden`} style={wrapperStyle} onPointerMove={onWrapperPointerMove}>
      <div ref={stageRef} className="relative" style={{ lineHeight: 0, fontSize: `${ANIMATION_TEXT_BASE_PX * stageFontScale}px`, willChange: 'transform, opacity' }}>
        {img}
        {children}
        {spec?.effects
          .filter((effect) => OVERLAY_EFFECT_TYPES.includes(effect.type))
          .filter((effect) => !(pollUiActive && effect.type === 'realtime-poll'))
          .map((effect) => (
            <EffectOverlay key={effect.id} effect={effect} resolveFigureImageUrl={resolveFigureImageUrl} />
          ))}
      </div>
      {overlay}
    </div>
  );
}

/** Empty container a notebook-page SlideRenderer offers to the shared NotebookPanel. */
function NotebookSlot({ fullscreen, maxHeight }: { fullscreen: boolean; maxHeight?: string | number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerNotebookHost({ el, fullscreen, maxHeight });
  }, [fullscreen, maxHeight]);
  return <div ref={ref} className="w-full" />;
}

export interface NotebookPanelSingletonProps {
  /** True only while the current page is a notebook page; false unmounts the panel. */
  active: boolean;
  pdfId?: string;
  pageNumber?: number;
  shareToken?: string;
  /** deck access_level==='edit' 時允許在 notebook 頁執行 cell（連 Jupyter kernel）。 */
  editable?: boolean;
}

/**
 * The one shared NotebookPanel for the whole play page, mounted once at the PlayPage
 * level so it outlives the fullscreen overlay's mount/unmount. It renders into a
 * detached div that never changes (changing createPortal's container would remount the
 * panel and wipe its editing/kernel state) and only MOVES that div into whichever
 * NotebookSlot is active — DOM reparenting preserves React state, so edits made in
 * fullscreen are still there when the same panel lands back in the normal slot.
 */
export function NotebookPanelSingleton({ active, pdfId, pageNumber, shareToken, editable }: NotebookPanelSingletonProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  if (containerRef.current === null && typeof document !== 'undefined') {
    const el = document.createElement('div');
    el.className = 'w-full';
    containerRef.current = el;
  }
  const host = useSyncExternalStore(subscribeNotebookHosts, activeNotebookHost, () => null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !host) return;
    host.el.appendChild(container);
    return () => {
      if (container.parentNode === host.el) host.el.removeChild(container);
    };
  }, [host]);
  if (!active || !pdfId || pageNumber == null || !containerRef.current) return null;
  // Size the single-cell notebook sensibly in both contexts. In the normal panel the slot
  // carries a window-relative maxHeight: the notebook fits its content and only scrolls past
  // that cap. In fullscreen it fills a large slice of the viewport instead of a tiny strip.
  const style: CSSProperties = host?.fullscreen ? { height: '85vh' } : { maxHeight: host?.maxHeight };
  return createPortal(
    <NotebookPanel
      pdfId={pdfId}
      pageNumber={pageNumber}
      shareToken={shareToken}
      editable={editable}
      fullscreen={Boolean(host?.fullscreen)}
      className="w-full"
      style={style}
    />,
    containerRef.current,
  );
}
