import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  ApiError,
  fetchPageAnimation,
  generateAiFocusEffects,
  generateCustomScriptCode,
  savePageAnimation,
} from '../../lib/api';
import type { PdfDetail, PdfDetailPage, SlideAnimationSpec } from '../../types';
import { cloneAnimationSpec, defaultAnimationSpec } from '../../lib/animationSpec';
import { useI18n } from '../../i18n';

interface UsePageAnimationParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  shareToken: string;
  editTab: string;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
}

export interface PageAnimationState {
  /** 最後一次自伺服器載入或儲存成功的 spec（播放時使用）。 */
  animationSavedSpec: SlideAnimationSpec | null;
  /** 動畫 Tab 編輯中的 draft；在動畫 Tab 開啟時即時預覽。 */
  animationDraft: SlideAnimationSpec | null;
  setAnimationDraft: Dispatch<SetStateAction<SlideAnimationSpec | null>>;
  animationBusy: boolean;
  animationError: string | null;
  animationMessage: string | null;
  animationWarning: string | null;
  setAnimationWarning: Dispatch<SetStateAction<string | null>>;
  handleSaveAnimation: () => Promise<boolean>;
  /** AI 自動產生逐字稿焦點動畫（呼叫中）。 */
  aiFocusBusy: boolean;
  /** 呼叫後端 LLM，依目前逐字稿句子決定每句的焦點效果，並覆蓋 draft 的 effects。 */
  handleGenerateAiFocusEffects: (sentences: string[], hints?: Record<string, string>) => Promise<boolean>;
  /** AI 產生/重新產生自訂腳本動畫程式碼（呼叫中）。 */
  customScriptBusy: boolean;
  /** Effect id currently being generated, so the editor can show per-row busy state. */
  customScriptBusyEffectId: string | null;
  /**
   * 呼叫後端 LLM，依提示詞（與選填的目前程式碼）產生 `custom-script` 效果的程式碼，
   * 並寫回該效果的 `code`/`prompt` 欄位。
   */
  handleGenerateCustomScriptCode: (effectId: string, prompt: string, previousCode?: string) => Promise<boolean>;
}

export function usePageAnimation({
  pdfId,
  currentPage,
  shareToken,
  editTab,
  setDetail,
}: UsePageAnimationParams): PageAnimationState {
  const { t } = useI18n();
  const [animationSavedSpec, setAnimationSavedSpec] = useState<SlideAnimationSpec | null>(null);
  const [animationDraft, setAnimationDraft] = useState<SlideAnimationSpec | null>(null);
  const [animationBusy, setAnimationBusy] = useState(false);
  const [animationError, setAnimationError] = useState<string | null>(null);
  const [animationMessage, setAnimationMessage] = useState<string | null>(null);
  const [animationWarning, setAnimationWarning] = useState<string | null>(null);
  const [aiFocusBusy, setAiFocusBusy] = useState(false);
  const [customScriptBusy, setCustomScriptBusy] = useState(false);
  const [customScriptBusyEffectId, setCustomScriptBusyEffectId] = useState<string | null>(null);

  const pageKey = pdfId && currentPage ? `${pdfId}:${currentPage.page_number}` : null;
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;
  // 已載入（或載入中）的頁面 key，避免重複請求；換頁時重置
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setAnimationSavedSpec(null);
    setAnimationDraft(null);
    setAnimationError(null);
    setAnimationMessage(null);
    setAnimationWarning(null);
    loadedKeyRef.current = null;
  }, [pageKey]);

  useEffect(() => {
    if (!pdfId || !currentPage || !pageKey) return;
    const needsLoad = currentPage.render_type === 'gsap-image' || editTab === 'animation';
    if (!needsLoad || loadedKeyRef.current === pageKey) return;
    loadedKeyRef.current = pageKey;
    const requestKey = pageKey;
    const wasAnimated = currentPage.render_type === 'gsap-image';
    void (async () => {
      try {
        const res = await fetchPageAnimation(pdfId, currentPage.page_number, shareToken);
        if (pageKeyRef.current !== requestKey) return;
        setAnimationSavedSpec(res.spec);
        setAnimationDraft(cloneAnimationSpec(res.spec));
      } catch {
        if (pageKeyRef.current !== requestKey) return;
        if (wasAnimated) setAnimationWarning(t('play.animation.loadWarning'));
        setAnimationSavedSpec(defaultAnimationSpec());
        setAnimationDraft(defaultAnimationSpec());
      }
    })();
  }, [pdfId, currentPage, pageKey, editTab, shareToken, t]);

  const handleSaveAnimation = useCallback(async (): Promise<boolean> => {
    if (!pdfId || !currentPage || !animationDraft) return false;
    setAnimationBusy(true);
    setAnimationError(null);
    setAnimationMessage(null);
    try {
      const res = await savePageAnimation(pdfId, currentPage.page_number, animationDraft);
      setAnimationSavedSpec(cloneAnimationSpec(animationDraft));
      setAnimationMessage(t('play.animation.saved'));
      const pageNumber = currentPage.page_number;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              pages: prev.pages.map((p) =>
                p.page_number === pageNumber
                  ? { ...p, render_type: res.render_type, animation_spec_url: res.animation_spec_url }
                  : p,
              ),
            }
          : prev,
      );
      return true;
    } catch (err) {
      setAnimationError(err instanceof ApiError ? err.message : t('play.animation.saveError'));
      return false;
    } finally {
      setAnimationBusy(false);
    }
  }, [pdfId, currentPage, animationDraft, setDetail, t]);

  const handleGenerateAiFocusEffects = useCallback(
    async (sentences: string[], hints?: Record<string, string>): Promise<boolean> => {
      if (!pdfId || !currentPage || sentences.length === 0) return false;
      setAiFocusBusy(true);
      setAnimationError(null);
      setAnimationMessage(null);
      try {
        const res = await generateAiFocusEffects(pdfId, currentPage.page_number, { sentences, hints });
        setAnimationDraft((prev) => ({
          ...(prev ?? defaultAnimationSpec()),
          enabled: true,
          effects: res.effects,
        }));
        setAnimationMessage(t('play.animation.autoGenerateFocusAiDone'));
        return true;
      } catch (err) {
        setAnimationError(err instanceof ApiError ? err.message : t('play.animation.autoGenerateFocusAiError'));
        return false;
      } finally {
        setAiFocusBusy(false);
      }
    },
    [pdfId, currentPage, t],
  );

  const handleGenerateCustomScriptCode = useCallback(
    async (effectId: string, prompt: string, previousCode?: string): Promise<boolean> => {
      if (!pdfId || !currentPage || !prompt.trim()) return false;
      setCustomScriptBusy(true);
      setCustomScriptBusyEffectId(effectId);
      setAnimationError(null);
      setAnimationMessage(null);
      try {
        const res = await generateCustomScriptCode(pdfId, currentPage.page_number, { prompt, previousCode });
        setAnimationDraft((prev) => {
          const base = prev ?? defaultAnimationSpec();
          return {
            ...base,
            effects: base.effects.map((e) => (e.id === effectId ? { ...e, code: res.code, prompt } : e)),
          };
        });
        setAnimationMessage(t('play.animation.customScriptDone'));
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNSAFE_SCRIPT') {
          setAnimationError(t('play.animation.customScriptUnsafe'));
        } else if (err instanceof ApiError && err.code === 'INVALID_SCRIPT_CONTRACT') {
          setAnimationError(t('play.animation.customScriptContractError'));
        } else {
          setAnimationError(err instanceof ApiError ? err.message : t('play.animation.customScriptError'));
        }
        return false;
      } finally {
        setCustomScriptBusy(false);
        setCustomScriptBusyEffectId(null);
      }
    },
    [pdfId, currentPage, t],
  );

  return {
    animationSavedSpec,
    animationDraft,
    setAnimationDraft,
    animationBusy,
    animationError,
    animationMessage,
    animationWarning,
    setAnimationWarning,
    handleSaveAnimation,
    aiFocusBusy,
    handleGenerateAiFocusEffects,
    customScriptBusy,
    customScriptBusyEffectId,
    handleGenerateCustomScriptCode,
  };
}
