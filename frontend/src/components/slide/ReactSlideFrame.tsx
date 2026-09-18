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
// Longer than the sandbox's own cap on waiting for pictures (4s in buildReactSlideSandboxDoc): the
// sandbox decides when a slow picture stops being worth waiting for, and this is only the backstop
// for a sandbox that never reports at all. Shorter, and it would swap in a half-decoded page.
const PENDING_SWAP_TIMEOUT_MS = 5000;

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
  /**
   * A picture to keep on screen until this frame has painted for the first time — the page the
   * viewer came from. Without it a freshly mounted frame shows its document's background (dark by
   * default) while React renders and the pictures decode.
   */
  posterSrc?: string | null;
  /** Fired once the frame has painted the slide, first mount or swap alike. */
  onPainted?: () => void;
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
  posterSrc,
  onPainted,
  className,
  style,
}: ReactSlideFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  /**
   * Whether this frame has ever shown a painted slide. Until then the live iframe stays invisible
   * and the poster stands in: the document's own background would otherwise be on screen, bare,
   * while React commits and the pictures decode. Set only by the sandbox's own "painted" report
   * (or a promotion) — the iframe's `load` event fires before either.
   */
  const [everPainted, setEverPainted] = useState(false);
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;
  const markPainted = useCallback(() => {
    setEverPainted(true);
    onPaintedRef.current?.();
  }, []);
  // A sandbox that never reports itself painted must not leave the slide invisible for good.
  useEffect(() => {
    if (everPainted) return;
    const timer = window.setTimeout(markPainted, PENDING_SWAP_TIMEOUT_MS + 1000);
    return () => window.clearTimeout(timer);
  }, [everPainted, markPainted]);
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
   * The documents in play, each in its own iframe: the one on screen, and at most one loading to
   * replace it.
   *
   * Each slot is rendered with a stable `key`, and promotion only changes which key is live. That
   * is the whole point. The first version copied the promoted document into the visible iframe's
   * `srcDoc` — which reloads that iframe from scratch, throwing away the copy that had just painted
   * off screen and putting the slide's dark background up while it reloaded. Measured frame by
   * frame, that reload was the black flash that remained after the swap was supposedly fixed.
   * Keeping the element that painted, and removing the other, cannot reload anything.
   */
  type DocSlot = { key: number; doc: string };
  const slotKeyCounter = useRef(0);
  const [slots, setSlots] = useState<DocSlot[]>(() => [{ key: 0, doc: srcDoc }]);
  const [liveKey, setLiveKey] = useState(0);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const liveKeyRef = useRef(liveKey);
  liveKeyRef.current = liveKey;
  const frameEls = useRef(new Map<number, HTMLIFrameElement>());
  const liveFrame = useCallback(() => frameEls.current.get(liveKeyRef.current) ?? null, []);

  useEffect(() => {
    const current = slotsRef.current;
    const live = current.find((slot) => slot.key === liveKeyRef.current);
    if (live && live.doc === srcDoc) {
      // Back to what is already on screen (or a re-render): drop any replacement in flight.
      if (current.length > 1) setSlots([live]);
      return;
    }
    const pending = current.find((slot) => slot.key !== liveKeyRef.current);
    if (pending && pending.doc === srcDoc) return;
    slotKeyCounter.current += 1;
    const next = { key: slotKeyCounter.current, doc: srcDoc };
    setSlots(live ? [live, next] : [next]);
  }, [srcDoc]);

  const promote = useCallback((key: number) => {
    if (key === liveKeyRef.current) return;
    const slot = slotsRef.current.find((s) => s.key === key);
    if (!slot) return;
    liveKeyRef.current = key;
    setLiveKey(key);
    setSlots([slot]);
    // The promoted document has already painted, so the frame it lives in is ready by definition;
    // waiting for a second 'ready' that will never arrive would stall the messages that style it.
    setReady(true);
    markPainted();
  }, [markPainted]);

  const pendingKey = slots.find((slot) => slot.key !== liveKey)?.key ?? null;
  useEffect(() => {
    if (pendingKey === null) return;
    // A sandbox that never reports itself painted (a runtime error before first paint, an asset
    // that stalls) must not strand the viewer on the previous page. Showing a half-painted slide
    // is better than showing the wrong one.
    const timer = window.setTimeout(() => promote(pendingKey), PENDING_SWAP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingKey, promote]);

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
      let fromKey: number | null = null;
      for (const [key, el] of frameEls.current) {
        if (el.contentWindow && event.source === el.contentWindow) {
          fromKey = key;
          break;
        }
      }
      if (fromKey === null) return;
      if (!isSlideSandboxMessage(event.data)) return;
      if (fromKey !== liveKeyRef.current) {
        // The incoming page has painted: show it. Anything else it has to say (a select, a move)
        // belongs to a page nobody is looking at yet, so it is ignored until it is the live one.
        if (event.data.type === 'ms-slide-ready') promote(fromKey);
        else if (event.data.type === 'ms-slide-error') onError?.(event.data.message);
        return;
      }
      if (event.data.type === 'ms-slide-ready') {
        setReady(true);
        markPainted();
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
  }, [onSelect, onError, onStats, onSelectLayer, onDeleteRequest, onMove, promote, markPainted]);

  // Everything below streams into the frame on screen. `liveKey` is in every dependency list so a
  // promoted frame is brought up to date at once: its document was built a moment earlier, and a
  // step, an override or a token may have changed while it was loading.

  // Push override edits into the live sandbox (no reload).
  useEffect(() => {
    if (!ready) return;
    liveFrame()?.contentWindow?.postMessage(
      { type: 'ms-slide-overrides', overrides: config.overrides ?? {} },
      '*',
    );
  }, [ready, liveKey, liveFrame, config.overrides]);

  useEffect(() => {
    if (!ready) return;
    liveFrame()?.contentWindow?.postMessage({ type: 'ms-slide-inspect', enabled: inspect }, '*');
  }, [ready, liveKey, liveFrame, inspect]);

  // The build state travels as a message rather than as a remount: a remount would restart the
  // component and drop the overrides the sandbox has already applied.
  useEffect(() => {
    if (!ready) return;
    liveFrame()?.contentWindow?.postMessage({ type: 'ms-slide-step', step: step ?? null }, '*');
  }, [ready, liveKey, liveFrame, step]);

  useEffect(() => {
    if (!ready) return;
    liveFrame()?.contentWindow?.postMessage(
      { type: 'ms-slide-background', transparent: hasSlideBackground(config, backgroundUrl) },
      '*',
    );
  }, [ready, liveKey, liveFrame, config, backgroundUrl]);

  useEffect(() => {
    if (!ready) return;
    liveFrame()?.contentWindow?.postMessage({ type: 'ms-slide-theme', tokens: theme.tokens }, '*');
  }, [ready, liveKey, liveFrame, theme.tokens]);

  // Text layers stream in like overrides, so editing one restyles the live slide instead of
  // remounting the component.
  useEffect(() => {
    if (!ready) return;
    const layers = config.textLayers ?? [];
    liveFrame()?.contentWindow?.postMessage(
      {
        type: 'ms-slide-text-layers',
        layers,
        css: Object.fromEntries(layers.map((layer) => [layer.id, textLayerCss(layer)])),
      },
      '*',
    );
  }, [ready, liveKey, liveFrame, config.textLayers]);

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
      {!everPainted && posterSrc ? (
        <img
          src={posterSrc}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            top: offsetY,
            left: offsetX,
            width: box.width * scale,
            height: box.height * scale,
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {slots.map((slot) => {
        const isLive = slot.key === liveKey;
        return (
          /*
            A loading slot is hidden with opacity, not `display: none`, and keeps the canvas's size:
            a sandbox that is never laid out may not paint at all, and one that never paints never
            reports itself ready — every page change would then wait for the timeout.
          */
          <iframe
            key={slot.key}
            ref={(el) => {
              if (el) frameEls.current.set(slot.key, el);
              else frameEls.current.delete(slot.key);
            }}
            title={isLive ? 'react slide' : 'react slide (loading)'}
            aria-hidden={isLive ? undefined : true}
            sandbox="allow-scripts"
            srcDoc={slot.doc}
            onLoad={() => {
              if (slot.key === liveKeyRef.current) setReady(true);
            }}
            style={{
              opacity: isLive && everPainted ? 1 : 0,
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
              pointerEvents: isLive && (inspect || interactive) ? 'auto' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}
