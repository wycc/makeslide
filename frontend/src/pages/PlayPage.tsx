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
  fetchPdfDetail,
  resolveShareToken,
  fetchPlaybackSyncState,
  joinSharedPlaybackSync,
  joinPlaybackSync,
  leavePlaybackSync,
  regeneratePageAudio,
  submitSyncFollowerQuestion,
  toggleSyncDisplayedQuestion,
  updatePlaybackSyncState,
  type ShareAccessMode,
} from '../lib/api';
import { type DrawingCanvasHandle, type DrawingData, type DrawingStroke } from '../components/DrawingCanvas';
import { useVersionHistory } from './play/useVersionHistory';
import { useRegeneration } from './play/useRegeneration';
import { useVideoGeneration } from './play/useVideoGeneration';
import { usePdfMetadata } from './play/usePdfMetadata';
import { useSlideManagement } from './play/useSlideManagement';
import { useImageStyle } from './play/useImageStyle';
import { useScriptEditor } from './play/useScriptEditor';
import { usePromptAndSource } from './play/usePromptAndSource';
import { useChatAndImageEdit } from './play/useChatAndImageEdit';
import { usePagePolls } from './play/usePagePolls';
import { resolveConfiguredUserCode } from './play/utils';
import { VersionHistoryDialog } from './play/VersionHistoryDialog';
import { ImagePreviewDialog } from './play/ImagePreviewDialog';
import { PlayPageCtx } from './play/PlayPageContext';
import { PlayPageDialogs } from './play/PlayPageDialogs';
import { PlayPageFullscreen } from './play/PlayPageFullscreen';
import { PlayPageHeader } from './play/PlayPageHeader';
import { PlayPageSlidePanel } from './play/PlayPageSlidePanel';
import { PlayPageSidebar } from './play/PlayPageSidebar';
import type {
  PdfDetail,
  PdfDetailPage,
  SyncAiAnswer,
  SyncFollowerQuestion,
  PdfSourceItem,
} from '../types';
import {
  getStoredPlaybackSpeed,
  getStoredShowSubtitle,
  getStoredInteractiveMode,
} from '../i18n';


const POLL_INTERVAL_MS = 3000;
const AUDIO_RETRY_DELAY_MS = 800;
const PREFETCH_START_DELAY_MS = 1200;
const SYNC_POLL_INTERVAL_MS = 1200;
const SYNC_POLL_INTERVAL_FULLSCREEN_MS = 250;
const SYNC_CURSOR_PUSH_INTERVAL_MS = 60;
const SYNC_CURSOR_PUSH_INTERVAL_FULLSCREEN_MS = 24;
const SENTENCE_MATCH_RE = /[^。！？!?；;\n]+[。！？!?；;]?|\n+/g;
const TONE_MARKER_RE = /\[\[\s*[^\]]+\s*\]\]/g;

interface SentenceTimelineItem {
  text: string;
  start: number;
  end: number;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}



function splitScriptIntoSentences(script: string): string[] {
  const withoutToneMarkers = script.replace(TONE_MARKER_RE, ' ');
  const normalized = withoutToneMarkers.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const parts = normalized.match(SENTENCE_MATCH_RE) ?? [];
  return parts
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function buildSentenceTimeline(sentences: string[], duration: number): SentenceTimelineItem[] {
  if (!Number.isFinite(duration) || duration <= 0 || sentences.length === 0) return [];
  // 估時模型：先估每句「朗讀秒數」與「句後停頓秒數」，再按整頁 duration 等比縮放。
  const CJK_CHAR_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  const STRONG_END_RE = /[。！？.!?]$/;
  const MEDIUM_END_RE = /[；;]$/;
  const LIGHT_END_RE = /[，,、:]$/;

  const estimateSpeakSeconds = (text: string): number => {
    const compact = text.replace(/\s+/g, '');
    if (!compact) return 0.08;
    let sec = 0;
    for (const ch of compact) {
      if (CJK_CHAR_RE.test(ch)) sec += 0.15;
      else if (/\d/.test(ch)) sec += 0.14;
      else if (/[A-Za-z]/.test(ch)) sec += 0.09;
      else sec += 0.06;
    }
    return Math.max(0.12, sec);
  };

  const estimatePauseSeconds = (text: string, isLast: boolean): number => {
    if (isLast) return 0;
    const compact = text.replace(/\s+/g, '');
    if (STRONG_END_RE.test(compact)) return 0.32;
    if (MEDIUM_END_RE.test(compact)) return 0.22;
    if (LIGHT_END_RE.test(compact)) return 0.16;
    return 0.12;
  };

  const rough = sentences.map((text, idx) => {
    const speak = estimateSpeakSeconds(text);
    const pause = estimatePauseSeconds(text, idx === sentences.length - 1);
    return { text, speak, pause, total: speak + pause };
  });

  const roughTotal = rough.reduce((acc, item) => acc + item.total, 0);
  if (!(roughTotal > 0)) return [];
  const scale = duration / roughTotal;

  let cursor = 0;
  return rough.map((item, idx) => {
    const seg = item.total * scale;
    const start = cursor;
    const end = idx === rough.length - 1 ? duration : Math.min(duration, cursor + seg);
    cursor = end;
    return { text: item.text, start, end };
  });
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

  const [detail, setDetail] = useState<PdfDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [qaPanelExpanded, setQaPanelExpanded] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncRole, setSyncRole] = useState<'master' | 'follower'>('follower');
  const [audioMuted, setAudioMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(() => getStoredPlaybackSpeed());
  const [showSubtitle, setShowSubtitle] = useState<boolean>(() => getStoredShowSubtitle());
  const [playbackSettingsOpen, setPlaybackSettingsOpen] = useState(false);
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
  const [syncQuestionInput, setSyncQuestionInput] = useState('');
  const [syncQuestionBusy] = useState(false);
  const [fullscreenQuestionDialogOpen, setFullscreenQuestionDialogOpen] = useState(false);
  const [fullscreenPollControlOpen, setFullscreenPollControlOpen] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<{ x: number; y: number } | null>(null);
  const [syncDrawingState, setSyncDrawingState] = useState<{ pageNumber: number; strokes: DrawingStroke[] } | null>(null);
  const syncClientIdRef = useRef<string>('');
  const applyingRemoteSyncRef = useRef(false);
  const [imageOnlyFullscreen, setImageOnlyFullscreen] = useState(false);
  // 全螢幕版面：'image' = 純圖片（字幕單行疊在下方）；'split' = 左圖右整頁字幕；'edit' = 左圖右逐字稿編輯。
  const [fullscreenLayout, setFullscreenLayout] = useState<'image' | 'split' | 'edit'>('image');
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
      return fullscreenLayout === 'split' || fullscreenLayout === 'edit'
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
  const playbackRateRef = useRef<number>(playbackRate);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    window.localStorage.setItem('makeslide.playback_speed', String(playbackRate));
  }, [playbackRate]);
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

  const scheduleAudioReload = useCallback(
    (token: number, audioUrl: string, pageNumber?: number) => {
      const audio = audioRef.current;
      if (!audio || !audioUrl) return;
      if (token !== currentAudioTokenRef.current) return;

      clearAudioRetryTimer();
      audioRetryTimerRef.current = window.setTimeout(() => {
        if (token !== currentAudioTokenRef.current) return;
        const retryUrl = `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`;
        // eslint-disable-next-line no-console
        console.warn('[tts][audio-element] auto retry load', {
          pageNumber,
          retryUrl,
        });
        audio.src = retryUrl;
        audio.load();
        audio.playbackRate = playbackRateRef.current;
        setAudioError('語音載入失敗，正在自動重試…');
      }, AUDIO_RETRY_DELAY_MS);
    },
    [clearAudioRetryTimer],
  );

  const currentShareToken = searchParams.get('share')?.trim() || '';
  const shouldAutoFullscreen = searchParams.get('fullscreen') === '1';
  // 透過分享連結開啟的簡報需直接進入全螢幕並鎖定，使用者只能在「全螢幕／全螢幕字幕」間切換，不能離開全螢幕。
  const isLockedFullscreen = Boolean(currentShareToken);
  const playbackProgressStorageKey = pdfId ? `makeslide.playback.progress.${pdfId}` : '';

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
            throw new ApiError('分享連結與簡報不符', 'INVALID_SHARE_TARGET', 400);
          }
          shareMode = share.access;
        }
        const d = await fetchPdfDetail(pdfId, currentShareToken || undefined);
        if (cancelled) return;
        const detailWithShare = shareMode ? { ...d, share_mode: shareMode } : d;
        setDetail(detailWithShare);
        setVideoUrl(detailWithShare.video_url ?? null);
        setTitleInput(detailWithShare.title ?? detailWithShare.original_filename);
        // page prompts are managed per page in local state
        setTtsVoice(d.tts_voice?.trim() || 'alloy');
        setTtsSpeed(d.tts_speed ?? 1);
        setScriptMaxCharsPerPage(typeof d.script_max_chars_per_page === 'number' ? d.script_max_chars_per_page : null);
        setHostMode(d.host_mode === 'dual' ? 'dual' : 'solo');
        setLoadError(null);
        if (detailWithShare.status !== 'ready') {
          timer = window.setTimeout(load, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : '載入失敗';
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
  const shareIsReadOnly = detail?.share_mode === 'read_only';
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

  const readOnlyReason = isReadOnlyProcessing
    ? shareIsReadOnly
      ? '此分享連結為唯讀模式：可瀏覽與播放，但不可修改或生成功能。'
      : `產生過程中可瀏覽與播放；目前狀態為 ${detail.status}${detail.progress_step ? ` / ${detail.progress_step}` : ''}，所有更改與生成功能暫時停用。`
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

  const targetImageSrc = useMemo(() => {
    if (!currentPage?.image_url) return null;
    return withImageBust(currentPage.image_url) ?? currentPage.image_url;
  }, [currentPage?.image_url, withImageBust]);

  useEffect(() => {
    if (!targetImageSrc) {
      setDisplayedImageSrc(null);
      return;
    }
    const img = new Image();
    const settle = () => setDisplayedImageSrc(targetImageSrc);
    img.onload = settle;
    img.onerror = settle;
    img.src = targetImageSrc;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [targetImageSrc]);

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
    setAudioError(null);
    if (isPlaying) {
      void audio.play().catch(() => scheduleAudioReload(token, audioUrl, pageNumber));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.page_number, clearAudioRetryTimer, scheduleAudioReload, withShareToken]);

  useEffect(
    () => () => {
      clearAudioRetryTimer();
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
      if (current?.image_url) {
        const img = new Image();
        img.src = withImageBust(current.image_url) ?? current.image_url;
        prefetchedImageRef.current = img;
      } else {
        prefetchedImageRef.current = null;
      }
      // 下一頁：提前預載，提升自動切頁銜接
      if (next?.image_url) {
        const img = new Image();
        img.src = withImageBust(next.image_url) ?? next.image_url;
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
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [classroomAwaitingNext, classroomMode, currentIdx, syncEnabled, syncRole, totalPages]);

  const goPrev = useCallback(() => {
    if (syncEnabled && syncRole !== 'master') return;
    setPlayQrCodeUrl(null);
    setClassroomAwaitingNext(false);
    setFinished(false);
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, [syncEnabled, syncRole]);

  const goNext = useCallback(() => {
    if (syncEnabled && syncRole !== 'master') return;
    setPlayQrCodeUrl(null);
    setClassroomAwaitingNext(false);
    setFinished(false);
    setCurrentIdx((i) => Math.min(totalPages - 1, i + 1));
  }, [syncEnabled, syncRole, totalPages]);

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

  // ─── handleEnded (stays in PlayPage) ───────────────────────────────────────
  // 跨領域協調：同時觸及 pollState（usePage Polls）、playback state（isPlaying/currentIdx/finished）
  // 以及 classroomMode/interactiveMode 全域開關，三個領域在同一個回呼中依序決策，
  // 任何一個領域都無法獨自持有完整的 if/else 邏輯。
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
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
        // 當頁無投票且非上課模式：直接進入下一頁
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
      setCurrentIdx((i) => i + 1);
      setIsPlaying(true);
    } else {
      setClassroomAwaitingNext(false);
      setFinished(true);
    }
  }, [classroomMode, interactiveMode, pollState.pagePolls.length, currentIdx, totalPages]);

  const handleSeek = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      if (syncEnabled && syncRole !== 'master') return;
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(duration) || duration <= 0) return;
      const ratio = Number(ev.target.value) / 1000;
      audio.currentTime = ratio * duration;
    },
    [duration, syncEnabled, syncRole],
  );

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
    setSyncEnabled(false);
  }, [pdfId, currentShareToken]);

  useEffect(() => {
    if (!syncEnabled || !pdfId) return;
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
        const joined = currentShareToken
          ? await joinSharedPlaybackSync(pdfId, next, currentShareToken)
          : await joinPlaybackSync(pdfId, next, userCode || undefined);
        if (cancelled) return;
        setSyncRole(joined.role);
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
        setSyncError(err instanceof ApiError ? err.message : '同步模式連線失敗');
        const enabledKey = `makeslide.sync.enabled.${pdfId}`;
        window.localStorage.removeItem(enabledKey);
        setSyncEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncEnabled, pdfId, currentShareToken]);

  // 同步模式下手寫工具僅 master 可用；若目前角色變成 follower（例如 master 易主），強制關閉手寫模式。
  useEffect(() => {
    if (!canUseDrawingTools && drawingMode) {
      setDrawingMode(false);
      setDrawingTool('pen');
    }
  }, [canUseDrawingTools, drawingMode]);

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
    // eslint-disable-next-line no-console
    console.info('[sync][master->state] push', {
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
      setSyncError(err instanceof ApiError ? err.message : '同步狀態更新失敗');
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
    // eslint-disable-next-line no-console
    console.info('[sync][poll] start', {
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
          // eslint-disable-next-line no-console
          console.info('[sync][poll] state', {
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
          if (currentShareToken && !state.master_client_id) {
            window.localStorage.removeItem(`makeslide.sync.enabled.${pdfId}`);
            setSyncEnabled(false);
            setSyncRole('follower');
            syncClientIdRef.current = '';
            setSyncError(null);
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
          // eslint-disable-next-line no-console
          console.info('[sync][follower] apply-remote', {
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
          setSyncError(err instanceof ApiError ? err.message : '同步輪詢失敗');
        } finally {
          applyingRemoteSyncRef.current = false;
        }
      })();
    }, pollInterval);
    return () => {
      // eslint-disable-next-line no-console
      console.info('[sync][poll] stop', {
        pdfId,
        clientId: syncClientIdRef.current,
        localRole: syncRole,
      });
      window.clearInterval(timer);
    };
  }, [syncEnabled, pdfId, imageOnlyFullscreen, navigate, syncRole, currentIdx, currentShareToken]);

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
      setSyncError(err instanceof ApiError ? err.message : '送出問題失敗');
    }
  }, [pdfId, syncFollowerQuestionInput, syncQuestionInput]);

  const handleToggleDisplayedQuestion = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    try {
      const result = await toggleSyncDisplayedQuestion(pdfId, syncClientIdRef.current);
      setSyncDisplayedQuestionId(result.displayed_question_id);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : '切換顯示問題失敗');
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
      setSyncError(err instanceof ApiError ? err.message : 'AI 回答 follower 問題失敗');
    } finally {
      setSyncAiAnswerBusy(false);
    }
  }, [pdfId, syncAiAnswerBusy]);

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
      } else if (ev.key.toLowerCase() === 'a' && syncEnabled && syncRole === 'master') {
        ev.preventDefault();
        void handleAiAnswerFollowerQuestions();
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
      } else if (ev.key === 'Escape') {
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
  }, [playPause, goPrev, goNext, navigate, imageOnlyFullscreen, isLockedFullscreen, syncEnabled, syncRole, canUseDrawingTools, handleAiAnswerFollowerQuestions, fullscreenPollControlOpen, drawingMode]);

  // ---- Fullscreen API integration ----
  // 編輯版面、以及透過分享連結鎖定的全螢幕都不進入瀏覽器原生全螢幕：
  // 原生全螢幕的 ESC 退出行為無法被 JS 攔截，會導致使用者按 ESC 就整個跳出全螢幕
  // （編輯逐字稿時可能誤按、分享連結模式下則完全不允許離開全螢幕）。
  // 改用純 CSS 覆蓋層即可避免觸發瀏覽器原生 ESC 行為，由自訂鍵盤處理邏輯接管。
  useEffect(() => {
    const isAlreadyFullscreen = Boolean(getAnyFullscreenElement());
    const useNativeFullscreen = fullscreenLayout !== 'edit' && !isLockedFullscreen;
    if (imageOnlyFullscreen && useNativeFullscreen && fullscreenContainerRef.current) {
      if (!isAlreadyFullscreen) {
        requestAnyFullscreen(fullscreenContainerRef.current).catch((err) => {
          console.error('Failed to enter fullscreen:', err);
        });
      }
    } else if ((!imageOnlyFullscreen || !useNativeFullscreen) && isAlreadyFullscreen) {
      exitAnyFullscreen().catch((err) => {
        console.error('Failed to exit fullscreen:', err);
      });
    }
  }, [imageOnlyFullscreen, fullscreenLayout, isLockedFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = Boolean(getAnyFullscreenElement());
      if (!isFullscreen && imageOnlyFullscreen && fullscreenLayout !== 'edit' && !isLockedFullscreen) {
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

  // 整頁字幕（依標點/換行切句），供「全螢幕字幕」版面一次顯示整頁。
  const pageSentences = useMemo(
    () => splitScriptIntoSentences(currentScript),
    [currentScript],
  );

  // 目前正在播放（朗讀）的句子索引；-1 代表本頁無字幕。
  const activeSentenceIdx = useMemo(() => {
    if (pageSentences.length === 0) return -1;
    if (pageSentences.length === 1) return 0;
    const timeline = buildSentenceTimeline(pageSentences, duration);
    if (timeline.length === 0) return 0;
    const t = Number.isFinite(currentTime) ? Math.max(0, currentTime + 0.5) : 0;
    const hit = timeline.findIndex((item) => t >= item.start && t < item.end);
    if (hit >= 0) return hit;
    const last = timeline[timeline.length - 1];
    if (last && t >= last.end) return timeline.length - 1;
    return 0;
  }, [pageSentences, currentTime, duration]);

  const currentSentence = activeSentenceIdx >= 0 ? pageSentences[activeSentenceIdx] ?? '' : '';

  // 全螢幕字幕版面下，自動把目前播放的句子捲動到可視範圍中央。
  useEffect(() => {
    if (!imageOnlyFullscreen || fullscreenLayout !== 'split') return;
    activeSentenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [imageOnlyFullscreen, fullscreenLayout, activeSentenceIdx]);

  useEffect(() => {
    if (!shouldAutoFullscreen && !isLockedFullscreen) return;
    setImageOnlyFullscreen(true);
    if (isLockedFullscreen && fullscreenLayout === 'edit') setFullscreenLayout('image');
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
        throw new ApiError('分享連結與簡報不符', 'INVALID_SHARE_TARGET', 400);
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
      scriptEditorState.setEditorError('文稿不可為空');
      return;
    }
    scriptEditorState.setEditorBusy(true);
    scriptEditorState.setEditorError(null);
    setAudioError(null);
    try {
      const res = await regeneratePageAudio(pdfId, currentPage.page_number, nextScript);
      // eslint-disable-next-line no-console
      console.info('[tts][regenerate-audio] api success', {
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
        // eslint-disable-next-line no-console
        console.info('[tts][regenerate-audio] verify audio response', {
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
        // eslint-disable-next-line no-console
        console.error('[tts][regenerate-audio] verification failed', {
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
        setFinished(false);
        void audio.play().catch(() => setIsPlaying(false));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tts][regenerate-audio] failed', {
        pdfId,
        pageNumber: currentPage?.page_number,
        error: err,
      });
      scriptEditorState.setEditorError(err instanceof ApiError ? err.message : '重生語音失敗');
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
      // debug: verify global paste event reachability
      // eslint-disable-next-line no-console
      console.info('[paste][global] event fired', {
        hasClipboard: !!e.clipboardData,
        itemCount: e.clipboardData?.items?.length ?? 0,
      });
      if (!currentPage || isReadOnlyProcessing) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const items = Array.from(e.clipboardData?.items ?? []);
      // eslint-disable-next-line no-console
      console.info('[paste][global] items', items.map((it) => ({ kind: it.kind, type: it.type })));
      void (async () => {
        const fileFromItems = await extractImageFileFromClipboard(e);
        if (!fileFromItems) {
          // eslint-disable-next-line no-console
          console.warn('[paste][global] no image file found in clipboard items');
          return;
        }

        e.preventDefault();
        // eslint-disable-next-line no-console
        console.info('[paste][global] image accepted', {
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        無效的 PDF id
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-100">
        <p className="text-rose-300">{loadError}</p>
        <Link to="/" className="text-sm text-slate-400 underline">
          返回首頁
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        載入中…
      </div>
    );
  }

  if (totalPages === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-100">
        <p className="text-slate-300">
          {isReadOnlyProcessing
            ? `尚未產生可瀏覽的頁面（${detail.status}${detail.progress_step ? ` / ${detail.progress_step}` : ''}）`
            : '這份 PDF 沒有可播放的語音頁面'}
        </p>
        {isReadOnlyProcessing ? <p className="text-xs text-slate-500">系統將每 3 秒重新檢查一次狀態…</p> : null}
        <Link to="/" className="text-sm text-slate-400 underline">
          返回首頁
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
    detail, setDetail, deckPages, currentPage, currentIdx, setCurrentIdx, totalPages, loadError,
    // playback
    isPlaying, setIsPlaying, currentTime, setCurrentTime, duration, setDuration,
    finished, setFinished, audioMuted, setAudioMuted, effectiveAudioMuted,
    playbackRate, setPlaybackRate, showSubtitle, setShowSubtitle,
    playbackSettingsOpen, setPlaybackSettingsOpen, followerAudioUnlocked, setFollowerAudioUnlocked,
    scripts, setScripts, displayedImageSrc, setDisplayedImageSrc,
    // playback actions
    playPause, goPrev, goNext, handleEnded, handleSeek, scheduleAudioReload, clearAudioRetryTimer, reloadDetail,
    // slide nav
    audioError, ...slideState,
    showAddPagesModal, setShowAddPagesModal, draggingPage, setDraggingPage,
    thumbLoadUntilIdx, setThumbLoadUntilIdx,
    // script / editor (from useScriptEditor)
    ...scriptEditorState,
    handleRetry,
    // prompt / source (from usePromptAndSource)
    ...promptState,
    // chat + image edit / inpaint (from useChatAndImageEdit)
    ...chatState,
    handleReplaceImageFile,
    // TTS / audio (from usePdfMetadata + PlayPage)
    ...metaState,
    handleRegenerateAudio,
    // image style (from useImageStyle)
    ...imageStyleState,
    // regen (from useRegeneration)
    ...regenState,
    // poll (from usePagePolls)
    ...pollState,
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
    handleToggleDisplayedQuestion, handleAiAnswerFollowerQuestions,
    // fullscreen / layout
    imageOnlyFullscreen, setImageOnlyFullscreen, fullscreenLayout, setFullscreenLayout,
    slideImageScale, setSlideImageScale, slideImageMaxHeightVh, activeTab, setActiveTab,
    qaPanelExpanded, setQaPanelExpanded,
    // drawing
    drawingMode, setDrawingMode, drawingTool, setDrawingTool, drawingColor, setDrawingColor,
    drawingLineWidth, setDrawingLineWidth, remoteDrawingData, pushLocalDrawingChange, flushLocalDrawingPush,
    // computed
    isReadOnlyProcessing, readOnlyReason, shareIsReadOnly, imageBustKey,
    withImageBust, withShareToken, targetImageSrc,
    sourceItems, hasScriptChanges, syncQuestionBusy, openVersionHistory,
    pageSentences, currentSentence, activeSentenceIdx,
    // refs
    audioRef, fullscreenContainerRef, fullscreenImageRef, drawingCanvasSplitRef,
    drawingCanvasMainRef, drawingCanvasFullscreenRef, sourcePdfInputRef,
    imageEditDragRef, imageEditRegionOverlayRef, activeSentenceRef, getActiveDrawingCanvas,
    // wake lock
    acquireWakeLock, releaseWakeLock,
  };




  return (
    <PlayPageCtx.Provider value={_ctxValue}>
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {imageOnlyFullscreen ? <PlayPageFullscreen /> : null}

      {slideBusy ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60">
          <div className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200 shadow-xl">
            <span className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-cyan-400" />
            圖片產生中…
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
          versionRestoring={versionRestoring}
          versionError={versionError}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => setVersionHistoryOpen(false)}
          onPreview={handleVersionPreview}
          onRestore={handleVersionRestore}
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
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
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
          // eslint-disable-next-line no-console
          console.error('[tts][audio-element] load failed', {
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

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 md:flex-row">
        {/* Mobile-only tab 切換列 */}
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 md:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('play')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'play'
                ? 'border-b-2 border-cyan-400 bg-slate-800/60 text-cyan-200'
                : 'border-b-2 border-transparent text-slate-400 hover:text-slate-200'
            }`}
            aria-pressed={activeTab === 'play'}
          >
            播放
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qa')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'qa'
                ? 'border-b-2 border-cyan-400 bg-slate-800/60 text-cyan-200'
                : 'border-b-2 border-transparent text-slate-400 hover:text-slate-200'
            }`}
            aria-pressed={activeTab === 'qa'}
          >
            問答
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
