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
import { appendConversationMessages, cloneAnimationSpec, defaultAnimationSpec } from '../../lib/animationSpec';
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
   * AI 產生 `custom-script` 程式碼時，依 effect id 即時累積的串流輸出文字。產生
   * 成功後會移除對應的 key，改由 `effect.code` 提供最終內容；產生失敗時則保留，
   * 讓使用者能看到中途產生的內容以對照錯誤訊息。
   */
  customScriptStreamingCode: Record<string, string>;
  /**
   * AI 產生 `custom-script` 動畫的第一階段：依 effect id 即時累積的「實作步驟」串流
   * 文字。步驟產生完成後會移除對應的 key，並將完整步驟加入對話紀錄；產生失敗時
   * 一併移除。
   */
  customScriptStreamingPlan: Record<string, string>;
  /**
   * 將使用者輸入的訊息加入該 `custom-script` 效果的對話紀錄（`conversation`），
   * 連同先前對話與目前程式碼一併送給後端 LLM。後端先產生一份實作步驟（顯示於
   * 對話框中），再依步驟產生程式碼；依回應更新 `code` 與對話紀錄（產生成功時
   * 依序加入步驟訊息與完成訊息，失敗時加入錯誤訊息），讓使用者能以多輪對話逐步
   * 調整動畫，並可對照步驟手動修改程式碼。
   */
  handleSendCustomScriptMessage: (effectId: string, message: string) => Promise<boolean>;
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
  const [customScriptStreamingCode, setCustomScriptStreamingCode] = useState<Record<string, string>>({});
  const [customScriptStreamingPlan, setCustomScriptStreamingPlan] = useState<Record<string, string>>({});

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

  const handleSendCustomScriptMessage = useCallback(
    async (effectId: string, message: string): Promise<boolean> => {
      const prompt = message.trim();
      if (!pdfId || !currentPage || !prompt) return false;
      const effect = animationDraft?.effects.find((e) => e.id === effectId && e.type === 'custom-script');
      if (!effect) return false;
      const previousCode = effect.code;
      const history = effect.conversation ?? [];
      setCustomScriptBusy(true);
      setCustomScriptBusyEffectId(effectId);
      setAnimationError(null);
      setAnimationMessage(null);
      setCustomScriptStreamingCode((prev) => ({ ...prev, [effectId]: '' }));
      setCustomScriptStreamingPlan((prev) => ({ ...prev, [effectId]: '' }));
      setAnimationDraft((prev) => {
        const base = prev ?? defaultAnimationSpec();
        return {
          ...base,
          effects: base.effects.map((e) =>
            e.id === effectId
              ? { ...e, conversation: appendConversationMessages(e.conversation, { role: 'user', content: prompt }) }
              : e,
          ),
        };
      });
      const clearStreamingPlan = () => {
        setCustomScriptStreamingPlan((prev) => {
          if (!(effectId in prev)) return prev;
          const next = { ...prev };
          delete next[effectId];
          return next;
        });
      };
      try {
        const res = await generateCustomScriptCode(
          pdfId,
          currentPage.page_number,
          { prompt, previousCode, history },
          {
            onPlanDelta: (delta) => {
              setCustomScriptStreamingPlan((prev) => ({ ...prev, [effectId]: (prev[effectId] ?? '') + delta }));
            },
            onPlanDone: (plan) => {
              clearStreamingPlan();
              if (!plan.trim()) return;
              setAnimationDraft((prev) => {
                const base = prev ?? defaultAnimationSpec();
                return {
                  ...base,
                  effects: base.effects.map((e) =>
                    e.id === effectId
                      ? {
                          ...e,
                          conversation: appendConversationMessages(e.conversation, {
                            role: 'assistant',
                            content: `${t('play.animation.customScriptPlanLabel')}\n${plan}`,
                          }),
                        }
                      : e,
                  ),
                };
              });
            },
            onDelta: (delta) => {
              setCustomScriptStreamingCode((prev) => ({ ...prev, [effectId]: (prev[effectId] ?? '') + delta }));
            },
          },
        );
        setAnimationDraft((prev) => {
          const base = prev ?? defaultAnimationSpec();
          return {
            ...base,
            effects: base.effects.map((e) =>
              e.id === effectId
                ? {
                    ...e,
                    code: res.code,
                    conversation: appendConversationMessages(e.conversation, {
                      role: 'assistant',
                      content: t('play.animation.customScriptDone'),
                    }),
                  }
                : e,
            ),
          };
        });
        setCustomScriptStreamingCode((prev) => {
          if (!(effectId in prev)) return prev;
          const next = { ...prev };
          delete next[effectId];
          return next;
        });
        setAnimationMessage(t('play.animation.customScriptDone'));
        return true;
      } catch (err) {
        const message =
          err instanceof ApiError && err.code === 'UNSAFE_SCRIPT'
            ? t('play.animation.customScriptUnsafe')
            : err instanceof ApiError && err.code === 'INVALID_SCRIPT_CONTRACT'
              ? t('play.animation.customScriptContractError')
              : err instanceof ApiError
                ? err.message
                : t('play.animation.customScriptError');
        clearStreamingPlan();
        setAnimationDraft((prev) => {
          const base = prev ?? defaultAnimationSpec();
          return {
            ...base,
            effects: base.effects.map((e) =>
              e.id === effectId
                ? { ...e, conversation: appendConversationMessages(e.conversation, { role: 'assistant', content: message }) }
                : e,
            ),
          };
        });
        setAnimationError(message);
        return false;
      } finally {
        setCustomScriptBusy(false);
        setCustomScriptBusyEffectId(null);
      }
    },
    [pdfId, currentPage, animationDraft, t],
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
    customScriptStreamingCode,
    customScriptStreamingPlan,
    handleSendCustomScriptMessage,
  };
}
