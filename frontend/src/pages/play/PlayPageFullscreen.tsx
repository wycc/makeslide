import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject, TouchEvent } from 'react';
import DrawingCanvas from '../../components/DrawingCanvas';
import { SlideRenderer } from '../../components/slide/SlideRenderer';
import { useI18n } from '../../i18n';
import { pollOptionPercent } from '../../lib/pollPercent';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import type { TranslationKey } from '../../i18n';
import { figureImageUrl } from '../../lib/api';
import { getFocusEffectParams, OVERLAY_EFFECT_TYPES } from '../../lib/animationSpec';
import type { SlideAnimationEffect } from '../../types';
import { AnimationEditorTab } from './AnimationEditorTab';
import { usePlayPageContext } from './PlayPageContext';

/**
 * Draggable box rendered directly on top of the actual fullscreen slide image (as a
 * `SlideRenderer` child, so it shares the same percentage-based coordinate space as every
 * other overlay effect) for whichever effect the user picked via "🎯 在投影片上拖曳" in the
 * fullscreen animation editor. Move-only (no resize handles) — the small thumbnail in the
 * editor panel still supports full move + resize for fine-tuning size.
 */
function FullscreenEffectPositionOverlay({
  effect,
  imageRef,
  onParamsChange,
}: {
  effect: SlideAnimationEffect;
  imageRef: RefObject<HTMLImageElement>;
  onParamsChange: (params: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
}) {
  const dragRef = useRef<{ startMouseX: number; startMouseY: number; startXPct: number; startYPct: number } | null>(null);
  const isPointerOnly = effect.type === 'pointer';
  const { xPct, yPct, widthPct, heightPct } = getFocusEffectParams(effect);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startXPct: xPct, startYPct: yPct };
  }, [xPct, yPct]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const dx = ((e.clientX - dragRef.current.startMouseX) / rect.width) * 100;
    const dy = ((e.clientY - dragRef.current.startMouseY) / rect.height) * 100;
    const maxX = isPointerOnly ? 100 : Math.max(0, 100 - widthPct);
    const maxY = isPointerOnly ? 100 : Math.max(0, 100 - heightPct);
    const newX = Math.min(maxX, Math.max(0, dragRef.current.startXPct + dx));
    const newY = Math.min(maxY, Math.max(0, dragRef.current.startYPct + dy));
    onParamsChange({
      xPct: Math.round(newX * 10) / 10,
      yPct: Math.round(newY * 10) / 10,
      widthPct,
      heightPct,
    });
  }, [imageRef, isPointerOnly, widthPct, heightPct, onParamsChange]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      style={
        isPointerOnly
          ? {
            position: 'absolute', left: `${xPct}%`, top: `${yPct}%`, width: 22, height: 22,
            transform: 'translate(-50%, -50%)', borderRadius: '50%', background: 'rgba(244, 63, 94, 0.85)',
            border: '2px solid #fff', boxShadow: '0 0 8px 3px rgba(244,63,94,0.7)', cursor: 'move', touchAction: 'none', zIndex: 20,
          }
          : {
            position: 'absolute', left: `${xPct}%`, top: `${yPct}%`, width: `${widthPct}%`, height: `${heightPct}%`,
            border: '3px solid #a855f7', background: 'rgba(168, 85, 247, 0.12)', boxSizing: 'border-box',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)', cursor: 'move', touchAction: 'none', zIndex: 20,
          }
      }
    />
  );
}

/** 觸發換頁所需的最小水平滑動距離（px）。 */
const SWIPE_THRESHOLD_PX = 50;
/** 超過此垂直位移視為滾動/手寫而非換頁手勢（px）。 */
const SWIPE_VERTICAL_TOLERANCE_PX = 80;

const DRAWING_COLORS = [
  { value: '#ef4444', labelKey: 'play.fullscreen.drawing.color.red' },
  { value: '#3b82f6', labelKey: 'play.fullscreen.drawing.color.blue' },
  { value: '#1e293b', labelKey: 'play.fullscreen.drawing.color.black' },
  { value: '#fbbf24', labelKey: 'play.fullscreen.drawing.color.yellow' },
  { value: '#22c55e', labelKey: 'play.fullscreen.drawing.color.green' },
  { value: '#f8fafc', labelKey: 'play.fullscreen.drawing.color.white' },
] as const;

const DRAWING_WIDTHS = [
  { value: 3, labelKey: 'play.fullscreen.drawing.width.thin' },
  { value: 6, labelKey: 'play.fullscreen.drawing.width.medium' },
  { value: 12, labelKey: 'play.fullscreen.drawing.width.thick' },
] as const;

const FULLSCREEN_LAYOUTS = [
  { mode: 'image', labelKey: 'play.fullscreen.layout.image' },
  { mode: 'split', labelKey: 'play.fullscreen.layout.split' },
  { mode: 'edit', labelKey: 'play.fullscreen.layout.edit' },
  { mode: 'animation', labelKey: 'play.fullscreen.layout.animation' },
] as const;

export function PlayPageFullscreen() {
  const {
    fullscreenContainerRef,
    fullscreenImageRef,
    drawingCanvasFullscreenRef,
    drawingCanvasSplitRef,
    getActiveDrawingCanvas,
    setImageOnlyFullscreen,
    fullscreenLayout, setFullscreenLayout,
    animationDraft, setAnimationDraft,
    positioningEffectId,
    isPlaying,
    slideAnimationPlaying,
    playPause,
    goPrev, goNext,
    currentPage, currentIdx, totalPages,
    detail,
    displayedImageSrc,
    fullscreenImageSrc,
    withImageBust,
    withShareToken,
    drawingMode, setDrawingMode,
    drawingTool, setDrawingTool,
    drawingColor, setDrawingColor,
    drawingLineWidth, setDrawingLineWidth,
    imageEditSelectMode,
    pdfId,
    isSyncFollower, canUseDrawingTools,
    remoteDrawingData, pushLocalDrawingChange,
    syncEnabled, syncRole,
    syncDisplayedQuestionId,
    syncFollowerQuestions,
    syncAiAnswer,
    fullscreenQuestionDialogOpen, setFullscreenQuestionDialogOpen,
    fullscreenPollControlOpen, setFullscreenPollControlOpen,
    syncQuestionInput, setSyncQuestionInput,
    syncQuestionBusy,
    activePoll, activePollQuestion,
    pollVotes, pollBusy,
    handleVotePoll,
    syncPollShowResults, setSyncPollShowResults,
    pollStarted,
    pagePolls,
    handleSelectDisplayedPoll, syncDisplayedPollId,
    classroomMode, classroomAwaitingNext,
    handleStartPoll, handleStopPoll,
    handleSubmitFollowerQuestion,
    pageSentences, currentSentence, activeSentenceIdx, activeSentenceRef,
    editingScript, setEditingScript,
    editorBusy, editorError,
    handleRegenerateAudio,
    isReadOnlyProcessing,
    isLockedFullscreen,
    remoteCursor,
    showSubtitle, subtitleSize, subtitlePosition,
    hasScriptChanges,
    playQrCodeUrl,
    currentTime,
    playbackRate,
    currentAnimationSpec,
    setAnimationWarning,
    gotoPageOpen, setGotoPageOpen, gotoPageInput, setGotoPageInput, gotoPageInputRef,
    deckPages, setCurrentIdx,
  } = usePlayPageContext();

  const { t } = useI18n();

  // Fullscreen poll voting overlay (so viewers can vote without leaving fullscreen).
  const [fullscreenPollOpen, setFullscreenPollOpen] = useState(false);
  const activePagePolls = pagePolls.filter((poll) => poll.is_active);

  const syncDisplayedQuestion = syncDisplayedQuestionId
    ? syncFollowerQuestions.find((q) => q.id === syncDisplayedQuestionId) ?? null
    : null;
  const syncOverlayText = syncAiAnswer?.answer || syncDisplayedQuestion?.question || '';
  const syncOverlayIsAiAnswer = Boolean(syncAiAnswer?.answer);
  const pageNumberLabel = currentPage?.page_number ? String(currentPage.page_number) : '-';

  // 動畫版面下，使用者選擇要直接在投影片上拖曳定位的效果（透過 AnimationEditorTab 的「🎯 在投影片上拖曳」按鈕）。
  const positioningEffect =
    fullscreenLayout === 'animation' && positioningEffectId
      ? animationDraft?.effects.find(
        (effect) => effect.id === positioningEffectId && OVERLAY_EFFECT_TYPES.includes(effect.type) && effect.type !== 'custom-script',
      ) ?? null
      : null;
  const handlePositioningEffectParamsChange = useCallback((params: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => {
    if (!positioningEffectId) return;
    setAnimationDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        effects: prev.effects.map((effect) => (effect.id === positioningEffectId ? { ...effect, params } : effect)),
      };
    });
  }, [positioningEffectId, setAnimationDraft]);

  const formatMessage = (key: TranslationKey, replacements: Record<string, string | number>) =>
    interpolateTemplate(t(key), replacements);

  const formatPageStatusMessage = () => {
    if (currentPage?.status === 'failed') {
      const message = currentPage.error_message ? `：${currentPage.error_message}` : '';
      return `${t('play.slidePanel.pageGenerationFailed')}${message}`;
    }
    if (detail?.status === 'awaiting_script_confirmation') {
      return t('play.slidePanel.awaitingSplitConfirmation');
    }
    return t('play.slidePanel.imageGenerating');
  };

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeHandledRef = useRef(false);

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (drawingMode && drawingTool !== 'cursor') return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    swipeHandledRef.current = false;
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > SWIPE_VERTICAL_TOLERANCE_PX) return;
    swipeHandledRef.current = true;
    if (dx < 0) {
      goNext();
    } else {
      goPrev();
    }
  };

  return (
    <div
      ref={fullscreenContainerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black"
      style={{
        cursor:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Ccircle cx='28' cy='28' r='8' fill='none' stroke='%23ef4444' stroke-width='2.5'/%3E%3Cline x1='28' y1='2' x2='28' y2='20' stroke='%23ef4444' stroke-width='2.5' stroke-linecap='round'/%3E%3Cline x1='28' y1='36' x2='28' y2='54' stroke='%23ef4444' stroke-width='2.5' stroke-linecap='round'/%3E%3Cline x1='2' y1='28' x2='20' y2='28' stroke='%23ef4444' stroke-width='2.5' stroke-linecap='round'/%3E%3Cline x1='36' y1='28' x2='54' y2='28' stroke='%23ef4444' stroke-width='2.5' stroke-linecap='round'/%3E%3Ccircle cx='28' cy='28' r='1.5' fill='%23ef4444'/%3E%3C/svg%3E\") 28 28, crosshair",
      }}
      onClick={() => {
        if (swipeHandledRef.current) {
          swipeHandledRef.current = false;
          return;
        }
        if (!imageEditSelectMode && (!drawingMode || drawingTool === 'cursor')) playPause();
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="button"
      tabIndex={-1}
      aria-label={isPlaying ? t('play.slidePanel.pauseAudioOverlay') : t('play.slidePanel.resumeAudioOverlay')}
    >
      {!isPlaying ? (
        <div className="pointer-events-none absolute left-4 top-4 flex h-12 w-12 items-center justify-center rounded-full border border-white/35 bg-black/55 text-white shadow-lg backdrop-blur-sm">
          <span className="sr-only">{t('play.fullscreen.audioPaused')}</span>
          <span className="h-6 w-2 rounded-sm bg-current" aria-hidden="true" />
          <span className="ml-2 h-6 w-2 rounded-sm bg-current" aria-hidden="true" />
        </div>
      ) : null}
      {syncEnabled && syncRole === 'master' && syncFollowerQuestions.length > 0 ? (
        <div className="pointer-events-none absolute left-4 top-20 z-30 flex items-center gap-1 rounded-full border border-amber-300/40 bg-black/55 px-3 py-1 text-amber-100 shadow-lg backdrop-blur-sm">
          <span aria-hidden="true">💬</span>
          <span className="text-sm font-semibold">{syncFollowerQuestions.length}</span>
          <span className="sr-only">{t('play.fullscreen.pendingQuestions')}</span>
        </div>
      ) : null}
      {activePagePolls.length > 0 ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setFullscreenPollOpen((o) => !o); }}
          className="absolute right-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-fuchsia-300/40 bg-black/60 text-2xl shadow-lg backdrop-blur-sm hover:bg-black/75"
          aria-label={t('play.fullscreen.pollButton')}
          aria-pressed={fullscreenPollOpen}
          title={t('play.fullscreen.pollButton')}
        >
          🗳
        </button>
      ) : null}
      {syncEnabled && syncRole === 'master' && pagePolls.length > 0 && !fullscreenPollOpen ? (
        <div className="pointer-events-none absolute right-4 top-20 z-30 flex flex-col items-end gap-1">
          {pagePolls.map((poll) => (
            <span
              key={poll.id}
              className="rounded-full border border-fuchsia-300/40 bg-black/55 px-3 py-1 text-sm text-fuchsia-100 shadow-lg backdrop-blur-sm"
            >
              🗳 {t('play.slidePanel.liveVotesCount').replace('{count}', String(poll.total_votes))}
            </span>
          ))}
        </div>
      ) : null}
      {fullscreenPollOpen && activePagePolls.length > 0 ? (
        <div
          className="absolute right-4 top-20 z-40 max-h-[70vh] w-80 max-w-[90vw] overflow-y-auto rounded-xl border border-fuchsia-400/40 bg-slate-950/95 p-4 shadow-2xl backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          {activePagePolls.map((poll) => (
            <div key={poll.id} className="mb-3 last:mb-0">
              <p className="mb-2 text-sm font-semibold text-fuchsia-100">{poll.question}</p>
              <div className="space-y-1.5">
                {poll.options.map((option, idx) => {
                  const ratio = pollOptionPercent(option.votes, poll.total_votes);
                  const selected = pollVotes[poll.id] === idx;
                  return (
                    <button
                      key={`${poll.id}-${idx}`}
                      type="button"
                      onClick={() => void handleVotePoll(poll.id, idx)}
                      disabled={pollBusy || !poll.is_active}
                      className={`w-full rounded-md border px-2 py-1.5 text-left text-sm transition ${selected ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100' : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800'} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{option.text}</span>
                        <span className="font-mono text-[10px] text-slate-400">{option.votes} · {ratio}%</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${ratio}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {fullscreenLayout === 'image' && !drawingMode ? (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            disabled={currentIdx === 0}
            className="absolute left-0 top-0 z-20 flex h-full w-14 items-center justify-start pl-1.5 opacity-0 transition-opacity duration-200 hover:opacity-100 disabled:pointer-events-none"
            aria-label={t('play.slidePanel.prevPage')}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-lg text-white backdrop-blur-sm">◀</span>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            disabled={currentIdx >= totalPages - 1}
            className="absolute right-0 top-0 z-20 flex h-full w-14 items-center justify-end pr-1.5 opacity-0 transition-opacity duration-200 hover:opacity-100 disabled:pointer-events-none"
            aria-label={t('play.slidePanel.nextPage')}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-lg text-white backdrop-blur-sm">▶</span>
          </button>
        </>
      ) : null}
      {fullscreenLayout === 'split' || fullscreenLayout === 'edit' || fullscreenLayout === 'animation' ? (
        <div className="flex h-full w-full items-stretch">
          <div className="flex h-full w-1/2 shrink-0 flex-col p-2">
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {currentPage?.image_url || currentPage?.thumbnail_url || displayedImageSrc ? (
                <SlideRenderer
                  renderType={currentPage?.render_type}
                  spec={currentAnimationSpec}
                  pageKey={`${pdfId ?? ''}:${currentPage?.page_number ?? 0}`}
                  currentTime={currentTime}
                  isPlaying={slideAnimationPlaying}
                  playbackRate={playbackRate}
                  resolveFigureImageUrl={
                    pdfId
                      ? (figureId) => withShareToken(figureImageUrl(pdfId, figureId)) ?? figureImageUrl(pdfId, figureId)
                      : undefined
                  }
                  onAnimationError={() => setAnimationWarning(t('play.animation.runtimeWarning'))}
                  wrapperClassName="relative"
                  wrapperStyle={{ lineHeight: 0 }}
                  src={displayedImageSrc ?? fullscreenImageSrc ?? (withImageBust(currentPage?.image_url) ?? currentPage?.image_url ?? '')}
                  alt={formatMessage('play.slidePanel.pageImageAlt', { page: pageNumberLabel })}
                  imgClassName="max-h-full max-w-full object-contain"
                  imgRef={fullscreenImageRef}
                >
                  {pdfId && currentPage && (
                    <DrawingCanvas
                      ref={drawingCanvasSplitRef}
                      pdfId={pdfId}
                      pageNumber={currentPage.page_number}
                      enabled={canUseDrawingTools && drawingMode && drawingTool !== 'cursor'}
                      color={drawingColor}
                      lineWidth={drawingTool === 'eraser' ? drawingLineWidth * 3 : drawingLineWidth}
                      eraser={drawingTool === 'eraser'}
                      remoteData={isSyncFollower ? remoteDrawingData : undefined}
                      onLocalChange={pushLocalDrawingChange}
                    />
                  )}
                  {positioningEffect && (
                    <FullscreenEffectPositionOverlay
                      effect={positioningEffect}
                      imageRef={fullscreenImageRef}
                      onParamsChange={handlePositioningEffectParamsChange}
                    />
                  )}
                </SlideRenderer>
              ) : (
                <div className="text-slate-300">
                  {formatPageStatusMessage()}
                </div>
              )}
            </div>
            {fullscreenLayout === 'edit' ? (
              <div
                className="mt-2 flex shrink-0 cursor-default items-center justify-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                  disabled={currentIdx === 0}
                  className="rounded-md border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title={t('play.slidePanel.prevPage')}
                  aria-label={t('play.slidePanel.prevPage')}
                >
                  ◀ {t('play.slidePanel.prevPage')}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playPause();
                  }}
                  className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-5 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/25"
                  title={isPlaying ? t('play.slidePanel.pause') : t('play.slidePanel.play')}
                  aria-label={isPlaying ? t('play.slidePanel.pause') : t('play.slidePanel.play')}
                >
                  {isPlaying ? `⏸ ${t('play.slidePanel.pause')}` : `▶ ${t('play.slidePanel.play')}`}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                  disabled={currentIdx >= totalPages - 1}
                  className="rounded-md border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title={t('play.slidePanel.nextPage')}
                  aria-label={t('play.slidePanel.nextPage')}
                >
                  {t('play.slidePanel.nextPage')} ▶
                </button>
                <span className="ml-1 text-sm tabular-nums text-slate-400">
                  {currentIdx + 1}/{totalPages}
                </span>
              </div>
            ) : null}
          </div>
          {fullscreenLayout === 'split' ? (
            <div className="h-full w-1/2 overflow-y-auto px-6 py-10 md:px-10 md:py-14">
              {pageSentences.length > 0 ? (
                <div className="mx-auto max-w-2xl space-y-3">
                  {pageSentences.map((sentence, idx) => {
                    const isActive = idx === activeSentenceIdx;
                    return (
                      <p
                        key={idx}
                        ref={isActive ? activeSentenceRef : undefined}
                        className={`whitespace-pre-wrap rounded-md px-3 py-1.5 text-xl leading-relaxed transition-colors md:text-2xl lg:text-3xl ${
                          isActive
                            ? 'bg-cyan-500/15 font-bold text-cyan-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]'
                            : 'text-slate-500'
                        }`}
                      >
                        {sentence}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-slate-500">{t('play.fullscreen.noSubtitle')}</div>
              )}
            </div>
          ) : fullscreenLayout === 'animation' ? (
            // 全螢幕動畫編輯：右側為動畫效果編輯面板，跟字幕/編輯版面一樣切成左右兩半顯示。
            <div
              className="flex h-full w-1/2 cursor-default flex-col overflow-y-auto px-6 py-10 md:px-10 md:py-12"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <h2 className="mb-1 shrink-0 text-base font-semibold text-slate-200 md:text-lg">
                {t('play.fullscreen.animation.heading')}
              </h2>
              <p className="mb-3 shrink-0 text-xs text-slate-400">{t('play.fullscreen.animation.description')}</p>
              <AnimationEditorTab mode="fullscreen" />
            </div>
          ) : (
            // 全螢幕編輯：右側為可編輯的逐字稿。stopPropagation 避免點擊/觸控時觸發播放切換或滑動換頁。
            <div
              className="flex h-full w-1/2 cursor-default flex-col px-6 py-10 md:px-10 md:py-12"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <h2 className="mb-3 shrink-0 text-base font-semibold text-slate-200 md:text-lg">
                {formatMessage('play.fullscreen.editTranscriptHeading', { page: pageNumberLabel })}
              </h2>
              <textarea
                value={editingScript}
                onChange={(e) => setEditingScript(e.target.value)}
                disabled={isReadOnlyProcessing}
                className="w-full flex-1 cursor-text resize-none rounded-md border border-slate-700 bg-slate-900/70 p-4 text-base leading-relaxed text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring md:text-lg"
                placeholder={t('play.slidePanel.transcript.placeholder')}
              />
              <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  {editorError ? <span className="text-rose-300">{editorError}</span> : t('play.slidePanel.transcript.saveHint')}
                </div>
                <button
                  type="button"
                  onClick={() => void handleRegenerateAudio()}
                  disabled={isReadOnlyProcessing || editorBusy || !hasScriptChanges}
                  className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {editorBusy ? t('play.slidePanel.transcript.regenerating') : t('play.slidePanel.transcript.saveAndRegenerate')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : currentPage?.image_url || currentPage?.thumbnail_url || displayedImageSrc ? (
        <SlideRenderer
          renderType={currentPage?.render_type}
          spec={currentAnimationSpec}
          pageKey={`${pdfId ?? ''}:${currentPage?.page_number ?? 0}`}
          currentTime={currentTime}
          isPlaying={slideAnimationPlaying}
          playbackRate={playbackRate}
          resolveFigureImageUrl={
            pdfId
              ? (figureId) => withShareToken(figureImageUrl(pdfId, figureId)) ?? figureImageUrl(pdfId, figureId)
              : undefined
          }
          onAnimationError={() => setAnimationWarning(t('play.animation.runtimeWarning'))}
          wrapperClassName="relative"
          wrapperStyle={{ lineHeight: 0 }}
          src={displayedImageSrc ?? fullscreenImageSrc ?? (withImageBust(currentPage?.image_url) ?? currentPage?.image_url ?? '')}
          alt={formatMessage('play.slidePanel.pageImageAlt', { page: pageNumberLabel })}
          imgClassName="max-h-screen max-w-screen object-contain"
          imgRef={fullscreenImageRef}
        >
          {pdfId && currentPage && (
            <DrawingCanvas
              ref={drawingCanvasFullscreenRef}
              pdfId={pdfId}
              pageNumber={currentPage.page_number}
              enabled={canUseDrawingTools && drawingMode && drawingTool !== 'cursor'}
              color={drawingColor}
              lineWidth={drawingTool === 'eraser' ? drawingLineWidth * 3 : drawingLineWidth}
              eraser={drawingTool === 'eraser'}
              remoteData={isSyncFollower ? remoteDrawingData : undefined}
              onLocalChange={pushLocalDrawingChange}
            />
          )}
        </SlideRenderer>
      ) : (
        <div className="text-slate-300">
          {formatPageStatusMessage()}
        </div>
      )}
      {/* Drawing toolbar inside fullscreen */}
      {drawingMode && pdfId && currentPage && !playQrCodeUrl && (
        <div
          className="absolute left-2 top-2 z-30 flex flex-col gap-1.5 rounded-lg border border-slate-600 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <button type="button" title={t('play.fullscreen.drawing.pen')} aria-label={t('play.fullscreen.drawing.penMode')}
              className={`flex h-7 w-7 items-center justify-center rounded border text-sm ${drawingTool === 'pen' ? 'border-slate-300 bg-slate-700 text-white' : 'border-slate-600 text-slate-400 hover:bg-slate-800'}`}
              onClick={() => setDrawingTool('pen')}>✏️</button>
            <button type="button" title={t('play.fullscreen.drawing.cursor')} aria-label={t('play.fullscreen.drawing.cursorMode')}
              className={`flex h-7 w-7 items-center justify-center rounded border text-sm ${drawingTool === 'cursor' ? 'border-slate-300 bg-slate-700 text-white' : 'border-slate-600 text-slate-400 hover:bg-slate-800'}`}
              onClick={() => setDrawingTool('cursor')}>🖱️</button>
            <button type="button" title={t('play.fullscreen.drawing.eraser')} aria-label={t('play.fullscreen.drawing.eraserMode')}
              className={`flex h-7 w-7 items-center justify-center rounded border text-sm ${drawingTool === 'eraser' ? 'border-slate-300 bg-slate-700 text-white' : 'border-slate-600 text-slate-400 hover:bg-slate-800'}`}
              onClick={() => setDrawingTool('eraser')}>⬜</button>
            <button type="button" title={t('play.fullscreen.drawing.clearAll')} aria-label={t('play.fullscreen.drawing.clear')}
              className="flex h-7 w-7 items-center justify-center rounded border border-rose-600/50 bg-rose-600/20 text-sm text-rose-300 hover:bg-rose-600/30"
              onClick={() => getActiveDrawingCanvas()?.clearAll()}>🗑️</button>
            <button type="button" title={t('play.fullscreen.drawing.closeWithShortcut')} aria-label={t('play.fullscreen.drawing.close')}
              className="flex h-7 w-7 items-center justify-center rounded border border-slate-600 text-xs text-slate-400 hover:bg-slate-800"
              onClick={() => { setDrawingMode(false); setDrawingTool('pen'); }}>✕</button>
          </div>
          {drawingTool !== 'cursor' && (
            <div className="flex flex-wrap gap-1">
              {DRAWING_COLORS.map(({ value, labelKey }) => (
                <button key={value} type="button" title={t(labelKey)}
                  className={`h-5 w-5 rounded-full border-2 transition-transform ${drawingColor === value ? 'scale-110 border-white' : 'border-transparent hover:border-slate-400'}`}
                  style={{ background: value }}
                  onClick={() => setDrawingColor(value)} aria-label={t(labelKey)} />
              ))}
            </div>
          )}
          {drawingTool !== 'cursor' && (
            <div className="flex gap-1">
              {DRAWING_WIDTHS.map(({ value, labelKey }) => (
                <button key={value} type="button" title={t(labelKey)}
                  className={`flex h-7 w-7 items-center justify-center rounded border ${drawingLineWidth === value ? 'border-slate-300 bg-slate-700' : 'border-slate-600 hover:bg-slate-800'}`}
                  onClick={() => setDrawingLineWidth(value)} aria-label={t(labelKey)}>
                  <span className="block rounded-full" style={{ width: `${Math.min(value * 2, 14)}px`, height: `${Math.min(value * 2, 14)}px`, background: drawingTool === 'eraser' ? '#94a3b8' : drawingColor }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-md border border-slate-500 bg-slate-900/70 text-sm">
          {FULLSCREEN_LAYOUTS.map(({ mode, labelKey }) => (
            isLockedFullscreen && (mode === 'edit' || mode === 'animation') ? null : (
            <button
              key={mode}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenLayout(mode);
              }}
              aria-pressed={fullscreenLayout === mode}
              className={`px-3 py-1.5 ${
                fullscreenLayout === mode
                  ? 'bg-cyan-500/25 font-medium text-cyan-100'
                  : 'text-slate-200 hover:bg-slate-800'
              }`}
              title={formatMessage('play.fullscreen.layout.title', { layout: t(labelKey) })}
            >
              {t(labelKey)}
            </button>
            )
          ))}
        </div>
        {!isLockedFullscreen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setImageOnlyFullscreen(false);
            }}
            title="Esc"
            className="rounded-md border border-slate-500 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
          >
            {t('play.fullscreen.exit')} <span className="ml-1 text-[11px] text-slate-400">(Esc)</span>
          </button>
        ) : null}
      </div>
      {syncOverlayText ? (
        <div
          className={`pointer-events-none absolute left-1/2 w-[min(94vw,1100px)] -translate-x-1/2 px-3 ${
            syncOverlayIsAiAnswer
              ? 'bottom-6 max-h-[70vh] pb-[max(0.5rem,env(safe-area-inset-bottom))]'
              : 'bottom-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
          }`}
        >
          <div
            className={`mx-auto overflow-y-auto rounded-md bg-cyan-950/90 px-4 text-center font-medium leading-relaxed text-cyan-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${
              syncOverlayIsAiAnswer ? 'max-h-[70vh] py-4 text-sm md:text-base' : 'py-3 text-base md:text-lg'
            }`}
          >
            <p className={`${syncOverlayIsAiAnswer ? '' : 'line-clamp-5'} whitespace-pre-wrap`}>{syncOverlayText}</p>
          </div>
        </div>
      ) : null}
      {syncEnabled && syncRole === 'follower' && remoteCursor ? (
        <div
          className="pointer-events-none absolute z-[130]"
          style={(() => {
            const rootRect = fullscreenContainerRef.current?.getBoundingClientRect();
            const imageRect = (fullscreenImageRef.current ?? fullscreenContainerRef.current)?.getBoundingClientRect();
            if (!rootRect || !imageRect || rootRect.width <= 0 || rootRect.height <= 0) {
              return {
                left: `${remoteCursor.x * 100}%`,
                top: `${remoteCursor.y * 100}%`,
                transform: 'translate(-50%, -50%)',
              } as const;
            }
            const leftPx = imageRect.left - rootRect.left + remoteCursor.x * imageRect.width;
            const topPx = imageRect.top - rootRect.top + remoteCursor.y * imageRect.height;
            return {
              left: `${(leftPx / rootRect.width) * 100}%`,
              top: `${(topPx / rootRect.height) * 100}%`,
              transform: 'translate(-50%, -50%)',
            } as const;
          })()}
        >
          <div className="h-8 w-8 rounded-full border-2 border-red-500/90 shadow-[0_0_10px_rgba(239,68,68,0.75)]" />
          <div className="absolute left-1/2 top-1/2 h-12 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-red-500/85" />
          <div className="absolute left-1/2 top-1/2 h-[2px] w-12 -translate-x-1/2 -translate-y-1/2 bg-red-500/85" />
        </div>
      ) : null}
      {syncEnabled && syncRole === 'follower' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setFullscreenQuestionDialogOpen(true);
          }}
          className="absolute left-4 top-4 rounded-md border border-cyan-400/60 bg-cyan-500/20 px-3 py-1.5 text-sm font-medium text-cyan-50 shadow-lg hover:bg-cyan-500/30"
        >
          {t('play.fullscreen.askQuestion')}
        </button>
      ) : null}
      {syncEnabled && syncRole === 'follower' && fullscreenQuestionDialogOpen ? (
        <div
          className="absolute inset-0 z-[120] flex cursor-default items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-lg rounded-xl border border-cyan-400/40 bg-slate-950 p-4 text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-cyan-100">{t('play.fullscreen.questionDialogTitle')}</h2>
                <p className="mt-1 text-xs text-slate-400">{t('play.fullscreen.questionDialogDescription')}</p>
              </div>
              <button
                type="button"
                onClick={() => setFullscreenQuestionDialogOpen(false)}
                className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                {t('play.fullscreen.close')}
              </button>
            </div>
            <textarea
              value={syncQuestionInput}
              onChange={(e) => setSyncQuestionInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleSubmitFollowerQuestion();
                }
              }}
              maxLength={500}
              rows={4}
              autoFocus
              placeholder={t('play.fullscreen.questionPlaceholder')}
              className="w-full resize-none rounded-lg border border-cyan-500/40 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                {formatMessage('play.fullscreen.questionCountHint', { count: syncQuestionInput.length })}
              </div>
              <button
                type="button"
                onClick={() => void handleSubmitFollowerQuestion()}
                disabled={syncQuestionBusy || !syncQuestionInput.trim()}
                className="rounded-md border border-cyan-400/60 bg-cyan-500/20 px-4 py-2 text-sm font-medium text-cyan-50 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {syncQuestionBusy ? t('play.fullscreen.submittingQuestion') : t('play.fullscreen.submitQuestion')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {syncEnabled && syncRole === 'master' && fullscreenPollControlOpen ? (
        <div
          className="absolute inset-0 z-[121] flex cursor-default items-start justify-end p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md rounded-xl border border-cyan-400/40 bg-slate-950/95 p-4 text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-cyan-100">{t('play.fullscreen.pollControlTitle')}</h2>
                <p className="mt-1 text-xs text-slate-400">{t('play.fullscreen.pollControlDescription')}</p>
              </div>
              <button
                type="button"
                onClick={() => setFullscreenPollControlOpen(false)}
                className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                {t('play.fullscreen.close')}
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleStartPoll()}
                disabled={pollStarted}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-40"
              >
                {t('play.fullscreen.startPoll')}
              </button>
              <button
                type="button"
                onClick={() => handleStopPoll()}
                disabled={!pollStarted}
                className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-xs text-rose-100 disabled:opacity-40"
              >
                {t('play.fullscreen.stopPoll')}
              </button>
              <button
                type="button"
                onClick={() => setSyncPollShowResults((prev) => !prev)}
                disabled={!pollStarted}
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-100 disabled:opacity-40"
              >
                {syncPollShowResults ? t('play.fullscreen.hidePollResults') : t('play.fullscreen.showPollResults')}
              </button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {pagePolls.length === 0 ? (
                <div className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-xs text-slate-500">
                  {t('play.fullscreen.noPolls')}
                </div>
              ) : (
                pagePolls.map((poll) => (
                  <button
                    key={poll.id}
                    type="button"
                    onClick={() => void handleSelectDisplayedPoll(poll.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                      syncDisplayedPollId === poll.id
                        ? 'border-cyan-300/80 bg-cyan-500/20 text-cyan-50'
                        : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-medium">{poll.question}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      {(classroomMode && classroomAwaitingNext) ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 w-[min(92vw,1000px)] -translate-x-1/2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto rounded-md bg-cyan-950/90 px-4 py-3 text-center text-base font-medium leading-relaxed text-cyan-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] md:text-lg">
            <p className="whitespace-pre-wrap">{t('play.fullscreen.waitingNextPage')}</p>
          </div>
        </div>
      ) : activePollQuestion ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 px-4">
          <div className="w-[min(92vw,1100px)] rounded-xl border border-cyan-200/70 bg-slate-950/95 px-5 py-5 text-center text-white shadow-[0_18px_50px_rgba(0,0,0,0.78)] backdrop-blur-md md:px-8 md:py-7">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">Realtime Poll</p>
            <p className="mt-3 whitespace-pre-wrap text-2xl font-extrabold leading-relaxed text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] md:text-4xl">
              {activePollQuestion}
            </p>
            {activePoll?.options?.length ? (
              <div className="mt-5 grid grid-cols-1 gap-2 text-left md:grid-cols-2 md:gap-3">
                {activePoll.options.map((option, idx) => {
                  const ratio = pollOptionPercent(option.votes, activePoll.total_votes);
                  return (
                    <button
                      key={`${activePoll.id}-${idx}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleVotePoll(activePoll.id, idx);
                      }}
                      disabled={pollBusy || !activePoll.is_active}
                      className={`rounded-lg border px-4 py-3 text-left text-base font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] md:text-lg ${
                        pollVotes[activePoll.id] === idx
                          ? 'border-emerald-300/90 bg-emerald-600/45 text-white'
                          : 'border-cyan-200/65 bg-slate-900/88 text-white hover:bg-slate-800/95'
                      } disabled:cursor-not-allowed disabled:opacity-55`}
                    >
                      <span className="mr-2 text-cyan-200">{idx + 1}.</span>
                      <span className="whitespace-pre-wrap">{option.text}</span>
                      {syncPollShowResults ? (
                        <>
                          <span className="mt-2 block text-xs text-cyan-100/90">
                            {formatMessage('play.fullscreen.pollVotes', { count: option.votes })}
                            {` · ${ratio}%`}
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <span className="block h-full rounded-full bg-cyan-400 transition-[width] duration-300" style={{ width: `${ratio}%` }} />
                          </span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {syncPollShowResults ? (
              <p className="mt-3 text-xs text-cyan-100/90">
                {formatMessage('play.fullscreen.pollTotalVotes', { count: activePoll?.total_votes ?? 0 })}
              </p>
            ) : null}
          </div>
        </div>
      ) : showSubtitle && currentSentence && fullscreenLayout === 'image' ? (
        <div className={`pointer-events-none absolute left-1/2 w-[min(92vw,1000px)] -translate-x-1/2 px-3 ${subtitlePosition === 'top' ? 'top-4 pt-[max(0.5rem,env(safe-area-inset-top))]' : 'bottom-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]'}`}>
          <div className={`mx-auto rounded-md bg-black/65 px-4 py-2 text-center font-medium leading-relaxed text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${subtitleSize === 'sm' ? 'text-xs md:text-sm' : subtitleSize === 'lg' ? 'text-base md:text-xl' : 'text-sm md:text-base'}`}>
            <p className="line-clamp-2 whitespace-pre-wrap">{currentSentence}</p>
          </div>
        </div>
      ) : null}

      {/* 跳頁對話框（全螢幕模式內渲染，確保出現在 native fullscreen 中） */}
      {gotoPageOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setGotoPageOpen(false)}
        >
          <div
            className="w-72 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-sm font-semibold text-slate-200">{t('play.gotoPageDialog')}</p>
            <input
              ref={gotoPageInputRef}
              type="number"
              min={1}
              max={deckPages.length}
              value={gotoPageInput}
              onChange={(e) => setGotoPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = Math.floor(Number(gotoPageInput));
                  if (n >= 1 && n <= deckPages.length) {
                    setCurrentIdx(n - 1);
                    setGotoPageOpen(false);
                  }
                } else if (e.key === 'Escape') {
                  setGotoPageOpen(false);
                }
              }}
              placeholder={t('play.gotoPagePlaceholder')}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-slate-500">1 – {deckPages.length}</p>
          </div>
        </div>
      )}
    </div>
  );
}
