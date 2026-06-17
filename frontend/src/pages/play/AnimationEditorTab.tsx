import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import katex from 'katex';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { PageFigure, SlideAnimationEffect, SlideAnimationEffectType, SlideAnimationEase, SlideAnimationShapeKind } from '../../types';
import { fetchPageFigures, figureImageUrl, savePageAnimation } from '../../lib/api';
import {
  ANIMATION_SHAPE_KINDS,
  DEFAULT_EXIT_DURATION_SECONDS,
  MAX_CUSTOM_SCRIPT_CODE_LENGTH,
  MAX_CUSTOM_SCRIPT_PROMPT_LENGTH,
  MAX_FORMULA_LENGTH,
  MAX_HINT_LENGTH,
  MAX_SLIDE_ANIMATION_EFFECTS,
  MAX_STEP_LIST_ITEMS,
  MAX_STEP_LIST_ITEM_LENGTH,
  MAX_TEXT_CALLOUT_LENGTH,
  OVERLAY_EFFECT_TYPES,
  SLIDE_ANIMATION_EASES,
  SLIDE_ANIMATION_EFFECT_TYPES,
  TRANSFORM_EFFECT_TYPES,
  buildCustomScriptSandboxDoc,
  customScriptDurationSeconds,
  defaultAnimationSpec,
  generateFocusEffectsFromTranscript,
  getFocusEffectParams,
  getShapeKind,
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
  'elastic.out': 'play.animation.ease.elasticOut',
  'back.out': 'play.animation.ease.backOut',
} as const satisfies Record<SlideAnimationEase, TranslationKey>;

/** 拖曳 handle 種類：中央為移動，四邊與四角為縮放。 */
type DragHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const HANDLE_CURSORS: Record<DragHandle, string> = {
  move: 'move',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
};

/**
 * 在投影片縮圖上以拖曳方式直接編輯 overlay 效果的位置與大小。
 * 非 overlay 效果或 pointer/custom-script 效果僅顯示位置點（pointer）或不顯示。
 */
function EffectPositionEditor({
  effect,
  imageUrl,
  isPointerOnly,
  onParamsChange,
  disabled,
}: {
  effect: SlideAnimationEffect;
  imageUrl: string;
  /** pointer 效果只有 x/y，不需要 resize handle。 */
  isPointerOnly: boolean;
  onParamsChange: (params: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: DragHandle;
    startMouseX: number;
    startMouseY: number;
    startXPct: number;
    startYPct: number;
    startWidthPct: number;
    startHeightPct: number;
  } | null>(null);

  const { xPct, yPct, widthPct, heightPct } = getFocusEffectParams(effect);

  const clamp = useCallback((v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, handle: DragHandle) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startXPct: xPct,
      startYPct: yPct,
      startWidthPct: widthPct,
      startHeightPct: heightPct,
    };
  }, [disabled, xPct, yPct, widthPct, heightPct]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startMouseX) / rect.width) * 100;
    const dy = ((e.clientY - dragRef.current.startMouseY) / rect.height) * 100;
    const { handle, startXPct, startYPct, startWidthPct, startHeightPct } = dragRef.current;

    let newX = startXPct;
    let newY = startYPct;
    let newW = startWidthPct;
    let newH = startHeightPct;

    if (handle === 'move' || isPointerOnly) {
      newX = clamp(startXPct + dx, 0, 100);
      newY = clamp(startYPct + dy, 0, 100);
    } else {
      if (handle === 'e' || handle === 'ne' || handle === 'se') newW = clamp(startWidthPct + dx, 2, 100 - startXPct);
      if (handle === 'w' || handle === 'nw' || handle === 'sw') {
        const newWidth = clamp(startWidthPct - dx, 2, startXPct + startWidthPct);
        newX = startXPct + startWidthPct - newWidth;
        newW = newWidth;
      }
      if (handle === 's' || handle === 'se' || handle === 'sw') newH = clamp(startHeightPct + dy, 2, 100 - startYPct);
      if (handle === 'n' || handle === 'nw' || handle === 'ne') {
        const newHeight = clamp(startHeightPct - dy, 2, startYPct + startHeightPct);
        newY = startYPct + startHeightPct - newHeight;
        newH = newHeight;
      }
    }

    onParamsChange({
      xPct: Math.round(newX * 10) / 10,
      yPct: Math.round(newY * 10) / 10,
      widthPct: Math.round(newW * 10) / 10,
      heightPct: Math.round(newH * 10) / 10,
    });
  }, [clamp, isPointerOnly, onParamsChange]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleSize = 10;
  const half = handleSize / 2;

  const edgeHandles: { handle: DragHandle; style: React.CSSProperties }[] = isPointerOnly ? [] : [
    { handle: 'n',  style: { top: -half, left: '50%', transform: 'translateX(-50%)', width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.n } },
    { handle: 's',  style: { bottom: -half, left: '50%', transform: 'translateX(-50%)', width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.s } },
    { handle: 'e',  style: { right: -half, top: '50%', transform: 'translateY(-50%)', width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.e } },
    { handle: 'w',  style: { left: -half, top: '50%', transform: 'translateY(-50%)', width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.w } },
    { handle: 'nw', style: { top: -half, left: -half, width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.nw } },
    { handle: 'ne', style: { top: -half, right: -half, width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.ne } },
    { handle: 'sw', style: { bottom: -half, left: -half, width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.sw } },
    { handle: 'se', style: { bottom: -half, right: -half, width: handleSize, height: handleSize, cursor: HANDLE_CURSORS.se } },
  ];

  return (
    <div
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ position: 'relative', width: '100%', paddingTop: '56.25%', userSelect: 'none' }}
      className="overflow-hidden rounded-md border border-slate-700 bg-slate-950"
    >
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
      />
      {isPointerOnly ? (
        // pointer 效果：一個可拖曳的圓點
        <div
          onPointerDown={(e) => onPointerDown(e, 'move')}
          style={{
            position: 'absolute',
            left: `${xPct}%`,
            top: `${yPct}%`,
            width: 18,
            height: 18,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'rgba(244, 63, 94, 0.85)',
            border: '2px solid #fff',
            boxShadow: '0 0 6px 2px rgba(244,63,94,0.6)',
            cursor: disabled ? 'default' : 'move',
            touchAction: 'none',
          }}
        />
      ) : (
        // 一般 overlay 效果：可拖曳移動＋縮放的矩形
        <div
          onPointerDown={(e) => onPointerDown(e, 'move')}
          style={{
            position: 'absolute',
            left: `${xPct}%`,
            top: `${yPct}%`,
            width: `${widthPct}%`,
            height: `${heightPct}%`,
            border: '2px solid #a855f7',
            background: 'rgba(168, 85, 247, 0.15)',
            boxSizing: 'border-box',
            cursor: disabled ? 'default' : HANDLE_CURSORS.move,
            touchAction: 'none',
          }}
        >
          {edgeHandles.map(({ handle, style }) => (
            <div
              key={handle}
              onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, handle); }}
              style={{
                position: 'absolute',
                background: '#a855f7',
                borderRadius: 2,
                touchAction: 'none',
                ...style,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function generateEffectId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `effect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newEffect(): SlideAnimationEffect {
  return {
    id: generateEffectId(),
    target: 'slide',
    type: 'fade-in',
    start: 0,
    duration: 1,
    ease: 'power1.out',
  };
}

/** 一組常用動畫效果的快速套用範本：提供比 `newEffect()` 更貼近實際使用情境的預設值。 */
interface EffectPreset {
  id: string;
  labelKey: TranslationKey;
  apply: () => Partial<SlideAnimationEffect>;
}

const EFFECT_PRESETS: readonly EffectPreset[] = [
  {
    id: 'title-fade-in',
    labelKey: 'play.animation.preset.titleFadeIn',
    apply: () => ({ type: 'fade-in', duration: 1.2, ease: 'power1.out' }),
  },
  {
    id: 'zoom-in-emphasis',
    labelKey: 'play.animation.preset.zoomInEmphasis',
    apply: () => ({ type: 'zoom-in', duration: 2, ease: 'power1.inOut' }),
  },
  {
    id: 'pan-left-reveal',
    labelKey: 'play.animation.preset.panLeftReveal',
    apply: () => ({ type: 'pan-left', duration: 2.5, ease: 'power1.inOut' }),
  },
  {
    id: 'highlight-callout',
    labelKey: 'play.animation.preset.highlightCallout',
    apply: () => ({
      type: 'highlight-box',
      duration: 0.8,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
    }),
  },
  {
    id: 'spotlight-focus',
    labelKey: 'play.animation.preset.spotlightFocus',
    apply: () => ({
      type: 'spotlight',
      duration: 0.8,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
      params: { xPct: 20, yPct: 20, widthPct: 60, heightPct: 60 },
    }),
  },
  {
    id: 'text-callout-note',
    labelKey: 'play.animation.preset.textCalloutNote',
    apply: () => ({
      type: 'text-callout',
      duration: 1.5,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
      params: { xPct: 8, yPct: 78, widthPct: 40, heightPct: 14 },
    }),
  },
  {
    id: 'pointer-mark',
    labelKey: 'play.animation.preset.pointerMark',
    apply: () => ({
      type: 'pointer',
      duration: 1,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
    }),
  },
  {
    id: 'shape-circle',
    labelKey: 'play.animation.preset.shapeCircle',
    apply: () => ({
      type: 'shape',
      shape: 'circle',
      duration: 0.8,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
    }),
  },
  {
    id: 'step-list-points',
    labelKey: 'play.animation.preset.stepList',
    apply: () => ({
      type: 'step-list',
      duration: 2,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
      params: { xPct: 8, yPct: 18, widthPct: 44, heightPct: 40 },
    }),
  },
  {
    id: 'overlay-image-figure',
    labelKey: 'play.animation.preset.overlayImage',
    apply: () => ({
      type: 'overlay-image',
      duration: 0.8,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
      params: { xPct: 55, yPct: 55, widthPct: 35, heightPct: 35 },
    }),
  },
  {
    id: 'formula-insert',
    labelKey: 'play.animation.preset.formula',
    apply: () => ({
      type: 'formula',
      duration: 1,
      ease: 'power1.out',
      exitDuration: DEFAULT_EXIT_DURATION_SECONDS,
      params: { xPct: 30, yPct: 40, widthPct: 40, heightPct: 20 },
    }),
  },
];

const CUSTOM_SCRIPT_EXAMPLE_PROMPTS: ReadonlyArray<{ labelKey: string; prompt: string }> = [
  {
    labelKey: 'play.animation.customScriptExample.manImTex',
    prompt: '用 Manim 在畫面中央顯示愛因斯坦公式 E=mc²，公式淡入後放大到 1.5 倍再縮回原大小',
  },
  {
    labelKey: 'play.animation.customScriptExample.manimAxes',
    prompt: '用 Manim 畫一個座標平面，顯示一個點沿 y=x² 拋物線從左移到右，並在點旁標記 (x, x²) 座標',
  },
  {
    labelKey: 'play.animation.customScriptExample.manimCircleToSquare',
    prompt: '用 Manim 從圓形變形為正方形，搭配顏色由藍變紅',
  },
  {
    labelKey: 'play.animation.customScriptExample.canvasCount',
    prompt: '畫一個計數器，數字從 0 逐漸增加到 100，用 canvas 顯示大型數字',
  },
  {
    labelKey: 'play.animation.customScriptExample.svgArrow',
    prompt: '用 SVG 畫一條從左到右延伸的箭頭，邊延伸邊顯示標籤文字「成長 35%」',
  },
];

/** 句子文字過長時，於下拉選單中截斷顯示。 */
function truncateSentence(text: string, maxLen = 18): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export function AnimationEditorTab() {
  const {
    pdfId,
    currentPage,
    currentShareToken,
    withShareToken,
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
    totalPages,
  } = usePlayPageContext();
  const { t } = useI18n();
  const [customScriptDialogEffectId, setCustomScriptDialogEffectId] = useState<string | null>(null);
  const [customScriptChatInput, setCustomScriptChatInput] = useState('');
  const customScriptChatScrollRef = useRef<HTMLDivElement>(null);
  const [selectedEffectIds, setSelectedEffectIds] = useState<Set<string>>(new Set());
  const [notebookTab, setNotebookTab] = useState<'effects' | 'hints' | 'json'>('effects');
  const [jsonCopied, setJsonCopied] = useState(false);
  // 跨頁複製用的暫存區：不隨頁面切換清空，讓使用者可在切換到其他頁面後貼上。
  const [copiedEffects, setCopiedEffects] = useState<SlideAnimationEffect[] | null>(null);
  const [applyingToAll, setApplyingToAll] = useState(false);
  // overlay-image 效果的圖片選擇器：本頁可用的已擷取圖片清單。
  const [pageFigures, setPageFigures] = useState<PageFigure[] | null>(null);
  // 記錄每個 figureId 的原始長寬比（naturalWidth / naturalHeight），在圖片 onLoad 時取得。
  const [figureNaturalRatios, setFigureNaturalRatios] = useState<Record<string, number>>({});
  // 已啟用比例鎖定的 overlay-image 效果 ID 集合。
  const [lockedAspectEffectIds, setLockedAspectEffectIds] = useState<Set<string>>(new Set());

  const pageNumber = currentPage?.page_number;
  useEffect(() => {
    if (!pdfId || !pageNumber) {
      setPageFigures(null);
      return;
    }
    let cancelled = false;
    fetchPageFigures(pdfId, pageNumber, currentShareToken)
      .then((res) => {
        if (!cancelled) setPageFigures(res.figures);
      })
      .catch(() => {
        if (!cancelled) setPageFigures(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, currentShareToken]);

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

  /** 調整效果在清單中的順序；順序也決定重疊 overlay 效果的疊加層次（越後面越上層）。 */
  const moveEffect = (id: string, direction: 'up' | 'down') => {
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      const index = base.effects.findIndex((e) => e.id === id);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (index === -1 || targetIndex < 0 || targetIndex >= base.effects.length) return base;
      const effects = [...base.effects];
      const temp = effects[index]!;
      effects[index] = effects[targetIndex]!;
      effects[targetIndex] = temp;
      return { ...base, effects };
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

  /** 將本頁所有效果複製到暫存區，供切換至其他頁面後貼上（跨頁複製）。 */
  const handleCopyPageEffects = () => {
    if (draft.effects.length === 0) return;
    setCopiedEffects(structuredClone(draft.effects));
  };

  /**
   * 將暫存區中的效果加入本頁效果清單：每個效果都產生新的 `id`，避免與本頁既有效果或
   * 來源頁面的效果衝突；超過 `MAX_SLIDE_ANIMATION_EFFECTS` 上限的部分會被忽略。
   */
  const handlePastePageEffects = () => {
    if (!copiedEffects || copiedEffects.length === 0) return;
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      const room = MAX_SLIDE_ANIMATION_EFFECTS - base.effects.length;
      if (room <= 0) return base;
      const pasted = copiedEffects.slice(0, room).map((effect) => ({ ...effect, id: generateEffectId() }));
      return { ...base, effects: [...base.effects, ...pasted] };
    });
  };

  /** 將本頁動畫設定（含 enabled 旗標、所有效果、hints）套用至全部其他頁面。 */
  const handleApplyToAllPages = async () => {
    if (!pdfId || !currentPage || totalPages <= 1) return;
    const otherCount = totalPages - 1;
    if (!window.confirm(t('play.animation.applyToAllConfirm').replace('{n}', String(otherCount)))) return;
    setApplyingToAll(true);
    const spec = draft;
    try {
      for (let n = 1; n <= totalPages; n++) {
        if (n === currentPage.page_number) continue;
        await savePageAnimation(pdfId, n, spec);
      }
    } finally {
      setApplyingToAll(false);
    }
  };

  /** 依選定的範本新增一個效果，套用範本中預先調整好的型別／長度／速度變化等常用設定。 */
  const handleApplyPreset = (presetId: string) => {
    const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setAnimationDraft((prev) => {
      const base = prev ?? defaultAnimationSpec();
      if (base.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS) return base;
      return { ...base, effects: [...base.effects, { ...newEffect(), ...preset.apply() }] };
    });
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
        <select
          disabled={disabled || draft.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS}
          title={t('play.animation.presetApplyHint')}
          defaultValue=""
          onChange={(e) => {
            const presetId = e.target.value;
            if (presetId) handleApplyPreset(presetId);
            e.target.value = '';
          }}
          className="rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <option value="">{t('play.animation.presetApply')}</option>
          {EFFECT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(preset.labelKey)}
            </option>
          ))}
        </select>
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
          disabled={disabled || draft.effects.length === 0}
          title={t('play.animation.copyPageEffectsHint')}
          onClick={handleCopyPageEffects}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('play.animation.copyPageEffects')}
        </button>
        {copiedEffects && copiedEffects.length > 0 && (
          <button
            type="button"
            disabled={disabled || draft.effects.length >= MAX_SLIDE_ANIMATION_EFFECTS}
            title={t('play.animation.pastePageEffectsHint')}
            onClick={handlePastePageEffects}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('play.animation.pastePageEffects')} ({copiedEffects.length})
          </button>
        )}
        {totalPages > 1 && (
          <button
            type="button"
            disabled={disabled || applyingToAll}
            title={t('play.animation.applyToAllPagesHint')}
            onClick={() => { void handleApplyToAllPages(); }}
            className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {applyingToAll ? t('play.animation.applyToAllPagesBusy') : t('play.animation.applyToAllPages')}
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

      <div className="mb-2 flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/60">
        <button
          type="button"
          onClick={() => setNotebookTab('effects')}
          className={`flex-1 px-3 py-1.5 text-sm ${notebookTab === 'effects' ? 'bg-slate-800 text-fuchsia-200' : 'text-slate-400'}`}
        >
          {t('play.animation.effectList')} ({draft.effects.length})
        </button>
        <button
          type="button"
          onClick={() => setNotebookTab('hints')}
          className={`flex-1 px-3 py-1.5 text-sm ${notebookTab === 'hints' ? 'bg-slate-800 text-fuchsia-200' : 'text-slate-400'}`}
        >
          {t('play.animation.hints')}
          {pageSentences.length > 0 ? ` (${Object.keys(draft.hints ?? {}).length}/${pageSentences.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setNotebookTab('json')}
          className={`flex-1 px-3 py-1.5 text-sm ${notebookTab === 'json' ? 'bg-slate-800 text-fuchsia-200' : 'text-slate-400'}`}
        >
          {t('play.animation.rawJson')}
        </button>
      </div>

      <div className="mb-3 max-h-[60vh] space-y-2 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/30 p-2">
      {notebookTab === 'effects' ? (
        <>
        {draft.effects.length > 1 && (
          <div className="text-[11px] text-slate-500">{t('play.animation.multiSelectHint')}</div>
        )}
        {draft.effects.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-500">
            {t('play.animation.noEffects')}
          </div>
        ) : (
          draft.effects.map((effect, index) => {
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
              {draft.effects.length > 1 && (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    title={t('play.animation.moveUp')}
                    aria-label={t('play.animation.moveUp')}
                    onClick={() => moveEffect(effect.id, 'up')}
                    className="rounded-md border border-slate-700 px-1.5 py-0.5 text-xs leading-none text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === draft.effects.length - 1}
                    title={t('play.animation.moveDown')}
                    aria-label={t('play.animation.moveDown')}
                    onClick={() => moveEffect(effect.id, 'down')}
                    className="rounded-md border border-slate-700 px-1.5 py-0.5 text-xs leading-none text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={disabled}
                title={t('play.animation.jumpToEffectStart')}
                aria-label={t('play.animation.jumpToEffectStart')}
                onClick={() => handleSeekToTime(effectStart)}
                className="rounded-md border border-slate-700 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏮
              </button>
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
              {effect.type === 'highlight-box' && (
                <>
                <div className="flex gap-3 items-end">
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.highlightColor')}
                    <input
                      type="color"
                      value={effect.highlightColor ?? '#ef4444'}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { highlightColor: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.highlightBorderWidth')}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        step={1}
                        value={effect.highlightBorderWidth ?? 4}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, { highlightBorderWidth: Math.min(12, Math.max(1, Math.round(Number(e.target.value) || 4))) })
                        }
                        className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                      />
                      <span className="text-slate-500">px</span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.highlightBorderStyle')}
                    <select
                      value={effect.highlightBorderStyle ?? 'solid'}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { highlightBorderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    >
                      <option value="solid">{t('play.animation.highlightBorderStyle.solid')}</option>
                      <option value="dashed">{t('play.animation.highlightBorderStyle.dashed')}</option>
                      <option value="dotted">{t('play.animation.highlightBorderStyle.dotted')}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.highlightBorderRadius')}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={50}
                        step={2}
                        value={effect.highlightBorderRadius ?? 8}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, { highlightBorderRadius: Math.min(50, Math.max(0, Math.round(Number(e.target.value)))) })
                        }
                        className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                      />
                      <span className="text-slate-500">px</span>
                    </div>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={effect.highlightOuterColor !== undefined}
                    disabled={disabled}
                    onChange={(e) =>
                      updateEffect(effect.id, { highlightOuterColor: e.target.checked ? '#ffffff' : undefined })
                    }
                    className="h-4 w-4 accent-fuchsia-500"
                  />
                  {t('play.animation.highlightOuterColor')}
                  {effect.highlightOuterColor !== undefined && (
                    <input
                      type="color"
                      value={effect.highlightOuterColor}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { highlightOuterColor: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  )}
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={effect.highlightPulse ?? false}
                    disabled={disabled}
                    onChange={(e) =>
                      updateEffect(effect.id, { highlightPulse: e.target.checked || undefined })
                    }
                    className="h-4 w-4 accent-fuchsia-500"
                  />
                  {t('play.animation.highlightPulse')}
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={effect.highlightFillColor !== undefined}
                    disabled={disabled}
                    onChange={(e) =>
                      updateEffect(effect.id, { highlightFillColor: e.target.checked ? '#ef444430' : undefined })
                    }
                    className="h-4 w-4 accent-fuchsia-500"
                  />
                  {t('play.animation.highlightFillColor')}
                  {effect.highlightFillColor !== undefined && (
                    <input
                      type="color"
                      value={effect.highlightFillColor.slice(0, 7)}
                      disabled={disabled}
                      onChange={(e) => {
                        const alpha = effect.highlightFillColor?.slice(7) ?? '30';
                        updateEffect(effect.id, { highlightFillColor: `${e.target.value}${alpha}` });
                      }}
                      className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  )}
                </label>
                </>
              )}
              {effect.type === 'spotlight' && (
                <div className="flex gap-2 items-end">
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.spotlightColor')}
                    <input
                      type="color"
                      value={effect.spotlightColor ?? '#000000'}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { spotlightColor: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.spotlightOpacity')}
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={effect.spotlightOpacity ?? 0.6}
                      disabled={disabled}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) updateEffect(effect.id, { spotlightOpacity: Math.min(1, Math.max(0, v)) });
                      }}
                      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.spotlightSoftEdge')}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={80}
                        step={4}
                        value={effect.spotlightSoftEdge ?? 0}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, { spotlightSoftEdge: Math.min(80, Math.max(0, Math.round(Number(e.target.value)))) })
                        }
                        className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                      />
                      <span className="text-slate-500">px</span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.spotlightShape')}
                    <select
                      value={effect.spotlightShape ?? 'circle'}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { spotlightShape: e.target.value as 'circle' | 'rect' })}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    >
                      <option value="circle">{t('play.animation.spotlightShape.circle')}</option>
                      <option value="rect">{t('play.animation.spotlightShape.rect')}</option>
                    </select>
                  </label>
                  {(effect.spotlightShape ?? 'circle') === 'rect' && (
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.spotlightBorderRadius')}
                      <input
                        type="number"
                        min={0}
                        max={32}
                        step={4}
                        value={effect.spotlightBorderRadius ?? 8}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { spotlightBorderRadius: Math.max(0, Math.min(32, Math.round(Number(e.target.value) || 0))) })}
                        className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                  )}
                </div>
              )}
              {effect.type === 'text-callout' && (
                <>
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
                  <div className="flex gap-2">
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.textCalloutBgColor')}
                      <input
                        type="color"
                        value={effect.textCalloutBgColor ?? '#0f172a'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { textCalloutBgColor: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.textCalloutTextColor')}
                      <input
                        type="color"
                        value={effect.textCalloutTextColor ?? '#f8fafc'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { textCalloutTextColor: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.textCalloutFontSize')}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0.5}
                        max={3}
                        step={0.125}
                        value={effect.textCalloutFontSize ?? 1.25}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, { textCalloutFontSize: Math.min(3, Math.max(0.5, Number(e.target.value) || 1.25)) })
                        }
                        className="w-20 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                      />
                      <span className="text-slate-500">rem</span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    {t('play.animation.textCalloutBorderRadius')}
                    <input
                      type="number"
                      min={0}
                      max={32}
                      step={2}
                      value={effect.textCalloutBorderRadius ?? 8}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { textCalloutBorderRadius: Math.max(0, Math.min(32, Math.round(Number(e.target.value) || 8))) })}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    <span className="text-slate-500">px</span>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.textCalloutAlign')}
                    <select
                      value={effect.textCalloutAlign ?? 'center'}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { textCalloutAlign: e.target.value as 'left' | 'center' | 'right' })}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    >
                      <option value="left">{t('play.animation.textCalloutAlign.left')}</option>
                      <option value="center">{t('play.animation.textCalloutAlign.center')}</option>
                      <option value="right">{t('play.animation.textCalloutAlign.right')}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!effect.textCalloutBorderColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { textCalloutBorderColor: e.target.checked ? '#ffffff' : undefined })}
                      />
                      {t('play.animation.textCalloutBorderColor')}
                    </span>
                    {effect.textCalloutBorderColor && (
                      <input
                        type="color"
                        value={effect.textCalloutBorderColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { textCalloutBorderColor: e.target.value })}
                        className="h-8 w-full cursor-pointer rounded border border-slate-700 bg-slate-900"
                      />
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={!!effect.textCalloutShadow}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { textCalloutShadow: e.target.checked || undefined })}
                    />
                    {t('play.animation.textCalloutShadow')}
                  </label>
                </>
              )}
              {effect.type === 'shape' && (
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.shapeKind')}
                  <select
                    value={getShapeKind(effect)}
                    disabled={disabled}
                    onChange={(e) => updateEffect(effect.id, { shape: e.target.value as SlideAnimationShapeKind })}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                  >
                    {ANIMATION_SHAPE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`play.animation.shapeKind.${kind}` as TranslationKey)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {effect.type === 'shape' && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.shapeColor')}
                      <input
                        type="color"
                        value={effect.color ?? '#f43f5e'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { color: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.shapeStrokeWidth')}
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        value={effect.strokeWidth ?? 5}
                        disabled={disabled}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(20, Math.round(Number(e.target.value))));
                          updateEffect(effect.id, { strokeWidth: Number.isFinite(v) ? v : 5 });
                        }}
                        className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={effect.shapeFillColor !== undefined}
                      disabled={disabled}
                      onChange={(e) =>
                        updateEffect(effect.id, { shapeFillColor: e.target.checked ? (effect.color ?? '#f43f5e') : undefined })
                      }
                      className="h-4 w-4 accent-fuchsia-500"
                    />
                    {t('play.animation.shapeFillColor')}
                    {effect.shapeFillColor !== undefined && (
                      <input
                        type="color"
                        value={effect.shapeFillColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { shapeFillColor: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    {t('play.animation.shapeOpacity')}
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={effect.shapeOpacity ?? 1}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { shapeOpacity: Math.max(0, Math.min(1, parseFloat(e.target.value) || 1)) })}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.shapeDashArray')}
                    <input
                      type="text"
                      maxLength={20}
                      value={effect.shapeDashArray ?? ''}
                      disabled={disabled}
                      placeholder="e.g. 8 4"
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^\d. ]/g, '').slice(0, 20);
                        updateEffect(effect.id, { shapeDashArray: val || undefined });
                      }}
                      className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  {(effect.shape ?? 'circle') === 'rect' && (
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.shapeRectRadius')}
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={2}
                        value={effect.shapeRectRadius ?? 6}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { shapeRectRadius: Math.max(0, Math.min(24, Math.round(Number(e.target.value) || 0))) })}
                        className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                  )}
                </div>
              )}
              {effect.type === 'step-list' && (
                <>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.stepListItems')}
                    <textarea
                      rows={3}
                      value={(effect.items ?? []).join('\n')}
                      disabled={disabled}
                      placeholder={t('play.animation.stepListItemsPlaceholder')}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split('\n')
                          .slice(0, MAX_STEP_LIST_ITEMS)
                          .map((line) => line.slice(0, MAX_STEP_LIST_ITEM_LENGTH));
                        updateEffect(effect.id, { items: lines.some((line) => line.trim().length > 0) ? lines : undefined });
                      }}
                      className="w-48 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    />
                  </label>
                  <div className="flex gap-3">
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.stepListBgColor')}
                      <input
                        type="color"
                        value={effect.stepListBgColor ?? '#1e293b'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { stepListBgColor: e.target.value })}
                        className="h-8 w-10 cursor-pointer rounded border border-slate-700 bg-slate-900 p-0.5"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.stepListTextColor')}
                      <input
                        type="color"
                        value={effect.stepListTextColor ?? '#f1f5f9'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { stepListTextColor: e.target.value })}
                        className="h-8 w-10 cursor-pointer rounded border border-slate-700 bg-slate-900 p-0.5"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.stepListFontSize')}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0.5}
                        max={2.5}
                        step={0.1}
                        value={effect.stepListFontSize ?? 1.1}
                        disabled={disabled}
                        onChange={(e) =>
                          updateEffect(effect.id, { stepListFontSize: Math.min(2.5, Math.max(0.5, Number(e.target.value) || 1.1)) })
                        }
                        className="w-20 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                      />
                      <span className="text-slate-500">rem</span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    {t('play.animation.stepListBorderRadius')}
                    <input
                      type="number"
                      min={0}
                      max={32}
                      step={2}
                      value={effect.stepListBorderRadius ?? 8}
                      disabled={disabled}
                      onChange={(e) =>
                        updateEffect(effect.id, { stepListBorderRadius: Math.min(32, Math.max(0, Math.round(Number(e.target.value)))) })
                      }
                      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                    />
                    <span className="text-slate-500">px</span>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!effect.stepListBorderColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { stepListBorderColor: e.target.checked ? '#ffffff' : undefined })}
                      />
                      {t('play.animation.stepListBorderColor')}
                    </span>
                    {effect.stepListBorderColor && (
                      <input
                        type="color"
                        value={effect.stepListBorderColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { stepListBorderColor: e.target.value })}
                        className="h-8 w-full cursor-pointer rounded border border-slate-700 bg-slate-900"
                      />
                    )}
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.stepListBulletStyle')}
                    <select
                      value={effect.stepListBulletStyle ?? 'disc'}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { stepListBulletStyle: e.target.value as 'disc' | 'decimal' | 'none' })}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    >
                      <option value="disc">{t('play.animation.stepListBulletStyle.disc')}</option>
                      <option value="decimal">{t('play.animation.stepListBulletStyle.decimal')}</option>
                      <option value="none">{t('play.animation.stepListBulletStyle.none')}</option>
                    </select>
                  </label>
                </>
              )}
              {effect.type === 'overlay-image' && (
                <div className="flex flex-col gap-1 text-xs text-slate-400">
                  {t('play.animation.overlayImageFigure')}
                  <div className="flex items-center gap-2">
                    {pageFigures === null ? (
                      <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-500">
                        {t('play.animation.overlayImageLoading')}
                      </span>
                    ) : pageFigures.length === 0 ? (
                      <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-500">
                        {t('play.animation.overlayImageNoFigures')}
                      </span>
                    ) : (
                      <>
                        <select
                          value={effect.figureId ?? ''}
                          disabled={disabled}
                          onChange={(e) => updateEffect(effect.id, { figureId: e.target.value || undefined })}
                          className="max-w-[12rem] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        >
                          <option value="">{t('play.animation.overlayImageSelectFigure')}</option>
                          {pageFigures.map((figure, idx) => (
                            <option key={figure.id} value={figure.id}>
                              {idx + 1}. {figure.caption ? truncateSentence(figure.caption, 20) : figure.id}
                            </option>
                          ))}
                        </select>
                        {effect.figureId && pdfId && (
                          <>
                            <img
                              src={withShareToken(figureImageUrl(pdfId, effect.figureId)) ?? figureImageUrl(pdfId, effect.figureId)}
                              alt=""
                              className="h-10 w-14 rounded border border-slate-700 bg-slate-950 object-contain"
                              onLoad={(e) => {
                                const img = e.currentTarget;
                                if (img.naturalWidth && img.naturalHeight) {
                                  const fid = effect.figureId!;
                                  setFigureNaturalRatios((prev) => ({ ...prev, [fid]: img.naturalWidth / img.naturalHeight }));
                                }
                              }}
                            />
                            <button
                              type="button"
                              title={t(lockedAspectEffectIds.has(effect.id) ? 'play.animation.unlockAspectRatio' : 'play.animation.lockAspectRatio')}
                              onClick={() =>
                                setLockedAspectEffectIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(effect.id)) next.delete(effect.id);
                                  else next.add(effect.id);
                                  return next;
                                })
                              }
                              className={`rounded-md border px-2 py-1.5 text-sm ${lockedAspectEffectIds.has(effect.id) ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                            >
                              {lockedAspectEffectIds.has(effect.id) ? '🔒' : '🔓'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-slate-400 mt-1">
                    {t('play.animation.overlayImageOpacity')}
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={effect.overlayImageOpacity ?? 1}
                      disabled={disabled}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) updateEffect(effect.id, { overlayImageOpacity: Math.min(1, Math.max(0, v)) });
                      }}
                      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.overlayImageBorderRadius')}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={48}
                        step={4}
                        value={effect.overlayImageBorderRadius ?? 0}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { overlayImageBorderRadius: Math.max(0, Math.min(48, Math.round(Number(e.target.value) || 0))) })}
                        className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                      <span className="text-slate-500">px</span>
                    </div>
                  </label>
                </div>
              )}
              {effect.type === 'formula' && (
                <>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.formulaContent')}
                    <input
                      type="text"
                      maxLength={MAX_FORMULA_LENGTH}
                      value={effect.formula ?? ''}
                      disabled={disabled}
                      placeholder={t('play.animation.formulaContentPlaceholder')}
                      onChange={(e) => updateEffect(effect.id, { formula: e.target.value })}
                      className="w-48 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    />
                    {effect.formula && (
                      <div
                        className="w-48 overflow-x-auto rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                        style={{ fontSize: `${effect.formulaFontSize ?? 1.5}em` }}
                        dangerouslySetInnerHTML={{
                          __html: katex.renderToString(effect.formula, { throwOnError: false, displayMode: true }),
                        }}
                      />
                    )}
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    {t('play.animation.formulaFontSize')}
                    <input
                      type="number"
                      min={0.5}
                      max={4}
                      step={0.1}
                      value={effect.formulaFontSize ?? 1.5}
                      disabled={disabled}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) updateEffect(effect.id, { formulaFontSize: Math.min(4, Math.max(0.5, v)) });
                      }}
                      className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                    />
                  </label>
                  <div className="flex gap-3 items-end">
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.formulaBgColor')}
                      <input
                        type="color"
                        value={effect.formulaBgColor ?? '#0f172a'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { formulaBgColor: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      {t('play.animation.formulaTextColor')}
                      <input
                        type="color"
                        value={effect.formulaTextColor ?? '#f8fafc'}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { formulaTextColor: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    {t('play.animation.formulaBorderRadius')}
                    <input
                      type="number"
                      min={0}
                      max={32}
                      step={2}
                      value={effect.formulaBorderRadius ?? 8}
                      disabled={disabled}
                      onChange={(e) => updateEffect(effect.id, { formulaBorderRadius: Math.max(0, Math.min(32, Math.round(Number(e.target.value) || 8))) })}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    <span className="text-slate-500">px</span>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!effect.formulaBorderColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { formulaBorderColor: e.target.checked ? '#ffffff' : undefined })}
                      />
                      {t('play.animation.formulaBorderColor')}
                    </span>
                    {effect.formulaBorderColor && (
                      <input
                        type="color"
                        value={effect.formulaBorderColor}
                        disabled={disabled}
                        onChange={(e) => updateEffect(effect.id, { formulaBorderColor: e.target.value })}
                        className="h-8 w-full cursor-pointer rounded border border-slate-700 bg-slate-900"
                      />
                    )}
                  </label>
                </>
              )}
              {OVERLAY_EFFECT_TYPES.includes(effect.type) && effect.type !== 'custom-script' && (
                <div className="flex flex-col gap-2 text-xs text-slate-400">
                  {t(effect.type === 'pointer' ? 'play.animation.pointerPosition' : 'play.animation.focusPosition')}
                  {currentPage?.image_url && (
                    <EffectPositionEditor
                      effect={effect}
                      imageUrl={currentPage.image_url}
                      isPointerOnly={effect.type === 'pointer'}
                      onParamsChange={(params) => {
                        let next = { ...getFocusEffectParams(effect), ...params };
                        if (
                          effect.type === 'overlay-image' &&
                          effect.figureId &&
                          lockedAspectEffectIds.has(effect.id) &&
                          figureNaturalRatios[effect.figureId]
                        ) {
                          const ratio = figureNaturalRatios[effect.figureId]!;
                          next = { ...next, heightPct: Math.round((next.widthPct / ratio) * 10) / 10 };
                        }
                        updateEffect(effect.id, { params: next });
                      }}
                      disabled={disabled}
                    />
                  )}
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
                          onChange={(e) => {
                            const newVal = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                            const base = { ...getFocusEffectParams(effect), [key]: newVal };
                            if (
                              key === 'widthPct' &&
                              effect.type === 'overlay-image' &&
                              effect.figureId &&
                              lockedAspectEffectIds.has(effect.id) &&
                              figureNaturalRatios[effect.figureId]
                            ) {
                              const ratio = figureNaturalRatios[effect.figureId]!;
                              base.heightPct = Math.round((newVal / ratio) * 10) / 10;
                            }
                            updateEffect(effect.id, { params: base });
                          }}
                          className="w-14 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                        />
                      </label>
                    ))}
                  </div>
                  {effect.type === 'pointer' && (
                    <>
                      <label className="flex flex-col gap-1 text-xs text-slate-400">
                        {t('play.animation.pointerShape')}
                        <select
                          value={effect.pointerShape ?? 'arrow'}
                          disabled={disabled}
                          onChange={(e) => updateEffect(effect.id, { pointerShape: e.target.value as 'arrow' | 'dot' })}
                          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <option value="arrow">{t('play.animation.pointerShape.arrow')}</option>
                          <option value="dot">{t('play.animation.pointerShape.dot')}</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-400">
                        {t('play.animation.pointerAngle')}
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={-180}
                            max={180}
                            step={15}
                            value={effect.angle ?? 0}
                            disabled={disabled}
                            onChange={(e) =>
                              updateEffect(effect.id, { angle: Number(e.target.value) || 0 })
                            }
                            className="w-20 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                          />
                          <span className="text-slate-500">°</span>
                        </div>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-400">
                        {t('play.animation.pointerColor')}
                        <input
                          type="color"
                          value={effect.pointerColor ?? '#f43f5e'}
                          disabled={disabled}
                          onChange={(e) => updateEffect(effect.id, { pointerColor: e.target.value })}
                          className="h-8 w-12 cursor-pointer rounded-md border border-slate-700 bg-slate-900 p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-400">
                        {t('play.animation.pointerSize')}
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={6}
                            step={0.5}
                            value={effect.pointerSize ?? 2.5}
                            disabled={disabled}
                            onChange={(e) =>
                              updateEffect(effect.id, { pointerSize: Math.min(6, Math.max(1, Number(e.target.value) || 2.5)) })
                            }
                            className="w-20 rounded-md border border-slate-700 bg-slate-900 px-1 py-1 text-sm text-slate-100"
                          />
                          <span className="text-slate-500">rem</span>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={effect.pointerPulse ?? false}
                          disabled={disabled}
                          onChange={(e) =>
                            updateEffect(effect.id, { pointerPulse: e.target.checked || undefined })
                          }
                          className="h-4 w-4 accent-fuchsia-500"
                        />
                        {t('play.animation.pointerPulse')}
                      </label>
                    </>
                  )}
                </div>
              )}
              {(OVERLAY_EFFECT_TYPES.includes(effect.type) || TRANSFORM_EFFECT_TYPES.includes(effect.type)) && (
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  {t(
                    OVERLAY_EFFECT_TYPES.includes(effect.type)
                      ? 'play.animation.exitDuration'
                      : 'play.animation.exitDuration.transform',
                  )}
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
          })
        )}
        </>
      ) : notebookTab === 'hints' ? (
        <>
        <div className="text-[11px] text-slate-500">{t('play.animation.hintsDescription')}</div>
        {pageSentences.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-500">
            {t('play.animation.noTranscript')}
          </div>
        ) : (
          pageSentences.map((sentence, idx) => (
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
          ))
        )}
        </>
      ) : (
        <>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">{t('play.animation.rawJsonDescription')}</div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(draft, null, 2)).then(() => {
                setJsonCopied(true);
                setTimeout(() => setJsonCopied(false), 1500);
              });
            }}
            className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            {jsonCopied ? t('play.animation.copyJsonDone') : t('play.animation.copyJson')}
          </button>
        </div>
        <textarea
          readOnly
          value={JSON.stringify(draft, null, 2)}
          onFocus={(e) => e.currentTarget.select()}
          rows={20}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-slate-800 bg-slate-950 px-2 py-2 font-mono text-xs leading-relaxed text-slate-300"
        />
        </>
      )}
      </div>

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
                <div className="flex flex-col gap-1">
                  <select
                    value=""
                    disabled={disabled || customScriptBusy}
                    onChange={(e) => {
                      const prompt = e.target.value;
                      if (prompt) setCustomScriptChatInput(prompt);
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <option value="">{t('play.animation.customScriptExamplePromptsLabel')}</option>
                    {CUSTOM_SCRIPT_EXAMPLE_PROMPTS.map((ex) => (
                      <option key={ex.labelKey} value={ex.prompt}>
                        {t(ex.labelKey as TranslationKey)}
                      </option>
                    ))}
                  </select>
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
