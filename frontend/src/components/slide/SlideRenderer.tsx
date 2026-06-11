import { useRef } from 'react';
import type { CSSProperties, ImgHTMLAttributes, ReactNode, Ref } from 'react';
import type { SlideAnimationSpec, SlideRenderType } from '../../types';
import { hasPlayableAnimation } from '../../lib/animationSpec';
import { useGsapSlideTimeline } from './useGsapSlideTimeline';

export interface SlideRendererProps {
  renderType: SlideRenderType | undefined;
  /** 動畫規格；由呼叫端（context）提供，renderer 不自行 fetch。 */
  spec: SlideAnimationSpec | null;
  /** 換頁時變更（例如 `${pdfId}:${page_number}`），用於重建 timeline。 */
  pageKey: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
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
      </div>
      {overlay}
    </div>
  );
}
