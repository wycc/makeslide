import { useEffect, useRef, useState } from 'react';
import { usePlayPageContext } from './PlayPageContext';
import { normalizedPointerPosition } from '../../lib/normalizedPointerPosition';

type Pt = { x: number; y: number };

// 疊在投影片上的旁白層：
//  - 錄音時：擷取指標動作（移動=游標、按住拖曳=畫筆）並**即時把游標與筆跡畫在畫面上**，讓講者看到自己畫的線。
//  - 播放時：依時間軸重播游標點與筆跡（筆跡會隨時間一段段長出來）。
// 座標相對本層（inset-0）——擷取與重播共用同一座標空間，故一致。一般檢視與全螢幕皆可掛。
export function NarrationSlideOverlay() {
  const { narrationCapture, narrationOverlay } = usePlayPageContext();

  // 錄音期間的即時筆跡（已完成的筆畫）、目前正在畫的一筆、與目前游標位置。
  const [liveStrokes, setLiveStrokes] = useState<Pt[][]>([]);
  const [liveCurrent, setLiveCurrent] = useState<Pt[] | null>(null);
  const [liveCursor, setLiveCursor] = useState<Pt | null>(null);
  const drawingRef = useRef(false);

  const capturing = narrationCapture.active && !!narrationCapture.onCapture;

  // 每次開始/結束一段錄製，清掉上一段殘留的即時筆跡。
  useEffect(() => {
    if (!capturing) {
      setLiveStrokes([]);
      setLiveCurrent(null);
      setLiveCursor(null);
      drawingRef.current = false;
    }
  }, [capturing]);

  return (
    <>
      {/* 播放時的重播疊加 */}
      {narrationOverlay && (
        <>
          <svg
            className="pointer-events-none absolute inset-0 z-40 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {narrationOverlay.strokes.map((s, i) => (
              <polyline
                key={i}
                points={s.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                fill="none"
                stroke="#ef4444"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {narrationOverlay.cursor && (
            <span
              className="pointer-events-none absolute z-40 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-700 bg-cyan-400/80 shadow"
              style={{ left: `${narrationOverlay.cursor.x * 100}%`, top: `${narrationOverlay.cursor.y * 100}%` }}
              aria-hidden="true"
            />
          )}
        </>
      )}

      {/* 錄音時的即時筆跡（讓講者看到正在畫的線） */}
      {capturing && (liveStrokes.length > 0 || liveCurrent) && (
        <svg
          className="pointer-events-none absolute inset-0 z-40 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[...liveStrokes, ...(liveCurrent ? [liveCurrent] : [])].map((pts, i) => (
            <polyline
              key={i}
              points={pts.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
              fill="none"
              stroke="#ef4444"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
      {capturing && liveCursor && (
        <span
          className="pointer-events-none absolute z-40 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-700 bg-cyan-400/80 shadow"
          style={{ left: `${liveCursor.x * 100}%`, top: `${liveCursor.y * 100}%` }}
          aria-hidden="true"
        />
      )}

      {/* 錄音擷取層 */}
      {capturing && (
        <div
          className="absolute inset-0 z-50 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            drawingRef.current = true;
            setLiveCurrent([{ x, y }]);
            setLiveCursor({ x, y });
            narrationCapture.onCapture?.('down', x, y);
          }}
          onPointerMove={(e) => {
            const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            setLiveCursor({ x, y });
            if (drawingRef.current) setLiveCurrent((cur) => (cur ? [...cur, { x, y }] : [{ x, y }]));
            narrationCapture.onCapture?.('move', x, y);
          }}
          onPointerUp={(e) => {
            const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            narrationCapture.onCapture?.('up', x, y);
            drawingRef.current = false;
            setLiveCurrent((cur) => {
              if (cur && cur.length > 1) setLiveStrokes((all) => [...all, cur]);
              return null;
            });
          }}
        />
      )}
    </>
  );
}
