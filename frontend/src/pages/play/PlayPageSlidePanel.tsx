import { useEffect, useState } from 'react';
import DrawingCanvas from '../../components/DrawingCanvas';
import { SlideRenderer } from '../../components/slide/SlideRenderer';
import { AnimationEditorTab } from './AnimationEditorTab';
import { FigureAssetsTab } from './FigureAssetsTab';
import { formatTime, formatDurationMs, formatTokenCount, formatCostUsd } from './formatters';
import { PageTimingChips } from './PageTimingChips';
import { ApiError, fetchPageGenerationPrompts, fetchPdfRunHistory, fetchPdfSlowArtifacts, figureImageUrl } from '../../lib/api';
import { SHOW_SUBTITLE_STORAGE_KEY, INTERACTIVE_MODE_STORAGE_KEY, useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import type { PageArtifact, PipelineRunStatus, PipelineRunSummary, PipelineRunType, PipelineStage, SlowArtifactSummary, TimingEventStatus } from '../../types';

const RUN_TYPE_LABELS: Record<PipelineRunType, string> = {
  initial: '初次產生',
  retry: '重試',
  resume: '接續處理',
  regenerate_batch: '批次重生',
  regenerate_page: '單頁重生',
  regenerate_artifact: '單一素材重生',
  generate_video: '生成影片',
};

const RUN_STATUS_LABELS: Record<PipelineRunStatus, string> = {
  running: '執行中',
  succeeded: '成功',
  failed: '失敗',
  canceled: '已取消',
  partial: '部分完成',
};

const RUN_STATUS_COLORS: Record<PipelineRunStatus, string> = {
  running: 'text-amber-300',
  succeeded: 'text-emerald-300',
  failed: 'text-rose-300',
  canceled: 'text-slate-400',
  partial: 'text-amber-300',
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  queue_wait: '排隊等待',
  source_prepare: '來源準備',
  render_pages: '頁面渲染',
  extract_text: '文字擷取',
  extract_figures: '圖表擷取',
  split_text: '文字分段',
  generate_scripts: '逐字稿生成',
  synthesize_audio: '語音合成',
  generate_animations: '動畫生成',
  generate_title: '標題生成',
  generate_video: '影片生成',
  finalize: '收尾處理',
};

const STAGE_STATUS_LABELS: Record<TimingEventStatus, string> = {
  running: '執行中',
  succeeded: '成功',
  failed: '失敗',
  skipped: '已跳過',
  canceled: '已取消',
  unknown: '未知',
};

const PAGE_ARTIFACT_LABELS: Record<PageArtifact, string> = {
  image: '圖片',
  text: '文字',
  script: '講稿',
  audio: '語音',
};

export function PlayPageSlidePanel() {
  const {
    pdfId,
    currentPage, currentIdx, totalPages,
    detail,
    displayedImageSrc,
    isPlaying, playPause,
    slideAnimationPlaying,
    currentTime, duration,
    finished,
    playbackRate, setPlaybackRate,
    showSubtitle, setShowSubtitle,
    playbackSettingsOpen, setPlaybackSettingsOpen,
    playbackStatusMessage, handleClearPlaybackProgress,
    audioMuted, setAudioMuted,
    effectiveAudioMuted,
    followerAudioUnlocked, setFollowerAudioUnlocked,
    audioError,
    handleSeek, goPrev, goNext,
    isReadOnlyProcessing,
    withImageBust,
    withShareToken,
    currentSentence,
    editingScript, setEditingScript,
    editorError,
    editorBusy,
    editTab, setEditTab,
    transcriptFocusMode, setTranscriptFocusMode,
    handleRetry,
    handleRegenerateAudio,
    promptInput, setPromptInput,
    sourceTextName, setSourceTextName,
    sourceTextContent, setSourceTextContent,
    sourceBusy, sourceMsg, sourceErr,
    genPrompts, setGenPrompts,
    genPromptsLoading, setGenPromptsLoading,
    expandedGenPrompt, setExpandedGenPrompt,
    promptBusy, promptMsg,
    handleSavePrompt,
    handleAddPdfSource, handleAddTxtSource,
    sourcePdfInputRef,
    slideImageMaxHeightVh,
    drawingMode,
    drawingTool,
    drawingColor,
    drawingLineWidth,
    drawingCanvasMainRef,
    imageEditSelectMode,
    imageEditRegion, setImageEditRegion,
    imageEditDragRef, imageEditRegionOverlayRef,
    clearImageEditRegion,
    handleReplaceImageFile,
    isSyncFollower, canUseDrawingTools,
    remoteDrawingData, pushLocalDrawingChange,
    openVersionHistory,
    activeTab,
    syncEnabled, syncRole,
    classroomMode, setClassroomMode,
    classroomAwaitingNext,
    interactiveMode, setInteractiveMode,
    handleShowPlayQrCode,
    playQrCodeUrl,
    shareUrl,
    hasScriptChanges,
    sourceItems,
    expandedSourceId, setExpandedSourceId,
    currentAnimationSpec,
    animationWarning, setAnimationWarning,
  } = usePlayPageContext();

  const { t } = useI18n();

  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) * 1000 : 0;

  const [runHistory, setRunHistory] = useState<PipelineRunSummary[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryError, setRunHistoryError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const [slowArtifacts, setSlowArtifacts] = useState<SlowArtifactSummary[]>([]);
  const [slowArtifactsLoading, setSlowArtifactsLoading] = useState(false);
  const [slowArtifactsError, setSlowArtifactsError] = useState<string | null>(null);

  // 切到「系統資料」分頁時載入此 PDF 的執行歷程（pipeline_runs/pipeline_stage_summaries）。
  useEffect(() => {
    if (editTab !== 'system' || !pdfId) return;
    let cancelled = false;
    setRunHistoryLoading(true);
    setRunHistoryError(null);
    fetchPdfRunHistory(pdfId)
      .then((res) => {
        if (cancelled) return;
        setRunHistory(res.runs);
      })
      .catch((err) => {
        if (cancelled) return;
        setRunHistory([]);
        setRunHistoryError(err instanceof ApiError ? err.message : '載入執行歷程失敗');
      })
      .finally(() => {
        if (!cancelled) setRunHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editTab, pdfId]);

  // 切到「系統資料」分頁時載入此 PDF 最慢的素材排行（page_artifact_timings）。
  useEffect(() => {
    if (editTab !== 'system' || !pdfId) return;
    let cancelled = false;
    setSlowArtifactsLoading(true);
    setSlowArtifactsError(null);
    fetchPdfSlowArtifacts(pdfId)
      .then((res) => {
        if (cancelled) return;
        setSlowArtifacts(res.artifacts);
      })
      .catch((err) => {
        if (cancelled) return;
        setSlowArtifacts([]);
        setSlowArtifactsError(err instanceof ApiError ? err.message : '載入最慢素材排行失敗');
      })
      .finally(() => {
        if (!cancelled) setSlowArtifactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editTab, pdfId]);

  return (
    <div
      className={`relative min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70 md:flex ${
        activeTab === 'play' ? 'flex' : 'hidden'
      }`}
    >
      {/* Slide image */}
      <section
        className={
          transcriptFocusMode
            ? 'absolute right-4 top-4 z-20 flex h-40 w-64 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/95 px-2 py-2 shadow-2xl md:h-48 md:w-80'
            : 'flex flex-1 items-center justify-center px-4 py-6'
        }
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (isReadOnlyProcessing) return;
          const f = e.dataTransfer.files?.[0];
          if (f && currentPage) void handleReplaceImageFile(f, currentPage.page_number);
        }}
        onPaste={(e) => {
          // eslint-disable-next-line no-console
          console.info('[paste][slide-panel] event fired', {
            itemCount: e.clipboardData.items.length,
            items: Array.from(e.clipboardData.items).map((it) => ({ kind: it.kind, type: it.type })),
          });
          if (isReadOnlyProcessing) return;
          const file = Array.from(e.clipboardData.items)
            .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
            .find((f): f is File => !!f);
          if (!file) {
            // eslint-disable-next-line no-console
            console.warn('[paste][slide-panel] no file found');
          }
          if (file && currentPage) void handleReplaceImageFile(file, currentPage.page_number);
        }}
        tabIndex={0}
      >
        <div className="relative flex h-full w-full max-w-4xl items-center justify-center">
          {playQrCodeUrl ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/80 p-4 shadow-xl">
              <img
                src={playQrCodeUrl}
                alt="分享連結 QR Code"
                className="w-auto rounded-md border border-slate-700 bg-white p-2"
                style={{ maxHeight: transcriptFocusMode ? '8rem' : `${slideImageMaxHeightVh}vh` }}
              />
              {!transcriptFocusMode && shareUrl ? <p className="max-w-[85vw] break-all text-center text-xs text-slate-300">{shareUrl}</p> : null}
            </div>
          ) : currentPage?.image_url || displayedImageSrc ? (
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
              wrapperClassName="relative inline-block rounded-lg"
              wrapperStyle={{ lineHeight: 0, maxHeight: transcriptFocusMode ? '10rem' : `${slideImageMaxHeightVh}vh` }}
              src={displayedImageSrc ?? (withImageBust(currentPage?.image_url) ?? currentPage?.image_url ?? '')}
              alt={`第 ${currentPage?.page_number ?? ''} 頁`}
              imgClassName="block h-auto w-auto rounded-lg border border-slate-800 shadow-xl"
              imgStyle={{
                maxHeight: transcriptFocusMode ? '10rem' : `${slideImageMaxHeightVh}vh`,
                cursor: imageEditSelectMode ? 'crosshair' : (drawingMode && drawingTool !== 'cursor') ? 'default' : 'pointer',
              }}
              onImgClick={() => { if (!imageEditSelectMode && (!drawingMode || drawingTool === 'cursor')) playPause(); }}
              imgProps={{ role: 'button', tabIndex: -1, 'aria-label': isPlaying ? '暫停語音播放' : '繼續語音播放' }}
              overlay={
                <button
                  type="button"
                  onClick={() => currentPage && void openVersionHistory('image', currentPage.page_number)}
                  disabled={!currentPage}
                  title="查看此頁圖片的歷史版本"
                  className="absolute right-2 top-2 z-20 rounded-md border border-slate-600 bg-slate-900/80 px-2 py-1 text-xs text-slate-300 backdrop-blur hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🖼 版本
                </button>
              }
            >
              {pdfId && currentPage && (
                <DrawingCanvas
                  ref={drawingCanvasMainRef}
                  pdfId={pdfId}
                  pageNumber={currentPage.page_number}
                  enabled={canUseDrawingTools && !imageEditSelectMode && drawingMode && drawingTool !== 'cursor'}
                  color={drawingColor}
                  lineWidth={drawingTool === 'eraser' ? drawingLineWidth * 3 : drawingLineWidth}
                  eraser={drawingTool === 'eraser'}
                  remoteData={isSyncFollower ? remoteDrawingData : undefined}
                  onLocalChange={pushLocalDrawingChange}
                />
              )}
              {/* Region selector overlay (for inpainting) */}
              {imageEditSelectMode && (
                <div
                  className="absolute inset-0 rounded-lg"
                  style={{ cursor: 'crosshair', zIndex: 30, userSelect: 'none', touchAction: 'none' }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    imageEditDragRef.current = {
                      startX: (e.clientX - rect.left) / rect.width,
                      startY: (e.clientY - rect.top) / rect.height,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const overlay = imageEditRegionOverlayRef.current;
                    if (overlay) overlay.style.display = 'none';
                  }}
                  onPointerMove={(e) => {
                    e.preventDefault();
                    if (!imageEditDragRef.current) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
                    const { startX, startY } = imageEditDragRef.current;
                    const x = Math.min(startX, nx);
                    const y = Math.min(startY, ny);
                    const w = Math.abs(nx - startX);
                    const h = Math.abs(ny - startY);
                    const overlay = imageEditRegionOverlayRef.current;
                    if (overlay) {
                      overlay.style.display = 'block';
                      overlay.style.left = `${x * 100}%`;
                      overlay.style.top = `${y * 100}%`;
                      overlay.style.width = `${w * 100}%`;
                      overlay.style.height = `${h * 100}%`;
                    }
                  }}
                  onPointerUp={(e) => {
                    if (!imageEditDragRef.current) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
                    const { startX, startY } = imageEditDragRef.current;
                    imageEditDragRef.current = null;
                    const x = Math.min(startX, nx);
                    const y = Math.min(startY, ny);
                    const w = Math.abs(nx - startX);
                    const h = Math.abs(ny - startY);
                    if (w > 0.02 && h > 0.02) {
                      setImageEditRegion({ x, y, w, h });
                    } else {
                      clearImageEditRegion();
                    }
                  }}
                />
              )}
              {/* Region overlay: shows live drag preview and committed selection */}
              {(imageEditSelectMode || imageEditRegion) && (
                <div
                  ref={imageEditRegionOverlayRef}
                  style={{
                    display: imageEditRegion ? 'block' : 'none',
                    position: 'absolute',
                    left: imageEditRegion ? `${imageEditRegion.x * 100}%` : '0',
                    top: imageEditRegion ? `${imageEditRegion.y * 100}%` : '0',
                    width: imageEditRegion ? `${imageEditRegion.w * 100}%` : '0',
                    height: imageEditRegion ? `${imageEditRegion.h * 100}%` : '0',
                    border: '2px solid rgba(0,200,255,0.95)',
                    backgroundColor: 'rgba(0,160,255,0.18)',
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              )}
            </SlideRenderer>
          ) : (
            <div
              className="flex w-full items-center justify-center rounded-lg border border-slate-800 text-slate-500"
              style={{ height: transcriptFocusMode ? '10rem' : `${slideImageMaxHeightVh}vh` }}
            >
              {currentPage?.status === 'failed'
                    ? `本頁產生失敗${currentPage.error_message ? `：${currentPage.error_message}` : ''}`
                    : detail?.status === 'awaiting_script_confirmation'
                      ? '等待確認分頁結果（確認後將開始產生圖片）'
                      : '圖片產生中…'}
            </div>
          )}
          {animationWarning ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-950/85 px-3 py-1.5 text-xs text-amber-200">
              {animationWarning}
            </div>
          ) : null}
          {showSubtitle && currentSentence ? (
            <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(92%,900px)] -translate-x-1/2 px-2">
              <div className="mx-auto rounded-md bg-black/60 px-4 py-2 text-center text-sm font-medium leading-relaxed text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] md:text-base">
                <p className="line-clamp-2 whitespace-pre-wrap">{currentSentence}</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Controls */}
      <section className={transcriptFocusMode ? 'absolute right-4 top-44 z-20 w-64 rounded-lg border border-slate-700 bg-slate-950/95 shadow-2xl md:top-56 md:w-80' : 'border-t border-slate-800 bg-slate-900/50'}>
        <div className={transcriptFocusMode ? 'flex flex-col gap-2 px-3 py-3' : 'flex flex-col gap-3 px-4 py-4'}>
      {finished && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          播放完成
        </div>
      )}
      {classroomMode && classroomAwaitingNext && !finished && (
        <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          本頁播放完畢，停留在目前頁。按空白鍵進入下一頁並播放。
        </div>
      )}
      <div className={`flex items-center gap-3 ${transcriptFocusMode ? 'flex-wrap' : ''}`}>
        <button
          type="button"
          onClick={goPrev}
          disabled={currentIdx === 0}
          className="rounded-full border border-slate-700 px-3 py-2 text-sm disabled:opacity-30 hover:bg-slate-800"
          aria-label="上一頁"
          title="上一頁 (←)"
        >
          ⏮
        </button>
        {audioError ? (
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-full border border-rose-500/50 bg-rose-500/15 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/25"
            aria-label="語音載入失敗，點擊重試"
            title={audioError}
          >
            ▶︎
          </button>
        ) : !currentPage?.audio_url ? (
          <button
            type="button"
            disabled
            className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm opacity-30 cursor-not-allowed"
            aria-label="此頁無語音"
            title="此頁無語音"
          >
            ▶︎
          </button>
        ) : (
          <button
            type="button"
            onClick={playPause}
            className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
            aria-label={classroomMode && classroomAwaitingNext ? '下一頁並播放' : isPlaying ? '暫停' : '播放'}
            title={classroomMode && classroomAwaitingNext ? '下一頁並播放 (Space)' : isPlaying ? '暫停 (Space)' : '播放 (Space)'}
          >
            {classroomMode && classroomAwaitingNext ? '⏭▶︎' : isPlaying ? '⏸' : '▶︎'}
          </button>
        )}
        <button
          type="button"
          onClick={goNext}
          disabled={currentIdx >= totalPages - 1}
          className="rounded-full border border-slate-700 px-3 py-2 text-sm disabled:opacity-30 hover:bg-slate-800"
          aria-label="下一頁"
          title="下一頁 (→)"
        >
          ⏭
        </button>
        <button
          type="button"
          onClick={() => void handleShowPlayQrCode()}
          disabled={!pdfId}
          className="rounded-full border border-violet-500/50 bg-violet-500/15 px-3 py-2 text-sm text-violet-200 hover:bg-violet-500/25 disabled:opacity-40"
          aria-label="顯示分享 QR Code"
          title="產生分享 QR Code"
        >
          ▦
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={progressRatio}
          onChange={handleSeek}
          className="order-2 min-w-0 flex-[1_1_calc(100%-5.75rem)] accent-emerald-500 sm:order-none sm:flex-1"
          aria-label="進度條"
        />
        <div className="order-3 w-[5.25rem] shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-slate-300 sm:order-none sm:w-24 sm:text-xs">
          {formatTime(Math.min(currentTime, duration))} / {formatTime(duration)}
        </div>
      </div>
      <div className={transcriptFocusMode ? 'hidden' : 'rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-200">播放設定</span>
            <span className={`rounded-full border px-2 py-0.5 ${effectiveAudioMuted ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'}`}>
              {effectiveAudioMuted ? '本機靜音' : '本機有聲'}
            </span>
            <span className={`rounded-full border px-2 py-0.5 ${classroomMode ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-slate-700 bg-slate-950 text-slate-400'}`}>
              {classroomMode ? '上課模式' : '連續播放'}
            </span>
            {interactiveMode ? (
              <span className="rounded-full border border-cyan-400/50 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
                互動模式
              </span>
            ) : null}
            {syncEnabled && syncRole === 'master' ? (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
                學生端音訊：{followerAudioUnlocked ? '可自行播放' : '強制靜音'}
              </span>
            ) : null}
            {syncEnabled && syncRole === 'follower' && !followerAudioUnlocked ? (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">老師端強制靜音</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPlaybackSettingsOpen((open) => !open)}
            className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
            aria-expanded={playbackSettingsOpen}
          >
            ⚙️ 設定
          </button>
        </div>
        {playbackSettingsOpen ? (
          <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
            {playbackStatusMessage ? (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100" role="status">
                {playbackStatusMessage}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div>
                <span className="font-semibold text-slate-200">音訊</span>
                <span className="ml-2 text-slate-400">
                  {syncEnabled && syncRole === 'follower' && !followerAudioUnlocked
                    ? '老師端已強制學生端靜音。'
                    : effectiveAudioMuted
                      ? '目前本機靜音。'
                      : '目前本機可播放聲音。'}
                </span>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={audioMuted}
                  disabled={syncEnabled && syncRole === 'follower' && !followerAudioUnlocked}
                  onChange={(event) => {
                    if (syncEnabled && syncRole === 'follower' && !followerAudioUnlocked) return;
                    setAudioMuted(event.target.checked);
                  }}
                  className="accent-cyan-500"
                />
                本機靜音
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div><span className="font-semibold text-slate-200">播放速度</span></div>
              <select value={String(playbackRate)} onChange={(e)=>setPlaybackRate(Number(e.target.value))} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
                {[0.5,0.75,1,1.25,1.5,2].map((speed)=><option key={speed} value={String(speed)}>{speed}x</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div>
                <span className="font-semibold text-slate-200">字幕</span>
                <span className="ml-2 text-slate-400">切換是否顯示目前句子字幕。</span>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={showSubtitle}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setShowSubtitle(next);
                    window.localStorage.setItem(SHOW_SUBTITLE_STORAGE_KEY, next ? '1' : '0');
                  }}
                  className="accent-cyan-500"
                />
                {showSubtitle ? 'ON' : 'OFF'}
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div>
                <span className="font-semibold text-slate-200">{t('play.playbackProgress.title')}</span>
                <span className="ml-2 text-slate-400">{t('play.playbackProgress.description')}</span>
              </div>
              <button
                type="button"
                onClick={handleClearPlaybackProgress}
                className="rounded-full border border-rose-500/50 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-100 hover:bg-rose-500/20"
              >
                {t('play.playbackProgress.clear')}
              </button>
            </div>
            {syncEnabled && syncRole === 'master' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-cyan-100">
                <div>
                  <span className="font-semibold">學生端音訊控制</span>
                  <span className="ml-2 text-cyan-200/80">
                    {followerAudioUnlocked
                      ? '已解鎖，學生可自行取消靜音播放。'
                      : '已鎖定，所有 follower 會被強制靜音。'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFollowerAudioUnlocked((unlocked) => !unlocked)}
                  className="rounded-full border border-cyan-300/50 bg-cyan-950/40 px-3 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-900/60"
                  aria-pressed={followerAudioUnlocked}
                >
                  {followerAudioUnlocked ? '強制所有學生靜音' : '解鎖學生自行播放'}
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div>
                <span className="font-semibold text-slate-200">上課模式</span>
                <span className="ml-2 text-slate-400">
                  {classroomMode ? '每頁播放完會停在目前頁，按空白鍵才進入下一頁。' : '關閉時會自動連續播放下一頁。'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setClassroomMode((enabled) => !enabled)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  classroomMode
                    ? 'border-amber-400/60 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
                aria-pressed={classroomMode}
              >
                {classroomMode ? '已開啟' : '開啟'}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div>
                <span className="font-semibold text-slate-200">互動模式</span>
                <span className="ml-2 text-slate-400">
                  {interactiveMode
                    ? '每頁播放完會停在目前頁並自動啟動 Realtime Poll。'
                    : '關閉時播放結束不會自動開始投票。'}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setInteractiveMode((enabled) => {
                    const next = !enabled;
                    window.localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, next ? '1' : '0');
                    return next;
                  })
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  interactiveMode
                    ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/25'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
                aria-pressed={interactiveMode}
              >
                {interactiveMode ? '已開啟' : '開啟'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
        </div>
      </section>

      {/* Script panel */}
      <section className={`border-t border-slate-800 bg-slate-950 ${transcriptFocusMode ? 'flex min-h-[65vh] flex-1 flex-col' : ''}`}>
        <div className={`px-4 py-4 ${transcriptFocusMode ? 'flex flex-1 flex-col pr-4 md:pr-[22rem]' : ''}`}>
          <div className="mb-3 flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/60">
            <button
              type="button"
              onClick={() => setEditTab('script')}
              className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'script' ? 'bg-slate-800 text-emerald-200' : 'text-slate-400'}`}
            >
              📝 逐字稿
            </button>
            <button
              type="button"
              onClick={() => setEditTab('prompt')}
              className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'prompt' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400'}`}
            >
              🪄 提示詞
            </button>
            <button
              type="button"
              onClick={() => setEditTab('animation')}
              className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'animation' ? 'bg-slate-800 text-fuchsia-200' : 'text-slate-400'}`}
            >
              🎞 {t('play.animation.tab')}
            </button>
            <button
              type="button"
              onClick={() => setEditTab('figures')}
              className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'figures' ? 'bg-slate-800 text-sky-200' : 'text-slate-400'}`}
            >
              📊 {t('play.figures.tab')}
            </button>
            <button
              type="button"
              onClick={() => setEditTab('system')}
              className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'system' ? 'bg-slate-800 text-amber-200' : 'text-slate-400'}`}
            >
              🧾 系統資料
            </button>
            <button
              type="button"
              onClick={() => {
                setEditTab('source');
                if (currentPage && pdfId) {
                  setGenPromptsLoading(true);
                  void fetchPageGenerationPrompts(pdfId, currentPage.page_number)
                    .then((r) => { setGenPrompts(r); })
                    .catch(() => { setGenPrompts([]); })
                    .finally(() => { setGenPromptsLoading(false); });
                }
              }}
              className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'source' ? 'bg-slate-800 text-violet-200' : 'text-slate-400'}`}
            >
              📚 來源
            </button>
            <button
              type="button"
              onClick={() => setTranscriptFocusMode((enabled) => !enabled)}
              className={`shrink-0 border-l border-slate-700 px-3 py-1.5 text-sm ${
                transcriptFocusMode ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              aria-pressed={transcriptFocusMode}
              title={transcriptFocusMode ? '還原播放器版面' : '縮小播放器，放大逐字稿編輯區'}
            >
              {transcriptFocusMode ? '↙' : '↗'}
            </button>
          </div>

          {editTab === 'script' ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-300">
                  📝 逐字稿（第 {currentPage?.page_number ?? '-'} 頁）
                </h2>
                <button
                  type="button"
                  onClick={() => currentPage && void openVersionHistory('script', currentPage.page_number)}
                  disabled={!currentPage}
                  title="查看此頁逐字稿的歷史版本"
                  className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🕘 版本
                </button>
              </div>
              <textarea
                value={editingScript}
                onChange={(e) => setEditingScript(e.target.value)}
                disabled={isReadOnlyProcessing}
                rows={transcriptFocusMode ? 18 : 6}
                className={`w-full rounded-md border border-slate-700 bg-slate-900/70 p-3 text-sm leading-relaxed text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring ${transcriptFocusMode ? 'min-h-[55vh] flex-1' : ''}`}
                placeholder="請輸入本頁逐字稿..."
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  {editorError ? <span className="text-rose-300">{editorError}</span> : '儲存後會僅重生此頁語音'}
                </div>
                <button
                  type="button"
                  onClick={() => void handleRegenerateAudio()}
                  disabled={isReadOnlyProcessing || editorBusy || !hasScriptChanges}
                  className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {editorBusy ? '重生中…' : '儲存並重生語音'}
                </button>
              </div>
            </>
          ) : editTab === 'prompt' ? (
            <>
              <h2 className="mb-2 text-sm font-semibold text-slate-300">🪄 提示詞（第 {currentPage?.page_number ?? '-'} 頁）</h2>
              <textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                disabled={isReadOnlyProcessing}
                rows={6}
                className="w-full rounded-md border border-slate-700 bg-slate-900/70 p-3 text-sm leading-relaxed text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-500 focus:ring"
                placeholder="請輸入這份簡報的風格提示詞..."
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  {promptMsg ? <span className="text-slate-300">{promptMsg}</span> : '更新後將影響後續以提示詞為基礎的生成'}
                </div>
                <button
                  type="button"
                  onClick={() => void handleSavePrompt()}
                  disabled={isReadOnlyProcessing || promptBusy}
                  className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {promptBusy ? '儲存中…' : '儲存提示詞'}
                </button>
              </div>
            </>
          ) : editTab === 'animation' ? (
            <AnimationEditorTab />
          ) : editTab === 'figures' ? (
            <FigureAssetsTab />
          ) : editTab === 'source' ? (
            <>
              <h2 className="mb-2 text-sm font-semibold text-slate-300">📚 來源管理</h2>
              <div className="space-y-3">
                <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-xs text-slate-400">新增 TXT 來源（會在生成逐字稿時一起送出）</p>
                  <input
                    value={sourceTextName}
                    onChange={(e) => setSourceTextName(e.target.value)}
                    placeholder="來源名稱（選填）"
                    className="mb-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                  />
                  <textarea
                    value={sourceTextContent}
                    onChange={(e) => setSourceTextContent(e.target.value)}
                    rows={5}
                    placeholder="貼上來源文字內容"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleAddTxtSource()}
                      disabled={sourceBusy || isReadOnlyProcessing}
                      className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200 disabled:opacity-40"
                    >
                      新增 TXT 來源
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-xs text-slate-400">新增 PDF 來源（會擷取文字並在生成逐字稿時一起送出）</p>
                  <input
                    ref={sourcePdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleAddPdfSource(file);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => sourcePdfInputRef.current?.click()}
                    disabled={sourceBusy || isReadOnlyProcessing}
                    className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
                  >
                    上傳 PDF 來源
                  </button>
                </div>

                {sourceErr ? <p className="text-xs text-rose-300">{sourceErr}</p> : null}
                {sourceMsg ? <p className="text-xs text-emerald-300">{sourceMsg}</p> : null}

                <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-xs text-slate-400">目前來源清單（{sourceItems.length}）</p>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {sourceItems.length === 0 ? (
                      <p className="text-xs text-slate-500">尚未新增額外來源</p>
                    ) : sourceItems.map((s) => {
                      const isExpanded = expandedSourceId === s.id;
                      const hasContent = s.content_text.trim().length > 0;
                      if (s.source_kind === 'youtube_audio') {
                        const audioSrc = withShareToken(`api/pdfs/${s.pdf_id}/source-audio`) ?? `api/pdfs/${s.pdf_id}/source-audio`;
                        return (
                          <div key={s.id} className="rounded border border-slate-700 px-2 py-1.5">
                            <p className="text-xs text-slate-300">[{s.source_kind}] {s.source_name ?? '未命名來源'}</p>
                            <audio controls preload="none" className="mt-1 w-full" src={audioSrc} />
                            {hasContent && <p className="mt-1 text-xs text-slate-500">{s.content_text}</p>}
                          </div>
                        );
                      }
                      return (
                        <div key={s.id} className="rounded border border-slate-700 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => hasContent && setExpandedSourceId(isExpanded ? null : s.id)}
                            disabled={!hasContent}
                            className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
                          >
                            <p className="text-xs text-slate-300">[{s.source_kind}] {s.source_name ?? '未命名來源'}</p>
                            {hasContent ? <span className="text-xs text-slate-400">{isExpanded ? '▲' : '▼'}</span> : null}
                          </button>
                          {!hasContent ? (
                            <p className="mt-1 text-xs text-slate-500">尚無內容</p>
                          ) : isExpanded ? (
                            <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-all text-xs text-slate-400">{s.content_text}</pre>
                          ) : (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{s.content_text}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
                  <p className="mb-2 text-xs text-slate-400">
                    🔍 第 {currentPage?.page_number ?? '-'} 頁 生成記錄
                  </p>
                  {genPromptsLoading ? (
                    <p className="text-xs text-slate-500">載入中…</p>
                  ) : genPrompts.length === 0 ? (
                    <p className="text-xs text-slate-500">尚無生成記錄（重新生成後才會出現）</p>
                  ) : (
                    <div className="space-y-2">
                      {genPrompts.map((gp) => {
                        const stageLabel =
                          gp.stage === 'image' ? '🖼 圖片生成提示' :
                          gp.stage === 'script' ? '📝 逐字稿生成提示' :
                          gp.stage === 'audio' ? '🔊 語音合成參數' : gp.stage;
                        const isExpanded = expandedGenPrompt === gp.stage;
                        return (
                          <div key={gp.stage} className="rounded border border-slate-700">
                            <button
                              type="button"
                              onClick={() => setExpandedGenPrompt(isExpanded ? null : gp.stage)}
                              className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs"
                            >
                              <span className="font-medium text-slate-200">{stageLabel}</span>
                              <span className="flex items-center gap-2 text-slate-400">
                                {gp.model && <span className="font-mono">{gp.model}</span>}
                                <span>{isExpanded ? '▲' : '▼'}</span>
                              </span>
                            </button>
                            {isExpanded && (
                              <pre className="max-h-64 overflow-y-auto border-t border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-300 leading-5 whitespace-pre-wrap break-all">
                                {gp.prompt_text}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-sm font-semibold text-slate-300">🧾 系統資料（第 {currentPage?.page_number ?? '-'} 頁）</h2>
              <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-300">
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">PDF ID</dt>
                    <dd className="break-all font-mono text-slate-200">{detail?.id}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">狀態</dt>
                    <dd className="text-slate-200">{detail?.status}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">原始檔名</dt>
                    <dd className="break-all text-slate-200">{detail?.original_filename}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">頁數</dt>
                    <dd className="text-slate-200">{detail?.page_count ?? totalPages}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">TTS</dt>
                    <dd className="text-slate-200">{detail?.tts_provider ?? 'openai'} / {detail?.tts_voice ?? '-'} / {detail?.tts_speed ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">目前頁狀態</dt>
                    <dd className="text-slate-200">{currentPage?.status ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">建立時間</dt>
                    <dd className="font-mono text-slate-200">{detail?.created_at}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">更新時間</dt>
                    <dd className="font-mono text-slate-200">{detail?.updated_at}</dd>
                  </div>
                </dl>
              </div>
              <div className="mt-3 overflow-x-auto rounded-md border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-900/70 text-slate-400">
                    <tr>
                      <th className="px-3 py-2">步驟</th>
                      <th className="px-3 py-2">狀態</th>
                      <th className="px-3 py-2">耗時</th>
                      <th className="px-3 py-2">SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                    {([
                      ['image', '圖片'],
                      ['text', '文字'],
                      ['script', '講稿'],
                      ['audio', '語音'],
                    ] as const).map(([key, label]) => {
                      const timing = currentPage?.timings?.[key] ?? null;
                      return (
                        <tr key={key}>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-200">{label}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-300">{timing?.status ?? '尚無紀錄'}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">{timing?.status === 'running' ? '產生中' : formatDurationMs(timing?.duration_ms)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                            {timing ? `${timing.sla_status}${timing.sla_target_ms != null ? ` / ${formatDurationMs(timing.sla_target_ms)}` : ''}` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {currentPage?.timings ? <div className="mt-3"><PageTimingChips page={currentPage} /></div> : null}
              <div className="mt-3 rounded-md border border-slate-800 bg-slate-900/50 p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-300">🗂 執行歷程</h3>
                {runHistoryLoading ? (
                  <p className="text-xs text-slate-500">載入中…</p>
                ) : runHistoryError ? (
                  <p className="text-xs text-rose-300">{runHistoryError}</p>
                ) : runHistory.length === 0 ? (
                  <p className="text-xs text-slate-500">尚無執行紀錄</p>
                ) : (
                  <div className="space-y-2">
                    {runHistory.map((run) => {
                      const isExpanded = expandedRunId === run.id;
                      return (
                        <div key={run.id} className="rounded border border-slate-700">
                          <button
                            type="button"
                            onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
                          >
                            <span className="flex flex-col">
                              <span className="font-medium text-slate-200">
                                {RUN_TYPE_LABELS[run.run_type] ?? run.run_type} · 第 {run.attempt} 次
                              </span>
                              <span className="font-mono text-slate-500">
                                {new Date(run.started_at).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'medium' })}
                              </span>
                            </span>
                            <span className="flex items-center gap-2 text-slate-400">
                              <span className={RUN_STATUS_COLORS[run.status]}>{RUN_STATUS_LABELS[run.status] ?? run.status}</span>
                              <span className="font-mono">{run.status === 'running' ? '執行中' : formatDurationMs(run.duration_ms)}</span>
                              <span>{isExpanded ? '▲' : '▼'}</span>
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-slate-700 px-2 py-2">
                              {run.error_message && (
                                <p className="mb-2 text-xs text-rose-300">
                                  {run.error_code ? `[${run.error_code}] ` : ''}{run.error_message}
                                </p>
                              )}
                              <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                                <thead className="text-slate-500">
                                  <tr>
                                    <th className="px-2 py-1">階段</th>
                                    <th className="px-2 py-1">狀態</th>
                                    <th className="px-2 py-1">耗時</th>
                                    <th className="px-2 py-1">SLA</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                  {run.stages.map((stage) => (
                                    <tr key={stage.stage}>
                                      <td className="px-2 py-1 text-slate-200">{STAGE_LABELS[stage.stage] ?? stage.stage}</td>
                                      <td className="px-2 py-1 text-slate-300">{STAGE_STATUS_LABELS[stage.status] ?? stage.status}</td>
                                      <td className="px-2 py-1 font-mono text-slate-200">
                                        {stage.status === 'running' ? '執行中' : formatDurationMs(stage.duration_ms)}
                                      </td>
                                      <td className="px-2 py-1 text-slate-400">
                                        {stage.sla_status}{stage.sla_target_ms != null ? ` / ${formatDurationMs(stage.sla_target_ms)}` : ''}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {run.llm_usage.requests > 0 && (
                                <p className="mt-2 font-mono text-xs text-slate-400">
                                  💬 LLM：{run.llm_usage.requests} 次請求 · {formatTokenCount(run.llm_usage.total_tokens)} tokens · 預估費用 {formatCostUsd(run.llm_usage.estimated_cost_usd)}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="mt-3 rounded-md border border-slate-800 bg-slate-900/50 p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-300">🐢 最慢素材排行</h3>
                {slowArtifactsLoading ? (
                  <p className="text-xs text-slate-500">載入中…</p>
                ) : slowArtifactsError ? (
                  <p className="text-xs text-rose-300">{slowArtifactsError}</p>
                ) : slowArtifacts.length === 0 ? (
                  <p className="text-xs text-slate-500">尚無素材耗時紀錄</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-slate-800">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                      <thead className="bg-slate-900/70 text-slate-400">
                        <tr>
                          <th className="px-3 py-2">頁碼</th>
                          <th className="px-3 py-2">素材</th>
                          <th className="px-3 py-2">狀態</th>
                          <th className="px-3 py-2">耗時</th>
                          <th className="px-3 py-2">SLA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                        {slowArtifacts.map((item) => (
                          <tr key={`${item.page_number}-${item.artifact}`}>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-200">第 {item.page_number} 頁</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-200">{PAGE_ARTIFACT_LABELS[item.artifact] ?? item.artifact}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-300">{STAGE_STATUS_LABELS[item.status] ?? item.status}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">{formatDurationMs(item.duration_ms)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                              {item.sla_status}{item.sla_target_ms != null ? ` / ${formatDurationMs(item.sla_target_ms)}` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
