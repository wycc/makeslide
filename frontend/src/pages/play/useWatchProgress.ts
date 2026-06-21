import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { reportWatchProgress } from '../../lib/api';
import { evaluateWatchCompletion } from '../../lib/watchProgress';
import { getOrCreateViewerId } from '../../lib/viewerId';
import { createSequentialQueue } from '../../lib/saveQueue';

const TICK_MS = 1000;

interface UseWatchProgressParams {
  pdfId: string | undefined;
  pageNumber: number | undefined;
  audioRef: RefObject<HTMLAudioElement | null>;
  durationMs: number | null;
}

interface PendingReport {
  pdfId: string;
  pageNumber: number;
  listenedMs: number;
  tabHiddenMs: number;
  durationMs: number | null;
  onEndedFired: boolean;
}

/**
 * 背景被動追蹤目前頁面的觀看進度（語音播放時間 vs 分頁是否在前景），換頁或卸載時
 * 回報給後端。這是 LOOP.md 要求的「多種不同方法確認使用者有認真看完簡報內容」的
 * 資料收集端：交叉比對 onEnded（音訊播完）、listenedMs（分頁可見且正在播放的累計
 * 時間）、tabHiddenMs（分頁被切到背景但音訊仍在播放的累計時間）三個獨立訊號，由
 * evaluateWatchCompletion() 統一判定是否視為「完整聽過」。
 *
 * 回報請求透過 createSequentialQueue 排隊，避免快速換頁時兩個回報請求競態、後送出
 * 但較快抵達的請求被較早送出但較慢抵達的請求蓋掉。回報失敗（網路錯誤）不顯示任何
 * UI 錯誤訊息——這是背景被動追蹤，不是使用者主動觸發的操作。
 */
export function useWatchProgress({ pdfId, pageNumber, audioRef, durationMs }: UseWatchProgressParams): void {
  const viewerIdRef = useRef<string>('');
  if (!viewerIdRef.current) {
    viewerIdRef.current = getOrCreateViewerId();
  }

  const listenedMsRef = useRef(0);
  const tabHiddenMsRef = useRef(0);
  const onEndedFiredRef = useRef(false);
  // 記錄「目前正在累積的這一頁」自己的語音長度，獨立於 durationMs 參數——換頁時
  // durationMs 早已先被父元件更新成新頁面的值，若直接讀取目前的 durationMs 來回報
  // 舊頁面的資料會張冠李戴，所以換頁時改用這個 ref 記住的「舊頁面那份」長度。
  const currentPageDurationMsRef = useRef<number | null>(durationMs);

  // 換頁後，這一頁的語音長度可能是非同步載入的（一開始是 null，稍後 onLoadedMetadata
  // 才補上實際秒數）；只要還是同一頁，就持續更新成最新值。
  const pdfIdRef = useRef(pdfId);
  const pageNumberRef = useRef(pageNumber);
  if (pdfIdRef.current === pdfId && pageNumberRef.current === pageNumber) {
    currentPageDurationMsRef.current = durationMs;
  }
  pdfIdRef.current = pdfId;
  pageNumberRef.current = pageNumber;

  const sendReportRef = useRef(
    createSequentialQueue(async (report: PendingReport) => {
      try {
        const completed = evaluateWatchCompletion({
          onEndedFired: report.onEndedFired,
          listenedMs: report.listenedMs,
          tabHiddenMs: report.tabHiddenMs,
          durationMs: report.durationMs,
        });
        await reportWatchProgress(report.pdfId, report.pageNumber, {
          viewer_id: viewerIdRef.current,
          listened_ms: report.listenedMs,
          tab_hidden_ms: report.tabHiddenMs,
          duration_ms: report.durationMs,
          completed,
        });
      } catch {
        // 背景被動追蹤；網路錯誤不顯示任何使用者可見的錯誤提示。
      }
    }),
  );

  const flushAndResetFor = (flushPdfId: string | undefined, flushPageNumber: number | undefined) => {
    if (flushPdfId && flushPageNumber != null) {
      if (listenedMsRef.current > 0 || tabHiddenMsRef.current > 0 || onEndedFiredRef.current) {
        void sendReportRef.current({
          pdfId: flushPdfId,
          pageNumber: flushPageNumber,
          listenedMs: listenedMsRef.current,
          tabHiddenMs: tabHiddenMsRef.current,
          durationMs: currentPageDurationMsRef.current,
          onEndedFired: onEndedFiredRef.current,
        });
      }
    }
    listenedMsRef.current = 0;
    tabHiddenMsRef.current = 0;
    onEndedFiredRef.current = false;
  };

  // 固定頻率累加：只要音訊正在播放，依分頁是否可見分別累加到 listenedMs 或 tabHiddenMs。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      if (document.visibilityState === 'visible') {
        listenedMsRef.current += TICK_MS;
      } else {
        tabHiddenMsRef.current += TICK_MS;
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [audioRef]);

  // 音訊播畢（自然播放到結尾，非使用者提前切頁）的訊號，獨立於上面的 tick 計時。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      onEndedFiredRef.current = true;
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audioRef, pageNumber]);

  // 換頁時：對剛離開的那一頁送出最後一次回報，並重置累加值準備累積新頁面的資料。
  const previousPageRef = useRef<{ pdfId: string | undefined; pageNumber: number | undefined }>({
    pdfId: undefined,
    pageNumber: undefined,
  });
  useEffect(() => {
    const previous = previousPageRef.current;
    flushAndResetFor(previous.pdfId, previous.pageNumber);
    previousPageRef.current = { pdfId, pageNumber };
    // flushAndResetFor 依賴的所有狀態都透過 ref 讀取，刻意只在 pdfId/pageNumber
    // 變化時觸發，避免 durationMs 非同步補上時誤判成換頁。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId, pageNumber]);

  // 元件卸載（離開播放頁）時，對目前頁送出最後一次回報；即使因頁面正在卸載而可能
  // 送不出去也沒關係。不使用 navigator.sendBeacon——專案其他地方未用過，維持風格一致。
  useEffect(() => {
    return () => {
      flushAndResetFor(pdfIdRef.current, pageNumberRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
