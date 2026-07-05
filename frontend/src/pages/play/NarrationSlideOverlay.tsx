import { usePlayPageContext } from './PlayPageContext';
import { normalizedPointerPosition } from '../../lib/normalizedPointerPosition';

// 疊在投影片上的旁白層：錄音時擷取指標動作（移動=游標、按住拖曳=畫筆），播放時重播游標點與筆跡。
// 座標相對本層（inset-0）——擷取與重播共用同一座標空間，故一致。放在一般檢視與全螢幕檢視皆可。
export function NarrationSlideOverlay() {
  const { narrationCapture, narrationOverlay } = usePlayPageContext();
  return (
    <>
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
      {narrationCapture.active && narrationCapture.onCapture && (
        <div
          className="absolute inset-0 z-50 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            narrationCapture.onCapture?.('down', x, y);
          }}
          onPointerMove={(e) => {
            const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            narrationCapture.onCapture?.('move', x, y);
          }}
          onPointerUp={(e) => {
            const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            narrationCapture.onCapture?.('up', x, y);
          }}
        />
      )}
    </>
  );
}
