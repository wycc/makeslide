import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ELEMENT_FONT_STACKS,
  ELEMENT_REF_HEIGHT,
  RESIZE_HANDLES,
  moveBox,
  resizeBox,
  rotationFromPointer,
  shapePolygonPoints,
  type ElementBox,
  type PageElement,
  type ResizeHandle,
} from '../../lib/pageElements';

/**
 * The element layer: draws a page's text / image / shape elements over its base image, in the
 * same percentage coordinate space as the drawing canvas, so it sits inside `SlideRenderer` as a
 * child and follows the picture wherever it is scaled to (docs/page-elements.md §5.1).
 *
 * With `editor` set it is also the editor surface: click to select, drag to move, handles to
 * resize / rotate, double-click a text element to edit it in place. Drag maths happen in page
 * units (pointer delta ÷ layer size), so nothing here depends on the on-screen size.
 */

export interface PageElementsEditor {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called continuously while dragging (draft update) and once more on release (commit). */
  onChange: (id: string, patch: Partial<PageElement>, commit: boolean) => void;
  onEditText: (id: string, text: string) => void;
  editingTextId: string | null;
  setEditingTextId: (id: string | null) => void;
}

interface PageElementsLayerProps {
  elements: PageElement[];
  assetUrl: (assetName: string) => string;
  editor?: PageElementsEditor;
}

type DragState =
  | { kind: 'move'; id: string; startX: number; startY: number; box: ElementBox; moved: boolean }
  | { kind: 'resize'; id: string; handle: ResizeHandle; startX: number; startY: number; box: ElementBox }
  | { kind: 'rotate'; id: string; centre: { x: number; y: number } };

const DRAG_THRESHOLD_PX = 3;

export function PageElementsLayer({ elements, assetUrl, editor }: PageElementsLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const node = layerRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const scale = size.height > 0 ? size.height / ELEMENT_REF_HEIGHT : 0;
  const editable = Boolean(editor);

  const toPageDelta = (dxPx: number, dyPx: number) => ({
    dx: size.width > 0 ? dxPx / size.width : 0,
    dy: size.height > 0 ? dyPx / size.height : 0,
  });

  const onPointerDownElement = (e: ReactPointerEvent<HTMLDivElement>, el: PageElement) => {
    if (!editor) return;
    if (editor.editingTextId === el.id) return;
    e.stopPropagation();
    e.preventDefault();
    editor.onSelect(el.id);
    dragRef.current = { kind: 'move', id: el.id, startX: e.clientX, startY: e.clientY, box: { x: el.x, y: el.y, w: el.w, h: el.h }, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerDownHandle = (e: ReactPointerEvent<HTMLDivElement>, el: PageElement, handle: ResizeHandle) => {
    if (!editor) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { kind: 'resize', id: el.id, handle, startX: e.clientX, startY: e.clientY, box: { x: el.x, y: el.y, w: el.w, h: el.h } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerDownRotate = (e: ReactPointerEvent<HTMLDivElement>, el: PageElement) => {
    if (!editor) return;
    e.stopPropagation();
    e.preventDefault();
    const layer = layerRef.current?.getBoundingClientRect();
    if (!layer) return;
    const centre = { x: layer.left + (el.x + el.w / 2) * layer.width, y: layer.top + (el.y + el.h / 2) * layer.height };
    dragRef.current = { kind: 'rotate', id: el.id, centre };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !editor) return;
    e.preventDefault();
    if (drag.kind === 'move') {
      const dxPx = e.clientX - drag.startX;
      const dyPx = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      const { dx, dy } = toPageDelta(dxPx, dyPx);
      editor.onChange(drag.id, moveBox(drag.box, dx, dy), false);
    } else if (drag.kind === 'resize') {
      const { dx, dy } = toPageDelta(e.clientX - drag.startX, e.clientY - drag.startY);
      editor.onChange(drag.id, resizeBox(drag.box, drag.handle, dx, dy, e.shiftKey), false);
    } else {
      editor.onChange(drag.id, { rotation: rotationFromPointer(drag.centre, { x: e.clientX, y: e.clientY }, e.shiftKey) }, false);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !editor) return;
    e.preventDefault();
    if (drag.kind === 'move' && !drag.moved) return;
    const current = elements.find((el) => el.id === drag.id);
    if (!current) return;
    editor.onChange(drag.id, { x: current.x, y: current.y, w: current.w, h: current.h, rotation: current.rotation }, true);
  };

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ pointerEvents: editable ? 'auto' : 'none', touchAction: editable ? 'none' : undefined, zIndex: editable ? 25 : undefined, lineHeight: 'normal' }}
      onPointerDown={editable ? (e) => { e.stopPropagation(); editor?.onSelect(null); } : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? onPointerUp : undefined}
      onPointerCancel={editable ? onPointerUp : undefined}
      onClick={editable ? (e) => e.stopPropagation() : undefined}
      data-testid="page-elements-layer"
    >
      {scale > 0 &&
        elements.map((el) => {
          const selected = editor?.selectedId === el.id;
          const editingText = editor?.editingTextId === el.id && el.type === 'text';
          const boxStyle: CSSProperties = {
            position: 'absolute',
            left: `${el.x * 100}%`,
            top: `${el.y * 100}%`,
            width: `${el.w * 100}%`,
            height: `${el.h * 100}%`,
            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            transformOrigin: 'center center',
            opacity: el.opacity,
            cursor: editable ? (editingText ? 'text' : 'move') : undefined,
            pointerEvents: editable ? 'auto' : 'none',
            userSelect: editingText ? 'text' : 'none',
          };
          return (
            <div
              key={el.id}
              style={boxStyle}
              onPointerDown={editable ? (e) => onPointerDownElement(e, el) : undefined}
              onDoubleClick={
                editable && el.type === 'text'
                  ? (e) => {
                      e.stopPropagation();
                      editor?.setEditingTextId(el.id);
                    }
                  : undefined
              }
              data-element-id={el.id}
            >
              <ElementBody el={el} scale={scale} assetUrl={assetUrl} editingText={editingText} editor={editor} />
              {selected && editor ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ outline: '2px solid rgb(56 189 248)', outlineOffset: 0, opacity: 1 }}
                >
                  {RESIZE_HANDLES.map((handle) => (
                    <div
                      key={handle}
                      onPointerDown={(e) => onPointerDownHandle(e, el, handle)}
                      className="pointer-events-auto absolute h-3 w-3 rounded-sm border border-sky-500 bg-white shadow"
                      style={{ ...handlePosition(handle), cursor: handleCursor(handle) }}
                      aria-label={`resize-${handle}`}
                    />
                  ))}
                  <div
                    onPointerDown={(e) => onPointerDownRotate(e, el)}
                    className="pointer-events-auto absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border border-sky-500 bg-white shadow"
                    style={{ top: -28, cursor: 'grab' }}
                    aria-label="rotate"
                  />
                  <div className="absolute left-1/2 h-4 w-px -translate-x-1/2 bg-sky-400" style={{ top: -16 }} />
                </div>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

function handlePosition(handle: ResizeHandle): CSSProperties {
  const style: CSSProperties = {};
  if (handle.includes('n')) style.top = -6;
  if (handle.includes('s')) style.bottom = -6;
  if (handle.includes('w')) style.left = -6;
  if (handle.includes('e')) style.right = -6;
  if (handle === 'n' || handle === 's') {
    style.left = '50%';
    style.marginLeft = -6;
  }
  if (handle === 'e' || handle === 'w') {
    style.top = '50%';
    style.marginTop = -6;
  }
  return style;
}

function handleCursor(handle: ResizeHandle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    default:
      return 'nwse-resize';
  }
}

function ElementBody({
  el,
  scale,
  assetUrl,
  editingText,
  editor,
}: {
  el: PageElement;
  scale: number;
  assetUrl: (name: string) => string;
  editingText: boolean;
  editor?: PageElementsEditor;
}) {
  if (el.type === 'text') {
    const justify = el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start';
    const style: CSSProperties = {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: justify,
      boxSizing: 'border-box',
      padding: el.padding * scale,
      background: el.background ?? undefined,
      borderRadius: el.borderRadius * scale,
      color: el.color,
      fontFamily: ELEMENT_FONT_STACKS[el.fontFamily],
      fontSize: el.fontSize * scale,
      fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? 'italic' : 'normal',
      textDecoration: el.underline ? 'underline' : 'none',
      textUnderlineOffset: '0.12em',
      textAlign: el.align,
      lineHeight: el.lineHeight,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'normal',
      overflow: 'hidden',
    };
    if (editingText && editor) {
      return (
        <textarea
          autoFocus
          value={el.text}
          onChange={(e) => editor.onEditText(el.id, e.target.value)}
          onBlur={() => editor.setEditingTextId(null)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') editor.setEditingTextId(null);
          }}
          style={{ ...style, resize: 'none', outline: '2px solid rgb(56 189 248)', border: 'none', width: '100%', height: '100%' }}
        />
      );
    }
    return <div style={style}>{el.text}</div>;
  }

  if (el.type === 'image') {
    return (
      <img
        src={assetUrl(el.asset)}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: el.fit,
          borderRadius: el.borderRadius * scale,
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    );
  }

  return <ShapeSvg el={el} scale={scale} />;
}

function ShapeSvg({ el, scale }: { el: Extract<PageElement, { type: 'shape' }>; scale: number }) {
  // Draw in a fixed 1000×1000 box stretched to the element; strokes use vector-effect so their
  // width stays in reference pixels rather than scaling with the box.
  const W = 1000;
  const H = 1000;
  const strokeW = el.strokeWidth * scale;
  const common = {
    fill: el.fill ?? 'none',
    stroke: el.stroke ?? 'none',
    strokeWidth: strokeW,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinejoin: 'round' as const,
  };
  let body;
  switch (el.shape) {
    case 'rect':
      body = <rect x={0} y={0} width={W} height={H} rx={el.borderRadius * scale} ry={el.borderRadius * scale} {...common} />;
      break;
    case 'ellipse':
      body = <ellipse cx={W / 2} cy={H / 2} rx={W / 2} ry={H / 2} {...common} />;
      break;
    case 'triangle':
    case 'diamond':
    case 'star':
      body = <polygon points={shapePolygonPoints(el.shape, W, H)} {...common} />;
      break;
    case 'line':
    case 'arrow': {
      const color = el.stroke ?? el.fill ?? '#111111';
      const lw = Math.max(1, strokeW || 4 * scale);
      const headLen = el.shape === 'arrow' ? lw * 4 : 0;
      return (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', display: 'block' }}
        >
          <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke={color} strokeWidth={lw} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {el.shape === 'arrow' ? (
            <ArrowHead color={color} headLen={headLen} />
          ) : null}
        </svg>
      );
    }
    default:
      body = null;
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', display: 'block' }}
    >
      {body}
    </svg>
  );
}

/**
 * The arrow head is drawn in screen pixels at the line's right end: `non-scaling-stroke` keeps
 * the shaft's width fixed, so the head must not stretch with the box either. A marker with
 * `markerUnits="strokeWidth"` gives exactly that.
 */
function ArrowHead({ color, headLen }: { color: string; headLen: number }) {
  return (
    <>
      <defs>
        <marker id={`arrow-${color.replace(/[^a-z0-9]/gi, '')}-${Math.round(headLen)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      <line
        x1={0}
        y1={500}
        x2={1000}
        y2={500}
        stroke="transparent"
        strokeWidth={Math.max(1, headLen / 4)}
        vectorEffect="non-scaling-stroke"
        markerEnd={`url(#arrow-${color.replace(/[^a-z0-9]/gi, '')}-${Math.round(headLen)})`}
      />
    </>
  );
}
