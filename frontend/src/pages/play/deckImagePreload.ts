// 進入簡報後在背景把整份簡報的圖片抓進來，讓之後的翻頁不必等網路。
// 這裡只放純邏輯（順序、保留上限），實際的載入在 useDeckImagePreload.ts。

/** 同時進行的預載數量。 */
export const PRELOAD_CONCURRENCY = 4;

/**
 * 最多保留幾張「已解碼」的圖片（`HTMLImageElement` 參照）。
 *
 * 刻意不是「全部」：解碼後的點陣圖是 寬×高×4 bytes，一張 1920×1080 就約 8 MB，
 * 一份 100 頁的簡報全數保留會逼近 1 GB，分頁直接被瀏覽器殺掉——那比慢一點更糟。
 * 超出上限的圖片只是放掉參照，**位元組仍留在瀏覽器的 HTTP 快取裡**，之後顯示不必
 * 再連一次網路（原本的瓶頸），只是多一次解碼。目前頁附近的那幾張才需要連解碼都免。
 */
export const RETAINED_DECODED_IMAGES = 24;

/** 開始背景預載前的等待時間，讓目前這一頁的圖片與語音先搶到頻寬。 */
export const BACKGROUND_PRELOAD_DELAY_MS = 2000;

/**
 * 預載順序：從目前頁往外擴散，同距離時「後面的頁」優先。
 *
 * 照 0..n 的順序抓，在第 80 頁按下播放時會先去抓第 1 頁——那是使用者最不需要的一張。
 * 播放一定是往後走，所以先把接下來要看的抓好，往前的當作回頭翻頁的保險。
 */
export function preloadOrderFromIndex(total: number, currentIdx: number): number[] {
  if (total <= 0) return [];
  const start = Math.min(Math.max(Math.trunc(currentIdx) || 0, 0), total - 1);
  const order: number[] = [start];
  for (let distance = 1; order.length < total; distance++) {
    const forward = start + distance;
    if (forward < total) order.push(forward);
    const backward = start - distance;
    if (backward >= 0) order.push(backward);
  }
  return order;
}

/**
 * 在還沒滿 `cap` 之前才保留這張圖的參照，回傳有沒有真的留下。
 *
 * 「滿了就丟最舊的」在這裡剛好是反的：載入順序是由近而遠（見 preloadOrderFromIndex），
 * 丟最舊的等於把離目前頁最近、最可能馬上要用的那幾張丟掉，留下一整批最遠的。
 * 先到先留，留下的就正好是起始頁附近那幾張；其餘的仍在 HTTP 快取裡。
 */
export function retainWithinCap<T>(map: Map<string, T>, key: string, value: T, cap: number): boolean {
  if (map.has(key)) return true;
  if (map.size >= Math.max(cap, 0)) return false;
  map.set(key, value);
  return true;
}

/**
 * 依預載順序排出還沒抓過的網址。
 *
 * `srcs` 以頁碼為索引，沒有圖片的頁是 null（例如 notebook 頁）。已在 `done` 裡的
 * 會被略過，所以每次換頁重新排序都只是把「剩下的」重排，不會重抓。
 */
export function pendingPreloadUrls(
  srcs: Array<string | null>,
  currentIdx: number,
  done: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const idx of preloadOrderFromIndex(srcs.length, currentIdx)) {
    const src = srcs[idx];
    if (!src || done.has(src) || seen.has(src)) continue;
    seen.add(src);
    urls.push(src);
  }
  return urls;
}
