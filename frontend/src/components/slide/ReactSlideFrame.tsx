import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  SLIDE_CANVAS_HEIGHT,
  SLIDE_CANVAS_WIDTH,
  backgroundStyle,
  buildReactSlideSandboxDoc,
  textLayerCss,
  hasSlideBackground,
  overlayStyle,
  isSlideSandboxMessage,
  isOpenableSlideLink,
  slideScale,
  type ReactSlideConfig,
  type SlideElementSelection,
  type SlideSandboxStats,
  type SlideTheme,
} from '../../lib/reactSlide';

export interface ReactSlideFrameProps {
  /** esbuild-compiled slide code from the backend. */
  compiled: string;
  theme: SlideTheme;
  config: ReactSlideConfig;
  backgroundUrl?: string;
  /** `{ name: data-url }` the sandbox's `MS_ASSET()` resolves against. */
  assetDataUrls?: Record<string, string>;
  /** Click-to-select mode; only the editor turns this on. */
  inspect?: boolean;
  /**
   * Whether clicks may reach the slide when not editing — what makes a link on it clickable.
   *
   * Off by default because the frame covers the whole stage: with it on, the drawing canvas and
   * the region picker never see a pointer. The caller turns it on exactly when nothing else wants
   * the clicks (not drawing, not selecting a region, not inspecting).
   */
  interactive?: boolean;
  onSelect?: (selection: SlideElementSelection) => void;
  /** Upper bound on the rendered height (the player caps how tall a slide may be). */
  maxHeight?: string | number;
  /** Fired when the sandbox reports a runtime error, so callers can fall back to the page image. */
  onError?: (message: string) => void;
  /** Sandbox self-report (labelled elements, last click), shown in the inspector. */
  onStats?: (stats: SlideSandboxStats) => void;
  /** A text layer was clicked in inspect mode. */
  onSelectLayer?: (layerId: string) => void;
  /** Del pressed inside the sandbox — the parent decides what the current selection means. */
  onDeleteRequest?: () => void;
  /** An element was dragged or nudged; `left`/`top` already carry the unit it was using. */
  onMove?: (move: { id: string; left: string; top: string }) => void;
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
  assetDataUrls,
  inspect = false,
  interactive = false,
  onSelect,
  onStats,
  onSelectLayer,
  onDeleteRequest,
  onMove,
  maxHeight,
  onError,
  className,
  style,
}: ReactSlideFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);

  // Only the code, the theme's custom CSS, and the assets force a rebuild. Overrides, token values
  // and the background are pushed into the live sandbox instead, so editing them never remounts the
  // component (which would flash the slide on every slider step).
  //
  // Assets have to be in this list: `MS_ASSET` is called while the component renders, so a map that
  // arrives after the document was built cannot be streamed in — the pictures would simply be
  // missing until something else happened to rebuild it. The map is state, so its identity only
  // changes when the assets actually do.
  const srcDoc = useMemo(
    () => buildReactSlideSandboxDoc({ compiled, theme, config, backgroundUrl, assetDataUrls, inspect }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the rest streams in live
    [compiled, theme.customCss, assetDataUrls],
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
      } else if (event.data.type === 'ms-slide-select-layer') {
        onSelectLayer?.(event.data.layerId);
      } else if (event.data.type === 'ms-slide-delete-request') {
        onDeleteRequest?.();
      } else if (event.data.type === 'ms-slide-stats') {
        onStats?.({ pathCount: event.data.pathCount, lastClick: event.data.lastClick });
      } else if (event.data.type === 'ms-slide-move') {
        onMove?.({ id: event.data.id, left: event.data.left, top: event.data.top });
      } else if (event.data.type === 'ms-slide-link') {
        // The sandbox cannot navigate or open windows by design, so the click arrives here as a
        // request. The URL is re-validated because the slide's code can be hand-edited: the check
        // inside the sandbox catches mistakes, this one is what stops anything deliberate.
        // `noopener` so the opened page cannot reach back and navigate this tab.
        const { href } = event.data;
        if (isOpenableSlideLink(href)) window.open(href, '_blank', 'noopener,noreferrer');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect, onError, onStats, onSelectLayer, onDeleteRequest, onMove]);

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
      { type: 'ms-slide-background', transparent: hasSlideBackground(config, backgroundUrl) },
      '*',
    );
  }, [ready, config, backgroundUrl]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'ms-slide-theme', tokens: theme.tokens }, '*');
  }, [ready, theme.tokens]);

  // Text layers stream in like overrides, so editing one restyles the live slide instead of
  // remounting the component.
  useEffect(() => {
    if (!ready) return;
    const layers = config.textLayers ?? [];
    frameRef.current?.contentWindow?.postMessage(
      {
        type: 'ms-slide-text-layers',
        layers,
        css: Object.fromEntries(layers.map((layer) => [layer.id, textLayerCss(layer)])),
      },
      '*',
    );
  }, [ready, config.textLayers]);

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
      {/* The background lives here, in the parent document, not in the sandbox: the image comes
          from an authenticated endpoint on our origin, and a cross-site subresource request from
          an opaque-origin iframe carries no session cookie (403) — quite apart from `about:srcdoc`
          being unable to resolve a relative URL at all. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: offsetY,
          left: offsetX,
          width: SLIDE_CANVAS_WIDTH * scale,
          height: SLIDE_CANVAS_HEIGHT * scale,
          pointerEvents: 'none',
          ...backgroundStyle(config, backgroundUrl),
        }}
      >
        <div style={{ position: 'absolute', inset: 0, ...overlayStyle(config) }} />
      </div>
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
          // Clicks belong to the player (seek, fullscreen, drawing) unless someone asks for them:
          // inspect mode needs them to select elements, and a page carrying links needs them so
          // those links can be clicked at all — without this the sandbox never sees the press.
          pointerEvents: inspect || interactive ? 'auto' : 'none',
        }}
      />
    </div>
  );
}
