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
  onError,
  className,
  style,
}: ReactSlideFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);

  // Only the code, the theme's custom CSS and inspect mode force a rebuild. Overrides, token
  // values and the background are pushed into the live sandbox instead, so editing them never
  // remounts the component (which would flash the slide on every slider step).
  const srcDoc = useMemo(
    () => buildReactSlideSandboxDoc({ compiled, theme, config, backgroundUrl }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the rest streams in live
    [compiled, theme.customCss],
  );

  useEffect(() => {
    setReady(false);
  }, [srcDoc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
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

  const scale = slideScale(width);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${SLIDE_CANVAS_WIDTH} / ${SLIDE_CANVAS_HEIGHT}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <iframe
        ref={frameRef}
        title="react slide"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
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
