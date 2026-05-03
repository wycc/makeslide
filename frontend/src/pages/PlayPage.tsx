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
  deleteSlide,
  fetchPdfDetail,
  fetchPageChatHistory,
  fetchRegenerateStatus,
  generatePdfVideo,
  regenerateSlideImage,
  replaceSlideImage,
  regeneratePageAudio,
  rollbackRegenerate,
  startRegenerateJob,
  updatePdfTtsSettings,
  updatePdfTitle,
  rewritePageScript,
} from '../lib/api';
import type {
  ChatMessage,
  PdfDetail,
  PdfDetailPage,
  RegenJobState,
  RegenStepName,
} from '../types';

const POLL_INTERVAL_MS = 3000;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  const [slideBusy, setSlideBusy] = useState(false);
  const [slideError, setSlideError] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);
  const [ttsDialogOpen, setTtsDialogOpen] = useState(false);
  const [regenAllDialogOpen, setRegenAllDialogOpen] = useState(false);
  const [regenAllPrompt, setRegenAllPrompt] = useState('請讓整份簡報的圖像風格一致，色調、字體與版面語言維持統一。');
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
  // 在按下「確認」啟動重生前記住目前頁碼，供 rollback 後跳回。
  const preRegenPageIdxRef = useRef<number | null>(null);
  // 避免 completion 的自動跳頁多次觸發；每一個 job_id 只跳一次。
  const autoJumpedJobIdRef = useRef<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  // 手機模式下的 tab 切換（桌面模式忽略此 state，永遠並排顯示）
  const [activeTab, setActiveTab] = useState<'play' | 'qa'>('play');
  const IMAGE_MSG_PREFIX = '[image] ';
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // prefetch refs so GC doesn't drop them mid-load
  const prefetchedAudioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchedImageRef = useRef<HTMLImageElement | null>(null);

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
        setTtsVoice(d.tts_voice?.trim() || 'alloy');
        setTtsSpeed(d.tts_speed ?? 1);
        setLoadError(null);
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

  // 掛載時檢查是否有正在進行中的批次重生任務；若有則接上並繼續顯示進度。
  useEffect(() => {
    if (!pdfId) return;
    let cancelled = false;
    fetchRegenerateStatus(pdfId)
      .then((state) => {
        if (cancelled) return;
        if (
          state.status === 'running' ||
          state.status === 'pending' ||
          state.status === 'cancelling'
        ) {
          setRegenJob(state);
          setRegenAllBusy(true);
        } else if (state.rollback_available) {
          // 終止的任務若仍可還原，也顯示 banner 讓使用者決定
          setRegenJob(state);
        }
      })
      .catch(() => {
        // 404 = 沒有任何任務紀錄，忽略即可。
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId]);

  const pages = detail?.pages ?? [];
  const deckPages: PdfDetailPage[] = useMemo(() => pages, [pages]);
  const currentPage: PdfDetailPage | null = deckPages[currentIdx] ?? null;
  const totalPages = deckPages.length;
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
    audio.src = currentPage.audio_url;
    audio.load();
    setCurrentTime(0);
    setAudioError(null);
    if (isPlaying) {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.page_number]);

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
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, []);

  const goPrev = useCallback(() => {
    setFinished(false);
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setFinished(false);
    setCurrentIdx((i) => Math.min(totalPages - 1, i + 1));
  }, [totalPages]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (currentIdx < totalPages - 1) {
      setCurrentIdx((i) => i + 1);
      setIsPlaying(true); // autoplay next
    } else {
      setFinished(true);
    }
  }, [currentIdx, totalPages]);

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
    setAudioError(null);
    audio.src = currentPage.audio_url;
    audio.load();
    void audio.play().catch(() => setIsPlaying(false));
  }, [currentPage]);

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
        ev.preventDefault();
        navigate('/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playPause, goPrev, goNext, navigate]);

  const currentScript =
    currentPage != null ? scripts[currentPage.page_number] ?? '' : '';

  useEffect(() => {
    setEditingScript(currentScript);
    setEditorError(null);
  }, [currentPage?.page_number, currentScript]);

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

  const handleSendChat = useCallback(async () => {
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
  }, [pdfId, currentPage, chatInput, chatHistory]);

  const handleRegenerateAudio = useCallback(async () => {
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
      await regeneratePageAudio(pdfId, currentPage.page_number, nextScript);
      setScripts((prev) => ({ ...prev, [currentPage.page_number]: nextScript }));
      const audio = audioRef.current;
      if (audio && currentPage.audio_url) {
        const nextUrl = `${currentPage.audio_url}?t=${Date.now()}`;
        audio.pause();
        audio.src = nextUrl;
        audio.load();
        setCurrentTime(0);
        setDuration(0);
        setFinished(false);
        void audio.play().catch(() => setIsPlaying(false));
      }
    } catch (err) {
      setEditorError(err instanceof ApiError ? err.message : '重生語音失敗');
    } finally {
      setEditorBusy(false);
    }
  }, [pdfId, currentPage, editingScript]);

  const handleRewriteScript = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    const prompt = chatInput.trim();
    const sourceScript = editingScript.trim();
    if (!prompt) {
      setRewriteError('請先輸入修改提示');
      return;
    }
    if (!sourceScript) {
      setRewriteError('目前逐字稿不可為空');
      return;
    }
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
  }, [pdfId, currentPage, chatInput, editingScript]);

  const handleClearChat = useCallback(async () => {
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
  }, [pdfId, currentPage]);

  const handleGenerateVideo = useCallback(async () => {
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
  }, [pdfId]);

  const handleSaveTtsSettings = useCallback(async () => {
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
  }, [pdfId, ttsVoice, ttsSpeed]);

  const handleSaveTitle = useCallback(async () => {
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
  }, [pdfId, titleInput]);

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
        scripts: regenOptions.script ? { prompt: '' } : null,
        audio: regenOptions.audio ? {} : null,
        images: regenOptions.image
          ? { prompt: regenAllPrompt.trim() }
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
  }, [pdfId, regenAllPrompt, regenAnySelected, regenOptions, regenJobRunning, currentIdx]);

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
  }, [pdfId, currentPage]);

  const handleDeleteCurrentSlide = useCallback(async () => {
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
  }, [pdfId, currentPage]);

  const handleReplaceImageFile = useCallback(
    async (file: File, targetPageNumber?: number) => {
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
    [pdfId, currentPage, reloadDetail],
  );

  const handleRegenerateImageWithPrompt = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    const trimmed = chatInput.trim() || '保留版型，讓文字更清晰、重點更聚焦';
    setSlideBusy(true);
    setSlideError(null);
    try {
      const res = await regenerateSlideImage(pdfId, currentPage.page_number, trimmed);
      const preview = `${res.image_url}${res.image_url.includes('?') ? '&' : '?'}t=${encodeURIComponent(res.updated_at)}`;
      setChatHistory((prev) => [
        ...prev,
        { role: 'user', content: `【修改圖片】${trimmed}` },
        { role: 'assistant', content: `${IMAGE_MSG_PREFIX}${preview}` },
      ]);
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : '修改圖片失敗');
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, chatInput, reloadDetail]);

  const handleApplyPreviewImage = useCallback(async () => {
    setImagePreviewOpen(false);
    await reloadDetail();
  }, [reloadDetail]);

  const hasChatInput = chatInput.trim().length > 0;

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

  if (detail.status !== 'ready') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-100">
        <p className="text-slate-300">尚未處理完成（{detail.status}{detail.progress_step ? ` / ${detail.progress_step}` : ''}）</p>
        <p className="text-xs text-slate-500">系統將每 3 秒重新檢查一次狀態…</p>
        <Link to="/" className="text-sm text-slate-400 underline">
          返回首頁
        </Link>
      </div>
    );
  }

  if (totalPages === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-100">
        <p className="text-slate-300">這份 PDF 沒有可播放的語音頁面</p>
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
                onClick={() => void handleApplyPreviewImage()}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25"
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
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onError={() => setAudioError('語音載入失敗')}
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
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-center text-sm text-slate-100"
              maxLength={200}
            />
            <button
              type="button"
              onClick={() => void handleSaveTitle()}
              disabled={titleBusy || !titleInput.trim()}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200 disabled:opacity-40"
            >
              {titleBusy ? '儲存中…' : '更新標題'}
            </button>
          </div>
          <div className="w-20 text-right text-sm text-slate-400">
            頁 {currentIdx + 1}/{totalPages}
          </div>
        </div>
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
              onClick={() => setTtsDialogOpen(true)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              title="語音設定"
              aria-label="語音設定"
            >
              ⚙️ 設定
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateVideo()}
              disabled={videoBusy}
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
              const f = e.dataTransfer.files?.[0];
              if (f && currentPage) void handleReplaceImageFile(f, currentPage.page_number);
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.items)
                .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
                .find((f): f is File => !!f);
              if (file && currentPage) void handleReplaceImageFile(file, currentPage.page_number);
            }}
            tabIndex={0}
          >
            <div className="flex h-full w-full max-w-4xl items-center justify-center">
              {currentPage?.image_url ? (
                <img
                  key={currentPage.page_number}
                  src={withImageBust(currentPage.image_url) ?? currentPage.image_url}
                  alt={`第 ${currentPage.page_number} 頁`}
                  className="max-h-[52vh] w-auto rounded-lg border border-slate-800 shadow-xl"
                />
              ) : (
                <div className="flex h-[52vh] w-full items-center justify-center rounded-lg border border-slate-800 text-slate-500">
                  無法顯示投影片
                </div>
              )}
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
              aria-label={isPlaying ? '暫停' : '播放'}
              title={isPlaying ? '暫停 (Space)' : '播放 (Space)'}
            >
              {isPlaying ? '⏸' : '▶︎'}
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
            </div>
          </section>

          {/* Script panel */}
          <section className="border-t border-slate-800 bg-slate-950">
            <div className="px-4 py-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">
                📝 逐字稿（第 {currentPage?.page_number ?? '-'} 頁）
              </h2>
              <textarea
                value={editingScript}
                onChange={(e) => setEditingScript(e.target.value)}
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
                  disabled={editorBusy || !hasScriptChanges}
                  className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {editorBusy ? '重生中…' : '儲存並重生語音'}
                </button>
              </div>
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
                      // 若非執行中才清掉舊訊息；執行中時保留以便顯示進度。
                      if (!regenJobRunning) {
                        setRegenAllMsg(null);
                      }
                      setRegenAllDialogOpen(true);
                    }}
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
                    disabled={slideBusy || !currentPage}
                    className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200 disabled:opacity-40"
                  >
                    新增
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteCurrentSlide()}
                    disabled={slideBusy || !currentPage || totalPages <= 1}
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
              onPaste={(e) => {
                const file = Array.from(e.clipboardData.items)
                  .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
                  .find((f): f is File => !!f);
                if (file) void handleReplaceImageFile(file);
              }}
              tabIndex={0}
            >
              {deckPages.map((p, idx) => (
                <button
                  key={p.page_number}
                  type="button"
                  onClick={() => setCurrentIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) void handleReplaceImageFile(f, p.page_number);
                  }}
                  onPaste={(e) => {
                    const file = Array.from(e.clipboardData.items)
                      .map((it) => (it.kind === 'file' ? it.getAsFile() : null))
                      .find((f): f is File => !!f);
                    if (file) void handleReplaceImageFile(file, p.page_number);
                  }}
                  className={`overflow-hidden rounded border ${idx === currentIdx ? 'border-cyan-400' : 'border-slate-700'}`}
                  title={`第 ${p.page_number} 頁`}
                >
                  {p.image_url ? (
                    <img
                      src={withImageBust(p.image_url) ?? p.image_url}
                      alt={`第 ${p.page_number} 頁縮圖`}
                      className="h-14 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-full items-center justify-center bg-slate-800 text-[10px] text-slate-400">
                      無圖片
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-800 px-3 py-2">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleReplaceImageFile(f);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={slideBusy || !currentPage}
                className="w-full rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-40"
              >
                取代目前頁圖片（可拖放/貼上）
              </button>
            </div>
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
              disabled={chatBusy || chatHistory.length === 0}
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
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
              rows={3}
              placeholder="可輸入問題，或輸入逐字稿修改指示（Shift+Enter 換行）"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring"
            />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleRegenerateImageWithPrompt()}
                  disabled={slideBusy || !currentPage || !hasChatInput}
                  className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  修改圖片
                </button>
                <button
                  type="button"
                  onClick={() => void handleRewriteScript()}
                  disabled={rewriteBusy || !hasChatInput}
                  className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {rewriteBusy ? '修改中…' : '修改逐字稿'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSendChat()}
                  disabled={chatBusy || !hasChatInput}
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
                  disabled={ttsBusy}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                >
                  <option value="alloy">alloy</option>
                  <option value="ash">ash</option>
                  <option value="ballad">ballad</option>
                  <option value="coral">coral</option>
                  <option value="echo">echo</option>
                  <option value="fable">fable</option>
                  <option value="nova">nova</option>
                  <option value="onyx">onyx</option>
                  <option value="sage">sage</option>
                  <option value="shimmer">shimmer</option>
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
                  disabled={ttsBusy}
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
                disabled={ttsBusy}
                className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
              >
                {ttsBusy ? '儲存中…' : '儲存設定'}
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
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="accent-fuchsia-500"
                  checked={regenOptions.image}
                  onChange={(e) => setRegenOptions((prev) => ({ ...prev, image: e.target.checked }))}
                  disabled={regenAllBusy}
                />
                <span>圖檔</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="accent-fuchsia-500"
                  checked={regenOptions.script}
                  onChange={(e) => setRegenOptions((prev) => ({ ...prev, script: e.target.checked }))}
                  disabled={regenAllBusy}
                />
                <span>逐字稿</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="accent-fuchsia-500"
                  checked={regenOptions.audio}
                  onChange={(e) => setRegenOptions((prev) => ({ ...prev, audio: e.target.checked }))}
                  disabled={regenAllBusy}
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
                  disabled={regenAllBusy}
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
                disabled={regenAllBusy || !regenAnySelected}
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

const STEP_LABELS: Record<RegenStepName, string> = {
  script: '逐字稿',
  audio: '語音',
  image: '圖檔',
};

function RegenerateProgress({ job }: { job: RegenJobState | null }) {
  if (!job) return null;
  const currentStepIndex = Math.max(0, job.step_index);
  return (
    <div className="mb-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-200">
          重生進度
          {job.status === 'running' || job.status === 'pending' ? (
            <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400 align-middle" />
          ) : null}
        </span>
        <span className="text-[11px] text-slate-400">
          步驟 {Math.min(currentStepIndex + 1, job.steps.length)}/{job.steps.length}
          {` · `}
          {job.status === 'running'
            ? '執行中'
            : job.status === 'completed'
              ? '已完成'
              : job.status === 'failed'
                ? '失敗'
                : '等待中'}
        </span>
      </div>
      <ul className="space-y-1.5">
        {job.steps.map((s) => {
          const ratio = s.total > 0 ? Math.min(100, Math.round((s.completed / s.total) * 100)) : 0;
          const isCurrent = job.current_step === s.name;
          const color =
            s.status === 'failed'
              ? 'bg-rose-500'
              : s.status === 'completed'
                ? 'bg-emerald-500'
                : isCurrent
                  ? 'bg-cyan-500'
                  : 'bg-slate-600';
          return (
            <li key={s.name}>
              <div className="flex items-center justify-between">
                <span>
                  {STEP_LABELS[s.name]}
                  {isCurrent && s.status === 'running' ? '（進行中）' : ''}
                </span>
                <span className="tabular-nums text-slate-400">
                  {s.status === 'pending'
                    ? '等待中'
                    : s.status === 'failed'
                      ? `失敗：${s.error ?? '未知錯誤'}`
                      : `${s.completed}/${s.total} (${ratio}%)`}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${color} transition-all`}
                  style={{ width: `${s.status === 'completed' ? 100 : ratio}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
