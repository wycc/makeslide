import { useEffect, useRef, useState } from 'react';

import {
  BACKGROUND_PRELOAD_DELAY_MS,
  PRELOAD_CONCURRENCY,
  RETAINED_DECODED_IMAGES,
  pendingPreloadUrls,
  retainWithinCap,
} from './deckImagePreload';

export interface DeckImagePreloadState {
  /** 已抓完的張數（含失敗的——那一張不會再重試，否則壞掉的頁會一直卡住佇列）。 */
  loaded: number;
  /** 這份簡報總共有幾張要抓。 */
  total: number;
}

/**
 * 進入簡報後，在背景把整份簡報的圖片抓進瀏覽器快取。
 *
 * 原本只預抓「目前頁」與「下一頁」，往前翻或跳頁時仍然要現抓，投影片會空一下。
 * 這裡改為整份抓完，代價是進場後多一段背景流量，因此：延後 `BACKGROUND_PRELOAD_DELAY_MS`
 * 才開始（先讓目前頁的圖與語音拿到頻寬）、同時只開 `PRELOAD_CONCURRENCY` 條，
 * 並只保留最近 `RETAINED_DECODED_IMAGES` 張的解碼結果（理由見 deckImagePreload.ts）。
 *
 * `srcs` 要傳「播放時真的會用的那個網址」（含 bust 參數），否則抓進快取的是另一個 key，
 * 等於白抓。以頁碼為索引，沒有圖片的頁給 null。
 */
export function useDeckImagePreload(params: {
  srcs: Array<string | null>;
  currentIdx: number;
  enabled: boolean;
}): DeckImagePreloadState {
  const { srcs, currentIdx, enabled } = params;
  // 已處理過的網址（成功或失敗都算），跨 effect 重跑保留，才不會每次換頁重抓一輪。
  const doneRef = useRef<Set<string>>(new Set());
  // 保留解碼結果的窗，超出上限就放掉參照（位元組仍在 HTTP 快取）。
  const retainedRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [loaded, setLoaded] = useState(0);
  // 只用來決定「先抓哪一張」。放 ref 而不是 effect 依賴：翻頁若重跑 effect，那個
  // BACKGROUND_PRELOAD_DELAY_MS 的計時器每次都會重來，播放中一直翻頁就永遠不會開始抓。
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;

  // 換一份簡報就重來：沿用上一份的 done 會讓新簡報永遠抓不滿。以「有圖的網址集合」
  // 當身分，同一份簡報只是換頁不會觸發。
  const deckKey = srcs.filter(Boolean).join('|');
  useEffect(() => {
    doneRef.current = new Set();
    retainedRef.current = new Map();
    setLoaded(0);
  }, [deckKey]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const inFlight = new Set<HTMLImageElement>();

    const timer = window.setTimeout(() => {
      const queue = pendingPreloadUrls(srcs, currentIdxRef.current, doneRef.current);
      if (queue.length === 0) return;
      let cursor = 0;

      const startNext = (): void => {
        if (cancelled) return;
        const url = queue[cursor];
        cursor += 1;
        if (url === undefined) return;
        // 兩條 worker 之間可能已經有人抓過同一張（換頁重排時的交叉），再查一次。
        if (doneRef.current.has(url)) {
          startNext();
          return;
        }
        const img = new Image();
        inFlight.add(img);
        const settle = () => {
          inFlight.delete(img);
          img.onload = null;
          img.onerror = null;
          if (cancelled) return;
          doneRef.current.add(url);
          retainWithinCap(retainedRef.current, url, img, RETAINED_DECODED_IMAGES);
          setLoaded(doneRef.current.size);
          startNext();
        };
        img.onload = settle;
        // 失敗也算處理完：這一張再試也還是壞的，重試只會擋住後面的頁。
        img.onerror = settle;
        img.src = url;
      };

      for (let worker = 0; worker < Math.min(PRELOAD_CONCURRENCY, queue.length); worker++) {
        startNext();
      }
    }, BACKGROUND_PRELOAD_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // 離開時停掉還在飛的請求，否則切換簡報後仍在替上一份耗頻寬。
      for (const img of inFlight) {
        img.onload = null;
        img.onerror = null;
        img.src = '';
      }
      inFlight.clear();
    };
  }, [enabled, srcs]);

  return { loaded, total: srcs.filter(Boolean).length };
}
