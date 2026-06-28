import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  answerSyncFollowerQuestionsWithAi,
  clearSyncAiAnswer,
  summarizeSyncFollowerQuestions,
  fetchPdfReportSummary,
  fetchPageSubtitleTimeline,
  fetchPdfDetail,
  fetchWatchProgress,
  resolveShareToken,
  updateLastPlayed,
  incrementPlayCount,
  fetchPlaybackSyncState,
  joinSharedPlaybackSync,
  joinPlaybackSync,
  leavePlaybackSync,
  regeneratePageAudio,
  submitSyncFollowerQuestion,
  toggleSyncDisplayedQuestion,
  deleteSyncFollowerQuestion,
  clearSyncFollowerQuestions,
  updatePlaybackSyncState,
  type PageWatchProgressStats,
  type PdfReportSummary,
  type ShareAccessMode,
} from '../lib/api';
import {
  animationTimelineDurationSeconds,
  effectIdsToReleaseOnSeekBack,
  getDuePausePlaybackEffect,
  resolveAnimationSpec,
} from '../lib/animationSpec';
import { debugLog, debugWarn } from '../lib/debugLog';
import { clamp } from '../lib/clamp';
import { formatGeneratingStatusLabel } from '../lib/statusLabels';
import { nextPageInList, prevPageInList } from '../lib/pageListNav';
import { parseGotoPage } from '../lib/parseGotoPage';
import { splitScriptIntoSentences, buildSentenceTimeline, type SentenceTimelineItem } from '../lib/subtitles';
import { roundToTwoDecimals } from '../lib/roundTo';
import { type DrawingCanvasHandle, type DrawingData, type DrawingStroke } from '../components/DrawingCanvas';
import { useVersionHistory } from './play/useVersionHistory';
import { useRegeneration } from './play/useRegeneration';
import { useVideoGeneration } from './play/useVideoGeneration';
import { usePdfMetadata } from './play/usePdfMetadata';
import { useSlideManagement } from './play/useSlideManagement';
import { useImageStyle } from './play/useImageStyle';
import { useScriptEditor } from './play/useScriptEditor';
import { usePageAnimation } from './play/usePageAnimation';
import { usePromptAndSource } from './play/usePromptAndSource';
import { useChatAndImageEdit } from './play/useChatAndImageEdit';
import { usePagePolls } from './play/usePagePolls';
import { usePageAsk } from './play/usePageAsk';
import { useWatchProgress } from './play/useWatchProgress';
import katex from 'katex';
import { resolveConfiguredUserCode } from './play/utils';
import { VersionHistoryDialog } from './play/VersionHistoryDialog';
import { ImagePreviewDialog } from './play/ImagePreviewDialog';
import { useBudgetWarning } from '../hooks/useBudgetWarning';
import { PlayPageCtx } from './play/PlayPageContext';
import { PlayPageDialogs } from './play/PlayPageDialogs';
import { PlayPageFullscreen } from './play/PlayPageFullscreen';
import { PlayPageHeader } from './play/PlayPageHeader';
import { PostClassReportPanel } from './play/PostClassReportPanel';
import { PlayPageSlidePanel } from './play/PlayPageSlidePanel';
import { PlayPageSidebar } from './play/PlayPageSidebar';
import { shouldResolvePageAnimationSpec } from './play/playbackReadiness';
import type {
  PdfDetail,
  PdfDetailPage,
  SyncAiAnswer,
  SyncFollowerQuestion,
  PdfSourceItem,
  SlideAnimationSpec,
} from '../types';
import {
  getStoredPlaybackSpeed,
  getStoredShowSubtitle,
  getStoredSubtitleSize,
  getStoredSubtitlePosition,
  getStoredInteractiveMode,
  getStoredAutoAdvance,
  getStoredTtsSpeed,
  useI18n,
  type SubtitleSize,
  type SubtitlePosition,
} from '../i18n';


const POLL_INTERVAL_MS = 3000;
const AUDIO_RETRY_DELAY_MS = 800;
const PREFETCH_START_DELAY_MS = 1200;
const SYNC_POLL_INTERVAL_MS = 1200;
const SYNC_POLL_INTERVAL_FULLSCREEN_MS = 250;
const SYNC_CURSOR_PUSH_INTERVAL_MS = 60;
const SYNC_CURSOR_PUSH_INTERVAL_FULLSCREEN_MS = 24;
// 動畫延長播放期間，定期推進 currentTime 的間隔；與音訊 timeupdate 的常見頻率（~4 次/秒）相近，
// 讓 custom-script 效果的 sandboxed iframe 在延長期間仍能持續收到 `sync` 訊息更新動畫畫面。
const PAGE_EXTEND_TICK_MS = 250;

function hasTranscriptStartTrigger(spec: SlideAnimationSpec | null | undefined): boolean {
  return Boolean(spec?.effects.some((effect) => effect.startTrigger));
}

interface LoadedSlideImageState {
  pageNumber: number;
  src: string;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

function getAnyFullscreenElement(): Element | null {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
}

async function requestAnyFullscreen(element: HTMLElement): Promise<void> {
  const el = element as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  if (el.webkitRequestFullscreen) {
    await el.webkitRequestFullscreen();
    return;
  }
  if (el.msRequestFullscreen) {
    await el.msRequestFullscreen();
  }
}

async function exitAnyFullscreen(): Promise<void> {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };
  if (doc.exitFullscreen) {
    await doc.exitFullscreen();
    return;
  }
  if (doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen();
    return;
  }
  if (doc.msExitFullscreen) {
    await doc.msExitFullscreen();
  }
}

export default function PlayPage() {
  const { id: pdfId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const budgetWarning = useBudgetWarning();

  const [detail, setDetail] = useState<PdfDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [watchProgressStats, setWatchProgressStats] = useState<PageWatchProgressStats[]>([]);
  const [postClassReportOpen, setPostClassReportOpen] = useState(false);
  const [postClassReportSummary, setPostClassReportSummary] = useState<PdfReportSummary | null>(null);
  const [postClassReportLoading, setPostClassReportLoading] = useState(false);
  const [postClassReportError, setPostClassReportError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [visitedIdxSet, setVisitedIdxSet] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [loadedSlideImage, setLoadedSlideImage] = useState<LoadedSlideImageState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [durationPageNumber, setDurationPageNumber] = useState<number | null>(null);
  const [scripts, setScripts] = useState<Record<number, string>>({});
  const [audioError, setAudioError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [classroomMode, setClassroomMode] = useState(false);
  const [classroomAwaitingNext, setClassroomAwaitingNext] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState<boolean>(() => getStoredInteractiveMode());
  const sourcePdfInputRef = useRef<HTMLInputElement>(null);

  const [showAddPagesModal, setShowAddPagesModal] = useState(false);
  const imageEditRegionOverlayRef = useRef<HTMLDivElement>(null);
  const imageEditDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [draggingPage, setDraggingPage] = useState<number | null>(null);
  const [thumbLoadUntilIdx, setThumbLoadUntilIdx] = useState(0);
  // 手機模式下的 tab 切換（桌面模式忽略此 state，永遠並排顯示）
  const [activeTab, setActiveTab] = useState<'play' | 'qa'>('play');
  const [gotoPageOpen, setGotoPageOpen] = useState(false);
  const [gotoPageInput, setGotoPageInput] = useState('');
  const gotoPageInputRef = useRef<HTMLInputElement>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncRole, setSyncRole] = useState<'master' | 'follower'>('follower');
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState<number>(() => {
    const stored = window.localStorage.getItem('makeslide.audioVolume');
    const v = stored !== null ? parseFloat(stored) : 1;
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  });
  const [playbackRate, setPlaybackRate] = useState<number>(() => getStoredPlaybackSpeed());
  const [showSubtitle, setShowSubtitle] = useState<boolean>(() => getStoredShowSubtitle());
  const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>(() => getStoredSubtitleSize());
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>(() => getStoredSubtitlePosition());
  const [autoAdvance, setAutoAdvance] = useState<boolean>(() => getStoredAutoAdvance());
  const [playbackSettingsOpen, setPlaybackSettingsOpen] = useState(false);
  const [playbackStatusMessage, setPlaybackStatusMessage] = useState<string | null>(null);
  const [followerAudioUnlocked, setFollowerAudioUnlocked] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncFollowerQuestionInput, setSyncFollowerQuestionInput] = useState('');
  const [syncFollowerQuestions, setSyncFollowerQuestions] = useState<SyncFollowerQuestion[]>([]);
  const [syncDisplayedQuestionId, setSyncDisplayedQuestionId] = useState<string | null>(null);
  const [syncAiAnswer, setSyncAiAnswer] = useState<SyncAiAnswer | null>(null);
  const [syncRealtimePollStarted, setSyncRealtimePollStarted] = useState(false);
  const [syncPollShowResults, setSyncPollShowResults] = useState(false);
  const [syncDisplayedPollId, setSyncDisplayedPollId] = useState<number | null>(null);
  const [syncAiAnswerBusy, setSyncAiAnswerBusy] = useState(false);
  const [questionSummary, setQuestionSummary] = useState<string | null>(null);
  const [questionSummaryBusy, setQuestionSummaryBusy] = useState(false);
  const [syncQuestionInput, setSyncQuestionInput] = useState('');
  const [syncQuestionBusy] = useState(false);
  const [fullscreenQuestionDialogOpen, setFullscreenQuestionDialogOpen] = useState(false);
  const [fullscreenPollControlOpen, setFullscreenPollControlOpen] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<{ x: number; y: number } | null>(null);
  const [syncDrawingState, setSyncDrawingState] = useState<{ pageNumber: number; strokes: DrawingStroke[] } | null>(null);
  const syncClientIdRef = useRef<string>('');
  const applyingRemoteSyncRef = useRef(false);
  const [imageOnlyFullscreen, setImageOnlyFullscreen] = useState(false);
  // 全螢幕版面：'image' = 純圖片（字幕單行疊在下方）；'split' = 左圖右整頁字幕；'edit' = 左圖右逐字稿編輯；'animation' = 左圖右動畫效果編輯。
  const [fullscreenLayout, setFullscreenLayout] = useState<'image' | 'split' | 'edit' | 'animation'>('image');
  // 動畫編輯時，使用者選擇要直接在全螢幕投影片上拖曳定位的效果 id（null 表示尚未選擇）。
  const [positioningEffectId, setPositioningEffectId] = useState<string | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const activeSentenceRef = useRef<HTMLParagraphElement>(null);
  const [slideImageScale, setSlideImageScale] = useState(1);
  const sourceItems: PdfSourceItem[] = detail?.sources ?? [];

  // ---- Drawing / annotation state ----
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingTool, setDrawingTool] = useState<'pen' | 'cursor' | 'eraser'>('pen');
  const [drawingColor, setDrawingColor] = useState('#ef4444');
  const [drawingLineWidth, setDrawingLineWidth] = useState(6);
  // 三個 <DrawingCanvas> 實例（全螢幕分割版面、全螢幕單圖版面、一般版面）即使彼此視覺上互斥，
  // 在 DOM 中仍可能同時掛載（全螢幕覆蓋層疊加在一般版面之上），共用同一個 ref 會讓它指向
  // 「最後掛載」的隱藏實例而非使用者實際正在操作的畫布，因此改為各自獨立的 ref。
  const drawingCanvasSplitRef = useRef<DrawingCanvasHandle>(null);
  const drawingCanvasFullscreenRef = useRef<DrawingCanvasHandle>(null);
  const drawingCanvasMainRef = useRef<DrawingCanvasHandle>(null);
  const getActiveDrawingCanvas = useCallback((): DrawingCanvasHandle | null => {
    if (imageOnlyFullscreen) {
      return fullscreenLayout === 'split' || fullscreenLayout === 'edit' || fullscreenLayout === 'animation'
        ? drawingCanvasSplitRef.current
        : drawingCanvasFullscreenRef.current;
    }
    return drawingCanvasMainRef.current;
  }, [imageOnlyFullscreen, fullscreenLayout]);

  const effectiveAudioMuted = audioMuted || (syncEnabled && syncRole === 'follower' && !followerAudioUnlocked);
  // 同步模式下，手寫工具僅供 master 開啟；follower 只能唯讀鏡射 master 的手寫畫面。
  const canUseDrawingTools = !syncEnabled || syncRole === 'master';
  const isSyncFollower = syncEnabled && syncRole === 'follower';


  const audioRef = useRef<HTMLAudioElement>(null);
  const previousPlaybackTimeRef = useRef(0);
  const consumedPausePlaybackEffectIdsRef = useRef<Set<string>>(new Set());
  // 記錄目前的暫停是不是由 realtime-poll 動畫效果觸發；只有這種情況下，master 按下
  // 「結束投票」才需要額外恢復播放（一般手動開始的投票結束後不應該自動繼續播放）。
  const pausedForRealtimePollEffectRef = useRef(false);
  const playbackRateRef = useRef<number>(playbackRate);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    window.localStorage.setItem('makeslide.playback_speed', String(playbackRate));
  }, [playbackRate]);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = audioVolume;
    window.localStorage.setItem('makeslide.audioVolume', String(audioVolume));
  }, [audioVolume]);
  // 動畫長度若超過語音長度，handleEnded 會延後切頁，等動畫播完再切換；
  // 用 ref 暫存最新的動畫總長，避免 handleEnded 的宣告順序受 currentAnimationSpec TDZ 影響。
  const animationDurationSecondsRef = useRef(0);
  const pendingPageExtendTimerRef = useRef<number | null>(null);
  const [isExtendingAnimation, setIsExtendingAnimation] = useState(false);
  useEffect(() => {
    const onStorageChanged = () => {
      setShowSubtitle(getStoredShowSubtitle());
    };
    window.addEventListener('storage', onStorageChanged);
    window.addEventListener('makeslide:language-settings-changed', onStorageChanged);
    return () => {
      window.removeEventListener('storage', onStorageChanged);
      window.removeEventListener('makeslide:language-settings-changed', onStorageChanged);
    };
  }, []);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setShowSubtitle(getStoredShowSubtitle());
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  // Handle renderLatex postMessage requests from custom-script sandbox iframes.
  // The sandbox cannot load KaTeX fonts directly (no network access), so it
  // delegates rendering to the host page via postMessage, which has KaTeX loaded.
  useEffect(() => {
    function handleSandboxLatex(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.type !== 'renderLatex' || !ev.source) return;
      const latex = typeof data.latex === 'string' ? data.latex : '';
      let html = '';
      try {
        html = katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: true });
      } catch {
        html = '';
      }
      (ev.source as Window).postMessage({ type: 'latexResult', id: data.id, html }, '*');
    }
    window.addEventListener('message', handleSandboxLatex);
    return () => window.removeEventListener('message', handleSandboxLatex);
  }, []);

  const currentAudioTokenRef = useRef(0);
  const audioRetryTimerRef = useRef<number | null>(null);
  // prefetch refs so GC doesn't drop them mid-load
  const prefetchedImageRef = useRef<HTMLImageElement | null>(null);
  const prefetchedAudioNextRef = useRef<HTMLAudioElement | null>(null);
  const prefetchedImageNextRef = useRef<HTMLImageElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const fullscreenImageRef = useRef<HTMLImageElement>(null);
  const resumePositionRef = useRef<number | null>(null);
  const hasRestoredProgressRef = useRef(false);
  const persistProgressTimerRef = useRef<number | null>(null);
  const suppressNextProgressPersistRef = useRef(false);
  const playbackStatusTimerRef = useRef<number | null>(null);
  const cursorPushRafRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const drawingPushTimerRef = useRef<number | null>(null);
  const pendingDrawingRef = useRef<{ pageNumber: number; data: DrawingData } | null>(null);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    }).wakeLock;
    if (!wakeLockApi?.request) return;
    if (wakeLockRef.current && !wakeLockRef.current.released) return;
    try {
      const sentinel = await wakeLockApi.request('screen');
      wakeLockRef.current = sentinel;
      const onRelease = () => {
        wakeLockRef.current = null;
      };
      sentinel.addEventListener?.('release', onRelease);
    } catch {
      // 手機瀏覽器/權限可能拒絕，忽略即可
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    if (!sentinel) return;
    wakeLockRef.current = null;
    try {
      if (!sentinel.released) {
        await sentinel.release();
      }
    } catch {
      // ignore
    }
  }, []);

  const clearAudioRetryTimer = useCallback(() => {
    if (audioRetryTimerRef.current != null) {
      window.clearTimeout(audioRetryTimerRef.current);
      audioRetryTimerRef.current = null;
    }
  }, []);

  // 取消「動畫長度超過語音長度」時延後切頁的計時器；換頁／拖動進度條／手動暫停時呼叫，
  // 避免計時器在使用者已離開該頁後才觸發切頁。
  const clearPendingPageExtend = useCallback(() => {
    if (pendingPageExtendTimerRef.current != null) {
      window.clearInterval(pendingPageExtendTimerRef.current);
      pendingPageExtendTimerRef.current = null;
    }
    setIsExtendingAnimation(false);
  }, []);

  const showPlaybackStatusMessage = useCallback((message: string) => {
    setPlaybackStatusMessage(message);
    if (playbackStatusTimerRef.current != null) {
      window.clearTimeout(playbackStatusTimerRef.current);
    }
    playbackStatusTimerRef.current = window.setTimeout(() => {
      setPlaybackStatusMessage(null);
      playbackStatusTimerRef.current = null;
    }, 2500);
  }, []);

  const scheduleAudioReload = useCallback(
    (token: number, audioUrl: string, pageNumber?: number) => {
      const audio = audioRef.current;
      if (!audio || !audioUrl) return;
      if (token !== currentAudioTokenRef.current) return;

      clearAudioRetryTimer();
      audioRetryTimerRef.current = window.setTimeout(() => {
        if (token !== currentAudioTokenRef.current) return;
        const retryUrl = `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`;
        debugWarn('[tts][audio-element] auto retry load', {
          pageNumber,
          retryUrl,
        });
        audio.src = retryUrl;
        audio.load();
        audio.playbackRate = playbackRateRef.current;
        setAudioError(t('play.error.audioLoad'));
      }, AUDIO_RETRY_DELAY_MS);
    },
    [clearAudioRetryTimer],
  );

  const currentShareToken = searchParams.get('share')?.trim() || '';
  const shouldAutoFullscreen = searchParams.get('fullscreen') === '1';
  // 透過分享連結開啟的簡報需直接進入全螢幕並鎖定，使用者只能在「全螢幕／全螢幕字幕」間切換，不能離開全螢幕。
  const isLockedFullscreen = Boolean(currentShareToken);
  const playbackProgressStorageKey = pdfId ? `makeslide.playback.progress.${pdfId}` : '';
  const bookmarksStorageKey = pdfId ? `makeslide.bookmarks.${pdfId}` : '';
  const [bookmarks, setBookmarks] = useState<number[]>(() => {
    if (!pdfId) return [];
    try {
      const raw = window.localStorage.getItem(`makeslide.bookmarks.${pdfId}`);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch { return []; }
  });

  const toggleBookmark = useCallback((pageNumber: number) => {
    if (!bookmarksStorageKey) return;
    setBookmarks((prev) => {
      const next = prev.includes(pageNumber) ? prev.filter((n) => n !== pageNumber) : [...prev, pageNumber].sort((a, b) => a - b);
      window.localStorage.setItem(bookmarksStorageKey, JSON.stringify(next));
      return next;
    });
  }, [bookmarksStorageKey]);

  const importantPagesStorageKey = pdfId ? `makeslide.importantPages.${pdfId}` : '';
  const [importantPages, setImportantPages] = useState<number[]>(() => {
    if (!pdfId) return [];
    try {
      const raw = window.localStorage.getItem(`makeslide.importantPages.${pdfId}`);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch { return []; }
  });

  const toggleImportantPage = useCallback((pageNumber: number) => {
    if (!importantPagesStorageKey) return;
    setImportantPages((prev) => {
      const next = prev.includes(pageNumber) ? prev.filter((n) => n !== pageNumber) : [...prev, pageNumber].sort((a, b) => a - b);
      window.localStorage.setItem(importantPagesStorageKey, JSON.stringify(next));
      return next;
    });
  }, [importantPagesStorageKey]);

  // ─── Poll new badge ────────────────────────────────────────────────────────
  const [newPollBadge, setNewPollBadge] = useState(false);
  const clearPollBadge = useCallback(() => setNewPollBadge(false), []);
  const prevSyncDisplayedPollIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevSyncDisplayedPollIdRef.current;
    if (
      syncDisplayedPollId !== null
      && syncDisplayedPollId !== prev
      && isSyncFollower
      && activeTab !== 'qa'
    ) {
      setNewPollBadge(true);
    }
    prevSyncDisplayedPollIdRef.current = syncDisplayedPollId;
  }, [syncDisplayedPollId, isSyncFollower, activeTab]);

  useEffect(() => {
    hasRestoredProgressRef.current = false;
    resumePositionRef.current = null;
    if (persistProgressTimerRef.current != null) {
      window.clearTimeout(persistProgressTimerRef.current);
      persistProgressTimerRef.current = null;
    }
  }, [pdfId]);

  // ---- Load detail (+ poll until ready) ----
  useEffect(() => {
    if (!pdfId) return;
    let cancelled = false;
    let timer: number | null = null;

    const load = async () => {
      try {
        let shareMode: ShareAccessMode | null = null;
        if (currentShareToken) {
          const share = await resolveShareToken(currentShareToken);
          if (share.pdf_id !== pdfId) {
            throw new ApiError(t('play.error.shareMismatch'), 'INVALID_SHARE_TARGET', 400);
          }
          shareMode = share.access;
        }
        const d = await fetchPdfDetail(pdfId, currentShareToken || undefined);
        if (cancelled) return;
        const detailWithShare = shareMode ? { ...d, share_mode: shareMode } : d;
        setDetail(detailWithShare);
        setVideoUrl(detailWithShare.video_url ?? null);
        setTitleInput(detailWithShare.title ?? detailWithShare.original_filename);
        setTagsInput(detailWithShare.tags ?? '');
        setDescriptionInput(detailWithShare.description ?? '');
        // page prompts are managed per page in local state
        setTtsVoice(d.tts_voice?.trim() || 'alloy');
        setTtsSpeed(d.tts_speed ?? getStoredTtsSpeed());
        setScriptMaxCharsPerPage(typeof d.script_max_chars_per_page === 'number' ? d.script_max_chars_per_page : null);
        setHostMode(d.host_mode === 'dual' ? 'dual' : 'solo');
        setLoadError(null);
        if (detailWithShare.status === 'ready') {
          void updateLastPlayed(pdfId).catch(() => undefined);
          void incrementPlayCount(pdfId).catch(() => undefined);
        } else {
          timer = window.setTimeout(load, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : t('play.error.loadFailed');
        setLoadError(msg);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [pdfId, currentShareToken]);

  const pages = detail?.pages ?? [];
  const deckPages: PdfDetailPage[] = useMemo(() => pages, [pages]);
  const currentPage: PdfDetailPage | null = deckPages[currentIdx] ?? null;
  // Follower 端僅在目前頁面與 master 推送的手寫頁碼一致時套用鏡射內容，否則維持空白（undefined 表示維持一般模式）。
  const remoteDrawingData: DrawingData | undefined = isSyncFollower
    ? (currentPage && syncDrawingState && syncDrawingState.pageNumber === currentPage.page_number
        ? { strokes: syncDrawingState.strokes }
        : { strokes: [] })
    : undefined;
  const totalPages = deckPages.length;
  // owner（含沒有 owner 的舊資料）永遠可讀寫；分享連結的唯讀限制只套用在其他訪客身上，
  // 避免 owner 自己設定唯讀分享後，用自己的帳號開啟簡報時也被鎖成唯讀。
  const shareIsReadOnly =
    !detail?.is_owner &&
    (detail?.share_mode === 'read_only' || (!currentShareToken && detail?.visibility === 'public'));
  // 加入同步前必須先載到簡報詳情，才能判斷是否唯讀；否則唯讀者可能在 detail 載入前
  // 以 master 身分（/sync/join）嘗試而吃 403，連帶把同步關掉。
  const isDetailLoaded = detail != null;
  const canViewPostClassReport = Boolean(detail?.is_owner && !currentShareToken);
  const canAskPage = Boolean(detail?.is_authenticated);
  const isReadOnlyProcessing =
    (detail != null &&
      detail.status !== 'ready' &&
      detail.status !== 'awaiting_script_confirmation') ||
    shareIsReadOnly;

  useEffect(() => {
    if (deckPages.length === 0) {
      setThumbLoadUntilIdx(0);
      return;
    }
    setThumbLoadUntilIdx((prev) => {
      const maxIdx = deckPages.length - 1;
      const initialWindow = Math.min(4, maxIdx);
      const base = Math.max(prev, initialWindow);
      if (base > maxIdx) return maxIdx;
      if (currentIdx > base) return currentIdx;
      return base;
    });
  }, [deckPages.length, currentIdx]);

  useEffect(() => {
    setVisitedIdxSet((prev) => {
      if (prev.has(currentIdx)) return prev;
      const next = new Set(prev);
      next.add(currentIdx);
      return next;
    });
  }, [currentIdx]);

  const readOnlyReason = isReadOnlyProcessing
    ? shareIsReadOnly
      ? t('play.banner.readOnlyShare')
      : `${t('play.banner.generatingPrefix')}${formatGeneratingStatusLabel(detail.status, detail.progress_step, t)}${t('play.banner.generatingSuffix')}`
    : null;
  const slideImageMaxHeightVh = Math.round(52 * slideImageScale);
  const imageBustKey = detail?.updated_at ?? '';
  const withImageBust = useCallback(
    (url: string | null | undefined) => {
      if (!url) return null;
      const parts = [`t=${encodeURIComponent(imageBustKey)}`];
      if (currentShareToken) parts.push(`share=${encodeURIComponent(currentShareToken)}`);
      const q = parts.join('&');
      return url.includes('?') ? `${url}&${q}` : `${url}?${q}`;
    },
    [imageBustKey, currentShareToken],
  );

  const withShareToken = useCallback(
    (url: string | null | undefined) => {
      if (!url || !currentShareToken) return url ?? null;
      const q = `share=${encodeURIComponent(currentShareToken)}`;
      return url.includes('?') ? `${url}&${q}` : `${url}?${q}`;
    },
    [currentShareToken],
  );

  const playbackImageSrc = useMemo(() => {
    const url = currentPage?.thumbnail_url ?? currentPage?.image_url ?? null;
    return withImageBust(url) ?? url;
  }, [currentPage?.image_url, currentPage?.thumbnail_url, withImageBust]);

  const fullscreenImageSrc = useMemo(() => {
    const url = currentPage?.image_url ?? currentPage?.thumbnail_url ?? null;
    return withImageBust(url) ?? url;
  }, [currentPage?.image_url, currentPage?.thumbnail_url, withImageBust]);

  const targetImageSrc = imageOnlyFullscreen ? fullscreenImageSrc : playbackImageSrc;
  const targetImagePageNumber = currentPage?.page_number ?? null;
  const displayedImageSrc =
    loadedSlideImage && loadedSlideImage.pageNumber === targetImagePageNumber && loadedSlideImage.src === targetImageSrc
      ? loadedSlideImage.src
      : null;
  const imageReadyForCurrentPage = !targetImageSrc || Boolean(displayedImageSrc);

  useEffect(() => {
    if (!targetImageSrc || targetImagePageNumber == null) {
      setLoadedSlideImage(null);
      return;
    }
    const img = new Image();
    const settle = () => setLoadedSlideImage({ pageNumber: targetImagePageNumber, src: targetImageSrc });
    img.onload = settle;
    img.onerror = settle;
    img.src = targetImageSrc;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [targetImagePageNumber, targetImageSrc]);

  useEffect(() => {
    if (!pdfId || !playbackProgressStorageKey || deckPages.length === 0) return;
    if (hasRestoredProgressRef.current) return;
    hasRestoredProgressRef.current = true;
    try {
      const raw = window.localStorage.getItem(playbackProgressStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { page_number?: number; current_time?: number };
      const pageNumber = Number(parsed.page_number);
      const savedTime = Number(parsed.current_time);
      if (Number.isFinite(pageNumber) && pageNumber >= 1) {
        const targetIdx = Math.min(deckPages.length - 1, Math.max(0, Math.floor(pageNumber) - 1));
        setCurrentIdx(targetIdx);
      }
      if (Number.isFinite(savedTime) && savedTime >= 0) {
        resumePositionRef.current = savedTime;
      }
    } catch {
      // ignore broken localStorage payload
    }
  }, [pdfId, deckPages.length, playbackProgressStorageKey]);

  useEffect(() => {
    if (!pdfId || !playbackProgressStorageKey || deckPages.length === 0 || !currentPage) return;
    if (suppressNextProgressPersistRef.current) {
      suppressNextProgressPersistRef.current = false;
      return;
    }
    if (persistProgressTimerRef.current != null) {
      window.clearTimeout(persistProgressTimerRef.current);
    }
    persistProgressTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          playbackProgressStorageKey,
          JSON.stringify({
            page_number: currentPage.page_number,
            current_time: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
            updated_at: Date.now(),
          }),
        );
      } catch {
        // ignore storage quota/security errors
      }
      persistProgressTimerRef.current = null;
    }, 300);
    return () => {
      if (persistProgressTimerRef.current != null) {
        window.clearTimeout(persistProgressTimerRef.current);
        persistProgressTimerRef.current = null;
      }
    };
  }, [pdfId, playbackProgressStorageKey, deckPages.length, currentPage?.page_number, currentTime]);

  // ---- Fetch all scripts once pages are ready ----
  useEffect(() => {
    if (deckPages.length === 0) return;
    let cancelled = false;
    // 改為「背景漸進載入」：避免一次 Promise.all 佔用網路/主執行緒，
    // 讓同步 join/poll 與首屏互動更快開始。
    const queue = [...deckPages];
    const concurrency = 1;

    const loadOne = async (p: PdfDetailPage) => {
      if (!p.script_url) {
        if (!cancelled) {
          setScripts((prev) => (prev[p.page_number] === '' ? prev : { ...prev, [p.page_number]: '' }));
        }
        return;
      }
      try {
        const bust = `t=${Date.now()}`;
        const scriptUrl = withShareToken(p.script_url) ?? p.script_url;
        const url = scriptUrl.includes('?') ? `${scriptUrl}&${bust}` : `${scriptUrl}?${bust}`;
        const resp = await fetch(url, { cache: 'no-store' });
        const text = resp.ok ? await resp.text() : '';
        if (!cancelled) {
          setScripts((prev) => ({ ...prev, [p.page_number]: text }));
        }
      } catch {
        if (!cancelled) {
          setScripts((prev) => ({ ...prev, [p.page_number]: '' }));
        }
      }
    };

    const worker = async () => {
      while (!cancelled) {
        const next = queue.shift();
        if (!next) return;
        await loadOne(next);
      }
    };

    void Promise.all(Array.from({ length: concurrency }, () => worker()));
    return () => {
      cancelled = true;
    };
  }, [deckPages, withShareToken]);

  // ---- Swap audio src when current page changes ----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentPage || !currentPage.audio_url) return;
    const audioUrl = withShareToken(currentPage.audio_url) ?? currentPage.audio_url;
    const pageNumber = currentPage.page_number;
    const token = currentAudioTokenRef.current + 1;
    currentAudioTokenRef.current = token;
    clearAudioRetryTimer();
    // 使用穩定版本鍵：同一版本 URL 不變可命中 cache；內容更新時（updated_at 改變）才換 URL
    const versionKey = detail?.updated_at ? encodeURIComponent(detail.updated_at) : '';
    const nextUrl = versionKey
      ? `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}v=${versionKey}`
      : audioUrl;
    audio.src = nextUrl;
    audio.load();
    // load() 會把 playbackRate 重置回 1.0，換頁後需重新套用使用者設定的速度
    audio.playbackRate = playbackRateRef.current;
    setCurrentTime(0);
    setDuration(0);
    setDurationPageNumber(null);
    setAudioError(null);
    if (isPlaying) {
      void audio.play().catch(() => scheduleAudioReload(token, audioUrl, pageNumber));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.page_number, clearAudioRetryTimer, scheduleAudioReload, withShareToken]);

  useEffect(
    () => () => {
      clearAudioRetryTimer();
      if (playbackStatusTimerRef.current != null) {
        window.clearTimeout(playbackStatusTimerRef.current);
        playbackStatusTimerRef.current = null;
      }
      void releaseWakeLock();
    },
    [clearAudioRetryTimer, releaseWakeLock],
  );

  useEffect(() => {
    if (isPlaying) {
      void acquireWakeLock();
    } else {
      void releaseWakeLock();
    }
  }, [isPlaying, acquireWakeLock, releaseWakeLock]);

  useEffect(() => {
    if (!isPlaying) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isPlaying, acquireWakeLock]);

  // ---- Prefetch current image + next page assets ----
  useEffect(() => {
    let timer: number | null = null;
    const current = deckPages[currentIdx] ?? null;
    const next = deckPages[currentIdx + 1] ?? null;

    // 延後預載：先讓同步模式初始化（join/state polling）取得時機，
    // 再進行圖片/音訊預抓，避免初始網路壅塞影響 follower 進場。
    timer = window.setTimeout(() => {
      // 目前頁：先預熱，避免切入頁面時首播卡住
      if (current?.thumbnail_url || current?.image_url) {
        const img = new Image();
        const currentImageUrl = current.thumbnail_url ?? current.image_url;
        img.src = withImageBust(currentImageUrl) ?? currentImageUrl ?? '';
        prefetchedImageRef.current = img;
      } else {
        prefetchedImageRef.current = null;
      }
      // 下一頁：提前預載，提升自動切頁銜接
      if (next?.thumbnail_url || next?.image_url) {
        const img = new Image();
        const nextImageUrl = next.thumbnail_url ?? next.image_url;
        img.src = withImageBust(nextImageUrl) ?? nextImageUrl ?? '';
        prefetchedImageNextRef.current = img;
      } else {
        prefetchedImageNextRef.current = null;
      }
      if (next?.audio_url) {
        const a = new Audio();
        a.preload = 'auto';
        // 與正式播放使用同一組版本 URL，才能真正命中快取
        const nextVersionKey = detail?.updated_at ? encodeURIComponent(detail.updated_at) : '';
        const nextAudioUrl = withShareToken(next.audio_url) ?? next.audio_url;
        a.src = nextVersionKey
          ? `${nextAudioUrl}${nextAudioUrl.includes('?') ? '&' : '?'}v=${nextVersionKey}`
          : nextAudioUrl;
        a.load();
        prefetchedAudioNextRef.current = a;
      } else {
        prefetchedAudioNextRef.current = null;
      }
    }, PREFETCH_START_DELAY_MS);

    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [currentIdx, deckPages, withImageBust, detail?.updated_at]);

  // ---- Controls ----
  const playPause = useCallback(() => {
    if (syncEnabled && syncRole !== 'master') return;
    setPlayQrCodeUrl(null);
    if (isExtendingAnimation) {
      // 語音已播畢、動畫仍在延長播放中：使用者按下播放/暫停視為提前結束延長，
      // 取消自動切頁計時器，動畫停在目前畫面，等待使用者手動操作。
      clearPendingPageExtend();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (classroomMode && classroomAwaitingNext && currentIdx < totalPages - 1) {
      setClassroomAwaitingNext(false);
      setFinished(false);
      setCurrentIdx((i) => Math.min(totalPages - 1, i + 1));
      setIsPlaying(true);
      return;
    }
    if (audio.paused) {
      // 本頁已播到結尾（沒開自動換頁而停在此）：按播放/點圖片時前進到下一頁並開始播放
      // （手動續播），而不是讓瀏覽器對已結束的音訊呼叫 play() 重播當頁。最後一頁則照常重播。
      const atEnd = audio.ended
        || (Number.isFinite(audio.duration) && audio.duration > 0 && audio.currentTime >= audio.duration - 0.05);
      if (atEnd && currentIdx < totalPages - 1) {
        setFinished(false);
        setCurrentIdx((i) => Math.min(totalPages - 1, i + 1));
        setIsPlaying(true);
        return;
      }
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [classroomAwaitingNext, classroomMode, currentIdx, syncEnabled, syncRole, totalPages, isExtendingAnimation, clearPendingPageExtend]);

  const goPrev = useCallback(() => {
    if (syncEnabled && syncRole !== 'master') return;
    setPlayQrCodeUrl(null);
    setClassroomAwaitingNext(false);
    setFinished(false);
    clearPendingPageExtend();
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, [syncEnabled, syncRole, clearPendingPageExtend]);

  const goNext = useCallback(() => {
    if (syncEnabled && syncRole !== 'master') return;
    setPlayQrCodeUrl(null);
    setClassroomAwaitingNext(false);
    setFinished(false);
    clearPendingPageExtend();
    setCurrentIdx((i) => Math.min(totalPages - 1, i + 1));
  }, [syncEnabled, syncRole, totalPages, clearPendingPageExtend]);

  // usePagePolls 必須在 handleEnded 之前宣告，以避免 TDZ 問題
  const pollState = usePagePolls({
    pdfId,
    currentPage,
    interactiveMode,
    syncEnabled,
    syncRole,
    syncRealtimePollStarted,
    totalPages,
    setCurrentIdx,
    setIsPlaying,
    setClassroomAwaitingNext,
    setFinished,
    setFullscreenPollControlOpen,
    syncClientIdRef,
    currentIdx,
    isPlaying,
    currentTime,
    followerAudioUnlocked,
    syncPollShowResults,
    setSyncPollShowResults,
    setSyncDisplayedPollId,
  });

  // 一般手動開始的投票結束後不會自動繼續播放；只有由 realtime-poll 動畫效果觸發暫停的
  // 這次問答，master 按下「結束投票」才需要額外恢復播放（回到觸發時所在的那一頁繼續講）。
  // 必須宣告在後面任何 early return（!pdfId/loadError/!detail/totalPages===0）之前，
  // 否則這個 hook 在走到早退路徑的那次 render 不會被呼叫，違反 Hooks 規則（React #310）。
  const handleStopPollAndResumeIfPausedByEffect = useCallback(() => {
    const shouldResume = pausedForRealtimePollEffectRef.current;
    pausedForRealtimePollEffectRef.current = false;
    pollState.handleStopPoll();
    if (shouldResume) {
      setFinished(false);
      void audioRef.current?.play().catch(() => setIsPlaying(false));
    }
  }, [pollState.handleStopPoll]);

  // ─── handleEnded (stays in PlayPage) ───────────────────────────────────────
  // 跨領域協調：同時觸及 pollState（usePage Polls）、playback state（isPlaying/currentIdx/finished）
  // 以及 classroomMode/interactiveMode 全域開關，三個領域在同一個回呼中依序決策，
  // 任何一個領域都無法獨自持有完整的 if/else 邏輯。
  // 拆成 runPageEndedAdvance：實際切頁／結束的邏輯，可在語音結束時立即執行，
  // 也可在動畫比語音長時，等動畫播完才延後執行。
  const runPageEndedAdvance = useCallback(() => {
    if (interactiveMode) {
      if (pollState.pagePolls.length > 0) {
        // 當頁有投票：啟動 poll，停在此頁等待互動
        pollState.setPollStarted(true);
        pollState.setPollError(null);
        setFullscreenPollControlOpen(true);
        if (currentIdx < totalPages - 1) {
          setClassroomAwaitingNext(true);
        } else {
          setFinished(true);
        }
        return;
      } else if (!classroomMode) {
        // 當頁無投票且非上課模式：根據 autoAdvance 決定是否切頁
        if (!autoAdvance) return;
        if (currentIdx < totalPages - 1) {
          setCurrentIdx((i) => i + 1);
          setIsPlaying(true);
        } else {
          setFinished(true);
        }
        return;
      }
      // 當頁無投票 + 上課模式：走下方 classroomMode 邏輯
    }
    if (currentIdx < totalPages - 1) {
      if (classroomMode) {
        setClassroomAwaitingNext(true);
        return;
      }
      if (!autoAdvance) return;
      setCurrentIdx((i) => i + 1);
      setIsPlaying(true);
    } else {
      setClassroomAwaitingNext(false);
      setFinished(true);
    }
  }, [autoAdvance, classroomMode, interactiveMode, pollState.pagePolls.length, currentIdx, totalPages]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    // 動畫的總長若超過語音長度，先延長本頁顯示時間（讓 GSAP timeline 播完），
    // 等動畫實際播完後才執行切頁／結束等後續動作。
    const extraSeconds = animationDurationSecondsRef.current - duration;
    const rate = playbackRateRef.current > 0 ? playbackRateRef.current : 1;
    if (Number.isFinite(extraSeconds) && extraSeconds > 0.05) {
      setIsExtendingAnimation(true);
      const targetTime = animationDurationSecondsRef.current;
      const baseTime = duration;
      const startedAtMs = performance.now();
      // 用 setInterval 持續推進 currentTime，讓 useGsapSlideTimeline 的
      // postMessage(sync) effect 在延長期間也能跟著更新，custom-script
      // 效果的內部動畫才不會在語音結束、audio 不再觸發 timeupdate 後停住。
      pendingPageExtendTimerRef.current = window.setInterval(() => {
        const elapsedSeconds = ((performance.now() - startedAtMs) / 1000) * rate;
        const next = baseTime + elapsedSeconds;
        if (next >= targetTime) {
          if (pendingPageExtendTimerRef.current != null) {
            window.clearInterval(pendingPageExtendTimerRef.current);
            pendingPageExtendTimerRef.current = null;
          }
          setCurrentTime(targetTime);
          setIsExtendingAnimation(false);
          runPageEndedAdvance();
          return;
        }
        setCurrentTime(next);
      }, PAGE_EXTEND_TICK_MS);
      return;
    }
    runPageEndedAdvance();
  }, [duration, runPageEndedAdvance]);

  const handleSeek = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      if (syncEnabled && syncRole !== 'master') return;
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(duration) || duration <= 0) return;
      clearPendingPageExtend();
      const ratio = Number(ev.target.value) / 1000;
      audio.currentTime = ratio * duration;
    },
    [duration, syncEnabled, syncRole, clearPendingPageExtend],
  );

  /** 將播放時間軸移到指定秒數（夾在 [0, duration] 內），供動畫編輯器點擊效果時跳轉預覽用。 */
  const handleSeekToTime = useCallback(
    (seconds: number) => {
      if (syncEnabled && syncRole !== 'master') return;
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(duration) || duration <= 0) return;
      clearPendingPageExtend();
      audio.currentTime = clamp(seconds, 0, duration);
    },
    [duration, syncEnabled, syncRole, clearPendingPageExtend],
  );

  const handleClearPlaybackProgress = useCallback(() => {
    if (!playbackProgressStorageKey) return;
    if (persistProgressTimerRef.current != null) {
      window.clearTimeout(persistProgressTimerRef.current);
      persistProgressTimerRef.current = null;
    }
    try {
      window.localStorage.removeItem(playbackProgressStorageKey);
    } catch {
      // ignore storage security errors; the visible playback state is still reset
    }
    suppressNextProgressPersistRef.current = true;
    resumePositionRef.current = null;
    hasRestoredProgressRef.current = true;
    clearPendingPageExtend();
    setPlayQrCodeUrl(null);
    setClassroomAwaitingNext(false);
    setFinished(false);
    setIsPlaying(false);
    setCurrentIdx(0);
    setCurrentTime(0);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    showPlaybackStatusMessage(t('play.playbackProgress.cleared'));
  }, [clearPendingPageExtend, playbackProgressStorageKey, showPlaybackStatusMessage, t]);

  // 換頁或卸載時，取消尚未觸發的延長切頁計時器，避免在已離開的頁面上執行切頁。
  useEffect(() => {
    return () => clearPendingPageExtend();
  }, [currentIdx, clearPendingPageExtend]);

  useEffect(() => {
    if (!pdfId) return;
    const enabledKey = `makeslide.sync.enabled.${pdfId}`;
    const stored = window.localStorage.getItem(enabledKey);
    if (stored === '1') {
      setSyncEnabled(true);
      return;
    }
    // follower 常由分享連結進入；若尚未有本機設定，預設自動開啟同步模式。
    if (currentShareToken) {
      window.localStorage.setItem(enabledKey, '1');
      setSyncEnabled(true);
      return;
    }
    // 從列表進入（網址沒帶分享 token）的唯讀觀看者：若簡報 owner 已經進入 master 模式
    // （同步中），自動以 follower 加入，與帶 token 連結的體驗一致。需等 detail 載入後
    // 才能判斷是否唯讀；本 effect 已將 isDetailLoaded / shareIsReadOnly 列入相依。
    if (isDetailLoaded && shareIsReadOnly) {
      let cancelled = false;
      void fetchPlaybackSyncState(pdfId)
        .then((state) => {
          if (!cancelled) setSyncEnabled(Boolean(state.master_client_id));
        })
        .catch(() => {
          if (!cancelled) setSyncEnabled(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setSyncEnabled(false);
  }, [pdfId, currentShareToken, isDetailLoaded, shareIsReadOnly]);

  useEffect(() => {
    // 等 detail 載入後再 join：唯讀判斷依賴 detail，太早 join 會讓唯讀者吃 403。
    // 本 effect 已把 isDetailLoaded / shareIsReadOnly 列入相依，detail 載入後會重跑。
    if (!syncEnabled || !pdfId || !isDetailLoaded) return;
    const enabledKey = `makeslide.sync.enabled.${pdfId}`;
    window.localStorage.setItem(enabledKey, '1');
    // client_id 必須「每個分頁唯一」；若用 localStorage 會在同瀏覽器多分頁共用，
    // 造成第二個分頁被視為同一 client，無法正確進入 follower。
    const storageKey = `makeslide.sync.client.${pdfId}`;
    const existing = window.sessionStorage.getItem(storageKey);
    const next = existing || `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(storageKey, next);
    syncClientIdRef.current = next;
    let cancelled = false;
    void (async () => {
      try {
        const userCode = await resolveConfiguredUserCode();
        // 唯讀觀看者（含從列表進入、URL 沒帶分享 token 的 public 簡報）一律走 follower 的
        // share-join；/sync/join 會以編輯權限把關，唯讀者呼叫只會拿到 403。currentShareToken
        // 可能為空字串，後端 share-join 對可讀的簡報（public）也會放行。
        const joined = (currentShareToken || shareIsReadOnly)
          ? await joinSharedPlaybackSync(pdfId, next, currentShareToken)
          : await joinPlaybackSync(pdfId, next, userCode || undefined);
        if (cancelled) return;
        setSyncRole(joined.role);
        // Remember that this browser was master so polling can reclaim the slot
        // after a server-side reset (e.g. server restart or session expiry).
        if (joined.role === 'master' && !currentShareToken) {
          window.localStorage.setItem(`makeslide.sync.wasMaster.${pdfId}`, '1');
        }
        setFollowerAudioUnlocked(joined.follower_audio_unlocked);
        if (joined.role === 'follower' && !joined.follower_audio_unlocked) setAudioMuted(true);
        setSyncFollowerQuestions(joined.follower_questions ?? []);
        setSyncDisplayedQuestionId(joined.displayed_question_id ?? null);
        setSyncAiAnswer(joined.ai_answer ?? null);
        setSyncRealtimePollStarted(Boolean(joined.realtime_poll_started));
        setSyncPollShowResults(Boolean(joined.quiz_show_answers));
        setSyncDisplayedPollId(
          typeof joined.active_quiz_id === 'number' && joined.active_quiz_id > 0
            ? joined.active_quiz_id
            : null,
        );
        setSyncError(null);
      } catch (err) {
        if (cancelled) return;
        setSyncError(err instanceof ApiError ? err.message : t('play.error.syncConnect'));
        const enabledKey = `makeslide.sync.enabled.${pdfId}`;
        window.localStorage.removeItem(enabledKey);
        setSyncEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncEnabled, pdfId, currentShareToken, shareIsReadOnly, isDetailLoaded]);

  // 同步模式下手寫工具僅 master 可用；若目前角色變成 follower（例如 master 易主），強制關閉手寫模式。
  useEffect(() => {
    if (!canUseDrawingTools && drawingMode) {
      setDrawingMode(false);
      setDrawingTool('pen');
    }
  }, [canUseDrawingTools, drawingMode]);

  // 進入手寫模式時自動暫停播放，避免講者繪圖時投影片自動切換或動畫繼續播放。
  useEffect(() => {
    if (drawingMode) {
      audioRef.current?.pause();
    }
  }, [drawingMode]);

  const handleSyncEnabledChange = useCallback(
    (checked: boolean) => {
      if (!pdfId) return;
      const enabledKey = `makeslide.sync.enabled.${pdfId}`;
      if (checked) {
        window.localStorage.setItem(enabledKey, '1');
        setSyncError(null);
        setSyncEnabled(true);
        return;
      }
      window.localStorage.removeItem(enabledKey);
      window.localStorage.removeItem(`makeslide.sync.wasMaster.${pdfId}`);
      setSyncError(null);
      setSyncEnabled(false);
      setSyncRole('follower');
      const clientId = syncClientIdRef.current;
      syncClientIdRef.current = '';
      if (clientId) {
        void leavePlaybackSync(pdfId, clientId).catch(() => undefined);
      }
      setSyncDrawingState(null);
    },
    [pdfId],
  );

  // ─── Drawing push (stays in PlayPage) ──────────────────────────────────────
  // flushLocalDrawingPush / pushLocalDrawingChange 與游標推送（cursor push effect）共用
  // 同一個 updatePlaybackSyncState payload：每次推送都必須帶齊播放位置、投票狀態等欄位，
  // 才能讓 follower 端一次 tick 拿到所有最新狀態。
  // 若移入獨立 hook，將需要把 currentIdx/isPlaying/currentTime/pollState 等全部注入，
  // 且 flushLocalDrawingPush 仍必須與 cursor push effect 的節流間隔完全一致，
  // 組合複雜度高於保留在 PlayPage 的成本。
  const flushLocalDrawingPush = useCallback(() => {
    drawingPushTimerRef.current = null;
    const pending = pendingDrawingRef.current;
    if (!pending || !pdfId || !syncClientIdRef.current) return;
    pendingDrawingRef.current = null;
    void updatePlaybackSyncState(pdfId, syncClientIdRef.current, {
      page_number: Math.max(1, currentIdx + 1),
      is_playing: isPlaying,
      current_time: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
      follower_audio_unlocked: followerAudioUnlocked,
      realtime_poll_started: pollState.pollStarted,
      quiz_show_answers: syncPollShowResults,
      active_quiz_id: syncDisplayedPollId,
      drawing_page_number: pending.pageNumber,
      drawing_json: JSON.stringify(pending.data),
    });
  }, [pdfId, currentIdx, isPlaying, currentTime, followerAudioUnlocked, pollState.pollStarted, syncPollShowResults, syncDisplayedPollId]);

  const pushLocalDrawingChange = useCallback(
    (data: DrawingData) => {
      if (!syncEnabled || syncRole !== 'master' || !pdfId || !syncClientIdRef.current || !currentPage) return;
      pendingDrawingRef.current = { pageNumber: currentPage.page_number, data };
      if (drawingPushTimerRef.current == null) {
        drawingPushTimerRef.current = window.setTimeout(
          flushLocalDrawingPush,
          imageOnlyFullscreen ? SYNC_CURSOR_PUSH_INTERVAL_FULLSCREEN_MS : SYNC_CURSOR_PUSH_INTERVAL_MS,
        );
      }
    },
    [syncEnabled, syncRole, pdfId, currentPage, imageOnlyFullscreen, flushLocalDrawingPush],
  );

  useEffect(() => {
    return () => {
      if (drawingPushTimerRef.current != null) {
        window.clearTimeout(drawingPushTimerRef.current);
        drawingPushTimerRef.current = null;
      }
      pendingDrawingRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!syncEnabled || !pdfId || !syncClientIdRef.current) return;
    if (syncRole !== 'master') return;
    if (applyingRemoteSyncRef.current) return;
    const pageNumber = Math.max(1, currentIdx + 1);
    const time = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    debugLog('[sync][master->state] push', {
      pdfId,
      clientId: syncClientIdRef.current,
      syncRole,
      pageNumber,
      isPlaying,
      currentTime: time,
      followerAudioUnlocked,
    });
    void updatePlaybackSyncState(pdfId, syncClientIdRef.current, {
      page_number: pageNumber,
      is_playing: isPlaying,
      current_time: time,
      follower_audio_unlocked: followerAudioUnlocked,
      realtime_poll_started: pollState.pollStarted,
      quiz_show_answers: syncPollShowResults,
      active_quiz_id: syncDisplayedPollId,
    }).catch((err) => {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.syncStateUpdate'));
    });
  }, [syncEnabled, syncRole, pdfId, currentIdx, isPlaying, currentTime, followerAudioUnlocked, pollState.pollStarted, syncPollShowResults, syncDisplayedPollId]);

  useEffect(() => {
    if (!syncEnabled || syncRole !== 'master' || !pdfId) return;
    if (!imageOnlyFullscreen) return;
    const root = fullscreenContainerRef.current;
    if (!root) return;
    const flush = () => {
      cursorPushRafRef.current = null;
      const next = pendingCursorRef.current;
      if (!next || !syncClientIdRef.current) return;
      pendingCursorRef.current = null;
      void updatePlaybackSyncState(pdfId, syncClientIdRef.current, {
        page_number: Math.max(1, currentIdx + 1),
        is_playing: isPlaying,
        current_time: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
        follower_audio_unlocked: followerAudioUnlocked,
        realtime_poll_started: pollState.pollStarted,
        quiz_show_answers: syncPollShowResults,
        active_quiz_id: syncDisplayedPollId,
        cursor_x: next.x,
        cursor_y: next.y,
      }).catch(() => undefined);
    };
    const onPointerMove = (ev: PointerEvent) => {
      const rect = (fullscreenImageRef.current ?? root).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (
        ev.clientX < rect.left ||
        ev.clientX > rect.right ||
        ev.clientY < rect.top ||
        ev.clientY > rect.bottom
      ) {
        return;
      }
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      pendingCursorRef.current = { x, y };
      if (cursorPushRafRef.current == null) {
        cursorPushRafRef.current = window.setTimeout(
          flush,
          imageOnlyFullscreen ? SYNC_CURSOR_PUSH_INTERVAL_FULLSCREEN_MS : SYNC_CURSOR_PUSH_INTERVAL_MS,
        );
      }
    };
    root.addEventListener('pointermove', onPointerMove);
    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      if (cursorPushRafRef.current != null) {
        window.clearTimeout(cursorPushRafRef.current);
        cursorPushRafRef.current = null;
      }
      pendingCursorRef.current = null;
    };
  }, [syncEnabled, syncRole, pdfId, imageOnlyFullscreen, currentIdx, isPlaying, currentTime, followerAudioUnlocked, pollState.pollStarted, syncPollShowResults, syncDisplayedPollId]);

  // ─── Sync mega-polling effect (stays in PlayPage) ───────────────────────────
  // 這個 effect 同時寫入跨領域的 14+ 個 state setter（音訊 seek/play/pause、
  // 投票 syncRealtimePollStarted/syncDisplayedPollId/syncPollShowResults、
  // 繪圖 syncDrawingState、游標 remoteCursor、導航 setCurrentIdx、
  // sync 元數據 syncRole/syncError/followerAudioUnlocked 等），
  // 且 master/follower 邏輯完全交織在同一個 setInterval callback 中。
  // 若拆出 hook 需注入所有 setter 並保留完整 if/else 分支，
  // 不會減少複雜度；以 reducer 或狀態機重寫才是正確長期方向。
  useEffect(() => {
    if (!syncEnabled || !pdfId || !syncClientIdRef.current) return;
    debugLog('[sync][poll] start', {
      pdfId,
      clientId: syncClientIdRef.current,
      localRole: syncRole,
    });
    const pollInterval = imageOnlyFullscreen
      ? SYNC_POLL_INTERVAL_FULLSCREEN_MS
      : SYNC_POLL_INTERVAL_MS;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const state = await fetchPlaybackSyncState(pdfId, syncClientIdRef.current);
          debugLog('[sync][poll] state', {
            pdfId,
            clientId: syncClientIdRef.current,
            localRole: syncRole,
            serverRole: state.role,
            page: state.page_number,
            playing: state.is_playing,
            t: state.current_time,
          });
          setSyncRole(state.role);
          setFollowerAudioUnlocked(state.follower_audio_unlocked);
          // 唯讀觀看者（帶 token 的分享連結，或從列表自動跟隨的 public 觀看者）一旦
          // master 收掉同步就退出 follower；owner／可編輯分享者不在此列，留待下方自動
          // 重奪 master 的邏輯處理。
          if ((currentShareToken || shareIsReadOnly) && !state.master_client_id) {
            window.localStorage.removeItem(`makeslide.sync.enabled.${pdfId}`);
            setSyncEnabled(false);
            setSyncRole('follower');
            syncClientIdRef.current = '';
            setSyncError(null);
            return;
          }
          // If we were master before (e.g. server restarted, session reset) but
          // the slot is now vacant, reclaim master automatically so a reload or
          // server restart does not permanently strand the user as follower.
          if (
            state.role === 'follower'
            && !state.master_client_id
            && !currentShareToken
            && syncClientIdRef.current
            && window.localStorage.getItem(`makeslide.sync.wasMaster.${pdfId}`) === '1'
          ) {
            void joinPlaybackSync(pdfId, syncClientIdRef.current).then((rejoined) => {
              setSyncRole(rejoined.role);
              if (rejoined.role === 'master') {
                window.localStorage.setItem(`makeslide.sync.wasMaster.${pdfId}`, '1');
              }
            }).catch(() => undefined);
            return;
          }
          if (state.role !== 'master' && !state.follower_audio_unlocked) {
            setAudioMuted(true);
          }
          setSyncFollowerQuestions(state.follower_questions ?? []);
          setSyncDisplayedQuestionId(state.displayed_question_id ?? null);
          setSyncAiAnswer(state.ai_answer ?? null);
          setSyncRealtimePollStarted(Boolean(state.realtime_poll_started));
          setSyncPollShowResults(Boolean(state.quiz_show_answers));
          setSyncDisplayedPollId(
            typeof state.active_quiz_id === 'number' && state.active_quiz_id > 0
              ? state.active_quiz_id
              : null,
          );
          if (typeof state.cursor_x === 'number' && typeof state.cursor_y === 'number') {
            setRemoteCursor({
              x: Math.min(1, Math.max(0, state.cursor_x)),
              y: Math.min(1, Math.max(0, state.cursor_y)),
            });
          } else {
            setRemoteCursor(null);
          }
          if (
            state.role !== 'master'
            && typeof state.drawing_page_number === 'number'
            && typeof state.drawing_json === 'string'
          ) {
            try {
              const parsed = JSON.parse(state.drawing_json) as DrawingData;
              setSyncDrawingState({
                pageNumber: state.drawing_page_number,
                strokes: Array.isArray(parsed?.strokes) ? parsed.strokes : [],
              });
            } catch {
              setSyncDrawingState(null);
            }
          } else if (state.role !== 'master') {
            setSyncDrawingState(null);
          }
          if (
            state.role !== 'master'
            && imageOnlyFullscreen
            && state.quiz_mode
            && typeof state.active_quiz_id === 'number'
            && state.active_quiz_id > 0
          ) {
            navigate(`/play/${encodeURIComponent(pdfId)}/quizzes`, { replace: true });
            return;
          }
          if (state.role === 'master') return;
          applyingRemoteSyncRef.current = true;
          const targetIdx = Math.max(0, state.page_number - 1);
          debugLog('[sync][follower] apply-remote', {
            pdfId,
            clientId: syncClientIdRef.current,
            targetIdx,
            targetPage: state.page_number,
            currentIdx,
            playing: state.is_playing,
          });
          setCurrentIdx((prev) => (prev === targetIdx ? prev : targetIdx));
          const audio = audioRef.current;
          if (audio) {
            const nextTime = Number.isFinite(state.current_time) ? Math.max(0, state.current_time) : 0;
            const drift = Math.abs((audio.currentTime || 0) - nextTime);
            if (drift > 0.8) audio.currentTime = nextTime;
            if (state.is_playing) {
              void audio.play().catch(() => setIsPlaying(false));
            } else {
              audio.pause();
            }
          }
          setSyncError(null);
        } catch (err) {
          setSyncError(err instanceof ApiError ? err.message : t('play.error.syncPoll'));
        } finally {
          applyingRemoteSyncRef.current = false;
        }
      })();
    }, pollInterval);
    return () => {
      debugLog('[sync][poll] stop', {
        pdfId,
        clientId: syncClientIdRef.current,
        localRole: syncRole,
      });
      window.clearInterval(timer);
    };
  }, [syncEnabled, pdfId, imageOnlyFullscreen, navigate, syncRole, currentIdx, currentShareToken, shareIsReadOnly]);

  const handleSubmitFollowerQuestion = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    // 全螢幕對話框使用 syncQuestionInput，header 同步列使用 syncFollowerQuestionInput；
    // 任一非空即視為要送出的內容。
    const question =
      syncQuestionInput.trim() || syncFollowerQuestionInput.trim();
    if (!question) return;
    try {
      const userCode = await resolveConfiguredUserCode();
      const item = await submitSyncFollowerQuestion(
        pdfId,
        syncClientIdRef.current,
        question,
        userCode || undefined,
      );
      setSyncFollowerQuestions((prev) => [item, ...prev]);
      setSyncFollowerQuestionInput('');
      setSyncQuestionInput('');
      setFullscreenQuestionDialogOpen(false);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.submitQuestion'));
    }
  }, [pdfId, syncFollowerQuestionInput, syncQuestionInput]);

  const handleRaiseHand = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    try {
      const userCode = await resolveConfiguredUserCode();
      const item = await submitSyncFollowerQuestion(pdfId, syncClientIdRef.current, '🖐', userCode || undefined);
      setSyncFollowerQuestions((prev) => [item, ...prev]);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.raiseHand'));
    }
  }, [pdfId]);

  const handleToggleDisplayedQuestion = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    try {
      const result = await toggleSyncDisplayedQuestion(pdfId, syncClientIdRef.current);
      setSyncDisplayedQuestionId(result.displayed_question_id);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.toggleQuestion'));
    }
  }, [pdfId]);

  const handleDeleteFollowerQuestion = useCallback(async (questionId: string) => {
    if (!pdfId || !syncClientIdRef.current) return;
    try {
      await deleteSyncFollowerQuestion(pdfId, syncClientIdRef.current, questionId);
      setSyncFollowerQuestions((prev) => prev.filter((q) => q.id !== questionId));
      setSyncDisplayedQuestionId((prev) => (prev === questionId ? null : prev));
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.deleteQuestion'));
    }
  }, [pdfId]);

  const handleClearFollowerQuestions = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    if (!window.confirm(t('play.sync.clearAllQuestionsConfirm'))) return;
    try {
      await clearSyncFollowerQuestions(pdfId, syncClientIdRef.current);
      setSyncFollowerQuestions([]);
      setSyncDisplayedQuestionId(null);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.clearQuestions'));
    }
  }, [pdfId]);

  const handleAiAnswerFollowerQuestions = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current || syncAiAnswerBusy) return;
    setSyncAiAnswerBusy(true);
    try {
      const answer = await answerSyncFollowerQuestionsWithAi(pdfId, syncClientIdRef.current);
      setSyncAiAnswer(answer);
      setSyncDisplayedQuestionId(null);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.aiAnswerFollower'));
    } finally {
      setSyncAiAnswerBusy(false);
    }
  }, [pdfId, syncAiAnswerBusy]);

  const handleHideAiAnswer = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    try {
      await clearSyncAiAnswer(pdfId, syncClientIdRef.current);
      setSyncAiAnswer(null);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.hideAiAnswer'));
    }
  }, [pdfId]);

  const handleSummarizeFollowerQuestions = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current || questionSummaryBusy) return;
    setQuestionSummaryBusy(true);
    try {
      const res = await summarizeSyncFollowerQuestions(pdfId, syncClientIdRef.current);
      setQuestionSummary(res.summary);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : t('play.error.aiSummarizeQuestions'));
    } finally {
      setQuestionSummaryBusy(false);
    }
  }, [pdfId, questionSummaryBusy]);

  // ─── handleRetry (stays in PlayPage) ───────────────────────────────────────
  // 直接讀寫 audioRef.current（src/load/play）、currentAudioTokenRef（防競態 token）、
  // 並呼叫 clearAudioRetryTimer / scheduleAudioReload（同在 PlayPage 的 retry 排程機制）。
  // 這些 ref 與排程函式都因相同理由（直接操作 <audio> DOM）留在 PlayPage，
  // 無法在不移走 audioRef 的前提下獨立抽出。
  const handleRetry = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentPage?.audio_url) return;
    const audioUrl = withShareToken(currentPage.audio_url) ?? currentPage.audio_url;
    const pageNumber = currentPage.page_number;
    const token = currentAudioTokenRef.current + 1;
    currentAudioTokenRef.current = token;
    clearAudioRetryTimer();
    setAudioError(null);
    const retryUrl = `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}manual_retry=${Date.now()}`;
    audio.src = retryUrl;
    audio.load();
    void audio.play().catch(() => scheduleAudioReload(token, audioUrl, pageNumber));
  }, [currentPage, clearAudioRetryTimer, scheduleAudioReload, withShareToken]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Ignore when focus is in an input/textarea
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault();
        if (chatState.imageEditSelectMode) return;
        // 全螢幕模式下，空白鍵切換播放/暫停；非全螢幕維持下一頁。
        const isFullscreen = Boolean(getAnyFullscreenElement()) || imageOnlyFullscreen;
        if (isFullscreen) {
          playPause();
        } else {
          goNext();
        }
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        goPrev();
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        goNext();
      } else if (ev.key.toLowerCase() === 'a') {
        const isFullscreen = Boolean(getAnyFullscreenElement()) || imageOnlyFullscreen;
        if (!isFullscreen && syncEnabled && syncRole === 'master') {
          ev.preventDefault();
          void handleAiAnswerFollowerQuestions();
        }
      } else if (ev.code === 'KeyP' || ev.key.toLowerCase() === 'p') {
        const isFullscreen = Boolean(getAnyFullscreenElement()) || imageOnlyFullscreen;
        if (isFullscreen && syncRole === 'master') {
          ev.preventDefault();
          setFullscreenPollControlOpen((open) => !open);
        }
      } else if (ev.key.toLowerCase() === 'w') {
        if (!canUseDrawingTools) return;
        ev.preventDefault();
        setDrawingMode((prev) => !prev);
        if (drawingMode) setDrawingTool('pen');
      } else if (ev.key.toLowerCase() === 'g') {
        ev.preventDefault();
        if (isPlaying) playPause();
        setGotoPageInput('');
        setGotoPageOpen(true);
        setTimeout(() => gotoPageInputRef.current?.focus(), 50);
      } else if (ev.key.toLowerCase() === 'b') {
        if (bookmarks.length > 0) {
          ev.preventDefault();
          const currentPageNumber = currentIdx + 1;
          // Shift+B 跳到上一個書籤，B 跳到下一個（皆環狀）。
          const target = ev.shiftKey
            ? prevPageInList(bookmarks, currentPageNumber)
            : nextPageInList(bookmarks, currentPageNumber);
          if (target !== null) setCurrentIdx(target - 1);
        }
      } else if (ev.key.toLowerCase() === 'n') {
        if (importantPages.length > 0) {
          ev.preventDefault();
          const currentPageNumber = currentIdx + 1;
          // Shift+N 跳到上一個重點頁，N 跳到下一個（皆環狀）。
          const target = ev.shiftKey
            ? prevPageInList(importantPages, currentPageNumber)
            : nextPageInList(importantPages, currentPageNumber);
          if (target !== null) setCurrentIdx(target - 1);
        }
      } else if (ev.key.toLowerCase() === 'i') {
        if (currentPage) {
          ev.preventDefault();
          toggleImportantPage(currentPage.page_number);
        }
      } else if (ev.key === 'Escape') {
        if (gotoPageOpen) {
          ev.preventDefault();
          setGotoPageOpen(false);
          return;
        }
        if (drawingMode) {
          ev.preventDefault();
          setDrawingMode(false);
          setDrawingTool('pen');
          return;
        }
        if (fullscreenPollControlOpen) {
          ev.preventDefault();
          setFullscreenPollControlOpen(false);
          return;
        }
        if (imageOnlyFullscreen) {
          ev.preventDefault();
          if (!isLockedFullscreen) setImageOnlyFullscreen(false);
          return;
        }
        const isFullscreen = Boolean(getAnyFullscreenElement());
        if (isFullscreen && !isLockedFullscreen) {
          ev.preventDefault();
          void exitAnyFullscreen().catch(() => undefined);
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [playPause, goPrev, goNext, navigate, imageOnlyFullscreen, isLockedFullscreen, syncEnabled, syncRole, canUseDrawingTools, handleAiAnswerFollowerQuestions, fullscreenPollControlOpen, drawingMode, gotoPageOpen, isPlaying, importantPages, bookmarks]);

  // ---- Fullscreen API integration ----
  // 編輯版面、動畫編輯版面，以及透過分享連結鎖定的全螢幕都不進入瀏覽器原生全螢幕：
  // 原生全螢幕的 ESC 退出行為無法被 JS 攔截，會導致使用者按 ESC 就整個跳出全螢幕
  // （編輯逐字稿/動畫效果時可能誤按、分享連結模式下則完全不允許離開全螢幕）。
  // 改用純 CSS 覆蓋層即可避免觸發瀏覽器原生 ESC 行為，由自訂鍵盤處理邏輯接管。
  useEffect(() => {
    const isAlreadyFullscreen = Boolean(getAnyFullscreenElement());
    const useNativeFullscreen = fullscreenLayout !== 'edit' && fullscreenLayout !== 'animation' && !isLockedFullscreen;
    if (imageOnlyFullscreen && useNativeFullscreen && fullscreenContainerRef.current) {
      if (!isAlreadyFullscreen) {
        requestAnyFullscreen(fullscreenContainerRef.current).catch((err) => {
          debugWarn('Failed to enter fullscreen:', err);
        });
      }
    } else if ((!imageOnlyFullscreen || !useNativeFullscreen) && isAlreadyFullscreen) {
      exitAnyFullscreen().catch((err) => {
        debugWarn('Failed to exit fullscreen:', err);
      });
    }
  }, [imageOnlyFullscreen, fullscreenLayout, isLockedFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = Boolean(getAnyFullscreenElement());
      if (!isFullscreen && imageOnlyFullscreen && fullscreenLayout !== 'edit' && fullscreenLayout !== 'animation' && !isLockedFullscreen) {
        setImageOnlyFullscreen(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, [imageOnlyFullscreen, fullscreenLayout, isLockedFullscreen]);

  const currentScript =
    currentPage != null ? scripts[currentPage.page_number] ?? '' : '';

  // 整頁字幕（依標點/換行切句），供「全螢幕字幕」版面一次顯示整頁，亦供動畫的逐字稿同步使用。
  const pageSentences = useMemo(
    () => splitScriptIntoSentences(currentScript),
    [currentScript],
  );

  // 若這份簡報的語音是用「Whisper 精準對齊」模式產生的，後端會留下一份依真實語音時間
  // 對齊出來的逐句時間軸；換頁時重新抓取，抓到之前先清空，避免短暫顯示前一頁的時間軸。
  const [realSentenceTimeline, setRealSentenceTimeline] = useState<SentenceTimelineItem[] | null>(null);
  useEffect(() => {
    setRealSentenceTimeline(null);
    if (!pdfId || currentPage == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const timeline = await fetchPageSubtitleTimeline(pdfId, currentPage.page_number);
        if (!cancelled) setRealSentenceTimeline(timeline);
      } catch {
        if (!cancelled) setRealSentenceTimeline(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, currentPage?.page_number]);

  // 各句估計的播放起訖時間；不隨 currentTime 變動，避免動畫 timeline 頻繁重建。
  const audioMetadataReadyForCurrentPage =
    currentPage != null
    && durationPageNumber === currentPage.page_number
    && Number.isFinite(duration)
    && duration > 0;
  const sentenceTimelineDuration = audioMetadataReadyForCurrentPage ? duration : 0;

  useWatchProgress({
    pdfId,
    pageNumber: currentPage?.page_number,
    audioRef,
    durationMs: audioMetadataReadyForCurrentPage ? Math.round(duration * 1000) : null,
  });

  // 讀取（非送出）每頁觀看進度聚合統計，供側邊欄縮圖徽章顯示；只有 owner 看得到，
  // 詳情載入完成後只抓一次（不 polling，使用者可重新整理頁面取得最新數字）。
  // 與上面 useWatchProgress（送出本機觀看數據）是相反方向的資料流，刻意分開不混在一起。
  useEffect(() => {
    if (!pdfId || !detail?.is_owner) {
      setWatchProgressStats([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const stats = await fetchWatchProgress(pdfId);
        if (!cancelled) setWatchProgressStats(stats);
      } catch (err) {
        // 次要的背景輔助統計資訊，載入失敗不應干擾正常播放，靜默處理。
        debugWarn('[watch-progress] failed to load stats', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, detail?.is_owner]);

  const loadPostClassReport = useCallback(async () => {
    if (!pdfId || !canViewPostClassReport) return;
    setPostClassReportLoading(true);
    setPostClassReportError(null);
    try {
      const summary = await fetchPdfReportSummary(pdfId);
      setPostClassReportSummary(summary);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('play.error.reportLoad');
      setPostClassReportError(message || t('play.error.reportLoad'));
    } finally {
      setPostClassReportLoading(false);
    }
  }, [pdfId, canViewPostClassReport]);

  const openPostClassReport = useCallback(() => {
    if (!canViewPostClassReport) return;
    setPostClassReportOpen(true);
    void loadPostClassReport();
  }, [canViewPostClassReport, loadPostClassReport]);

  useEffect(() => {
    if (!canViewPostClassReport) {
      setPostClassReportOpen(false);
      setPostClassReportSummary(null);
      setPostClassReportError(null);
    }
  }, [canViewPostClassReport]);

  const watchProgressByPage = useMemo(
    () => new Map(watchProgressStats.map((stat) => [stat.page_number, stat])),
    [watchProgressStats],
  );

  const sentenceTimeline = useMemo(() => {
    // 只在句數對得上時才採用真實時間軸：逐字稿如果在產生 Whisper 時間軸之後被編輯過，
    // 句數會跟目前的 pageSentences 不一致，這時改用估算值才不會讓索引對不齊。
    if (realSentenceTimeline && realSentenceTimeline.length === pageSentences.length) {
      return realSentenceTimeline;
    }
    return buildSentenceTimeline(pageSentences, sentenceTimelineDuration);
  }, [realSentenceTimeline, pageSentences, sentenceTimelineDuration]);

  // 目前正在播放（朗讀）的句子索引；-1 代表本頁無字幕。
  const activeSentenceIdx = useMemo(() => {
    if (pageSentences.length === 0) return -1;
    if (pageSentences.length === 1) return 0;
    if (sentenceTimeline.length === 0) return 0;
    const t = Number.isFinite(currentTime) ? Math.max(0, currentTime + 0.5) : 0;
    const hit = sentenceTimeline.findIndex((item) => t >= item.start && t < item.end);
    if (hit >= 0) return hit;
    const last = sentenceTimeline[sentenceTimeline.length - 1];
    if (last && t >= last.end) return sentenceTimeline.length - 1;
    return 0;
  }, [pageSentences, sentenceTimeline, currentTime]);

  const currentSentence = activeSentenceIdx >= 0 ? pageSentences[activeSentenceIdx] ?? '' : '';

  // 全螢幕字幕版面下，自動把目前播放的句子捲動到可視範圍中央。
  useEffect(() => {
    if (!imageOnlyFullscreen || fullscreenLayout !== 'split') return;
    activeSentenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [imageOnlyFullscreen, fullscreenLayout, activeSentenceIdx]);

  useEffect(() => {
    if (!shouldAutoFullscreen && !isLockedFullscreen) return;
    setImageOnlyFullscreen(true);
    if (isLockedFullscreen && (fullscreenLayout === 'edit' || fullscreenLayout === 'animation')) setFullscreenLayout('image');
  }, [shouldAutoFullscreen, isLockedFullscreen, fullscreenLayout]);

  // ─── Custom hooks ────────────────────────────────────────────────────────────
  // 宣告在此處（effects 之後、handleRegenerateAudio 之前）確保 deps array 無 TDZ 問題

  // ref 先宣告：避免 useRegeneration ↔ useImageStyle 循環依賴
  const deckImageStylePromptRef = useRef('簡潔商業風格，以深色系為主，文字清晰對比，版面留白充足');

  const reloadDetail = useCallback(async () => {
    if (!pdfId) return;
    let shareMode: ShareAccessMode | null = null;
    if (currentShareToken) {
      const share = await resolveShareToken(currentShareToken);
      if (share.pdf_id !== pdfId) {
        throw new ApiError(t('play.error.shareMismatch'), 'INVALID_SHARE_TARGET', 400);
      }
      shareMode = share.access;
    }
    const d = await fetchPdfDetail(pdfId, currentShareToken || undefined);
    const detailWithShare = shareMode ? { ...d, share_mode: shareMode } : d;
    setDetail(detailWithShare);
    setVideoUrl(detailWithShare.video_url ?? null);
  }, [pdfId, currentShareToken]);

  const {
    versionHistoryOpen,
    setVersionHistoryOpen,
    versionHistoryType,
    versionHistoryPage,
    versionHistoryEntries,
    versionHistoryLoading,
    versionPreviewHash,
    versionPreviewScript,
    versionRestoring,
    versionError,
    openVersionHistory,
    handleVersionPreview,
    handleVersionRestore,
  } = useVersionHistory({ pdfId, reloadDetail });

  const videoState = useVideoGeneration({ pdfId, isReadOnlyProcessing, detail, setDetail });
  const { setVideoUrl } = videoState;

  const metaState = usePdfMetadata({ pdfId, isReadOnlyProcessing, detail, setDetail });
  const {
    setTitleInput,
    setTagsInput,
    setDescriptionInput,
    setTtsVoice,
    setTtsSpeed,
    setScriptMaxCharsPerPage,
    setHostMode,
    setPlayQrCodeUrl,
  } = metaState;

  const regenState = useRegeneration({
    pdfId,
    currentIdx,
    isReadOnlyProcessing,
    deckImageStylePromptRef,
    reloadDetail,
    setCurrentIdx,
    hostMode: metaState.hostMode,
    scriptMaxCharsPerPage: metaState.scriptMaxCharsPerPage,
    setDetail,
  });
  const { setRegenAllMsg } = regenState;

  const slideState = useSlideManagement({
    pdfId,
    currentPage,
    currentIdx,
    totalPages,
    isReadOnlyProcessing,
    reloadDetail,
    setCurrentIdx,
    setRegenSelectedPages: regenState.setRegenSelectedPages,
  });
  const { slideBusy, setSlideBusy, setSlideError, handleReplaceImageFile } = slideState;

  const imageStyleState = useImageStyle({
    pdfId,
    isReadOnlyProcessing,
    setDetail,
    setRegenAllMsg,
  });
  deckImageStylePromptRef.current = imageStyleState.deckImageStylePrompt;

  const chatState = useChatAndImageEdit({
    pdfId,
    currentPage,
    isReadOnlyProcessing,
    deckImageStylePrompt: imageStyleState.deckImageStylePrompt,
    setSlideBusy,
    setSlideError,
    reloadDetail,
    imageEditRegionOverlayRef,
  });

  const pageAskState = usePageAsk({
    pdfId,
    currentPageNumber: currentPage?.page_number ?? null,
    shareToken: currentShareToken,
  });

  const scriptEditorState = useScriptEditor({
    pdfId,
    currentPage,
    currentScript: currentPage ? (scripts[currentPage.page_number] ?? '') : '',
    currentIdx,
    deckPages,
    scripts,
    isReadOnlyProcessing,
    chatInput: chatState.chatInput,
    chatHistory: chatState.chatHistory,
    setChatHistory: chatState.setChatHistory,
    setChatInput: chatState.setChatInput,
  });

  const promptState = usePromptAndSource({
    pdfId,
    currentPage,
    isReadOnlyProcessing,
    setDetail,
  });

  // ─── Slide animation (GSAP V1) ──────────────────────────────────────────────
  const animationState = usePageAnimation({
    pdfId,
    currentPage,
    shareToken: currentShareToken,
    editTab: scriptEditorState.editTab,
    setDetail,
  });
  // 動畫 Tab 開啟時用編輯中的 draft 即時預覽，其餘時間用已儲存的 spec
  const rawAnimationSpec =
    scriptEditorState.editTab === 'animation' && animationState.animationDraft
      ? animationState.animationDraft
      : animationState.animationSavedSpec;
  // 將綁定逐字稿句子的效果，依目前句子時間表換算為實際的 start 秒數；
  // 若沒有任何效果使用 startTrigger，則回傳原物件參照，避免 GSAP timeline 不必要的重建。
  // 換頁後 audio duration 會短暫重置為 0；若此時先用空 sentenceTimeline 解析，
  // startTrigger 會退回效果 JSON 的字面 start（AI 預設多為 0），造成逐字稿動畫在 t=0 誤播。
  const animationSpecReadyForCurrentPage = useMemo(
    () => shouldResolvePageAnimationSpec({
      hasTranscriptStartTrigger: hasTranscriptStartTrigger(rawAnimationSpec),
      imageReadyForCurrentPage,
      audioMetadataReadyForCurrentPage,
      sentenceTimelineLength: sentenceTimeline.length,
    }),
    [audioMetadataReadyForCurrentPage, imageReadyForCurrentPage, rawAnimationSpec, sentenceTimeline.length],
  );
  const currentAnimationSpec = useMemo(
    () => (animationSpecReadyForCurrentPage ? resolveAnimationSpec(rawAnimationSpec, sentenceTimeline) : null),
    [animationSpecReadyForCurrentPage, rawAnimationSpec, sentenceTimeline],
  );
  useEffect(() => {
    previousPlaybackTimeRef.current = currentTime;
    consumedPausePlaybackEffectIdsRef.current = new Set();
    pausedForRealtimePollEffectRef.current = false;
    setPositioningEffectId(null);
  }, [currentPage?.page_number]);
  useEffect(() => {
    if (currentTime < previousPlaybackTimeRef.current) {
      // 使用者倒退（拖曳進度條、跳到指定時間）：把落在新時間點之後的暫停提示
      // 重新標記為未消費，避免重播到該處時被誤判為「已經按過播放鍵」而跳過暫停。
      for (const id of effectIdsToReleaseOnSeekBack(currentAnimationSpec, currentTime, sentenceTimeline)) {
        consumedPausePlaybackEffectIdsRef.current.delete(id);
      }
    }
    if (!isPlaying) {
      previousPlaybackTimeRef.current = currentTime;
      return;
    }
    const dueEffect = getDuePausePlaybackEffect(
      currentAnimationSpec,
      previousPlaybackTimeRef.current,
      currentTime,
      consumedPausePlaybackEffectIdsRef.current,
      sentenceTimeline,
    );
    previousPlaybackTimeRef.current = currentTime;
    if (!dueEffect) return;
    consumedPausePlaybackEffectIdsRef.current.add(dueEffect.id);
    audioRef.current?.pause();
    if (dueEffect.type === 'realtime-poll' && (!syncEnabled || syncRole === 'master')) {
      // 進入即時問答模式只由 master（或未開同步的單機預覽）執行；follower 完全依賴
      // master 廣播的 realtime_poll_started/active_quiz_id，避免 follower 端的
      // pollStarted 卡在 true 卻永遠等不到清除（因為 follower 看不到「結束投票」按鈕）。
      pausedForRealtimePollEffectRef.current = true;
      pollState.setPollStarted(true);
      pollState.setPollError(null);
      setSyncDisplayedPollId(dueEffect.pollId ?? null);
      setFullscreenPollControlOpen(true);
    }
  }, [
    currentAnimationSpec,
    currentPage?.page_number,
    currentTime,
    isPlaying,
    sentenceTimeline,
    syncEnabled,
    syncRole,
    pollState.setPollStarted,
    pollState.setPollError,
  ]);
  // 動畫總長：若超過語音長度，handleEnded 會延後切頁直到動畫播完。
  const animationDurationSeconds = useMemo(
    () => animationTimelineDurationSeconds(currentAnimationSpec),
    [currentAnimationSpec],
  );
  useEffect(() => {
    animationDurationSecondsRef.current = animationDurationSeconds;
  }, [animationDurationSeconds]);
  const { handleSaveAnimation } = animationState;
  // 從頭預覽：先儲存（確保重整後一致），再把音訊歸零播放；timeline 由 currentTime 漂移校正自動跳回 0
  const handlePreviewAnimation = useCallback(() => {
    void (async () => {
      const ok = await handleSaveAnimation();
      if (!ok) return;
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      setCurrentTime(0);
      setFinished(false);
      if (audio.paused) {
        void audio.play().catch(() => setIsPlaying(false));
      }
    })();
  }, [handleSaveAnimation]);

  // detail ロード後、image_style_prompt を imageStyleState に反映
  // （load effect は setDeckImageStylePrompt を直接呼べないため、detail 変化を監視）
  useEffect(() => {
    if (detail?.image_style_prompt?.trim()) {
      imageStyleState.setDeckImageStylePrompt(detail.image_style_prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.image_style_prompt]);

  // ─── Audio regeneration (stays in PlayPage: directly manipulates audioRef) ─
  const handleRegenerateAudio = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const nextScript = scriptEditorState.editingScript.trim();
    if (!nextScript) {
      scriptEditorState.setEditorError(t('play.error.scriptEmpty'));
      return;
    }
    scriptEditorState.setEditorBusy(true);
    scriptEditorState.setEditorError(null);
    setAudioError(null);
    try {
      const res = await regeneratePageAudio(pdfId, currentPage.page_number, nextScript);
      debugLog('[tts][regenerate-audio] api success', {
        pdfId,
        pageNumber: currentPage.page_number,
        audioUrl: res.audio_url,
        audioBytes: res.audio_bytes,
        audioMime: res.audio_mime,
        updatedAt: res.updated_at,
      });

      try {
        const verifyResp = await fetch(`${res.audio_url}?v=${encodeURIComponent(res.updated_at)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const contentType = verifyResp.headers.get('content-type');
        const contentLengthHeader = verifyResp.headers.get('content-length');
        const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
        const verifyBlob = verifyResp.ok ? await verifyResp.blob() : null;
        const blobSize = verifyBlob?.size ?? 0;
        debugLog('[tts][regenerate-audio] verify audio response', {
          status: verifyResp.status,
          ok: verifyResp.ok,
          contentType,
          contentLength,
          blobSize,
        });

        if (!verifyResp.ok) {
          throw new Error(`Audio URL not reachable (HTTP ${verifyResp.status})`);
        }
        if ((Number.isFinite(contentLength) && contentLength <= 0) || blobSize <= 0) {
          throw new Error('Audio file is empty (0 bytes)');
        }
      } catch (verifyErr) {
        debugWarn('[tts][regenerate-audio] verification failed', {
          pdfId,
          pageNumber: currentPage.page_number,
          error: verifyErr,
        });
        throw verifyErr;
      }

      setScripts((prev) => ({ ...prev, [currentPage.page_number]: nextScript }));
      // 同步更新 detail 內目前頁的 audio_url，避免 UI 仍綁舊 URL 看不到新檔。
      setDetail((prev) => {
        if (!prev) return prev;
        const pages = prev.pages.map((p) =>
          p.page_number === currentPage.page_number
            ? { ...p, audio_url: res.audio_url, status: 'audio_ready' as const }
            : p,
        );
        return { ...prev, pages, updated_at: res.updated_at };
      });

      const audio = audioRef.current;
      const latestAudioUrl = res.audio_url || currentPage.audio_url;
      if (audio && latestAudioUrl) {
        const nextUrl = `${latestAudioUrl}${latestAudioUrl.includes('?') ? '&' : '?'}t=${Date.now()}&u=${encodeURIComponent(res.updated_at)}`;
        audio.pause();
        audio.src = nextUrl;
        audio.load();
        setCurrentTime(0);
        setDuration(0);
        setDurationPageNumber(null);
        setFinished(false);
        void audio.play().catch(() => setIsPlaying(false));
      }
    } catch (err) {
      debugWarn('[tts][regenerate-audio] failed', {
        pdfId,
        pageNumber: currentPage?.page_number,
        error: err,
      });
      scriptEditorState.setEditorError(err instanceof ApiError ? err.message : t('play.error.regenAudio'));
    } finally {
      scriptEditorState.setEditorBusy(false);
    }
  }, [pdfId, currentPage, scriptEditorState.editingScript, isReadOnlyProcessing]);

  useEffect(() => {
    const itemAsString = (item: DataTransferItem): Promise<string> =>
      new Promise((resolve) => item.getAsString((s) => resolve(s || '')));

    const extractImageFileFromClipboard = async (
      e: ClipboardEvent,
    ): Promise<File | null> => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const directFile = items
        .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
        .find((f): f is File => !!f && /^image\//i.test(f.type || ''));
      if (directFile) return directFile;

      const htmlItem = items.find((it) => it.kind === 'string' && /html/i.test(it.type));
      if (!htmlItem) return null;
      const html = await itemAsString(htmlItem);
      if (!html) return null;

      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      const src = m?.[1];
      if (!src) return null;

      try {
        if (src.startsWith('data:image/')) {
          const [meta, b64] = src.split(',', 2);
          if (!meta || !b64) return null;
          const mime = /data:([^;]+)/i.exec(meta)?.[1] || 'image/png';
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new File([bytes], 'clipboard-image', { type: mime });
        }

        const resp = await fetch(src, { credentials: 'include' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        if (!/^image\//i.test(blob.type || '')) return null;
        return new File([blob], 'clipboard-image', { type: blob.type || 'image/png' });
      } catch {
        return null;
      }
    };

    const onPasteGlobal = (e: ClipboardEvent) => {
      debugLog('[paste][global] event fired', {
        hasClipboard: !!e.clipboardData,
        itemCount: e.clipboardData?.items?.length ?? 0,
      });
      if (!currentPage || isReadOnlyProcessing) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const items = Array.from(e.clipboardData?.items ?? []);
      debugLog('[paste][global] items', items.map((it) => ({ kind: it.kind, type: it.type })));
      void (async () => {
        const fileFromItems = await extractImageFileFromClipboard(e);
        if (!fileFromItems) {
          debugWarn('[paste][global] no image file found in clipboard items');
          return;
        }

        e.preventDefault();
        debugLog('[paste][global] image accepted', {
          name: fileFromItems.name,
          type: fileFromItems.type,
          size: fileFromItems.size,
          page: currentPage.page_number,
        });
        await handleReplaceImageFile(fileFromItems, currentPage.page_number);
      })();
    };

    window.addEventListener('paste', onPasteGlobal);
    return () => window.removeEventListener('paste', onPasteGlobal);
  }, [currentPage, handleReplaceImageFile, isReadOnlyProcessing]);

  // ---- Render loading / error states ----
  if (!pdfId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        {t('play.status.invalidPdfId')}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-text">
        <p className="text-rose-300">{loadError}</p>
        <Link to="/" className="text-sm text-muted underline">
          {t('play.status.backHome')}
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        {t('play.status.loading')}
      </div>
    );
  }

  if (totalPages === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-text">
        <p className="text-text">
          {isReadOnlyProcessing
            ? `${t('play.status.noPagesGeneratingPrefix')}${formatGeneratingStatusLabel(detail.status, detail.progress_step, t)}${t('play.status.noPagesGeneratingSuffix')}`
            : t('play.status.noAudioPages')}
        </p>
        {isReadOnlyProcessing ? <p className="text-xs text-muted">{t('play.status.recheckHint')}</p> : null}
        <Link to="/" className="text-sm text-muted underline">
          {t('play.status.backHome')}
        </Link>
      </div>
    );
  }

  const hasScriptChanges = scriptEditorState.editingScript !== (currentPage ? (scripts[currentPage.page_number] ?? '') : '');

  const activePoll =
    (pollState.pollStarted || (syncEnabled && syncRole === 'follower' && syncRealtimePollStarted)) && pollState.pagePolls.length > 0
      ? (
        (syncDisplayedPollId != null
          ? pollState.pagePolls.find((poll) => poll.id === syncDisplayedPollId)
          : null)
        ?? pollState.pagePolls.find((poll) => poll.is_active)
        ?? pollState.pagePolls[0]
        ?? null
      )
      : null;
  const activePollQuestion = activePoll?.question ?? '';


  // ─── Context value ─────────────────────────────────────────────────────────
    const _ctxValue = {
    // routing
    pdfId, currentShareToken, isLockedFullscreen,
    // deck data
    detail, setDetail, deckPages, currentPage, currentIdx, setCurrentIdx, visitedIdxSet, totalPages, loadError,
    watchProgressByPage,
    // playback
    isPlaying, setIsPlaying, currentTime, setCurrentTime, duration, setDuration,
    finished, setFinished, audioMuted, setAudioMuted, effectiveAudioMuted,
    audioVolume, setAudioVolume,
    playbackRate, setPlaybackRate, showSubtitle, setShowSubtitle, subtitleSize, setSubtitleSize, subtitlePosition, setSubtitlePosition,
    autoAdvance, setAutoAdvance,
    playbackSettingsOpen, setPlaybackSettingsOpen, playbackStatusMessage,
    followerAudioUnlocked, setFollowerAudioUnlocked,
    scripts, setScripts, displayedImageSrc,
    // 動畫長度超過語音長度時，語音已結束但動畫仍需繼續播放至完成
    isExtendingAnimation,
    slideAnimationPlaying: isPlaying || isExtendingAnimation,
    // playback actions
    playPause, goPrev, goNext, handleEnded, handleSeek, handleSeekToTime,
    handleClearPlaybackProgress, scheduleAudioReload, clearAudioRetryTimer, reloadDetail,
    // slide nav
    audioError, ...slideState,
    showAddPagesModal, setShowAddPagesModal, draggingPage, setDraggingPage,
    thumbLoadUntilIdx, setThumbLoadUntilIdx,
    // script / editor (from useScriptEditor)
    ...scriptEditorState,
    handleRetry,
    // slide animation (from usePageAnimation)
    ...animationState,
    currentAnimationSpec,
    handlePreviewAnimation,
    // prompt / source (from usePromptAndSource)
    ...promptState,
    // chat + image edit / inpaint (from useChatAndImageEdit)
    ...chatState,
    handleReplaceImageFile,
    // AI 導師問這一頁 (from usePageAsk)
    canAskPage,
    ...pageAskState,
    // TTS / audio (from usePdfMetadata + PlayPage)
    ...metaState,
    canViewPostClassReport,
    openPostClassReport,
    handleRegenerateAudio,
    // image style (from useImageStyle)
    ...imageStyleState,
    // regen (from useRegeneration)
    ...regenState,
    // poll (from usePagePolls)
    ...pollState,
    handleStopPoll: handleStopPollAndResumeIfPausedByEffect,
    activePoll, activePollQuestion,
    syncDisplayedPollId, setSyncDisplayedPollId,
    syncRealtimePollStarted, syncPollShowResults, setSyncPollShowResults,
    // video (from useVideoGeneration)
    ...videoState,
    // classroom
    classroomMode, setClassroomMode, classroomAwaitingNext, interactiveMode, setInteractiveMode,
    // sync
    syncEnabled, setSyncEnabled, syncRole, setSyncRole, syncError, setSyncError,
    syncFollowerQuestionInput, setSyncFollowerQuestionInput, syncFollowerQuestions,
    syncDisplayedQuestionId, syncAiAnswer, syncAiAnswerBusy,
    syncQuestionInput, setSyncQuestionInput, fullscreenQuestionDialogOpen, setFullscreenQuestionDialogOpen,
    fullscreenPollControlOpen, setFullscreenPollControlOpen, remoteCursor, syncDrawingState,
    isSyncFollower, canUseDrawingTools, handleSyncEnabledChange, handleSubmitFollowerQuestion,
    handleRaiseHand, handleToggleDisplayedQuestion, handleDeleteFollowerQuestion,
    handleClearFollowerQuestions, handleAiAnswerFollowerQuestions, handleHideAiAnswer,
    handleSummarizeFollowerQuestions, questionSummary, questionSummaryBusy,
    // fullscreen / layout
    imageOnlyFullscreen, setImageOnlyFullscreen, fullscreenLayout, setFullscreenLayout,
    positioningEffectId, setPositioningEffectId,
    slideImageScale, setSlideImageScale, slideImageMaxHeightVh, activeTab, setActiveTab,
    sidebarExpanded, setSidebarExpanded,
    // drawing
    drawingMode, setDrawingMode, drawingTool, setDrawingTool, drawingColor, setDrawingColor,
    drawingLineWidth, setDrawingLineWidth, remoteDrawingData, pushLocalDrawingChange, flushLocalDrawingPush,
    // computed
    isReadOnlyProcessing, readOnlyReason, shareIsReadOnly, imageBustKey,
    withImageBust, withShareToken, targetImageSrc, playbackImageSrc, fullscreenImageSrc,
    sourceItems, hasScriptChanges, syncQuestionBusy, openVersionHistory,
    pageSentences, currentSentence, activeSentenceIdx, sentenceTimeline,
    // refs
    audioRef, fullscreenContainerRef, fullscreenImageRef, drawingCanvasSplitRef,
    drawingCanvasMainRef, drawingCanvasFullscreenRef, sourcePdfInputRef,
    imageEditDragRef, imageEditRegionOverlayRef, activeSentenceRef, getActiveDrawingCanvas,
    // wake lock
    acquireWakeLock, releaseWakeLock,
    // bookmarks
    bookmarks, toggleBookmark,
    // important pages
    importantPages, toggleImportantPage,
    // poll badge
    newPollBadge, clearPollBadge,
    // goto page dialog
    gotoPageOpen, setGotoPageOpen, gotoPageInput, setGotoPageInput, gotoPageInputRef,
  };




  return (
    <PlayPageCtx.Provider value={_ctxValue}>
    <div className="flex min-h-screen flex-col bg-bg text-text">
      {imageOnlyFullscreen ? <PlayPageFullscreen /> : null}

      {slideBusy ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/60">
          <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text shadow-xl">
            <span className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-cyan-400" />
            {t('play.status.imageGenerating')}
          </div>
        </div>
      ) : null}

      {versionHistoryOpen ? (
        <VersionHistoryDialog
          pdfId={pdfId}
          versionHistoryType={versionHistoryType}
          versionHistoryPage={versionHistoryPage}
          versionHistoryEntries={versionHistoryEntries}
          versionHistoryLoading={versionHistoryLoading}
          versionPreviewHash={versionPreviewHash}
          versionPreviewScript={versionPreviewScript}
          currentScript={versionHistoryType === 'script' ? currentScript : null}
          versionRestoring={versionRestoring}
          versionError={versionError}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => setVersionHistoryOpen(false)}
          onPreview={handleVersionPreview}
          onRestore={handleVersionRestore}
        />
      ) : null}

      {postClassReportOpen && canViewPostClassReport ? (
        <PostClassReportPanel
          pdfId={pdfId ?? ''}
          pdfTitle={detail?.title ?? detail?.original_filename}
          summary={postClassReportSummary}
          loading={postClassReportLoading}
          error={postClassReportError}
          onClose={() => setPostClassReportOpen(false)}
          onReload={() => void loadPostClassReport()}
        />
      ) : null}

      {chatState.imagePreviewOpen && chatState.imagePreviewUrl ? (
        <ImagePreviewDialog
          imagePreviewUrl={chatState.imagePreviewUrl}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => chatState.setImagePreviewOpen(false)}
          onApply={() => void chatState.handleApplyPreviewImage()}
        />
      ) : null}

      {/* Hidden (but functional) audio element */}
      <audio
        ref={audioRef}
        preload="auto"
        muted={effectiveAudioMuted}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          setDurationPageNumber(currentPage?.page_number ?? null);
        }}
        onCanPlay={() => {
          if (resumePositionRef.current != null && audioRef.current) {
            const maxSeek = Number.isFinite(audioRef.current.duration)
              ? Math.max(0, audioRef.current.duration - 0.01)
              : resumePositionRef.current;
            audioRef.current.currentTime = Math.min(resumePositionRef.current, maxSeek);
            setCurrentTime(audioRef.current.currentTime || 0);
            resumePositionRef.current = null;
          }
          clearAudioRetryTimer();
          setAudioError(null);
          if (isPlaying) {
            void audioRef.current?.play().catch(() => {
              if (currentPage?.audio_url) {
                scheduleAudioReload(
                  currentAudioTokenRef.current,
                  withShareToken(currentPage.audio_url) ?? currentPage.audio_url,
                  currentPage.page_number,
                );
              }
            });
          }
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onError={() => {
          debugWarn('[tts][audio-element] load failed', {
            pageNumber: currentPage?.page_number,
            src: audioRef.current?.src,
          });
          if (currentPage?.audio_url) {
            scheduleAudioReload(
              currentAudioTokenRef.current,
              withShareToken(currentPage.audio_url) ?? currentPage.audio_url,
              currentPage.page_number,
            );
          }
        }}
      />

      {/* Header */}
      <PlayPageHeader />
      {budgetWarning?.exceeded ? (
        <div className="mx-auto w-full max-w-5xl px-4 pt-2">
          <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
            {t('budget.exceeded')
              .replace('${cost}', String(roundToTwoDecimals(budgetWarning.costUsd)))
              .replace('${limit}', String(budgetWarning.limitUsd))}
          </div>
        </div>
      ) : null}

      {/* 跳頁對話框 */}
      {gotoPageOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setGotoPageOpen(false)}
        >
          <div
            className="w-72 rounded-xl border border-border bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-sm font-semibold text-text">{t('play.gotoPageDialog')}</p>
            <input
              ref={gotoPageInputRef}
              type="number"
              min={1}
              max={deckPages.length}
              value={gotoPageInput}
              onChange={(e) => setGotoPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseGotoPage(gotoPageInput, deckPages.length);
                  if (n !== null) {
                    setCurrentIdx(n - 1);
                    setGotoPageOpen(false);
                  }
                } else if (e.key === 'Escape') {
                  setGotoPageOpen(false);
                }
              }}
              placeholder={t('play.gotoPagePlaceholder')}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-muted">1 – {deckPages.length}</p>
            <button
              type="button"
              onClick={() => {
                const n = parseGotoPage(gotoPageInput, deckPages.length);
                if (n !== null) {
                  setCurrentIdx(n - 1);
                  setGotoPageOpen(false);
                }
              }}
              disabled={parseGotoPage(gotoPageInput, deckPages.length) === null}
              className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {t('play.gotoPageConfirm')}
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 md:flex-row">
        {/* Mobile-only tab 切換列 */}
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-border bg-surface md:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('play')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'play'
                ? 'border-b-2 border-primary bg-primary/10 text-primary'
                : 'border-b-2 border-transparent text-muted hover:text-text'
            }`}
            aria-pressed={activeTab === 'play'}
          >
            {t('play.mobileTab.play')}
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('qa'); clearPollBadge(); }}
            className={`relative flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'qa'
                ? 'border-b-2 border-primary bg-primary/10 text-primary'
                : 'border-b-2 border-transparent text-muted hover:text-text'
            }`}
            aria-pressed={activeTab === 'qa'}
          >
            <span className="inline-flex items-center gap-1.5">
              {t('play.mobileTab.qa')}
              {syncFollowerQuestions.length > 0 && (
                <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-normal text-muted">
                  {syncFollowerQuestions.length}
                </span>
              )}
            </span>
            {newPollBadge && (
              <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-rose-500" aria-label={t('play.mobileTab.newPollAria')} />
            )}
          </button>
        </div>

        {/* Left: player + script（手機：僅於 play tab 顯示；桌面：永遠顯示） */}
        <PlayPageSlidePanel />

        {/* Right: thumbnails + LLM chat panel（手機：僅於 qa tab 顯示；桌面：永遠顯示） */}
        <PlayPageSidebar />
      </main>

      <PlayPageDialogs />
    </div>
    </PlayPageCtx.Provider>
  );
}
