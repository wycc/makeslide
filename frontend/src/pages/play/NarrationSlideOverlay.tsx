import DrawingCanvas from '../../components/DrawingCanvas';
import { usePlayPageContext } from './PlayPageContext';

// 疊在投影片上的旁白「重播」層：播放旁白時同步重現當時的手繪（用唯讀 DrawingCanvas 還原快照，
// 完整保留顏色/粗細/橡皮擦）與游標（十字樣式）。錄製時的畫筆與游標由原生畫筆與外框 pointermove 負責，
// 不在此層攔截。
export function NarrationSlideOverlay() {
  const { pdfId, currentPage, narrationOverlay } = usePlayPageContext();
  if (!narrationOverlay) return null;
  const cursor = narrationOverlay.cursor;
  return (
    <>
      {pdfId && currentPage && narrationOverlay.drawing && (
        <DrawingCanvas
          pdfId={pdfId}
          pageNumber={currentPage.page_number}
          enabled={false}
          color="#ef4444"
          lineWidth={4}
          remoteData={narrationOverlay.drawing}
        />
      )}
      {cursor && (
        <svg
          className="pointer-events-none absolute z-40 h-6 w-6 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <line x1="2" y1="12" x2="22" y2="12" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="12" y1="2" x2="12" y2="22" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )}
    </>
  );
}
