import { useRef } from 'react';
import type { CSSProperties, ImgHTMLAttributes, ReactNode, Ref } from 'react';
import katex from 'katex';
import type { SlideAnimationEffect, SlideAnimationSpec, SlideRenderType } from '../../types';
import {
  OVERLAY_EFFECT_TYPES,
  buildCustomScriptSandboxDoc,
  customScriptDurationSeconds,
  getFocusEffectParams,
  getShapeKind,
  hasPlayableAnimation,
} from '../../lib/animationSpec';
import { useGsapSlideTimeline } from './useGsapSlideTimeline';

/** 套用 highlight-box / spotlight / text-callout 效果的疊加層，由 buildGsapTimeline 透過 data-effect-id 抓取並控制淡入。 */
function EffectOverlay({
  effect,
  resolveFigureImageUrl,
}: {
  effect: SlideAnimationEffect;
  /** 將 `overlay-image` 效果的 `figureId` 解析為可顯示的圖片網址；未提供時 `overlay-image` 不會渲染。 */
  resolveFigureImageUrl?: (figureId: string) => string;
}) {
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
    const boxShadow = hOuter
      ? `0 0 0 2px ${hOuter}, 0 0 ${hBw * 4}px ${hColor}b3`
      : `0 0 ${hBw * 4}px ${hColor}b3`;
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          border: `${hBw}px solid ${hColor}`,
          borderRadius: `${hBr}px`,
          boxShadow,
        }}
      />
    );
  }
  if (effect.type === 'spotlight') {
    const spColor = effect.spotlightColor ?? '#000000';
    const spOpacity = effect.spotlightOpacity ?? 0.6;
    const spSoft = effect.spotlightSoftEdge ?? 0;
    const spR = parseInt(spColor.slice(1, 3), 16);
    const spG = parseInt(spColor.slice(3, 5), 16);
    const spB = parseInt(spColor.slice(5, 7), 16);
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          borderRadius: '50%',
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
    const tcFontSize = `${effect.textCalloutFontSize ?? 1.25}rem`;
    const tcBr = `${effect.textCalloutBorderRadius ?? 8}px`;
    const tcAlign = effect.textCalloutAlign ?? 'center';
    const tcJustify = tcAlign === 'left' ? 'flex-start' : tcAlign === 'right' ? 'flex-end' : 'center';
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          justifyContent: tcJustify,
          padding: '0.5em 0.75em',
          borderRadius: tcBr,
          background: tcBg,
          color: tcText,
          fontSize: tcFontSize,
          fontWeight: 600,
          textAlign: tcAlign,
          overflow: 'hidden',
          wordBreak: 'break-word',
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
    const markerId = `shape-arrowhead-${effect.id}`;
    let preserveAspectRatio = 'none';
    let shapeContent: ReactNode;
    if (shapeKind === 'circle') {
      preserveAspectRatio = 'xMidYMid meet';
      shapeContent = <circle cx="50" cy="50" r="46" fill={fill} stroke={stroke} strokeWidth={sw} />;
    } else if (shapeKind === 'ellipse') {
      shapeContent = <ellipse cx="50" cy="50" rx="46" ry="46" fill={fill} stroke={stroke} strokeWidth={sw} />;
    } else if (shapeKind === 'arrow') {
      shapeContent = (
        <>
          <defs>
            <marker id={markerId} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill={stroke} />
            </marker>
          </defs>
          <line x1="8" y1="92" x2="88" y2="8" stroke={stroke} strokeWidth={sw + 1} markerEnd={`url(#${markerId})`} />
        </>
      );
    } else {
      shapeContent = <rect x="4" y="4" width="92" height="92" rx="6" fill={fill} stroke={stroke} strokeWidth={sw} />;
    }
    return (
      <svg data-effect-id={effect.id} viewBox="0 0 100 100" preserveAspectRatio={preserveAspectRatio} style={{ ...position, overflow: 'visible', opacity: shapeOp }}>
        {shapeContent}
      </svg>
    );
  }
  if (effect.type === 'step-list') {
    const items = (effect.items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    const bgColor = effect.stepListBgColor ?? '#1e293b';
    const textColor = effect.stepListTextColor ?? '#f1f5f9';
    const slFontSize = `${effect.stepListFontSize ?? 1.1}rem`;
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          padding: '0.5em 0.75em',
          borderRadius: '8px',
          background: bgColor,
          color: textColor,
          overflow: 'hidden',
        }}
      >
        <ul style={{ margin: 0, paddingLeft: '1.25em', listStyle: 'disc', fontSize: slFontSize, fontWeight: 600, lineHeight: 1.5 }}>
          {items.map((item, index) => (
            <li key={index} style={{ wordBreak: 'break-word' }}>
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (effect.type === 'overlay-image') {
    const url = effect.figureId ? resolveFigureImageUrl?.(effect.figureId) : undefined;
    if (!url) return null;
    const imgOpacity = effect.overlayImageOpacity ?? 1;
    return (
      <img
        data-effect-id={effect.id}
        src={url}
        alt=""
        draggable={false}
        style={{ ...position, objectFit: 'contain', opacity: imgOpacity }}
      />
    );
  }
  if (effect.type === 'formula') {
    const fontSizeEm = effect.formulaFontSize ?? 1.5;
    const fBg = effect.formulaBgColor ?? '#0f172a';
    const fText = effect.formulaTextColor ?? '#f8fafc';
    const fBr = `${effect.formulaBorderRadius ?? 8}px`;
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
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
  /** 疊在投影片上、需跟著動畫移動的內容（手寫層、選取框）。 */
  children?: ReactNode;
  /** 固定在外框、不跟著動畫移動的內容（例如版本按鈕）。 */
  overlay?: ReactNode;
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
  children,
  overlay,
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

  if (!animated || animationFailed) {
    return (
      <div className={wrapperClassName} style={wrapperStyle}>
        {img}
        {overlay}
        {children}
      </div>
    );
  }

  return (
    <div className={`${wrapperClassName ?? ''} overflow-hidden`} style={wrapperStyle}>
      <div ref={stageRef} className="relative" style={{ lineHeight: 0, willChange: 'transform, opacity' }}>
        {img}
        {children}
        {spec?.effects
          .filter((effect) => OVERLAY_EFFECT_TYPES.includes(effect.type))
          .map((effect) => (
            <EffectOverlay key={effect.id} effect={effect} resolveFigureImageUrl={resolveFigureImageUrl} />
          ))}
      </div>
      {overlay}
    </div>
  );
}
