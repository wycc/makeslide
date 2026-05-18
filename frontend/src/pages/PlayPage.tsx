import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  chatWithPageContext,
  addSlide,
  cancelRegenerateJob,
  clearPageChatHistory,
  createPagePoll,
  deleteSlide,
  fetchPdfDetail,
  fetchPagePolls,
  fetchPagePrompt,
  fetchPageChatHistory,
  getImagePromptTemplates,
  fetchRegenerateStatus,
  generatePdfVideo,
  moveSlide,
  regenerateSlideImage,
  replaceSlideImage,
  regeneratePageAudio,
  rollbackRegenerate,
  startRegenerateJob,
  updatePdfCoverFromPage,
  updatePdfImageStyleSettings,
  updatePdfTtsSettings,
  updatePdfPrompt,
  updatePdfTitle,
  votePagePoll,
  rewritePageScript,
  type ImagePromptTemplate,
} from '../lib/api';
import {
  DEFAULT_TTS_VOICE_BY_PROVIDER,
  TTS_VOICES_BY_PROVIDER,
  type TtsProvider,
} from '../lib/ttsVoices';
import { formatDurationMs, formatTime } from './play/formatters';
import { PageTimingChips } from './play/PageTimingChips';
import { RegenerateProgress } from './play/RegenerateProgress';
import type {
  ChatMessage,
  PdfDetail,
  PdfDetailPage,
  PagePoll,
  RegenJobState,
} from '../types';

const POLL_INTERVAL_MS = 3000;
const AUDIO_RETRY_DELAY_MS = 800;
const SENTENCE_MATCH_RE = /[^。！？!?；;\n]+[。！？!?；;]?|\n+/g;
const TONE_MARKER_RE = /\[\[\s*[^\]]+\s*\]\]/g;

interface SentenceTimelineItem {
  text: string;
  start: number;
  end: number;
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

  const [detail, setDetail] = useState<PdfDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scripts, setScripts] = useState<Record<number, string>>({});
  const [audioError, setAudioError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [classroomMode, setClassroomMode] = useState(false);
  const [classroomAwaitingNext, setClassroomAwaitingNext] = useState(false);
  const [editingScript, setEditingScript] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<'script' | 'prompt' | 'system'>('script');
  const [promptInput, setPromptInput] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptMsg, setPromptMsg] = useState<string | null>(null);
  const [pagePrompts, setPagePrompts] = useState<Record<number, string>>({});
  const [slideBusy, setSlideBusy] = useState(false);
  const [slideError, setSlideError] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);
  const [ttsDialogOpen, setTtsDialogOpen] = useState(false);
  const [regenAllDialogOpen, setRegenAllDialogOpen] = useState(false);
  const [imageStyleDialogOpen, setImageStyleDialogOpen] = useState(false);
  const [deckImageStylePrompt, setDeckImageStylePrompt] = useState(
    'academic minimalist style, clean layout, professional presentation design, soft blue background, clear visual hierarchy, vector illustration, no clutter, high readability',
  );
  const [imageStyleTemplates, setImageStyleTemplates] = useState<ImagePromptTemplate[]>([]);
  const [selectedImageStyleTemplateKey, setSelectedImageStyleTemplateKey] = useState('');
  const [regenAllPrompt, setRegenAllPrompt] = useState('請讓整份簡報的圖像風格一致，色調、字體與版面語言維持統一。');
  const [regenScriptPrompt, setRegenScriptPrompt] = useState('請以原始重點為主，語句更口語、自然，並加強頁與頁之間的銜接。');
  const [regenAllBusy, setRegenAllBusy] = useState(false);
  const [regenAllMsg, setRegenAllMsg] = useState<string | null>(null);
  // 「重生」多選項目：圖檔 / 逐字稿 / 語音。後端 `/api/pdfs/:id/regenerate` 會依
  // image → script → audio 的順序執行，並將進度保存在記憶體供前端輪詢。
  const [regenOptions, setRegenOptions] = useState<{ image: boolean; script: boolean; audio: boolean }>({
    image: true,
    script: false,
    audio: false,
  });
  const [regenJob, setRegenJob] = useState<RegenJobState | null>(null);
  const [regenStopBusy, setRegenStopBusy] = useState(false);
  const [regenRollbackBusy, setRegenRollbackBusy] = useState(false);
  const [regenBannerDismissed, setRegenBannerDismissed] = useState(false);
  const [pagePolls, setPagePolls] = useState<PagePoll[]>([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptionsText, setPollOptionsText] = useState('同意\n不同意');
  const [pollBusy, setPollBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollVotes, setPollVotes] = useState<Record<number, number>>({});
  const [pollSettingsOpen, setPollSettingsOpen] = useState(false);
  const [pollStarted, setPollStarted] = useState(false);
  // 在按下「確認」啟動重生前記住目前頁碼，供 rollback 後跳回。
  const preRegenPageIdxRef = useRef<number | null>(null);
  const pollVoterIdRef = useRef<string>('');
  // 避免 completion 的自動跳頁多次觸發；每一個 job_id 只跳一次。
  const autoJumpedJobIdRef = useRef<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewPageNumber, setImagePreviewPageNumber] = useState<number | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [draggingPage, setDraggingPage] = useState<number | null>(null);
  // 手機模式下的 tab 切換（桌面模式忽略此 state，永遠並排顯示）
  const [activeTab, setActiveTab] = useState<'play' | 'qa'>('play');
  const [imageOnlyFullscreen, setImageOnlyFullscreen] = useState(false);
  const [slideImageScale, setSlideImageScale] = useState(1);
  const IMAGE_MSG_PREFIX = '[image] ';
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const ttsProvider: TtsProvider = detail?.tts_provider === 'gemini' ? 'gemini' : 'openai';
  const availableTtsVoices = TTS_VOICES_BY_PROVIDER[ttsProvider];

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioTokenRef = useRef(0);
  const audioRetryTimerRef = useRef<number | null>(null);
  // prefetch refs so GC doesn't drop them mid-load
  const prefetchedAudioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchedImageRef = useRef<HTMLImageElement | null>(null);

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
        setAudioError('語音載入失敗，正在自動重試…');
      }, AUDIO_RETRY_DELAY_MS);
    },
    [clearAudioRetryTimer],
  );

  // ---- Load detail (+ poll until ready) ----
  useEffect(() => {
    if (!pdfId) return;
    let cancelled = false;
    let timer: number | null = null;

    const load = async () => {
      try {
        const d = await fetchPdfDetail(pdfId);
        if (cancelled) return;
        setDetail(d);
        setVideoUrl(d.video_url ?? null);
        setTitleInput(d.title ?? d.original_filename);
        // page prompts are managed per page in local state
        setTtsVoice(d.tts_voice?.trim() || 'alloy');
        setTtsSpeed(d.tts_speed ?? 1);
        setLoadError(null);
        if (d.image_style_prompt && d.image_style_prompt.trim()) {
          setDeckImageStylePrompt(d.image_style_prompt);
        }
        if (d.status !== 'ready') {
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
  }, [pdfId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getImagePromptTemplates();
        if (cancelled) return;
        setImageStyleTemplates(res.templates);
        const key = res.default_template_key ?? res.templates[0]?.key ?? '';
        setSelectedImageStyleTemplateKey(key);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (availableTtsVoices.some((voice) => voice === ttsVoice)) return;
    setTtsVoice(DEFAULT_TTS_VOICE_BY_PROVIDER[ttsProvider]);
  }, [availableTtsVoices, ttsProvider, ttsVoice]);

  const applyImageStyleTemplate = useCallback(
    (key: string) => {
      setSelectedImageStyleTemplateKey(key);
      const hit = imageStyleTemplates.find((t) => t.key === key);
      if (hit) setDeckImageStylePrompt(hit.prompt_en);
    },
    [imageStyleTemplates],
  );

  const openImageStyleDialog = useCallback(async () => {
    if (!pdfId) {
      setImageStyleDialogOpen(true);
      return;
    }
    try {
      const d = await fetchPdfDetail(pdfId);
      setDetail(d);
      if (d.image_style_prompt && d.image_style_prompt.trim()) {
        setDeckImageStylePrompt(d.image_style_prompt);
      }
    } catch {
      // non-fatal: still allow opening dialog with current local value
    } finally {
      setImageStyleDialogOpen(true);
    }
  }, [pdfId]);

  const pages = detail?.pages ?? [];
  const deckPages: PdfDetailPage[] = useMemo(() => pages, [pages]);
  const currentPage: PdfDetailPage | null = deckPages[currentIdx] ?? null;
  const totalPages = deckPages.length;
  const isReadOnlyProcessing = detail != null && detail.status !== 'ready';
  const readOnlyReason = isReadOnlyProcessing
    ? `產生過程中可瀏覽與播放；目前狀態為 ${detail.status}${detail.progress_step ? ` / ${detail.progress_step}` : ''}，所有更改與生成功能暫時停用。`
    : null;
  const slideImageMaxHeightVh = Math.round(52 * slideImageScale);
  const imageBustKey = detail?.updated_at ?? '';
  const withImageBust = useCallback(
    (url: string | null | undefined) => {
      if (!url) return null;
      const q = `t=${encodeURIComponent(imageBustKey)}`;
      return url.includes('?') ? `${url}&${q}` : `${url}?${q}`;
    },
    [imageBustKey],
  );

  // ---- Fetch all scripts once pages are ready ----
  useEffect(() => {
    if (deckPages.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        deckPages.map(async (p) => {
          if (!p.script_url) return [p.page_number, ''] as const;
          try {
            const bust = `t=${Date.now()}`;
            const url = p.script_url.includes('?') ? `${p.script_url}&${bust}` : `${p.script_url}?${bust}`;
            const resp = await fetch(url, { cache: 'no-store' });
            if (!resp.ok) return [p.page_number, ''] as const;
            const t = await resp.text();
            return [p.page_number, t] as const;
          } catch {
            return [p.page_number, ''] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<number, string> = {};
      for (const [n, s] of entries) next[n] = s;
      setScripts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [deckPages]);

  // ---- Swap audio src when current page changes ----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentPage || !currentPage.audio_url) return;
    const audioUrl = currentPage.audio_url;
    const pageNumber = currentPage.page_number;
    const token = currentAudioTokenRef.current + 1;
    currentAudioTokenRef.current = token;
    clearAudioRetryTimer();
    const nextUrl = `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    audio.src = nextUrl;
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    setAudioError(null);
    if (isPlaying) {
      void audio.play().catch(() => scheduleAudioReload(token, audioUrl, pageNumber));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.page_number, clearAudioRetryTimer, scheduleAudioReload]);

  useEffect(
    () => () => {
      clearAudioRetryTimer();
    },
    [clearAudioRetryTimer],
  );

  // ---- Prefetch next page assets ----
  useEffect(() => {
    const next = deckPages[currentIdx + 1];
    if (!next) return;
    if (next.image_url) {
      const img = new Image();
      img.src = next.image_url;
      prefetchedImageRef.current = img;
    }
    if (next.audio_url) {
      const a = new Audio();
      a.preload = 'auto';
      a.src = next.audio_url;
      prefetchedAudioRef.current = a;
    }
  }, [currentIdx, deckPages]);

  // ---- Controls ----
  const playPause = useCallback(() => {
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
  }, [classroomAwaitingNext, classroomMode, currentIdx, totalPages]);

  const goPrev = useCallback(() => {
    setClassroomAwaitingNext(false);
    setFinished(false);
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setClassroomAwaitingNext(false);
    setFinished(false);
    setCurrentIdx((i) => Math.min(totalPages - 1, i + 1));
  }, [totalPages]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
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
  }, [classroomMode, currentIdx, totalPages]);

  const handleSeek = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(duration) || duration <= 0) return;
      const ratio = Number(ev.target.value) / 1000;
      audio.currentTime = ratio * duration;
    },
    [duration],
  );

  const handleRetry = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentPage?.audio_url) return;
    const audioUrl = currentPage.audio_url;
    const pageNumber = currentPage.page_number;
    const token = currentAudioTokenRef.current + 1;
    currentAudioTokenRef.current = token;
    clearAudioRetryTimer();
    setAudioError(null);
    const retryUrl = `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}manual_retry=${Date.now()}`;
    audio.src = retryUrl;
    audio.load();
    void audio.play().catch(() => scheduleAudioReload(token, audioUrl, pageNumber));
  }, [currentPage, clearAudioRetryTimer, scheduleAudioReload]);

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
        playPause();
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        goPrev();
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        goNext();
      } else if (ev.key === 'Escape') {
        if (imageOnlyFullscreen) {
          ev.preventDefault();
          setImageOnlyFullscreen(false);
          return;
        }
        const isFullscreen = Boolean(getAnyFullscreenElement());
        if (isFullscreen) {
          ev.preventDefault();
          void exitAnyFullscreen().catch(() => undefined);
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [playPause, goPrev, goNext, navigate, imageOnlyFullscreen]);

  const currentScript =
    currentPage != null ? scripts[currentPage.page_number] ?? '' : '';

  const currentSentence = useMemo(() => {
    if (!currentScript.trim()) return '';
    const sentences = splitScriptIntoSentences(currentScript);
    if (sentences.length === 0) return '';
    if (sentences.length === 1) return sentences[0];

    const timeline = buildSentenceTimeline(sentences, duration);
    if (timeline.length === 0) return sentences[0];

    const t = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    const hit = timeline.find((item) => t >= item.start && t < item.end);
    if (hit) return hit.text;
    const first = timeline[0];
    const last = timeline[timeline.length - 1];
    if (!first || !last) return sentences[0];
    if (t >= last.end) return last.text;
    return first.text;
  }, [currentScript, currentTime, duration]);

  useEffect(() => {
    setEditingScript(currentScript);
    setEditorError(null);
  }, [currentPage?.page_number, currentScript]);

  useEffect(() => {
    const n = currentPage?.page_number;
    if (!n) {
      setPromptInput('');
      return;
    }
    setPromptInput(pagePrompts[n] ?? '');
  }, [currentPage?.page_number, pagePrompts]);

  useEffect(() => {
    if (!pdfId || !currentPage) return;
    const n = currentPage.page_number;
    let cancelled = false;
    fetchPagePrompt(pdfId, n)
      .then((res) => {
        if (cancelled) return;
        setPagePrompts((prev) => ({ ...prev, [n]: res.page_prompt ?? '' }));
      })
      .catch(() => {
        // keep local fallback
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, currentPage?.page_number]);

  const hasScriptChanges = editingScript !== currentScript;

  useEffect(() => {
    if (!pdfId || !currentPage) return;
    let cancelled = false;
    setChatBusy(true);
    setChatError(null);
    fetchPageChatHistory(pdfId, currentPage.page_number)
      .then((res) => {
        if (cancelled) return;
        setChatHistory(res.history);
        setChatInput('');
      })
      .catch((err) => {
        if (cancelled) return;
        setChatHistory([]);
        setChatError(err instanceof ApiError ? err.message : '讀取問答紀錄失敗');
      })
      .finally(() => {
        if (!cancelled) setChatBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, currentPage?.page_number]);

  useEffect(() => {
    if (!pollVoterIdRef.current) {
      const storageKey = 'makeslide.poll.voterId';
      const existing = window.localStorage.getItem(storageKey);
      const next = existing || `voter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(storageKey, next);
      pollVoterIdRef.current = next;
    }
  }, []);

  useEffect(() => {
    if (!pollStarted || !pdfId || !currentPage) return;
    let cancelled = false;
    let timer: number | null = null;
    const loadPolls = async () => {
      try {
        const polls = await fetchPagePolls(pdfId, currentPage.page_number);
        if (cancelled) return;
        setPagePolls(polls);
        setPollError(null);
      } catch (err) {
        if (!cancelled) setPollError(err instanceof ApiError ? err.message : '讀取投票失敗');
      }
      if (!cancelled) timer = window.setTimeout(loadPolls, POLL_INTERVAL_MS);
    };
    void loadPolls();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [pollStarted, pdfId, currentPage?.page_number]);

  const handleSendChat = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const question = chatInput.trim();
    if (!question) return;
    const nextHistory = [...chatHistory, { role: 'user' as const, content: question }];
    setChatHistory(nextHistory);
    setChatInput('');
    setChatBusy(true);
    setChatError(null);
    try {
      const res = await chatWithPageContext(pdfId, currentPage.page_number, question, chatHistory);
      setChatHistory((prev) => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : '對話失敗');
    } finally {
      setChatBusy(false);
    }
  }, [pdfId, currentPage, chatInput, chatHistory, isReadOnlyProcessing]);

  const handleCreatePoll = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    const question = pollQuestion.trim();
    const options = pollOptionsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!question) {
      setPollError('請輸入投票問題');
      return;
    }
    if (options.length < 2) {
      setPollError('至少需要兩個答案選項');
      return;
    }
    setPollBusy(true);
    setPollError(null);
    try {
      const poll = await createPagePoll(pdfId, currentPage.page_number, question, options);
      setPagePolls((prev) => [poll, ...prev]);
      setPollQuestion('');
      setPollOptionsText('同意\n不同意');
      setPollStarted(true);
    } catch (err) {
      setPollError(err instanceof ApiError ? err.message : '建立投票失敗');
    } finally {
      setPollBusy(false);
    }
  }, [pdfId, currentPage, pollQuestion, pollOptionsText]);

  const handleStartPoll = useCallback(() => {
    setPollStarted(true);
    setPollError(null);
  }, []);

  const handleStopPoll = useCallback(() => {
    setPollStarted(false);
    setPagePolls([]);
    setPollVotes({});
    setPollError(null);
  }, []);

  const handleVotePoll = useCallback(async (pollId: number, optionIndex: number) => {
    if (!pdfId) return;
    const voterId = pollVoterIdRef.current;
    if (!voterId) return;
    setPollBusy(true);
    setPollError(null);
    try {
      const poll = await votePagePoll(pdfId, pollId, voterId, optionIndex);
      setPagePolls((prev) => prev.map((item) => (item.id === poll.id ? poll : item)));
      setPollVotes((prev) => ({ ...prev, [pollId]: optionIndex }));
    } catch (err) {
      setPollError(err instanceof ApiError ? err.message : '投票失敗');
    } finally {
      setPollBusy(false);
    }
  }, [pdfId]);

  const handleRegenerateAudio = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const nextScript = editingScript.trim();
    if (!nextScript) {
      setEditorError('文稿不可為空');
      return;
    }
    setEditorBusy(true);
    setEditorError(null);
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
      setEditorError(err instanceof ApiError ? err.message : '重生語音失敗');
    } finally {
      setEditorBusy(false);
    }
  }, [pdfId, currentPage, editingScript, isReadOnlyProcessing]);

  const handleRewriteScript = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const prompt = chatInput.trim();
    const sourceScript = editingScript.trim();
    setRewriteBusy(true);
    setRewriteError(null);
    const nextHistory = [...chatHistory, { role: 'user' as const, content: prompt }];
    setChatHistory(nextHistory);
    setChatInput('');
    try {
      const res = await rewritePageScript(
        pdfId,
        currentPage.page_number,
        prompt,
        sourceScript,
        {
          previousScript:
            currentIdx > 0
              ? (scripts[deckPages[currentIdx - 1]?.page_number ?? -1] ?? '').trim()
              : '',
          currentScript: sourceScript,
          nextScript:
            currentIdx < deckPages.length - 1
              ? (scripts[deckPages[currentIdx + 1]?.page_number ?? -1] ?? '').trim()
              : '',
        },
        chatHistory,
      );
      setEditingScript(res.script);
      setChatHistory((prev) => [...prev, { role: 'assistant', content: res.script }]);
    } catch (err) {
      setChatHistory(chatHistory);
      setRewriteError(err instanceof ApiError ? err.message : '逐字稿改寫失敗');
    } finally {
      setRewriteBusy(false);
    }
  }, [pdfId, currentPage, chatInput, editingScript, chatHistory, currentIdx, deckPages, scripts, isReadOnlyProcessing]);

  const handleClearChat = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    setChatBusy(true);
    setChatError(null);
    try {
      await clearPageChatHistory(pdfId, currentPage.page_number);
      setChatHistory([]);
      setChatInput('');
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : '清除問答失敗');
    } finally {
      setChatBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing]);

  const handleGenerateVideo = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    setVideoBusy(true);
    setVideoError(null);
    try {
      const res = await generatePdfVideo(pdfId);
      setVideoUrl(res.video_url);
      setDetail((prev) => (prev ? { ...prev, video_url: res.video_url, updated_at: res.updated_at } : prev));
    } catch (err) {
      setVideoError(err instanceof ApiError ? err.message : '產生影片失敗');
    } finally {
      setVideoBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing]);

  const handleSaveTtsSettings = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    setTtsBusy(true);
    setTtsMsg(null);
    try {
      const res = await updatePdfTtsSettings(pdfId, ttsVoice, ttsSpeed);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              tts_voice: res.tts_voice,
              tts_speed: res.tts_speed,
              updated_at: res.updated_at,
            }
          : prev,
      );
      setTtsMsg('語音設定已儲存');
    } catch (err) {
      setTtsMsg(err instanceof ApiError ? err.message : '儲存語音設定失敗');
    } finally {
      setTtsBusy(false);
    }
  }, [pdfId, ttsVoice, ttsSpeed, isReadOnlyProcessing]);

  const handleSaveTitle = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    const nextTitle = titleInput.trim();
    if (!nextTitle) {
      setTitleMsg('標題不可為空');
      return;
    }
    setTitleBusy(true);
    setTitleMsg(null);
    try {
      const res = await updatePdfTitle(pdfId, nextTitle);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              title: res.title,
              updated_at: res.updated_at,
            }
          : prev,
      );
      setTitleMsg('標題已更新');
    } catch (err) {
      setTitleMsg(err instanceof ApiError ? err.message : '更新標題失敗');
    } finally {
      setTitleBusy(false);
    }
  }, [pdfId, titleInput, isReadOnlyProcessing]);

  const handleSavePrompt = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    setPromptBusy(true);
    setPromptMsg(null);
    try {
      const res = await updatePdfPrompt(pdfId, currentPage.page_number, promptInput);
      setPagePrompts((prev) => ({ ...prev, [res.page_number]: res.page_prompt ?? '' }));
      setDetail((prev) => (prev ? { ...prev, updated_at: res.updated_at } : prev));
      setPromptMsg('提示詞已更新');
    } catch (err) {
      setPromptMsg(err instanceof ApiError ? err.message : '更新提示詞失敗');
    } finally {
      setPromptBusy(false);
    }
  }, [pdfId, currentPage, promptInput, isReadOnlyProcessing]);

  const reloadDetail = useCallback(async () => {
    if (!pdfId) return;
    const d = await fetchPdfDetail(pdfId);
    setDetail(d);
    setVideoUrl(d.video_url ?? null);
  }, [pdfId]);

  const regenAnySelected = regenOptions.image || regenOptions.script || regenOptions.audio;
  const regenJobRunning =
    regenJob?.status === 'running' ||
    regenJob?.status === 'pending' ||
    regenJob?.status === 'cancelling';
  const regenJobTerminal =
    regenJob?.status === 'completed' ||
    regenJob?.status === 'failed' ||
    regenJob?.status === 'cancelled';
  const showRegenBanner = regenJob != null && !regenBannerDismissed;

  const handleConfirmRegenerate = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    if (regenJobRunning) return; // 防重複提交
    if (!regenAnySelected) {
      setRegenAllMsg('請至少選擇一個重生項目');
      return;
    }
    if (regenOptions.image) {
      const p = regenAllPrompt.trim();
      if (!p) {
        setRegenAllMsg('圖檔提示詞不可為空');
        return;
      }
    }
    setRegenAllBusy(true);
    setRegenAllMsg(null);
    setRegenBannerDismissed(false);
    // 記住啟動前的頁碼，之後 rollback 可以跳回
    preRegenPageIdxRef.current = currentIdx;
    try {
      const started = await startRegenerateJob(pdfId, {
        scripts: regenOptions.script ? { prompt: regenScriptPrompt.trim() } : null,
        audio: regenOptions.audio ? {} : null,
        images: regenOptions.image
          ? {
              prompt: [
                `整份圖片風格（固定套用）：\n${deckImageStylePrompt.trim() || '(無)'}`,
                `本次圖片重生需求：\n${regenAllPrompt.trim()}`,
              ].join('\n\n'),
            }
          : null,
      });
      autoJumpedJobIdRef.current = null;
      setRegenJob(started);
      setRegenAllDialogOpen(false); // 關閉對話框，讓進度顯示在主畫面
      setRegenAllMsg('重生任務已啟動，進度顯示在畫面上方');
    } catch (err) {
      setRegenAllMsg(err instanceof ApiError ? err.message : '重生失敗');
      setRegenAllBusy(false);
    }
  }, [pdfId, regenAllPrompt, regenScriptPrompt, regenAnySelected, regenOptions, regenJobRunning, currentIdx, deckImageStylePrompt, isReadOnlyProcessing]);

  const handleStopRegenerate = useCallback(async () => {
    if (!pdfId || !regenJob) return;
    setRegenStopBusy(true);
    try {
      const next = await cancelRegenerateJob(pdfId);
      setRegenJob(next);
      setRegenAllMsg('已送出停止請求，等待目前頁面處理完成…');
    } catch (err) {
      setRegenAllMsg(err instanceof ApiError ? err.message : '停止失敗');
    } finally {
      setRegenStopBusy(false);
    }
  }, [pdfId, regenJob]);

  const handleRollbackRegenerate = useCallback(async () => {
    if (!pdfId) return;
    if (!window.confirm('確定要還原到重生前的狀態？此操作無法復原。')) return;
    setRegenRollbackBusy(true);
    try {
      await rollbackRegenerate(pdfId);
      // 還原後重新載入詳情
      await reloadDetail();
      // 回到啟動前的頁碼（若能取得）
      const targetIdx = preRegenPageIdxRef.current;
      if (targetIdx != null) {
        setCurrentIdx(targetIdx);
      }
      // 清除記憶體中的 job，隱藏 banner
      setRegenJob(null);
      setRegenBannerDismissed(false);
      setRegenAllMsg('已還原至重生前狀態');
      autoJumpedJobIdRef.current = null;
    } catch (err) {
      setRegenAllMsg(err instanceof ApiError ? err.message : '還原失敗');
    } finally {
      setRegenRollbackBusy(false);
    }
  }, [pdfId, reloadDetail]);

  // 輪詢批次重生任務進度。任務進入 completed/failed 後停止輪詢。
  useEffect(() => {
    if (!pdfId || !regenJob || !regenJobRunning) return;
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const next = await fetchRegenerateStatus(pdfId);
        if (cancelled) return;
        setRegenJob(next);
        if (
          next.status === 'running' ||
          next.status === 'pending' ||
          next.status === 'cancelling'
        ) {
          timer = window.setTimeout(tick, 1500);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setRegenJob(null);
          setRegenAllBusy(false);
          return;
        }
        setRegenAllMsg(err instanceof ApiError ? err.message : '取得進度失敗');
      }
    };
    timer = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [pdfId, regenJob?.job_id, regenJobRunning]);

  // 任務結束後：關閉 busy、顯示結果訊息，並重新載入詳情；若有成功完成的頁碼資訊
  // 則自動切到該頁供使用者檢視。每個 job 只自動跳頁一次。
  useEffect(() => {
    if (!regenJob) return;
    const terminal =
      regenJob.status === 'completed' ||
      regenJob.status === 'failed' ||
      regenJob.status === 'cancelled';
    if (!terminal) return;
    setRegenAllBusy(false);
    if (regenJob.status === 'completed') {
      setRegenAllMsg('重生完成');
    } else if (regenJob.status === 'failed') {
      setRegenAllMsg(regenJob.error ?? '重生失敗');
    } else {
      setRegenAllMsg('已停止生成');
    }
    void reloadDetail();
    // 自動跳頁：優先跳到 last_processed_page（使用者可看到剛生成的頁）。
    if (autoJumpedJobIdRef.current !== regenJob.job_id) {
      const lastPage =
        regenJob.last_processed_page ?? regenJob.last_generated_page ?? null;
      if (lastPage != null) {
        // page_number 是 1-based，currentIdx 是 0-based
        setCurrentIdx(Math.max(0, lastPage - 1));
      }
      autoJumpedJobIdRef.current = regenJob.job_id;
    }
  }, [regenJob, reloadDetail]);

  const handleAddSlideAfterCurrent = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      await addSlide(pdfId, currentPage.page_number);
      // 等後端新增完成後再整頁重載，避免讀到中間狀態。
      window.location.reload();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : '新增投影片失敗');
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing]);

  const handleDeleteCurrentSlide = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    if (!window.confirm(`確定刪除第 ${currentPage.page_number} 頁？`)) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      await deleteSlide(pdfId, currentPage.page_number);
      // 等後端刪除完成後再整頁重載，避免讀到中間狀態。
      window.location.reload();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : '刪除投影片失敗');
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing]);

  const handleMoveSlide = useCallback(
    async (fromPageNumber: number, toPageNumber: number) => {
      if (isReadOnlyProcessing) return;
      if (!pdfId || fromPageNumber === toPageNumber) return;
      setSlideBusy(true);
      setSlideError(null);
      try {
        await moveSlide(pdfId, fromPageNumber, toPageNumber);
        await reloadDetail();
        setCurrentIdx(Math.max(0, toPageNumber - 1));
      } catch (err) {
        setSlideError(err instanceof ApiError ? err.message : '調整頁面順序失敗');
      } finally {
        setSlideBusy(false);
      }
    },
    [pdfId, reloadDetail, isReadOnlyProcessing],
  );

  const handleReplaceImageFile = useCallback(
    async (file: File, targetPageNumber?: number) => {
      if (isReadOnlyProcessing) return;
      if (!pdfId || !currentPage) return;
      const pageNumber = targetPageNumber ?? currentPage.page_number;
      setSlideBusy(true);
      setSlideError(null);
      try {
        await replaceSlideImage(pdfId, pageNumber, file);
        await reloadDetail();
      } catch (err) {
        setSlideError(err instanceof ApiError ? err.message : '替換圖片失敗');
      } finally {
        setSlideBusy(false);
      }
    },
    [pdfId, currentPage, reloadDetail, isReadOnlyProcessing],
  );

  const handleUpdateCoverFromCurrentPage = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    if (!currentPage.image_url) {
      setSlideError('目前頁沒有可用圖片，無法更新封面');
      return;
    }
    setSlideBusy(true);
    setSlideError(null);
    try {
      await updatePdfCoverFromPage(pdfId, currentPage.page_number);
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : '更新封面失敗');
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, reloadDetail]);

  const handleRegenerateImageWithPrompt = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const trimmed = chatInput.trim() || '保留版型，讓文字更清晰、重點更聚焦';
    const merged = [
      `整份圖片風格（固定套用）：\n${deckImageStylePrompt.trim() || '(無)'}`,
      `單張調整需求：\n${trimmed}`,
    ].join('\n\n');
    setSlideBusy(true);
    setSlideError(null);
    try {
      const nextHistory = [...chatHistory, { role: 'user' as const, content: `【修改圖片】${trimmed}` }];
      setChatHistory(nextHistory);
      const res = await regenerateSlideImage(pdfId, currentPage.page_number, merged, chatHistory);
      const preview = `${res.image_url}${res.image_url.includes('?') ? '&' : '?'}t=${encodeURIComponent(res.updated_at)}`;
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: `${IMAGE_MSG_PREFIX}${preview}` },
      ]);
    } catch (err) {
      setChatHistory(chatHistory);
      setSlideError(err instanceof ApiError ? err.message : '修改圖片失敗');
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, chatInput, chatHistory, deckImageStylePrompt, isReadOnlyProcessing]);

  const handleApplyPreviewImage = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !imagePreviewUrl || !imagePreviewPageNumber) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      const resp = await fetch(imagePreviewUrl);
      if (!resp.ok) throw new Error('Failed to fetch preview image');
      const blob = await resp.blob();
      const file = new File([blob], `page-${imagePreviewPageNumber}-candidate.jpg`, { type: blob.type || 'image/jpeg' });
      await replaceSlideImage(pdfId, imagePreviewPageNumber, file);
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : '套用圖片失敗');
    } finally {
      setSlideBusy(false);
    }
    setImagePreviewOpen(false);
  }, [pdfId, imagePreviewUrl, imagePreviewPageNumber, reloadDetail, isReadOnlyProcessing]);

  const hasChatInput = chatInput.trim().length > 0;

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

  const progressRatio =
    duration > 0 ? Math.min(1, currentTime / duration) * 1000 : 0;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {imageOnlyFullscreen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
          {currentPage?.image_url ? (
            <img
              src={withImageBust(currentPage.image_url) ?? currentPage.image_url}
              alt={`第 ${currentPage.page_number} 頁`}
              className="max-h-screen max-w-screen object-contain"
            />
          ) : (
            <div className="text-slate-300">無法顯示投影片</div>
          )}
          <button
            type="button"
            onClick={() => setImageOnlyFullscreen(false)}
            className="absolute right-4 top-4 rounded-md border border-slate-500 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
          >
            離開全螢幕
          </button>
          {currentSentence ? (
            <div className="pointer-events-none absolute bottom-4 left-1/2 w-[min(92vw,1000px)] -translate-x-1/2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto rounded-md bg-black/65 px-4 py-2 text-center text-base font-medium leading-relaxed text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] md:text-lg">
                <p className="line-clamp-2 whitespace-pre-wrap">{currentSentence}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {slideBusy ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60">
          <div className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200 shadow-xl">
            <span className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-cyan-400" />
            圖片產生中…
          </div>
        </div>
      ) : null}

      {imagePreviewOpen && imagePreviewUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">圖片產生結果預覽</h3>
            <div className="mb-4 flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2">
              <img src={imagePreviewUrl} alt="生成結果預覽" className="max-h-[64vh] w-auto rounded" />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImagePreviewOpen(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                關閉預覽
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isReadOnlyProcessing) return;
                  void handleApplyPreviewImage();
                }}
                disabled={isReadOnlyProcessing}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                套用取代原圖
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hidden (but functional) audio element */}
      <audio
        ref={audioRef}
        preload="auto"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onCanPlay={() => {
          clearAudioRetryTimer();
          setAudioError(null);
          if (isPlaying) {
            void audioRef.current?.play().catch(() => {
              if (currentPage?.audio_url) {
                scheduleAudioReload(
                  currentAudioTokenRef.current,
                  currentPage.audio_url,
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
              currentPage.audio_url,
              currentPage.page_number,
            );
          }
        }}
      />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/"
            className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
          >
            ← 返回
          </Link>
          <div className="flex flex-1 items-center justify-center gap-2">
            <input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              disabled={isReadOnlyProcessing}
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-center text-sm text-slate-100"
              maxLength={200}
            />
            <button
              type="button"
              onClick={() => void handleSaveTitle()}
              disabled={isReadOnlyProcessing || titleBusy || !titleInput.trim()}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200 disabled:opacity-40"
            >
              {titleBusy ? '儲存中…' : '更新標題'}
            </button>
          </div>
          <div className="w-20 text-right text-sm text-slate-400">
            頁 {currentIdx + 1}/{totalPages}
          </div>
        </div>
        {readOnlyReason ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {readOnlyReason}
            </div>
          </div>
        ) : null}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 pb-3 md:flex-row md:items-center md:justify-between md:gap-3">
          <div className="text-xs text-slate-400">
            {videoError ? <span className="text-rose-300">{videoError}</span> : null}
            {!videoError && titleMsg ? <span className="text-slate-300">{titleMsg}</span> : null}
          </div>
          {/* 手機：一排 3 欄（設定 / 產生影片 / 開啟影片）；桌面：維持原本 flex 排列。
              註：「重生」按鍵已搬到右側問答區（aside）。 */}
          <div className="grid grid-cols-3 gap-2 md:flex md:items-center md:gap-2">
            <button
              type="button"
              onClick={() => setImageOnlyFullscreen(true)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              title="全螢幕圖片模式"
            >
              全螢幕
            </button>
            <div className="col-span-2 flex items-center justify-center gap-1 rounded-md border border-slate-700 px-2 py-1 md:col-span-1" title="調整圖片與下方資料區比例">
              <button
                type="button"
                onClick={() => setSlideImageScale((scale) => Math.max(0.65, Number((scale - 0.1).toFixed(2))))}
                className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                disabled={slideImageScale <= 0.65}
                aria-label="縮小圖片區"
              >
                −
              </button>
              <span className="w-10 text-center text-xs tabular-nums text-slate-400">{Math.round(slideImageScale * 100)}%</span>
              <button
                type="button"
                onClick={() => setSlideImageScale((scale) => Math.min(1.35, Number((scale + 0.1).toFixed(2))))}
                className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                disabled={slideImageScale >= 1.35}
                aria-label="放大圖片區"
              >
                ＋
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTtsDialogOpen(true)}
              disabled={isReadOnlyProcessing}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              title="語音設定"
              aria-label="語音設定"
            >
              ⚙️ 設定
            </button>
            <button
              type="button"
              onClick={() => void openImageStyleDialog()}
              disabled={isReadOnlyProcessing}
              className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20"
              title="圖片風格設定"
              aria-label="圖片風格設定"
            >
              🖼️ 風格
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateVideo()}
              disabled={isReadOnlyProcessing || videoBusy}
              className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {videoBusy ? '產生影片中…' : videoUrl ? '重新產生影片' : '產生影片'}
            </button>
            {videoUrl ? (
              <a
                href={videoUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-center text-sm text-cyan-200 hover:bg-cyan-500/25"
              >
                開啟影片
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-500 opacity-60"
                title="尚未產生影片"
              >
                開啟影片
              </button>
            )}
          </div>
        </div>
        {showRegenBanner ? (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs text-slate-200">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span>
                  重生任務：
                  {regenJob?.status === 'running'
                    ? '執行中'
                    : regenJob?.status === 'pending'
                      ? '等待中'
                      : regenJob?.status === 'cancelling'
                        ? '停止中'
                        : regenJob?.status === 'cancelled'
                          ? '已停止'
                          : regenJob?.status === 'completed'
                            ? '已完成'
                            : '失敗'}
                  {regenJob?.last_processed_page != null
                    ? ` · 目前頁 ${regenJob.last_processed_page}`
                    : ''}
                </span>
                <div className="flex items-center gap-2">
                  {regenJobRunning ? (
                    <button
                      type="button"
                      onClick={() => void handleStopRegenerate()}
                      disabled={regenStopBusy}
                      className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200 disabled:opacity-40"
                    >
                      {regenStopBusy ? '停止中…' : '停止生成'}
                    </button>
                  ) : null}
                  {regenJobTerminal && regenJob?.rollback_available ? (
                    <button
                      type="button"
                      onClick={() => void handleRollbackRegenerate()}
                      disabled={regenRollbackBusy}
                      className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200 disabled:opacity-40"
                    >
                      {regenRollbackBusy ? '還原中…' : '還原'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setRegenBannerDismissed(true)}
                    className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300"
                  >
                    關閉
                  </button>
                </div>
              </div>
              <RegenerateProgress job={regenJob} />
              {regenAllMsg ? <p className="mt-1 text-[11px] text-slate-300">{regenAllMsg}</p> : null}
            </div>
          </div>
        ) : null}
      </header>

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
        <div
          className={`min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70 md:flex ${
            activeTab === 'play' ? 'flex' : 'hidden'
          }`}
        >
          {/* Slide image */}
          <section
            className="flex flex-1 items-center justify-center px-4 py-6"
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
              {currentPage?.image_url ? (
                <img
                  key={currentPage.page_number}
                  src={withImageBust(currentPage.image_url) ?? currentPage.image_url}
                  alt={`第 ${currentPage.page_number} 頁`}
                  className="w-auto rounded-lg border border-slate-800 shadow-xl"
                  style={{ maxHeight: `${slideImageMaxHeightVh}vh` }}
                />
              ) : (
                <div
                  className="flex w-full items-center justify-center rounded-lg border border-slate-800 text-slate-500"
                  style={{ height: `${slideImageMaxHeightVh}vh` }}
                >
                  無法顯示投影片
                </div>
              )}
              {currentSentence ? (
                <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(92%,900px)] -translate-x-1/2 px-2">
                  <div className="mx-auto rounded-md bg-black/60 px-4 py-2 text-center text-sm font-medium leading-relaxed text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] md:text-base">
                    <p className="line-clamp-2 whitespace-pre-wrap">{currentSentence}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* Controls */}
          <section className="border-t border-slate-800 bg-slate-900/50">
            <div className="flex flex-col gap-3 px-4 py-4">
          {audioError && (
            <div className="flex items-center justify-between rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <span>{audioError}</span>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded border border-rose-300/50 px-2 py-0.5 text-xs hover:bg-rose-500/20"
              >
                重試
              </button>
            </div>
          )}
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
          <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={playPause}
              className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
              aria-label={classroomMode && classroomAwaitingNext ? '下一頁並播放' : isPlaying ? '暫停' : '播放'}
              title={classroomMode && classroomAwaitingNext ? '下一頁並播放 (Space)' : isPlaying ? '暫停 (Space)' : '播放 (Space)'}
            >
              {classroomMode && classroomAwaitingNext ? '⏭▶︎' : isPlaying ? '⏸' : '▶︎'}
            </button>
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
            <input
              type="range"
              min={0}
              max={1000}
              value={progressRatio}
              onChange={handleSeek}
              className="flex-1 accent-emerald-500"
              aria-label="進度條"
            />
            <div className="w-24 whitespace-nowrap text-right font-mono text-xs text-slate-300">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
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
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
              }`}
              aria-pressed={classroomMode}
            >
              {classroomMode ? '已開啟' : '開啟'}
            </button>
          </div>
            </div>
          </section>

          {/* Script panel */}
          <section className="border-t border-slate-800 bg-slate-950">
            <div className="px-4 py-4">
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
                  onClick={() => setEditTab('system')}
                  className={`flex-1 px-3 py-1.5 text-sm ${editTab === 'system' ? 'bg-slate-800 text-amber-200' : 'text-slate-400'}`}
                >
                  🧾 系統資料
                </button>
              </div>

              {editTab === 'script' ? (
                <>
                  <h2 className="mb-2 text-sm font-semibold text-slate-300">
                    📝 逐字稿（第 {currentPage?.page_number ?? '-'} 頁）
                  </h2>
                  <textarea
                    value={editingScript}
                    onChange={(e) => setEditingScript(e.target.value)}
                    disabled={isReadOnlyProcessing}
                    rows={6}
                    className="w-full rounded-md border border-slate-700 bg-slate-900/70 p-3 text-sm leading-relaxed text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring"
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
              ) : (
                <>
                  <h2 className="mb-2 text-sm font-semibold text-slate-300">🧾 系統資料（第 {currentPage?.page_number ?? '-'} 頁）</h2>
                  <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-300">
                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-slate-500">PDF ID</dt>
                        <dd className="break-all font-mono text-slate-200">{detail.id}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">狀態</dt>
                        <dd className="text-slate-200">{detail.status}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">原始檔名</dt>
                        <dd className="break-all text-slate-200">{detail.original_filename}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">頁數</dt>
                        <dd className="text-slate-200">{detail.page_count ?? totalPages}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">TTS</dt>
                        <dd className="text-slate-200">{detail.tts_provider ?? 'openai'} / {detail.tts_voice ?? '-'} / {detail.tts_speed ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">目前頁狀態</dt>
                        <dd className="text-slate-200">{currentPage?.status ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">建立時間</dt>
                        <dd className="font-mono text-slate-200">{detail.created_at}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">更新時間</dt>
                        <dd className="font-mono text-slate-200">{detail.updated_at}</dd>
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
                </>
              )}
            </div>
          </section>
        </div>

        {/* Right: thumbnails + LLM chat panel（手機：僅於 qa tab 顯示；桌面：永遠顯示） */}
        <aside
          className={`max-h-[calc(100vh-7rem)] w-full shrink-0 flex-col gap-3 overflow-y-auto md:flex md:w-[360px] ${
            activeTab === 'qa' ? 'flex' : 'hidden'
          }`}
        >
          <section className="rounded-lg border border-slate-800 bg-slate-900/40">
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-300">🧩 投影片管理</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isReadOnlyProcessing) return;
                      // 若非執行中才清掉舊訊息；執行中時保留以便顯示進度。
                      if (!regenJobRunning) {
                        setRegenAllMsg(null);
                      }
                      setRegenAllDialogOpen(true);
                    }}
                    disabled={isReadOnlyProcessing}
                    className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-2 py-1 text-xs text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    title="重生（可選逐字稿/語音/圖檔）"
                  >
                    {regenJobRunning
                      ? '重生中…'
                      : regenAllBusy
                        ? '啟動中…'
                        : '重生'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAddSlideAfterCurrent()}
                    disabled={isReadOnlyProcessing || slideBusy || !currentPage}
                    className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200 disabled:opacity-40"
                  >
                    新增
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteCurrentSlide()}
                    disabled={isReadOnlyProcessing || slideBusy || !currentPage || totalPages <= 1}
                    className="rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-xs text-rose-200 disabled:opacity-40"
                  >
                    刪除
                  </button>
                </div>
              </div>
              {slideError ? <p className="mt-2 text-xs text-rose-300">{slideError}</p> : null}
            </div>
            <div
              className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto p-3"
              onDragOver={(e) => {
                e.preventDefault();
                if (isReadOnlyProcessing) return;
                e.dataTransfer.dropEffect = 'move';
              }}
              onDropCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isReadOnlyProcessing) return;
                const fromText =
                  e.dataTransfer.getData('application/x-page-number') ||
                  e.dataTransfer.getData('text/plain');
                const fromPage = Number(fromText);
                const targetEl = (e.target as HTMLElement | null)?.closest('[data-page-number]') as HTMLElement | null;
                const toPage = Number(targetEl?.dataset.pageNumber || '');
                // eslint-disable-next-line no-console
                console.info('[reorder][drop-capture]', { fromText, fromPage, toPage, hasTarget: !!targetEl });
                if (Number.isFinite(fromPage) && fromPage > 0 && Number.isFinite(toPage) && toPage > 0 && fromPage !== toPage) {
                  void handleMoveSlide(fromPage, toPage);
                }
              }}
              onPaste={(e) => {
                // eslint-disable-next-line no-console
                console.info('[paste][thumb-grid] event fired', {
                  itemCount: e.clipboardData.items.length,
                  items: Array.from(e.clipboardData.items).map((it) => ({ kind: it.kind, type: it.type })),
                });
                if (isReadOnlyProcessing) return;
                const file = Array.from(e.clipboardData.items)
                  .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
                  .find((f): f is File => !!f);
                if (!file) {
                  // eslint-disable-next-line no-console
                  console.warn('[paste][thumb-grid] no file found');
                }
                if (file) void handleReplaceImageFile(file);
              }}
              tabIndex={0}
            >
              {deckPages.map((p, idx) => (
                <div
                  key={p.page_number}
                  data-page-number={p.page_number}
                  onClick={() => setCurrentIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (isReadOnlyProcessing) return;
                    // Reorder is handled by parent onDropCapture to avoid double requests.
                    const f = e.dataTransfer.files?.[0];
                    if (f) void handleReplaceImageFile(f, p.page_number);
                  }}
                  onPaste={(e) => {
                    if (isReadOnlyProcessing) return;
                    const file = Array.from(e.clipboardData.items)
                      .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
                      .find((f): f is File => !!f);
                    if (file) void handleReplaceImageFile(file, p.page_number);
                  }}
                  className={`relative overflow-hidden rounded border ${idx === currentIdx ? 'border-cyan-400' : 'border-slate-700'} ${draggingPage === p.page_number ? 'opacity-50' : ''}`}
                  title={`第 ${p.page_number} 頁`}
                >
                  <button
                    type="button"
                    draggable={!isReadOnlyProcessing && !slideBusy}
                    onDragStart={(e) => {
                      if (isReadOnlyProcessing) {
                        e.preventDefault();
                        return;
                      }
                      setDraggingPage(p.page_number);
                      e.dataTransfer.setData('application/x-page-number', String(p.page_number));
                      e.dataTransfer.setData('text/plain', String(p.page_number));
                      e.dataTransfer.effectAllowed = 'move';
                      // eslint-disable-next-line no-console
                      console.info('[reorder][dragstart]', { page: p.page_number });
                    }}
                    onDragEnd={() => {
                      setDraggingPage(null);
                      // eslint-disable-next-line no-console
                      console.info('[reorder][dragend]', { page: p.page_number });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-0 z-10 rounded-bl bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-slate-200 cursor-grab active:cursor-grabbing"
                    title="拖曳此把手可重排"
                  >
                    ↕
                  </button>
                  {(() => {
                    const thumbSrc = isReadOnlyProcessing
                      ? p.image_url
                      : (p.thumbnail_url ?? p.image_url);
                    return thumbSrc ? (
                    <img
                      src={withImageBust(thumbSrc) ?? thumbSrc}
                      alt={`第 ${p.page_number} 頁縮圖`}
                      className="h-14 w-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget;
                        const fallback = p.image_url;
                        if (!fallback || img.dataset.fallbackApplied === 'true') {
                          img.style.display = 'none';
                          return;
                        }
                        img.dataset.fallbackApplied = 'true';
                        img.src = withImageBust(fallback) ?? fallback;
                      }}
                    />
                    ) : (
                    <div className="flex h-14 w-full items-center justify-center bg-slate-800 text-[10px] text-slate-400">
                      無圖片
                    </div>
                    );
                  })()}
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 px-3 py-2">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (isReadOnlyProcessing) return;
                  const f = e.target.files?.[0];
                  if (f) void handleReplaceImageFile(f);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isReadOnlyProcessing || slideBusy || !currentPage}
                className="w-full rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-40"
              >
                取代目前頁圖片（可拖放/貼上）
              </button>
              <button
                type="button"
                onClick={() => void handleUpdateCoverFromCurrentPage()}
                disabled={slideBusy || !currentPage?.image_url}
                className="mt-2 w-full rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                title="將首頁列表封面更新為目前選取頁面的圖片"
              >
                將目前頁設為封面
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900/40">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-slate-300">📊 Realtime Poll</h2>
                <p className="text-[11px] text-slate-500">
                  {pollStarted ? `第 ${currentPage?.page_number ?? '-'} 頁投票中` : '尚未開始，不顯示結果'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPollSettingsOpen((v) => !v)}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {pollSettingsOpen ? '收合設定' : '設定'}
                </button>
                {pollStarted ? (
                  <button
                    type="button"
                    onClick={handleStopPoll}
                    className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
                  >
                    結束
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartPoll}
                    disabled={!currentPage}
                    className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    開始
                  </button>
                )}
              </div>
            </div>
            {(pollSettingsOpen || pollStarted || pollError) && (
              <div className="space-y-2 border-t border-slate-800 p-2">
                {pollSettingsOpen && (
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                    <input
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      maxLength={300}
                      placeholder="輸入投票問題"
                      className="mb-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-500 focus:ring"
                    />
                    <textarea
                      value={pollOptionsText}
                      onChange={(e) => setPollOptionsText(e.target.value)}
                      rows={2}
                      placeholder="每行一個答案選項"
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-500 focus:ring"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreatePoll()}
                      disabled={pollBusy || !currentPage}
                      className="mt-2 w-full rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pollBusy ? '處理中…' : '建立並開始本頁投票'}
                    </button>
                  </div>
                )}
                {pollError ? <p className="text-xs text-rose-300">{pollError}</p> : null}

                {pollStarted && (
                  <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                    {pagePolls.length === 0 ? (
                      <div className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-xs text-slate-500">
                        已開始輪詢，本頁尚無投票。
                      </div>
                    ) : (
                      pagePolls.map((poll) => (
                        <div key={poll.id} className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <h3 className="text-xs font-medium text-slate-200">{poll.question}</h3>
                            <span className="shrink-0 rounded-full border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                              {poll.total_votes} 票
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {poll.options.map((option, idx) => {
                              const ratio = poll.total_votes > 0 ? Math.round((option.votes / poll.total_votes) * 100) : 0;
                              const selected = pollVotes[poll.id] === idx;
                              return (
                                <button
                                  key={`${poll.id}-${idx}`}
                                  type="button"
                                  onClick={() => void handleVotePoll(poll.id, idx)}
                                  disabled={pollBusy || !poll.is_active}
                                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${selected ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100' : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800'} disabled:cursor-not-allowed disabled:opacity-60`}
                                >
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <span className="truncate">{option.text}</span>
                                    <span className="font-mono text-[10px] text-slate-400">{option.votes} · {ratio}%</span>
                                  </div>
                                  <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                                    <div className="h-full rounded-full bg-cyan-400" style={{ width: `${ratio}%` }} />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="border-b border-slate-800 px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            💬 本頁問答（含本頁圖片與文字上下文）
          </h2>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleClearChat()}
              disabled={isReadOnlyProcessing || chatBusy || chatHistory.length === 0}
              className="rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              清除全部訊息
            </button>
          </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
            {chatHistory.length === 0 ? (
              <div className="text-slate-500">尚無對話，請輸入問題。</div>
            ) : (
              chatHistory.map((m, idx) => (
                <div key={idx} className={m.role === 'user' ? 'text-slate-100' : 'text-emerald-200'}>
                  <span className="mr-2 text-xs uppercase opacity-70">{m.role === 'user' ? '你' : '助教'}</span>
                  {m.role === 'assistant' && m.content.startsWith(IMAGE_MSG_PREFIX) ? (
                    <button
                      type="button"
                      onClick={() => {
                        const url = m.content.slice(IMAGE_MSG_PREFIX.length).trim();
                        if (!url) return;
                        setImagePreviewUrl(url);
                        setImagePreviewPageNumber(currentPage?.page_number ?? null);
                        setImagePreviewOpen(true);
                      }}
                      className="inline-block overflow-hidden rounded-md border border-cyan-500/40 hover:border-cyan-300"
                      title="點擊放大預覽"
                    >
                      <img src={m.content.slice(IMAGE_MSG_PREFIX.length).trim()} alt="生成圖片結果" className="max-h-36 w-auto" />
                    </button>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="border-t border-slate-800 p-3">
            <div className="flex flex-col gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (isReadOnlyProcessing) return;
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
              rows={3}
              disabled={isReadOnlyProcessing}
              placeholder={isReadOnlyProcessing ? '處理中為唯讀模式，問答與修改功能暫停' : '可輸入問題，或輸入逐字稿修改指示（Shift+Enter 換行）'}
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring"
            />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleRegenerateImageWithPrompt()}
                  disabled={isReadOnlyProcessing || slideBusy || !currentPage}
                  className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  修改圖片
                </button>
                <button
                  type="button"
                  onClick={() => void handleRewriteScript()}
                  disabled={isReadOnlyProcessing || rewriteBusy}
                  className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {rewriteBusy ? '修改中…' : '修改逐字稿'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSendChat()}
                  disabled={isReadOnlyProcessing || chatBusy || !hasChatInput}
                  className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {chatBusy ? '詢問中…' : '詢問'}
                </button>
              </div>
            </div>
            {chatError ? <p className="mt-1 text-xs text-rose-300">{chatError}</p> : null}
            {rewriteError ? <p className="mt-1 text-xs text-rose-300">{rewriteError}</p> : null}
          </div>
          </section>
        </aside>
      </main>

      {ttsDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">語音設定</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">聲音</span>
                <select
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  disabled={isReadOnlyProcessing || ttsBusy}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                >
                  {availableTtsVoices.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-300">速度</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(Number(e.target.value))}
                  disabled={isReadOnlyProcessing || ttsBusy}
                  className="flex-1 accent-cyan-500"
                />
                <span className="w-10 text-right text-xs tabular-nums text-slate-300">{ttsSpeed.toFixed(2)}</span>
              </div>
              {ttsMsg ? <p className="text-xs text-slate-400">{ttsMsg}</p> : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTtsDialogOpen(false)}
                className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                關閉
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTtsSettings()}
                disabled={isReadOnlyProcessing || ttsBusy}
                className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
              >
                {ttsBusy ? '儲存中…' : '儲存設定'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {imageStyleDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <h3 className="mb-2 text-sm font-semibold text-slate-200">整份簡報圖片風格設定</h3>
            <p className="mb-3 text-xs text-slate-400">
              這個風格會套用在後續的單張與多張圖片重生。可填入你偏好的風格模板並自行調整。
            </p>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <select
                value={selectedImageStyleTemplateKey}
                onChange={(e) => setSelectedImageStyleTemplateKey(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                {imageStyleTemplates.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => applyImageStyleTemplate(selectedImageStyleTemplateKey)}
                disabled={isReadOnlyProcessing}
                className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25"
              >
                套用模板
              </button>
            </div>
            <textarea
              value={deckImageStylePrompt}
              onChange={(e) => setDeckImageStylePrompt(e.target.value)}
              disabled={isReadOnlyProcessing}
              rows={8}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
              placeholder="例如：academic minimalist style, clean layout..."
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImageStyleDialogOpen(false)}
                className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                關閉
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!pdfId) {
                    setImageStyleDialogOpen(false);
                    return;
                  }
                  if (isReadOnlyProcessing) return;
                  void (async () => {
                    try {
                      const res = await updatePdfImageStyleSettings(pdfId, deckImageStylePrompt);
                      setDetail((prev) => (prev ? { ...prev, image_style_prompt: res.image_style_prompt, updated_at: res.updated_at } : prev));
                      setRegenAllMsg('已儲存整份圖片風格設定，後續重生會自動套用');
                    } catch (err) {
                      setRegenAllMsg(err instanceof ApiError ? err.message : '儲存圖片風格設定失敗');
                    } finally {
                      setImageStyleDialogOpen(false);
                    }
                  })();
                }}
                disabled={isReadOnlyProcessing}
                className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200"
              >
                儲存設定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {regenAllDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">選擇重生項目</h3>
            <p className="mb-3 text-xs text-slate-400">
              可多選；執行順序固定為 <span className="font-semibold text-slate-200">圖檔 → 逐字稿 → 語音</span>。
            </p>
            <div className="mb-3 space-y-2">
              <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                已套用整份圖片風格設定（可於上方「🖼️ 風格」調整）。
              </div>
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="accent-fuchsia-500"
                  checked={regenOptions.image}
                  onChange={(e) => setRegenOptions((prev) => ({ ...prev, image: e.target.checked }))}
                  disabled={isReadOnlyProcessing || regenAllBusy}
                />
                <span>圖檔</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="accent-fuchsia-500"
                  checked={regenOptions.script}
                  onChange={(e) => setRegenOptions((prev) => ({ ...prev, script: e.target.checked }))}
                  disabled={isReadOnlyProcessing || regenAllBusy}
                />
                <span>逐字稿</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="accent-fuchsia-500"
                  checked={regenOptions.audio}
                  onChange={(e) => setRegenOptions((prev) => ({ ...prev, audio: e.target.checked }))}
                  disabled={isReadOnlyProcessing || regenAllBusy}
                />
                <span>語音</span>
              </label>
            </div>
            {regenOptions.image ? (
              <div className="mb-2">
                <label className="mb-1 block text-xs text-slate-400">圖檔重生提示詞</label>
                <textarea
                  value={regenAllPrompt}
                  onChange={(e) => setRegenAllPrompt(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
                  placeholder="輸入整份風格調整提示詞..."
                  disabled={isReadOnlyProcessing || regenAllBusy}
                />
              </div>
            ) : null}
            {regenOptions.script ? (
              <div className="mb-2">
                <label className="mb-1 block text-xs text-slate-400">逐字稿重生提示詞</label>
                <textarea
                  value={regenScriptPrompt}
                  onChange={(e) => setRegenScriptPrompt(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
                  placeholder="例如：請以更精煉、口語、易懂的方式重寫，並保留每頁核心重點"
                  disabled={isReadOnlyProcessing || regenAllBusy}
                />
              </div>
            ) : null}
            {regenOptions.script && regenOptions.audio ? null : regenOptions.script ? (
              <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                提醒：若僅重生逐字稿，原有語音可能與新的逐字稿不相符，建議同時勾選「語音」。
              </p>
            ) : null}
            <RegenerateProgress job={regenJob} />
            {regenAllMsg ? (
              <p
                className={`mt-2 text-xs ${
                  regenJob?.status === 'completed'
                    ? 'text-emerald-300'
                    : regenJob?.status === 'failed'
                      ? 'text-rose-300'
                      : 'text-slate-300'
                }`}
              >
                {regenAllMsg}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRegenAllDialogOpen(false);
                  if (!regenJobRunning) {
                    setRegenJob(null);
                    setRegenAllMsg(null);
                  }
                }}
                disabled={regenAllBusy}
                className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                {regenJobRunning ? '關閉（背景繼續）' : regenJob ? '關閉' : '取消'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRegenerate()}
                disabled={isReadOnlyProcessing || regenAllBusy || !regenAnySelected}
                className="rounded border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-sm text-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-40"
                title={!regenAnySelected ? '請至少選擇一個項目' : ''}
              >
                {regenAllBusy ? '重生中…' : regenJob?.status === 'completed' ? '再次重生' : '確認'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
