import { useEffect, useState } from 'react';
import { getOpenAIKeyStatus, type OpenAIKeyStatusResponse } from './api/system';

/**
 * 「LLM／TTS 功能現在能不能用」的前端單一狀態來源。
 *
 * 判斷本身在後端（providerAvailability.ts），這裡只負責取回來、快取、以及在設定變更後
 * 讓所有畫面同步更新——不然每個掛著 AI 按鈕的元件都得自己打一次 /openai-key-status，
 * 而且使用者剛貼上 key 之後，其他分頁上的按鈕還會停在灰掉的舊狀態。
 */
export interface ProviderStatus {
  llmEnabled: boolean;
  ttsEnabled: boolean;
  /** 還沒拿到後端回應前為 false；此時按鈕不該灰掉（樂觀假設可用，避免載入中閃一下）。 */
  loaded: boolean;
}

const UNKNOWN_STATUS: ProviderStatus = { llmEnabled: true, ttsEnabled: true, loaded: false };

let cached: ProviderStatus = UNKNOWN_STATUS;
let inflight: Promise<ProviderStatus> | null = null;
const listeners = new Set<(status: ProviderStatus) => void>();

export function toProviderStatus(resp: OpenAIKeyStatusResponse): ProviderStatus {
  return {
    // 舊版後端沒有這兩個欄位；缺欄位時退回 has_key（LLM）／視為可用（TTS），寧可讓使用者
    // 點下去拿到後端的 API_KEY_MISSING，也不要憑空把功能鎖住。
    llmEnabled: resp.llm_enabled ?? resp.has_key,
    ttsEnabled: resp.tts_enabled ?? true,
    loaded: true,
  };
}

function publish(status: ProviderStatus): void {
  cached = status;
  for (const listener of listeners) listener(status);
}

/** 讀取（必要時抓取）目前狀態；同時間的多個呼叫共用同一個請求。 */
export function loadProviderStatus(): Promise<ProviderStatus> {
  if (cached.loaded) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getOpenAIKeyStatus()
      .then((resp) => {
        const status = toProviderStatus(resp);
        publish(status);
        return status;
      })
      .catch(() => cached)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 設定頁存檔後呼叫：重新抓一次並通知所有畫面。 */
export function refreshProviderStatus(): Promise<ProviderStatus> {
  cached = { ...cached, loaded: false };
  inflight = null;
  return loadProviderStatus();
}

export function useProviderStatus(): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>(cached);
  useEffect(() => {
    listeners.add(setStatus);
    void loadProviderStatus().then(setStatus);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}

/** 測試用：把 module 內的快取清乾淨。 */
export function resetProviderStatusForTest(): void {
  cached = UNKNOWN_STATUS;
  inflight = null;
  listeners.clear();
}
