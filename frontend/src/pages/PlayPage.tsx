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
  clearPageChatHistory,
  fetchPdfDetail,
  fetchPageChatHistory,
  regeneratePageAudio,
} from '../lib/api';
import type { ChatMessage, PdfDetail, PdfDetailPage } from '../types';

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
  const [finished, setFinished] = useState(false);
  const [editingScript, setEditingScript] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

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

  const pages = detail?.pages ?? [];
  const readyPages: PdfDetailPage[] = useMemo(
    () => pages.filter((p) => !!p.audio_url && !!p.image_url),
    [pages],
  );
  const currentPage: PdfDetailPage | null = readyPages[currentIdx] ?? null;
  const totalPages = readyPages.length;

  // ---- Fetch all scripts once pages are ready ----
  useEffect(() => {
    if (readyPages.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        readyPages.map(async (p) => {
          if (!p.script_url) return [p.page_number, ''] as const;
          try {
            const resp = await fetch(p.script_url);
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
  }, [readyPages]);

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
    const next = readyPages[currentIdx + 1];
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
  }, [currentIdx, readyPages]);

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
          <h1 className="flex-1 truncate text-center text-base font-semibold">
            {detail.title ?? detail.original_filename}
          </h1>
          <div className="w-20 text-right text-sm text-slate-400">
            頁 {currentIdx + 1}/{totalPages}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 gap-4 px-4 py-4">
        {/* Left: player + script */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
          {/* Slide image */}
          <section className="flex flex-1 items-center justify-center px-4 py-6">
            <div className="flex h-full w-full max-w-4xl items-center justify-center">
              {currentPage?.image_url ? (
                <img
                  key={currentPage.page_number}
                  src={currentPage.image_url}
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

        {/* Right: LLM chat panel */}
        <aside className="flex max-h-[calc(100vh-7rem)] w-[360px] shrink-0 flex-col overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40">
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
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-slate-800 p-3">
            <div className="flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
              placeholder="問這一頁的重點、名詞、推論…"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500/40 placeholder:text-slate-500 focus:ring"
            />
            <button
              type="button"
              onClick={() => void handleSendChat()}
              disabled={chatBusy || !chatInput.trim()}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chatBusy ? '送出中…' : '送出'}
            </button>
            </div>
            {chatError ? <p className="mt-1 text-xs text-rose-300">{chatError}</p> : null}
          </div>
        </aside>
      </main>
    </div>
  );
}
