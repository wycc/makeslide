// 測驗錄影「人頭偵測」的提示狀態機（第一步、純函式）。
//
// 規畫中的功能：測驗錄影時在瀏覽器端偵測鏡頭裡是否有人頭，若一段時間偵測不到就提示
// 學生並顯示鏡頭預覽，直到重新入鏡。逐幀偵測（FaceDetector API 或輕量模型）本身會有
// 單幀誤判（偶爾一兩幀抓不到臉），若每次沒抓到就閃提示會非常干擾。這裡先固化「偵測
// 結果序列 → 是否提示」的去抖邏輯，作為之後接偵測迴圈／UI 的可測基礎。
//
// 遲滯設計（避免閃爍）：
// - 開啟提示需「連續 missThreshold 幀未偵測到」（on-delay 去抖）。
// - 一旦偵測到人頭即立刻清除提示並歸零計數（快速恢復，off-delay = 0）。

export interface HeadDetectionState {
  /** 目前連續未偵測到人頭的幀數。 */
  consecutiveMisses: number;
  /** 是否正顯示「請入鏡」提示。 */
  prompting: boolean;
}

export const initialHeadDetectionState: HeadDetectionState = {
  consecutiveMisses: 0,
  prompting: false,
};

// 依最新一幀的偵測結果推進狀態。`missThreshold` 會被夾為至少 1。
export function updateHeadDetectionState(
  state: HeadDetectionState,
  headDetected: boolean,
  missThreshold: number,
): HeadDetectionState {
  if (headDetected) {
    // 偵測到人頭：立即清除提示、歸零連續未偵測計數（快速恢復）。
    if (state.consecutiveMisses === 0 && !state.prompting) return state;
    return { consecutiveMisses: 0, prompting: false };
  }
  const threshold = Math.max(1, Math.floor(missThreshold));
  const consecutiveMisses = state.consecutiveMisses + 1;
  // 一旦提示開啟，維持到偵測到人頭為止（上面的 headDetected 分支才會關閉）。
  const prompting = state.prompting || consecutiveMisses >= threshold;
  return { consecutiveMisses, prompting };
}
