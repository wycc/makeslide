import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DEFAULT_SLIDE_CANVAS,
  backgroundStyle,
  buildReactSlideSandboxDoc,
  textLayerCss,
  hasSlideBackground,
  overlayStyle,
  isSlideSandboxMessage,
  isOpenableSlideLink,
  slideFitScale,
  slideFrameBoxStyle,
  type ReactSlideConfig,
  type SlideCanvas,
  type SlideElementSelection,
  type SlideSandboxStats,
  type SlideTheme,
} from '../../lib/reactSlide';

/**
 * How long to wait for a replacement document to report itself painted before showing it anyway.
 *
 * Generous: the cost of waiting is that the previous page stays up a moment longer, while the cost
 * of giving up early is the flash this whole mechanism exists to remove.
 */
const PENDING_SWAP_TIMEOUT_MS = 2000;

export interface ReactSlideFrameProps {
  /** esbuild-compiled slide code from the backend. */
  compiled: string;
  theme: SlideTheme;
  config: ReactSlideConfig;
  backgroundUrl?: string;
  /** `{ name: data-url }` the sandbox's `MS_ASSET()` resolves against. */
  assetDataUrls?: Record<string, string>;
  /** The deck's canvas, so a React page is the same shape as the image pages around it. */
  canvas?: SlideCanvas;
  /** Click-to-select mode; only the editor turns this on. */
  inspect?: boolean;
  /**
   * Current step of a step-built page: layers tagged with a later step are hidden.
   *
   * Undefined means "not stepping", and every layer shows — the editor, the thumbnail and any
   * still view need the finished slide, not a half-built one.
   */
  step?: number;
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
 * The canvas is scaled with a CSS transform sized from the container's measured width,
 * which is what lets the same page render identically in the editor preview, the player and
 * fullscreen without any responsive code in the generated component.
 */
export function ReactSlideFrame({
  compiled,
  theme,
  config,
  backgroundUrl,
  assetDataUrls,
  canvas,
  inspect = false,
  interactive = false,
  step,
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
  const pendingFrameRef = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  /**
   * The step a document is *built* with; later changes stream in as messages, so stepping through
   * a page never rebuilds the sandbox. Read at build time rather than captured on mount: a rebuild
   * happens when the page changes, and the new page's document has to start at the new page's step
   * — a ref frozen at mount would build page 12 as if it were still on page 3's fourth step.
   */
  const stepRef = useRef(step);
  stepRef.current = step;

  // Only the code, the theme's custom CSS, and the assets force a rebuild. Overrides, token values
  // and the background are pushed into the live sandbox instead, so editing them never remounts the
  // component (which would flash the slide on every slider step).
  //
  // Assets have to be in this list: `MS_ASSET` is called while the component renders, so a map that
  // arrives after the document was built cannot be streamed in — the pictures would simply be
  // missing until something else happened to rebuild it. The map is state, so its identity only
  // changes when the assets actually do.
  const srcDoc = useMemo(
    () => buildReactSlideSandboxDoc({
      compiled,
      theme,
      config,
      backgroundUrl,
      assetDataUrls,
      canvas,
      inspect,
      step: stepRef.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the rest streams in live
    [compiled, theme.customCss, assetDataUrls, canvas],
  );

  /**
   * The document currently on screen, and the one being loaded to replace it.
   *
   * Swapping an iframe's `srcDoc` blanks it while the new document loads, which on a dark stage
   * reads as the slide flashing black between pages. So the replacement is built in a second,
   * invisible iframe and only promoted once it reports itself painted — the outgoing page stays
   * visible until then, which is what makes the change look instant.
   */
  const [liveDoc, setLiveDoc] = useState(srcDoc);
  const [pendingDoc, setPendingDoc] = useState<string | null>(null);

  useEffect(() => {
    // Same document (a re-render, or a change that streams in) — nothing to swap.
    if (srcDoc === liveDoc) {
      setPendingDoc(null);
      return;
    }
    setPendingDoc(srcDoc);
  }, [srcDoc, liveDoc]);

  // Read through a ref rather than from the updater: promotion has to set two pieces of state, and
  // doing that inside an updater makes it a side effect React is free to run twice.
  const pendingDocRef = useRef<string | null>(null);
  pendingDocRef.current = pendingDoc;

  const promotePending = useCallback(() => {
    const doc = pendingDocRef.current;
    if (doc === null) return;
    pendingDocRef.current = null;
    setLiveDoc(doc);
    setPendingDoc(null);
    // The promoted document has already painted, so the live frame it becomes is ready by
    // definition; waiting for a second 'ready' that will never arrive would stall the messages
    // that style it.
    setReady(true);
  }, []);

  useEffect(() => {
    if (pendingDoc === null) return;
    // A sandbox that never reports itself painted (a runtime error before first paint, an asset
    // that stalls) must not strand the viewer on the previous page. Showing a half-painted slide
    // is better than showing the wrong one.
    const timer = window.setTimeout(promotePending, PENDING_SWAP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingDoc, promotePending]);

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
      const fromPending = Boolean(pendingFrameRef.current && event.source === pendingFrameRef.current.contentWindow);
      const fromLive = Boolean(frameRef.current && event.source === frameRef.current.contentWindow);
      if (!fromPending && !fromLive) return;
      if (!isSlideSandboxMessage(event.data)) return;
      if (fromPending) {
        // The incoming page has painted: show it. Anything else it has to say (a select, a move)
        // belongs to a page nobody is looking at yet, so it is ignored until it is the live one.
        if (event.data.type === 'ms-slide-ready') promotePending();
        else if (event.data.type === 'ms-slide-error') onError?.(event.data.message);
        return;
      }
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
  }, [onSelect, onError, onStats, onSelectLayer, onDeleteRequest, onMove, promotePending]);

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

  // The build state travels as a message rather than as a remount: a remount would restart the
  // component and drop the overrides the sandbox has already applied.
  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'ms-slide-step', step: step ?? null }, '*');
  }, [ready, step]);

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

  const scale = slideFitScale(size.width, size.height, canvas);
  // Centre the scaled canvas in the leftover space so a height-limited slide isn't pinned left.
  const box = canvas ?? DEFAULT_SLIDE_CANVAS;
  const offsetX = Math.max(0, (size.width - box.width * scale) / 2);
  const offsetY = Math.max(0, (size.height - box.height * scale) / 2);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...slideFrameBoxStyle(maxHeight, canvas), ...style }}
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
          width: box.width * scale,
          height: box.height * scale,
          pointerEvents: 'none',
          ...backgroundStyle(config, backgroundUrl),
        }}
      >
        <div style={{ position: 'absolute', inset: 0, ...overlayStyle(config) }} />
      </div>
      {/*
        The replacement, loading out of sight. Not `display: none` and not zero-sized: a sandbox
        that is never laid out may not paint at all, and one that never paints never reports
        itself ready — which would turn every page change into a two-second wait for the timeout.
        `aria-hidden` and no pointer events so it exists only for the browser.
      */}
      {pendingDoc !== null ? (
        <iframe
          ref={pendingFrameRef}
          title="react slide (loading)"
          aria-hidden
          sandbox="allow-scripts"
          srcDoc={pendingDoc}
          style={{
            position: 'absolute',
            top: offsetY,
            left: offsetX,
            width: `${box.width}px`,
            height: `${box.height}px`,
            border: 'none',
            background: 'transparent',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <iframe
        ref={frameRef}
        title="react slide"
        sandbox="allow-scripts"
        srcDoc={liveDoc}
        onLoad={() => setReady(true)}
        style={{
          position: 'absolute',
          top: offsetY,
          left: offsetX,
          width: `${box.width}px`,
          height: `${box.height}px`,
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
