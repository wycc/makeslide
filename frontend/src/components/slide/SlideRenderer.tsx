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
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          border: '4px solid #ef4444',
          borderRadius: '8px',
          boxShadow: '0 0 16px rgba(239, 68, 68, 0.7)',
        }}
      />
    );
  }
  if (effect.type === 'spotlight') {
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          borderRadius: '50%',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
        }}
      />
    );
  }
  if (effect.type === 'pointer') {
    return (
      <div
        data-effect-id={effect.id}
        style={{
          position: 'absolute',
          left: `${xPct}%`,
          top: `${yPct}%`,
          width: '2.25rem',
          height: '2.25rem',
          transform: 'translate(-50%, -50%)',
          opacity: 0,
          pointerEvents: 'none',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(244,63,94,0.95) 0%, rgba(244,63,94,0.45) 55%, transparent 80%)',
          boxShadow: '0 0 12px 2px rgba(244,63,94,0.8)',
        }}
      />
    );
  }
  if (effect.type === 'text-callout') {
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.5em 0.75em',
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.85)',
          color: '#f8fafc',
          fontSize: '1.25rem',
          fontWeight: 600,
          textAlign: 'center',
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
    const stroke = '#f43f5e';
    const markerId = `shape-arrowhead-${effect.id}`;
    let preserveAspectRatio = 'none';
    let shapeContent: ReactNode;
    if (shapeKind === 'circle') {
      preserveAspectRatio = 'xMidYMid meet';
      shapeContent = <circle cx="50" cy="50" r="46" fill="none" stroke={stroke} strokeWidth="5" />;
    } else if (shapeKind === 'ellipse') {
      shapeContent = <ellipse cx="50" cy="50" rx="46" ry="46" fill="none" stroke={stroke} strokeWidth="5" />;
    } else if (shapeKind === 'arrow') {
      shapeContent = (
        <>
          <defs>
            <marker id={markerId} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill={stroke} />
            </marker>
          </defs>
          <line x1="8" y1="92" x2="88" y2="8" stroke={stroke} strokeWidth="6" markerEnd={`url(#${markerId})`} />
        </>
      );
    } else {
      shapeContent = <rect x="4" y="4" width="92" height="92" rx="6" fill="none" stroke={stroke} strokeWidth="5" />;
    }
    return (
      <svg data-effect-id={effect.id} viewBox="0 0 100 100" preserveAspectRatio={preserveAspectRatio} style={{ ...position, overflow: 'visible' }}>
        {shapeContent}
      </svg>
    );
  }
  if (effect.type === 'step-list') {
    const items = (effect.items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    return (
      <div
        data-effect-id={effect.id}
        style={{
          ...position,
          display: 'flex',
          alignItems: 'center',
          padding: '0.5em 0.75em',
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.85)',
          color: '#f8fafc',
          overflow: 'hidden',
        }}
      >
        <ul style={{ margin: 0, paddingLeft: '1.25em', listStyle: 'disc', fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.5 }}>
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
    return (
      <img
        data-effect-id={effect.id}
        src={url}
        alt=""
        draggable={false}
        style={{ ...position, objectFit: 'contain' }}
      />
    );
  }
  if (effect.type === 'formula') {
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
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.85)',
          color: '#f8fafc',
          overflow: 'hidden',
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
