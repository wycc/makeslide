import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  SLIDE_CANVAS_HEIGHT,
  SLIDE_CANVAS_WIDTH,
  backgroundCss,
  buildReactSlideSandboxDoc,
  overlayCss,
  isSlideSandboxMessage,
  slideScale,
  type ReactSlideConfig,
  type SlideElementSelection,
  type SlideTheme,
} from '../../lib/reactSlide';

export interface ReactSlideFrameProps {
  /** esbuild-compiled slide code from the backend. */
  compiled: string;
  theme: SlideTheme;
  config: ReactSlideConfig;
  backgroundUrl?: string;
  /** Click-to-select mode; only the editor turns this on. */
  inspect?: boolean;
  onSelect?: (selection: SlideElementSelection) => void;
  /** Upper bound on the rendered height (the player caps how tall a slide may be). */
  maxHeight?: string | number;
  /** Fired when the sandbox reports a runtime error, so callers can fall back to the page image. */
  onError?: (message: string) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders one React slide page inside a sandboxed iframe (see docs/react-slide-design.md §3.3).
 *
 * The iframe is rebuilt only when the compiled code (or the theme's custom CSS) changes. Theme
 * tokens, the background and per-element overrides are pushed in over `postMessage`, so dragging a
 * font-size slider re-styles the live DOM rather than remounting React on every step.
 *
 * The 1920×1080 canvas is scaled with a CSS transform sized from the container's measured width,
 * which is what lets the same page render identically in the editor preview, the player and
 * fullscreen without any responsive code in the generated component.
 */
export function ReactSlideFrame({
  compiled,
  theme,
  config,
  backgroundUrl,
  inspect = false,
  onSelect,
  maxHeight,
  onError,
  className,
  style,
}: ReactSlideFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);

  // Only the code, the theme's custom CSS and inspect mode force a rebuild. Overrides, token
  // values and the background are pushed into the live sandbox instead, so editing them never
  // remounts the component (which would flash the slide on every slider step).
  const srcDoc = useMemo(
    () => buildReactSlideSandboxDoc({ compiled, theme, config, backgroundUrl, inspect }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the rest streams in live
    [compiled, theme.customCss],
  );

  useEffect(() => {
    setReady(false);
  }, [srcDoc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // The sandbox is an opaque origin, so event.origin is "null" and cannot be used to
      // authenticate the sender; identify the frame by its window handle instead.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      if (!isSlideSandboxMessage(event.data)) return;
      if (event.data.type === 'ms-slide-ready') {
        setReady(true);
      } else if (event.data.type === 'ms-slide-error') {
        onError?.(event.data.message);
      } else if (event.data.type === 'ms-slide-select') {
        onSelect?.(event.data);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect, onError]);

  // Push override edits into the live sandbox (no reload).
  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'ms-slide-overrides', overrides: config.overrides ?? {} },
      '*',
    );
  }, [ready, config.overrides]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'ms-slide-inspect', enabled: inspect }, '*');
  }, [ready, inspect]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'ms-slide-background', background: backgroundCss(config, backgroundUrl), overlay: overlayCss(config) },
      '*',
    );
  }, [ready, config, backgroundUrl]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'ms-slide-theme', tokens: theme.tokens }, '*');
  }, [ready, theme.tokens]);

  // Fit by whichever axis runs out first. Scaling by width alone overflows whenever the player
  // caps the slide's height (`maxHeight`), and scaling by height alone wastes the panel's width.
  const scale = Math.min(slideScale(size.width), size.height > 0 ? size.height / SLIDE_CANVAS_HEIGHT : Infinity);
  // Centre the scaled canvas in the leftover space so a height-limited slide isn't pinned left.
  const offsetX = Math.max(0, (size.width - SLIDE_CANVAS_WIDTH * scale) / 2);
  const offsetY = Math.max(0, (size.height - SLIDE_CANVAS_HEIGHT * scale) / 2);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${SLIDE_CANVAS_WIDTH} / ${SLIDE_CANVAS_HEIGHT}`,
        ...(maxHeight === undefined ? {} : { maxHeight }),
        overflow: 'hidden',
        ...style,
      }}
    >
      <iframe
        ref={frameRef}
        title="react slide"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        onLoad={() => setReady(true)}
        style={{
          position: 'absolute',
          top: offsetY,
          left: offsetX,
          width: `${SLIDE_CANVAS_WIDTH}px`,
          height: `${SLIDE_CANVAS_HEIGHT}px`,
          border: 'none',
          background: 'transparent',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // During playback the slide is not interactive: clicks belong to the player (seek,
          // fullscreen, drawing). The editor turns pointer events back on for inspect mode.
          pointerEvents: inspect ? 'auto' : 'none',
        }}
      />
    </div>
  );
}
