import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

// Drawing coordinates are stored normalized to this reference space.
const REF_H = 1080;
const SAVE_DEBOUNCE_MS = 1500;

export interface DrawingStroke {
  color: string;
  lineWidth: number; // logical width in ref-space units
  points: [number, number][]; // each point: [x/REF_W, y/REF_H] in [0,1]
}

export interface DrawingData {
  strokes: DrawingStroke[];
}

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

export interface DrawingCanvasHandle {
  clearAll: () => void;
}

export interface DrawingCanvasProps {
  pdfId: string;
  pageNumber: number;
  enabled: boolean;
  color: string;
  lineWidth: number;
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ pdfId, pageNumber, enabled, color, lineWidth }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<DrawingStroke[]>([]);
    const currentStrokeRef = useRef<DrawingStroke | null>(null);
    const isDrawingRef = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        ctx.strokeStyle = stroke.color;
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

    // Load saved drawing when page changes.
    useEffect(() => {
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
    }, [pdfId, pageNumber, redraw]);

    const scheduleSave = useCallback(() => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveDrawingToServer(pdfId, pageNumber, { strokes: strokesRef.current });
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
        },
      }),
      [pdfId, pageNumber, redraw],
    );

    const getNorm = useCallback((e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      return [
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      ];
    }, []);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!enabled) return;
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        isDrawingRef.current = true;
        const norm = getNorm(e);
        currentStrokeRef.current = {
          color,
          lineWidth: lineWidth * (REF_H / 1080),
          points: [norm],
        };
      },
      [enabled, color, lineWidth, getNorm],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!enabled || !isDrawingRef.current || !currentStrokeRef.current) return;
        e.preventDefault();
        currentStrokeRef.current.points.push(getNorm(e));
        redraw();
      },
      [enabled, redraw, getNorm],
    );

    const handlePointerUp = useCallback(
      (_e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current || !currentStrokeRef.current) return;
        isDrawingRef.current = false;
        if (currentStrokeRef.current.points.length >= 2) {
          strokesRef.current.push(currentStrokeRef.current);
          scheduleSave();
        }
        currentStrokeRef.current = null;
        redraw();
      },
      [redraw, scheduleSave],
    );

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: enabled ? 'auto' : 'none',
          cursor: enabled ? 'crosshair' : 'default',
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
