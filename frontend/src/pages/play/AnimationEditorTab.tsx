import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { SlideAnimationEffect, SlideAnimationEffectType, SlideAnimationEase } from '../../types';
import {
  DEFAULT_EXIT_DURATION_SECONDS,
  MAX_CUSTOM_SCRIPT_CODE_LENGTH,
  MAX_CUSTOM_SCRIPT_PROMPT_LENGTH,
  MAX_HINT_LENGTH,
  MAX_SLIDE_ANIMATION_EFFECTS,
  MAX_TEXT_CALLOUT_LENGTH,
  OVERLAY_EFFECT_TYPES,
  SLIDE_ANIMATION_EASES,
  SLIDE_ANIMATION_EFFECT_TYPES,
  buildCustomScriptSandboxDoc,
  customScriptDurationSeconds,
  defaultAnimationSpec,
  generateFocusEffectsFromTranscript,
  getFocusEffectParams,
  resolveStartTriggerSeconds,
} from '../../lib/animationSpec';
import { usePlayPageContext } from './PlayPageContext';

/** 預覽用迴圈總長（秒）：與實際播放時傳給 sandbox 的 `api.duration` 相同，並夾在合理範圍內以免預覽迴圈過長。 */
function previewLoopSeconds(effect: SlideAnimationEffect): number {
  return Math.min(20, Math.max(2, customScriptDurationSeconds(effect)));
}

/**
 * custom-script 效果的即時預覽：在 sandboxed iframe 中載入目前的 `code`，並持續送出
 * `{ type: 'sync', t, playing: true }` 訊息，讓畫面依 0~loopSeconds 反覆播放，
 * 方便使用者在反覆調整提示詞時立即看到結果。
 */
function CustomScriptPreview({ effect }: { effect: SlideAnimationEffect }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loopSeconds = previewLoopSeconds(effect);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const startedAt = performance.now();
    let rafId = 0;
    const tick = () => {
      const t = ((performance.now() - startedAt) / 1000) % loopSeconds;
      iframe.contentWindow?.postMessage({ type: 'sync', t, playing: true }, '*');
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [effect.code, loopSeconds]);

  return (
    <iframe
      ref={iframeRef}
      key={effect.code ?? ''}
      title="custom-script preview"
      sandbox="allow-scripts"
      srcDoc={buildCustomScriptSandboxDoc(effect.code ?? '', loopSeconds)}
      className="h-40 w-full rounded-md border border-slate-700 bg-slate-950"
    />
  );
}

const FOCUS_PARAM_LABELS = {
  xPct: 'play.animation.focusX',
  yPct: 'play.animation.focusY',
  widthPct: 'play.animation.focusWidth',
  heightPct: 'play.animation.focusHeight',
} as const satisfies Record<string, TranslationKey>;

const EASE_LABELS = {
  none: 'play.animation.ease.none',
  'power1.in': 'play.animation.ease.power1In',
  'power1.out': 'play.animation.ease.power1Out',
  'power1.inOut': 'play.animation.ease.power1InOut',
  'power2.inOut': 'play.animation.ease.power2InOut',
} as const satisfies Record<SlideAnimationEase, TranslationKey>;

function newEffect(): SlideAnimationEffect {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `effect-${Date.now()}`,
    target: 'slide',
    type: 'fade-in',
    start: 0,
    duration: 1,
    ease: 'power1.out',
  };
}

/** 句子文字過長時，於下拉選單中截斷顯示。 */
function truncateSentence(text: string, maxLen = 18): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export function AnimationEditorTab() {
  const {
    currentPage,
    animationDraft, setAnimationDraft,
    animationBusy,
    animationError,
    animationMessage,
    handleSaveAnimation,
    handlePreviewAnimation,
    isReadOnlyProcessing,
    pageSentences,
    sentenceTimeline,
    currentTime,
    handleSeekToTime,
    aiFocusBusy,
    handleGenerateAiFocusEffects,
    customScriptBusy,
    customScriptBusyEffectId,
    customScriptStreamingCode,
    customScriptStreamingPlan,
    handleSendCustomScriptMessage,
  } = usePlayPageContext();
  const { t } = useI18n();
  const [customScriptDialogEffectId, setCustomScriptDialogEffectId] = useState<string | null>(null);
  const [customScriptChatInput, setCustomScriptChatInput] = useState('');
  const customScriptChatScrollRef = useRef<HTMLDivElement>(null);
  const [selectedEffectIds, setSelectedEffectIds] = useState<Set<string>>(new Set());

  const draft = animationDraft ?? defaultAnimationSpec();
  const disabled = isReadOnlyProcessing || animationBusy || !currentPage;
  const customScriptDialogEffect = useMemo(
    () => draft.effects.find((effect) => effect.id === customScriptDialogEffectId && effect.type === 'custom-script') ?? null,
    [draft.effects, customScriptDialogEffectId],
  );
  // AI 產生中（或最近一次產生失敗）時顯示即時串流內容；否則顯示已儲存於 draft 的 code。
  const customScriptSourceValue = customScriptDialogEffect
    ? customScriptStreamingCode[customScriptDialogEffect.id] ?? customScriptDialogEffect.code ?? ''
    : '';
  const customScriptConversation = customScriptDialogEffect?.conversation ?? [];
  const customScriptIsBusy = customScriptBusyEffectId === customScriptDialogEffectId;
  // 第一階段（實作步驟）串流中的文字；步驟產生完成後會從這裡移除並併入 customScriptConversation。
  const customScriptPlanStreaming = customScriptDialogEffect
    ? customScriptStreamingPlan[customScriptDialogEffect.id]
    : undefined;

  // 開啟對話框（或切換效果）時清空尚未送出的訊息。
  useEffect(() => {
    setCustomScriptChatInput('');
  }, [customScriptDialogEffectId]);

  // 對話內容增加或產生中狀態改變時，自動捲動到最新訊息。
  useEffect(() => {
    const el = customScriptChatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [customScriptConversation.length, customScriptIsBusy]);

  // 切換頁面時清空已選擇的效果，避免跨頁合併。
  useEffect(() => {
    setSelectedEffectIds(new Set());
  }, [currentPage?.page_number]);

  const sendCustomScriptChatMessage = () => {
    if (!customScriptDialogEffect || disabled || customScriptBusy || !customScriptChatInput.trim()) return;
    void handleSendCustomScriptMessage(customScriptDialogEffect.id, customScriptChatInput);
    setCustomScriptChatInput('');
  };

  const updateEffect = (id: string, patch: Partial<SlideAnimationEffect>) => {
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      return {
        ...base,
        effects: base.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      };
    });
  };

  /**
   * 將已選擇的效果合併成一個：起點取最早的起始時間，長度延伸至最晚的結束時間，其餘設定沿用最早的效果。
   * 若最早的效果原本是依逐字稿句子觸發（`startTrigger`），合併後維持該觸發設定，不轉換為絕對秒數；
   * `start` 仍更新為目前解析出的秒數，作為轉錄被編輯導致無法解析時的備援值。
   */
  const handleMergeSelectedEffects = () => {
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      const selected = base.effects.filter((e) => selectedEffectIds.has(e.id));
      if (selected.length < 2) return base;
      const ranges = selected.map((effect) => {
        const start = effect.startTrigger
          ? resolveStartTriggerSeconds(effect.startTrigger, sentenceTimeline) ?? effect.start
          : effect.start;
        return { effect, start, end: start + effect.duration };
      });
      const minStart = Math.min(...ranges.map((r) => r.start));
      const maxEnd = Math.max(...ranges.map((r) => r.end));
      const earliest = ranges.reduce((a, b) => (b.start < a.start ? b : a)).effect;
      const merged: SlideAnimationEffect = {
        ...earliest,
        start: minStart,
        duration: maxEnd - minStart,
      };
      const selectedIds = new Set(selected.map((e) => e.id));
      return {
        ...base,
        effects: base.effects
          .filter((e) => !selectedIds.has(e.id) || e.id === earliest.id)
          .map((e) => (e.id === earliest.id ? merged : e)),
      };
    });
    setSelectedEffectIds(new Set());
  };

  const updateHint = (line: number, text: string) => {
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      const hints = { ...(base.hints ?? {}) };
      const key = String(line);
      if (text) {
        hints[key] = text;
      } else {
        delete hints[key];
      }
      return { ...base, hints: Object.keys(hints).length > 0 ? hints : undefined };
    });
  };

  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-slate-300">
        🎞 {t('play.animation.title')}（第 {currentPage?.page_number ?? '-'} 頁）
      </h2>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(e) =>
            setAnimationDraft((prev) => ({ ...(prev ?? defaultAnimationSpec()), enabled: e.target.checked }))
          }
          className="h-4 w-4 accent-fuchsia-500"
        />
        {t('play.animation.enabled')}
      </label>

      <div className="mb-2 text-xs font-semibold text-slate-400">{t('play.animation.effectList')}</div>
      {draft.effects.length > 1 && (
        <div className="mb-2 text-[11px] text-slate-500">{t('play.animation.multiSelectHint')}</div>
      )}
      {draft.effects.length === 0 ? (
        <div className="mb-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-500">
          {t('play.animation.noEffects')}
        </div>
      ) : (
        <div className="mb-2 space-y-2">
          {draft.effects.map((effect) => {
            const effectStart = effect.startTrigger
              ? resolveStartTriggerSeconds(effect.startTrigger, sentenceTimeline) ?? effect.start
              : effect.start;
            const effectEnd = effectStart + effect.duration + (effect.exitDuration ?? 0);
            const isActive = currentTime >= effectStart && currentTime <= effectEnd;
            const isSelected = selectedEffectIds.has(effect.id);
            return (
            <div
              key={effect.id}
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                setSelectedEffectIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(effect.id)) next.delete(effect.id);
                  else next.add(effect.id);
                  return next;
                });
              }}
              className={`flex flex-col gap-2 rounded-md border px-3 py-2 transition-colors ${
                isActive ? 'border-fuchsia-400 bg-fuchsia-500/15' : 'border-slate-800 bg-slate-900/50'
              } ${isSelected ? 'ring-2 ring-cyan-400' : ''}`}
            >
              <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                disabled={disabled}
                title={t('play.animation.seekToMidpoint')}
                aria-label={t('play.animation.seekToMidpoint')}
                onClick={() => handleSeekToTime(effectStart + effect.duration / 2)}
                className="rounded-md border border-slate-700 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏱
              </button>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                {t('play.animation.effectType')}
                <select
                  value={effect.type}
                  disabled={disabled}
                  onChange={(e) => updateEffect(effect.id, { type: e.target.value as SlideAnimationEffectType })}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                >
                  {SLIDE_ANIMATION_EFFECT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`play.animation.type.${type}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                {t('play.animation.startMode')}
                <select
                  value={effect.startTrigger ? 'transcript-line' : 'time'}
                  disabled={disabled}
                  onChange={(e) => {
                    if (e.target.value === 'transcript-line') {
                      updateEffect(effect.id, {
                        startTrigger: effect.startTrigger ?? { type: 'transcript-line', line: 0 },
                      });
                    } else {
                      const resolved = effect.startTrigger
                        ? resolveStartTriggerSeconds(effect.startTrigger, sentenceTimeline)
                        : undefined;
                      updateEffect(effect.id, {
                        start: resolved ?? effect.start,
                        startTrigger: undefined,
                      });
                    }
                  }}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                >
                  <option value="time">{t('play.animation.startMode.time')}</option>
                  <option value="transcript-line" disabled={pageSentences.length === 0}>
                    {t('play.animation.startMode.transcript')}
                  </option>
                </select>
              </label>
              {effect.startTrigger ? (
                pageSentences.length > 0 ? (
                  <>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.startTranscriptLine')}
                      <select
                        value={effect.startTrigger.line}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, {
                            startTrigger: {
                              ...effect.startTrigger!,
                              type: 'transcript-line',
                              line: Number(e.target.value),
                            },
                          })
                        }
                        className="max-w-[14rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                      >
                        {pageSentences.map((sentence, idx) => (
                          <option key={idx} value={idx}>
                            {idx + 1}. {truncateSentence(sentence)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.startOffsetSeconds')}
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step={0.1}
                        value={effect.startTrigger.offsetSeconds ?? 0}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, {
                            startTrigger: {
                              ...effect.startTrigger!,
                              type: 'transcript-line',
                              offsetSeconds: Math.min(60, Math.max(0, Number(e.target.value) || 0)),
                            },
                          })
                        }
                        className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                      />
                      <span className="text-[11px] text-slate-500">
                        {t('play.animation.startResolved')}{' '}
                        {(resolveStartTriggerSeconds(effect.startTrigger, sentenceTimeline) ?? effect.start).toFixed(1)}
                        {t('play.animation.seconds')}
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.startTranscriptLine')}
                    <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-500">
                      {t('play.animation.noTranscript')}
                    </span>
                  </div>
                )
              ) : (
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.start')}
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={effect.start}
                    disabled={disabled}
                    onChange={(e) => updateEffect(effect.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                {t('play.animation.duration')}
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={effect.duration}
                  disabled={disabled}
                  onChange={(e) => updateEffect(effect.id, { duration: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                />
              </label>
              {effect.type !== 'custom-script' && (
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.ease')}
                  <select
                    value={effect.ease}
                    disabled={disabled}
                    onChange={(e) => updateEffect(effect.id, { ease: e.target.value as SlideAnimationEase })}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                  >
                    {SLIDE_ANIMATION_EASES.map((ease) => (
                      <option key={ease} value={ease}>
                        {t(EASE_LABELS[ease])}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {effect.type === 'text-callout' && (
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.textContent')}
                  <input
                    type="text"
                    maxLength={MAX_TEXT_CALLOUT_LENGTH}
                    value={effect.text ?? ''}
                    disabled={disabled}
                    placeholder={t('play.animation.textContentPlaceholder')}
                    onChange={(e) => updateEffect(effect.id, { text: e.target.value })}
                    className="w-40 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                  />
                </label>
              )}
              {OVERLAY_EFFECT_TYPES.includes(effect.type) && effect.type !== 'custom-script' && (
                <div className="flex flex-col gap-1 text-xs text-slate-400">
                  {t(effect.type === 'pointer' ? 'play.animation.pointerPosition' : 'play.animation.focusPosition')}
                  <div className="flex gap-1">
                    {(
                      effect.type === 'pointer'
                        ? (['xPct', 'yPct'] as const)
                        : (Object.keys(FOCUS_PARAM_LABELS) as Array<keyof typeof FOCUS_PARAM_LABELS>)
                    ).map((key) => (
                      <label key={key} className="flex flex-col items-center gap-0.5 text-[11px] text-slate-500">
                        {t(FOCUS_PARAM_LABELS[key])}
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={getFocusEffectParams(effect)[key]}
                          disabled={disabled}
                          onChange={(e) =>
                            updateEffect(effect.id, {
                              params: {
                                ...getFocusEffectParams(effect),
                                [key]: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                              },
                            })
                          }
                          className="w-14 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {OVERLAY_EFFECT_TYPES.includes(effect.type) && (
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.exitDuration')}
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={effect.exitDuration !== undefined}
                      disabled={disabled}
                      onChange={(e) =>
                        updateEffect(effect.id, {
                          exitDuration: e.target.checked ? DEFAULT_EXIT_DURATION_SECONDS : undefined,
                        })
                      }
                      className="h-4 w-4 accent-fuchsia-500"
                    />
                    <input
                      type="number"
                      min={0}
                      max={600}
                      step={0.1}
                      value={effect.exitDuration ?? DEFAULT_EXIT_DURATION_SECONDS}
                      disabled={disabled || effect.exitDuration === undefined}
                      onChange={(e) =>
                        updateEffect(effect.id, { exitDuration: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100 disabled:opacity-40"
                    />
                    {t('play.animation.seconds')}
                  </div>
                </label>
              )}
              {effect.type === 'custom-script' && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setCustomScriptDialogEffectId(effect.id)}
                  className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-1.5 text-sm text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('play.animation.customScriptEdit' as TranslationKey)}
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setAnimationDraft((prev) => {
                    const base = prev ?? defaultAnimationSpec();
                    return { ...base, effects: base.effects.filter((e) => e.id !== effect.id) };
                  });
                  setSelectedEffectIds((prev) => {
                    if (!prev.has(effect.id)) return prev;
                    const next = new Set(prev);
                    next.delete(effect.id);
                    return next;
                  });
                }}
                className="ml-auto rounded-md border border-rose-600/50 bg-rose-600/15 px-2 py-1 text-xs text-rose-300 hover:bg-rose-600/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('play.animation.delete')}
              </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {customScriptDialogEffect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {t('play.animation.customScriptDialogTitle' as TranslationKey)}
                </div>
                <div className="text-xs text-slate-500">{t('play.animation.customScriptDraftNote')}</div>
              </div>
              <button
                type="button"
                onClick={() => setCustomScriptDialogEffectId(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                {t('play.animation.customScriptClose' as TranslationKey)}
              </button>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
              <div className="flex min-h-0 flex-col gap-2">
                <div className="text-xs font-semibold text-slate-400">
                  {t('play.animation.customScriptPreview' as TranslationKey)}
                </div>
                {customScriptDialogEffect.code ? (
                  <CustomScriptPreview effect={customScriptDialogEffect} />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-md border border-slate-800 bg-slate-950 text-xs text-slate-500">
                    {t('play.animation.customScriptEmpty')}
                  </div>
                )}
                <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs text-slate-400">
                  <span className="flex items-center justify-between gap-2">
                    <span>{t('play.animation.customScriptSource' as TranslationKey)}</span>
                    <span className="text-[11px] text-slate-500">
                      {customScriptSourceValue.length}/{MAX_CUSTOM_SCRIPT_CODE_LENGTH}
                    </span>
                  </span>
                  <textarea
                    rows={16}
                    spellCheck={false}
                    maxLength={MAX_CUSTOM_SCRIPT_CODE_LENGTH}
                    value={customScriptSourceValue}
                    disabled={disabled || customScriptBusyEffectId === customScriptDialogEffect.id}
                    placeholder={t('play.animation.customScriptSourcePlaceholder' as TranslationKey)}
                    onChange={(e) => updateEffect(customScriptDialogEffect.id, { code: e.target.value })}
                    className="min-h-64 w-full flex-1 resize-y rounded-md border border-slate-700 bg-slate-950 px-2 py-2 font-mono text-xs leading-relaxed text-slate-100 disabled:opacity-50"
                  />
                  <span className="text-[11px] text-slate-500">
                    {t('play.animation.customScriptSourceHelp' as TranslationKey)}
                  </span>
                </label>
              </div>
              <div className="flex min-h-0 flex-col gap-3">
                <div
                  ref={customScriptChatScrollRef}
                  className="flex min-h-[8rem] flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-2"
                >
                  {customScriptConversation.length === 0 && !customScriptIsBusy ? (
                    <div className="m-auto text-xs text-slate-500">
                      {t('play.animation.customScriptChatEmpty' as TranslationKey)}
                    </div>
                  ) : (
                    <>
                      {customScriptConversation.map((msg, idx) => (
                        <div
                          key={idx}
                          className={
                            msg.role === 'user'
                              ? 'ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-fuchsia-500/20 px-3 py-2 text-sm text-fuchsia-100'
                              : 'mr-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200'
                          }
                        >
                          {msg.content}
                        </div>
                      ))}
                      {customScriptIsBusy && (
                        customScriptPlanStreaming !== undefined ? (
                          <div className="mr-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">
                            {customScriptPlanStreaming || t('play.animation.customScriptPlanBusy')}
                          </div>
                        ) : (
                          <div className="mr-auto max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-400">
                            {t('play.animation.customScriptGenerateBusy')}
                          </div>
                        )
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    maxLength={MAX_CUSTOM_SCRIPT_PROMPT_LENGTH}
                    value={customScriptChatInput}
                    disabled={disabled || customScriptBusy}
                    placeholder={t('play.animation.customScriptChatInputPlaceholder' as TranslationKey)}
                    onChange={(e) => setCustomScriptChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.shiftKey) return;
                      e.preventDefault();
                      sendCustomScriptChatMessage();
                    }}
                    className="flex-1 resize-y rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={disabled || customScriptBusy || !customScriptChatInput.trim()}
                    onClick={sendCustomScriptChatMessage}
                    className="shrink-0 rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-1.5 text-sm text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {customScriptIsBusy
                      ? t('play.animation.customScriptGenerateBusy')
                      : t('play.animation.customScriptChatSend' as TranslationKey)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || draft.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS}
          title={draft.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS ? t('play.animation.maxEffects') : undefined}
          onClick={() =>
            setAnimationDraft((prev) => {
              const base = prev ?? defaultAnimationSpec();
              return { ...base, effects: [...base.effects, newEffect()] };
            })
          }
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('play.animation.addEffect')}
        </button>
        {selectedEffectIds.size >= 2 && (
          <button
            type="button"
            disabled={disabled}
            onClick={handleMergeSelectedEffects}
            className="rounded-md border border-cyan-400/50 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('play.animation.mergeSelected')} ({selectedEffectIds.size})
          </button>
        )}
        <button
          type="button"
          disabled={disabled || pageSentences.length === 0}
          title={pageSentences.length === 0 ? t('play.animation.noTranscript') : undefined}
          onClick={() => {
            if (draft.effects.length > 0 && !window.confirm(t('play.animation.autoGenerateFocusConfirm'))) return;
            setAnimationDraft((prev) => ({
              ...(prev ?? defaultAnimationSpec()),
              enabled: true,
              effects: generateFocusEffectsFromTranscript(pageSentences.length),
            }));
          }}
          className="rounded-md border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('play.animation.autoGenerateFocus')}
        </button>
        <button
          type="button"
          disabled={disabled || pageSentences.length === 0 || aiFocusBusy}
          title={pageSentences.length === 0 ? t('play.animation.noTranscript') : undefined}
          onClick={() => {
            if (draft.effects.length > 0 && !window.confirm(t('play.animation.autoGenerateFocusAiConfirm'))) return;
            void handleGenerateAiFocusEffects(pageSentences, draft.hints);
          }}
          className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-1.5 text-sm text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {aiFocusBusy ? t('play.animation.autoGenerateFocusAiBusy') : t('play.animation.autoGenerateFocusAi')}
        </button>
      </div>

      {pageSentences.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold text-slate-400">{t('play.animation.hints')}</div>
          <div className="mb-2 text-[11px] text-slate-500">{t('play.animation.hintsDescription')}</div>
          <div className="space-y-2">
            {pageSentences.map((sentence, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-start gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
              >
                <div className="min-w-[8rem] flex-1 basis-64 text-xs text-slate-300">
                  {idx + 1}. {sentence}
                </div>
                <input
                  type="text"
                  maxLength={MAX_HINT_LENGTH}
                  value={draft.hints?.[String(idx)] ?? ''}
                  disabled={disabled}
                  placeholder={t('play.animation.hintsPlaceholder')}
                  onChange={(e) => updateHint(idx, e.target.value)}
                  className="min-w-[12rem] flex-1 basis-64 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          {animationError ? (
            <span className="text-rose-300">{animationError}</span>
          ) : animationMessage ? (
            <span className="text-slate-300">{animationMessage}</span>
          ) : (
            t('play.animation.videoExportNote')
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => handlePreviewAnimation()}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ▶ {t('play.animation.previewFromStart')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleSaveAnimation()}
            className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-sm text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {animationBusy ? '…' : t('play.animation.save')}
          </button>
        </div>
      </div>
    </>
  );
}
