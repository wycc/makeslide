import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { strokeHitsPoint, normalizeCanvasPoint } from './drawingGeometry';

// Drawing coordinates are stored normalized to this reference space.
const REF_H = 1080;
const SAVE_DEBOUNCE_MS = 1500;

export interface DrawingStroke {
  color: string;
  lineWidth: number; // logical width in ref-space units
  points: [number, number][]; // each point: [x_norm, y_norm] in [0,1]
  isEraser?: boolean; // kept for backward-compat with saved data
}

export interface DrawingData {
  strokes: DrawingStroke[];
}

// ---- server helpers ----

async function fetchDrawingFromServer(pdfId: string, pageNumber: number): Promise<DrawingData | null> {
  try {
    const resp = await fetch(
      `api/pdfs/${encodeURIComponent(pdfId)}/pages/${encodeURIComponent(String(pageNumber))}/drawing`,
    );
    if (!resp.ok) return null;
    const body = (await resp.json()) as { drawing_json: string | null };
    if (!body.drawing_json) return null;
    return JSON.parse(body.drawing_json) as DrawingData;
  } catch {
    return null;
  }
}

async function saveDrawingToServer(
  pdfId: string,
  pageNumber: number,
  data: DrawingData,
): Promise<void> {
  await fetch(
    `api/pdfs/${encodeURIComponent(pdfId)}/pages/${encodeURIComponent(String(pageNumber))}/drawing`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drawing_json: JSON.stringify(data) }),
    },
  );
}

// ---- component ----

export interface DrawingCanvasHandle {
  clearAll: () => void;
}

export interface DrawingCanvasProps {
  pdfId: string;
  pageNumber: number;
  enabled: boolean;
  color: string;
  lineWidth: number;
  eraser?: boolean;
  // 提供時改為「唯讀鏡射」模式：直接以外部資料（同步狀態）覆蓋顯示，不從伺服器載入也不可編輯/儲存。
  // 供同步模式下的 follower 即時鏡射 master 正在繪製的手寫畫面（與游標同一個同步管道，速度一致）。
  remoteData?: DrawingData | null;
  // master 端每次本機筆劃變化時回呼，供外層透過同步狀態頻道即時推送給 follower。
  onLocalChange?: (data: DrawingData) => void;
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ pdfId, pageNumber, enabled, color, lineWidth, eraser, remoteData, onLocalChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<DrawingStroke[]>([]);
    const currentStrokeRef = useRef<DrawingStroke | null>(null);
    const isDrawingRef = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const notifyLocalChange = useCallback(() => {
      if (!onLocalChange) return;
      const snapshot: DrawingData = {
        strokes: currentStrokeRef.current
          ? [...strokesRef.current, currentStrokeRef.current]
          : strokesRef.current,
      };
      onLocalChange(snapshot);
    }, [onLocalChange]);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const paintStroke = (stroke: DrawingStroke) => {
        if (stroke.points.length < 2) return;
        ctx.save();
        ctx.beginPath();
        if (stroke.isEraser) {
          // backward-compat: old saved eraser strokes rendered with destination-out
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = stroke.color;
        }
        ctx.lineWidth = (stroke.lineWidth / REF_H) * canvas.height;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const p0 = stroke.points[0];
        if (!p0) return;
        ctx.moveTo(p0[0] * canvas.width, p0[1] * canvas.height);
        for (let i = 1; i < stroke.points.length; i++) {
          const pi = stroke.points[i];
          if (!pi) continue;
          ctx.lineTo(pi[0] * canvas.width, pi[1] * canvas.height);
        }
        ctx.stroke();
        ctx.restore();
      };

      strokesRef.current.forEach(paintStroke);
      if (currentStrokeRef.current) paintStroke(currentStrokeRef.current);
    }, []);

    // Sync canvas resolution with CSS size via ResizeObserver.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const observer = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        const w = Math.round(rect.width) || 1;
        const h = Math.round(rect.height) || 1;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          redraw();
        }
      });
      observer.observe(canvas);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width) || 800;
      canvas.height = Math.round(rect.height) || 450;
      return () => observer.disconnect();
    }, [redraw]);

    // Load saved drawing when page changes（remoteData 模式下改由同步狀態即時提供內容，不向伺服器讀取，避免互相覆蓋）。
    useEffect(() => {
      if (remoteData !== undefined) return;
      let cancelled = false;
      strokesRef.current = [];
      currentStrokeRef.current = null;
      redraw();
      fetchDrawingFromServer(pdfId, pageNumber).then((data) => {
        if (cancelled) return;
        strokesRef.current = data?.strokes ?? [];
        redraw();
      });
      return () => {
        cancelled = true;
      };
    }, [pdfId, pageNumber, redraw, remoteData]);

    // 同步模式下的唯讀鏡射：直接套用外部（同步狀態頻道）即時提供的筆劃資料並重繪，
    // 與游標走同一個推送/輪詢頻道，更新速度一致。
    useEffect(() => {
      if (remoteData === undefined) return;
      strokesRef.current = remoteData?.strokes ?? [];
      currentStrokeRef.current = null;
      redraw();
    }, [remoteData, redraw]);

    const scheduleSave = useCallback(() => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      // Snapshot the array reference now, not at fire time: a page switch reassigns
      // strokesRef.current to a brand-new array (see the page-load effect above), so this
      // snapshot keeps pointing at the current page's strokes even if the user has already
      // navigated away by the time this timer fires — otherwise the debounced save would
      // silently write the *new* page's (or not-yet-loaded, empty) strokes under the old
      // page's id, losing whatever the user just drew.
      const pendingStrokes = strokesRef.current;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveDrawingToServer(pdfId, pageNumber, { strokes: pendingStrokes });
      }, SAVE_DEBOUNCE_MS);
    }, [pdfId, pageNumber]);

    useImperativeHandle(
      ref,
      () => ({
        clearAll() {
          if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
          strokesRef.current = [];
          currentStrokeRef.current = null;
          isDrawingRef.current = false;
          redraw();
          void saveDrawingToServer(pdfId, pageNumber, { strokes: [] });
          notifyLocalChange();
        },
      }),
      [pdfId, pageNumber, redraw, notifyLocalChange],
    );

    const getNorm = useCallback((e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      return normalizeCanvasPoint(e.clientX, e.clientY, canvas.getBoundingClientRect());
    }, []);

    // Erase any strokes touched by the current pointer position.
    const eraseAt = useCallback((nx: number, ny: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ex = nx * canvas.width;
      const ey = ny * canvas.height;
      // eraser hit radius = half the eraser stroke width in pixels
      const radius = (lineWidth / REF_H) * canvas.height / 2;
      const before = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter(
        (s) => !strokeHitsPoint(s, ex, ey, radius, canvas.width, canvas.height),
      );
      if (strokesRef.current.length !== before) redraw();
    }, [lineWidth, redraw]);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!enabled) return;
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        isDrawingRef.current = true;
        if (eraser) {
          currentStrokeRef.current = null;
          eraseAt(...getNorm(e));
        } else {
          currentStrokeRef.current = {
            color,
            lineWidth: lineWidth * (REF_H / 1080),
            points: [getNorm(e)],
          };
        }
        notifyLocalChange();
      },
      [enabled, color, lineWidth, eraser, getNorm, eraseAt, notifyLocalChange],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!enabled || !isDrawingRef.current) return;
        e.preventDefault();
        if (eraser) {
          eraseAt(...getNorm(e));
        } else {
          if (!currentStrokeRef.current) return;
          currentStrokeRef.current.points.push(getNorm(e));
          redraw();
        }
        notifyLocalChange();
      },
      [enabled, eraser, redraw, getNorm, eraseAt, notifyLocalChange],
    );

    const handlePointerUp = useCallback(
      (_e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;
        if (!eraser && currentStrokeRef.current) {
          if (currentStrokeRef.current.points.length >= 2) {
            strokesRef.current.push(currentStrokeRef.current);
          }
          currentStrokeRef.current = null;
          redraw();
        }
        scheduleSave();
        notifyLocalChange();
      },
      [eraser, redraw, scheduleSave, notifyLocalChange],
    );

    const cursor = !enabled ? 'default' : eraser ? 'cell' : 'crosshair';

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: enabled ? 'auto' : 'none',
          cursor,
          touchAction: 'none',
          borderRadius: 'inherit',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    );
  },
);

export default DrawingCanvas;
