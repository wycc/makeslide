import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { SlideAnimationEffect, SlideAnimationEffectType, SlideAnimationEase } from '../../types';
import {
  FOCUS_EFFECT_TYPES,
  MAX_SLIDE_ANIMATION_EFFECTS,
  SLIDE_ANIMATION_EASES,
  SLIDE_ANIMATION_EFFECT_TYPES,
  defaultAnimationSpec,
  generateFocusEffectsFromTranscript,
  getFocusEffectParams,
  resolveStartTriggerSeconds,
} from '../../lib/animationSpec';
import { usePlayPageContext } from './PlayPageContext';

const FOCUS_PARAM_LABELS = {
  xPct: 'play.animation.focusX',
  yPct: 'play.animation.focusY',
  widthPct: 'play.animation.focusWidth',
  heightPct: 'play.animation.focusHeight',
} as const satisfies Record<string, TranslationKey>;

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
  } = usePlayPageContext();
  const { t } = useI18n();

  const draft = animationDraft ?? defaultAnimationSpec();
  const disabled = isReadOnlyProcessing || animationBusy || !currentPage;

  const updateEffect = (id: string, patch: Partial<SlideAnimationEffect>) => {
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      return {
        ...base,
        effects: base.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      };
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
      {draft.effects.length === 0 ? (
        <div className="mb-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-500">
          {t('play.animation.noEffects')}
        </div>
      ) : (
        <div className="mb-2 space-y-2">
          {draft.effects.map((effect) => (
            <div
              key={effect.id}
              className="flex flex-wrap items-end gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
            >
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
                      {ease}
                    </option>
                  ))}
                </select>
              </label>
              {FOCUS_EFFECT_TYPES.includes(effect.type) && (
                <div className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.focusPosition')}
                  <div className="flex gap-1">
                    {(Object.keys(FOCUS_PARAM_LABELS) as Array<keyof typeof FOCUS_PARAM_LABELS>).map((key) => (
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
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setAnimationDraft((prev) => {
                    const base = prev ?? defaultAnimationSpec();
                    return { ...base, effects: base.effects.filter((e) => e.id !== effect.id) };
                  })
                }
                className="ml-auto rounded-md border border-rose-600/50 bg-rose-600/15 px-2 py-1 text-xs text-rose-300 hover:bg-rose-600/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('play.animation.delete')}
              </button>
            </div>
          ))}
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
      </div>

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
