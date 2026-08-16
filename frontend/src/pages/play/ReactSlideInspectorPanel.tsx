import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayPageContext } from './PlayPageContext';
import { ReactSlideElementEditor } from './ReactSlideElementEditor';
import { ReactSlideTextLayerEditor } from './ReactSlideTextLayerEditor';
import { describeOverride, type ReactSlideOverride, type ReactSlideTextLayer } from '../../lib/reactSlide';
import { useI18n } from '../../i18n';

/** Where the panel first appears, and how big: top-right, clear of the slide's centre. */
const INITIAL_BOX = { x: 24, y: 96, width: 352, height: 0 };
/**
 * Remembered across sessions, because where this panel belongs depends on the screen and on what
 * the user is doing — the same reason the detached editor remembers its own rectangle. Height 0
 * means "as tall as its content", which is the default until the user resizes it.
 */
const PANEL_BOX_KEY = 'makeslide.reactInspector.box';

function readStoredBox(): typeof INITIAL_BOX {
  try {
    const raw = window.localStorage.getItem(PANEL_BOX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as typeof INITIAL_BOX;
      const numbers = [parsed.x, parsed.y, parsed.width, parsed.height];
      if (numbers.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        // Clamped on the way in: a window that was remembered on a wider screen would otherwise
        // come back off the edge of this one, where it cannot be dragged back.
        return {
          x: Math.max(0, Math.min(parsed.x, Math.max(0, window.innerWidth - 120))),
          y: Math.max(0, Math.min(parsed.y, Math.max(0, window.innerHeight - 80))),
          width: Math.max(260, Math.min(parsed.width || INITIAL_BOX.width, window.innerWidth - 32)),
          height: Math.max(0, Math.min(parsed.height, window.innerHeight - 40)),
        };
      }
    }
  } catch {
    // storage unavailable (private mode): fall through to the default placement
  }
  return INITIAL_BOX;
}

/**
 * The floating inspector: while click-to-select is on, this sits above everything so a click on
 * the slide is immediately followed by editing, without scrolling back down to the React tab.
 *
 * It is deliberately a panel and not a modal — a modal would cover the very slide the user is
 * clicking on, and every edit needs to be judged against the live result. For the same reason it
 * is draggable and collapsible: whatever fixed corner we picked would eventually sit on top of
 * the thing someone wants to edit.
 *
 * Edits go straight into the shared config (so the sandbox re-styles live) and are persisted only
 * on "save", matching the rest of the React tab.
 */
export function ReactSlideInspectorPanel() {
  const {
    currentPage,
    reactInspect,
    setReactInspect,
    reactSelection,
    handleSetElementLink,
    setReactSelection,
    reactSandboxStats,
    reactSelectedLayerId,
    setReactSelectedLayerId,
    reactConfig,
    setReactConfig,
    reactBusy,
    reactError,
    handleSaveReactConfig,
    isReadOnlyProcessing,
    deleteReactSelection,
  } = usePlayPageContext();
  const { t } = useI18n();

  const [box, setBox] = useState(readStoredBox);
  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Del deletes the selection while focus is in the app. The sandbox handles its own Del and
  // forwards it (see lib/reactSlide.ts) because an opaque origin hides its key events from us —
  // between the two, the key works wherever the user's focus happens to be after clicking.
  useEffect(() => {
    if (!reactInspect || isReadOnlyProcessing || reactBusy) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Delete') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Del inside the text box is Del inside the text box.
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      if (!deleteReactSelection()) return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reactInspect, isReadOnlyProcessing, reactBusy, deleteReactSelection]);

  // Remembered per browser, so each machine keeps the placement that suits its screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_BOX_KEY, JSON.stringify(box));
    } catch {
      // storage unavailable (private mode): the panel still works, it just won't be remembered
    }
  }, [box]);

  // The panel is resized with the native handle (CSS `resize`), which changes the element without
  // telling React — so its size is read back from the element rather than driven by state.
  useEffect(() => {
    const node = panelRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const width = Math.round(node.offsetWidth);
      const height = Math.round(node.offsetHeight);
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { ...prev, width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed]);

  // Keep the panel on screen when the window shrinks below its last position.
  useEffect(() => {
    function onResize() {
      setBox((prev) => ({
        ...prev,
        x: Math.min(prev.x, Math.max(0, window.innerWidth - 360)),
        y: Math.min(prev.y, Math.max(0, window.innerHeight - 120)),
      }));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!reactInspect) return null;
  const isReactPage = currentPage?.render_type === 'react';

  const disabled = isReadOnlyProcessing || reactBusy;
  const selectedOverride: ReactSlideOverride | undefined = reactSelection
    ? reactConfig.overrides[reactSelection.id]
    : undefined;
  const overrideCount = Object.keys(reactConfig.overrides ?? {}).length;

  const selectedLayer = reactSelectedLayerId
    ? reactConfig.textLayers?.find((layer) => layer.id === reactSelectedLayerId) ?? null
    : null;

  function updateLayer(next: ReactSlideTextLayer): void {
    setReactConfig((prev) => ({
      ...prev,
      textLayers: (prev.textLayers ?? []).map((layer) => (layer.id === next.id ? next : layer)),
    }));
  }

  function deleteLayer(layerId: string): void {
    setReactConfig((prev) => ({
      ...prev,
      textLayers: (prev.textLayers ?? []).filter((layer) => layer.id !== layerId),
    }));
    setReactSelectedLayerId(null);
  }

  function updateSelectedOverride(next: ReactSlideOverride | null): void {
    if (!reactSelection) return;
    const id = reactSelection.id;
    setReactConfig((prev) => {
      const overrides = { ...prev.overrides };
      if (next === null) delete overrides[id];
      else overrides[id] = next;
      return { ...prev, overrides };
    });
  }

  // Portalled to <body> because `position: fixed` is relative to the nearest ancestor with a
  // transform / filter / backdrop-filter, not the viewport. One such ancestor anywhere above this
  // panel — a dialog backdrop, a transition — and the window is positioned inside that element
  // instead, which can put it completely off screen with nothing to see and nothing to blame.
  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[140] flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-primary/50 bg-surface/95 shadow-2xl backdrop-blur"
      style={{
        right: box.x,
        top: box.y,
        width: box.width,
        ...(box.height > 0 && !collapsed ? { height: box.height } : {}),
        // Native resize handle: dragging it is the obvious way to make this bigger, and it costs
        // nothing to support. Collapsed the panel is just its title bar, so it does not resize.
        resize: collapsed ? 'none' : 'both',
        // Explicit, not inherited: `offsetWidth` includes the border, so under content-box the
        // stored size would grow by the border width every time it was restored and re-observed.
        boxSizing: 'border-box',
        minWidth: '17rem',
        minHeight: collapsed ? undefined : '8rem',
      }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 rounded-t-xl border-b border-border bg-surface-muted px-3 py-2"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.dragHandle) return;
          dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: box.x,
            originY: box.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          // `right` grows leftward, so a rightward drag decreases it.
          setBox((prev) => ({
            ...prev,
            x: Math.max(0, drag.originX - (e.clientX - drag.startX)),
            y: Math.max(0, drag.originY + (e.clientY - drag.startY)),
          }));
        }}
        onPointerUp={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
        }}
      >
        <span data-drag-handle="1" className="text-xs font-semibold text-text">
          🎯 {t('play.react.inspector.title')}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-muted"
          >
            {collapsed ? t('play.react.inspector.expand') : t('play.react.inspector.collapse')}
          </button>
          <button
            type="button"
            onClick={() => {
              setReactInspect(false);
              setReactSelection(null);
            }}
            title={t('play.react.inspector.close')}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-muted"
          >
            ✕
          </button>
        </span>
      </div>

      {collapsed ? null : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" style={box.height > 0 ? undefined : { maxHeight: '70vh' }}>
          <p className="text-[11px] text-muted">
            {t('play.react.inspector.pageState')
              .replace('{page}', String(currentPage?.page_number ?? '-'))
              .replace('{type}', currentPage?.render_type ?? '-')}
          </p>
          {/* The sandbox's own report. "0 selectable" and "clicked X but found nothing" are
              different faults with the same symptom, and both are readable from a screenshot. */}
          <p className="text-[11px] text-muted">
            {t('play.react.inspector.sandboxState')
              .replace('{count}', String(reactSandboxStats?.pathCount ?? '—'))
              .replace('{click}', reactSandboxStats?.lastClick ?? '—')}
          </p>
          {!isReactPage ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted">
              {t('play.react.inspector.notReactPage')}
            </p>
          ) : null}
          {selectedLayer ? (
            <ReactSlideTextLayerEditor
              layer={selectedLayer}
              disabled={disabled}
              onChange={updateLayer}
              onDelete={() => deleteLayer(selectedLayer.id)}
            />
          ) : reactSelection ? (
            <>
              <ReactSlideElementEditor
                selection={reactSelection}
                override={selectedOverride}
                disabled={disabled}
                onChange={updateSelectedOverride}
                onDelete={deleteReactSelection}
              />
              {/* Written straight into the JSX rather than held with the pending style tweaks: a
                  link is one attribute with one correct value, so there is nothing to preview and
                  nothing to accumulate. */}
              <ElementLinkField
                key={reactSelection.id}
                initial={reactSelection.href ?? ''}
                disabled={disabled}
                onApply={(href) => void handleSetElementLink(reactSelection.id, href)}
              />
            </>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
              {t('play.react.inspector.pickPrompt')}
            </p>
          )}

          {overrideCount > 0 ? (
            <details className="rounded-md border border-border p-2">
              <summary className="cursor-pointer text-[11px] text-text">
                {t('play.react.overrideList')} ({overrideCount})
              </summary>
              <div className="mt-1 space-y-1">
                {Object.entries(reactConfig.overrides).map(([path, override]) => (
                  <div key={path} className="flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span className="truncate font-mono">{describeOverride(path, override)}</span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setReactConfig((prev) => {
                          const overrides = { ...prev.overrides };
                          delete overrides[path];
                          return { ...prev, overrides };
                        })
                      }
                      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-muted"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {reactError ? <p className="text-[11px] text-danger">{reactError}</p> : null}

          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleSaveReactConfig(reactConfig)}
            className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {reactBusy ? t('play.react.inspector.saving') : t('play.react.saveEdits')}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * The selected element's link.
 *
 * Local state, applied on a button rather than on every keystroke: each apply rewrites the JSX and
 * recompiles the page, so typing a URL character by character would be dozens of compiles for one
 * intended change. `key={id}` resets it when the selection moves.
 */
function ElementLinkField({
  initial,
  disabled,
  onApply,
}: {
  initial: string;
  disabled: boolean;
  onApply: (href: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  return (
    <div className="rounded-md border border-border p-2">
      <span className="mb-1 block text-[11px] text-muted">{t('play.react.linkFieldLabel')}</span>
      <div className="flex gap-1">
        <input
          type="url"
          value={value}
          disabled={disabled}
          placeholder={t('play.react.linkFieldPlaceholder')}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface-muted px-2 py-1 text-[11px] text-text"
        />
        <button
          type="button"
          disabled={disabled || value.trim() === initial.trim()}
          onClick={() => onApply(value.trim())}
          className="rounded border border-primary/50 bg-primary/15 px-2 py-1 text-[11px] text-primary disabled:opacity-40"
        >
          {t('play.react.linkApply')}
        </button>
        <button
          type="button"
          disabled={disabled || !initial}
          onClick={() => {
            setValue('');
            onApply('');
          }}
          className="rounded border border-border px-2 py-1 text-[11px] text-text disabled:opacity-40"
        >
          {t('play.react.linkClear')}
        </button>
      </div>
    </div>
  );
}
