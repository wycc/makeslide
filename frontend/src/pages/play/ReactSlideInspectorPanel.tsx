import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayPageContext } from './PlayPageContext';
import { ReactSlideElementEditor } from './ReactSlideElementEditor';
import { ReactSlideTextLayerEditor } from './ReactSlideTextLayerEditor';
import { describeOverride, type ReactSlideOverride, type ReactSlideTextLayer } from '../../lib/reactSlide';
import { useI18n } from '../../i18n';

/** Where the panel first appears: top-right, clear of the slide's centre. */
const INITIAL_OFFSET = { x: 24, y: 96 };

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
  } = usePlayPageContext();
  const { t } = useI18n();

  const [position, setPosition] = useState(INITIAL_OFFSET);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Keep the panel on screen when the window shrinks below its last position.
  useEffect(() => {
    function onResize() {
      setPosition((prev) => ({
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
    ? reactConfig.overrides[reactSelection.path]
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
    const path = reactSelection.path;
    setReactConfig((prev) => {
      const overrides = { ...prev.overrides };
      if (next === null) delete overrides[path];
      else overrides[path] = next;
      return { ...prev, overrides };
    });
  }

  // Portalled to <body> because `position: fixed` is relative to the nearest ancestor with a
  // transform / filter / backdrop-filter, not the viewport. One such ancestor anywhere above this
  // panel — a dialog backdrop, a transition — and the window is positioned inside that element
  // instead, which can put it completely off screen with nothing to see and nothing to blame.
  return createPortal(
    <div
      className="fixed z-[140] w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-primary/50 bg-surface/95 shadow-2xl backdrop-blur"
      style={{ right: position.x, top: position.y }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 rounded-t-xl border-b border-border bg-surface-muted px-3 py-2"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.dragHandle) return;
          dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: position.x,
            originY: position.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          // `right` grows leftward, so a rightward drag decreases it.
          setPosition({
            x: Math.max(0, drag.originX - (e.clientX - drag.startX)),
            y: Math.max(0, drag.originY + (e.clientY - drag.startY)),
          });
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
        <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
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
            <ReactSlideElementEditor
              selection={reactSelection}
              override={selectedOverride}
              disabled={disabled}
              onChange={updateSelectedOverride}
            />
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
