import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import {
  fetchPagePolls,
  fetchPdfDetail,
  fetchPlaybackSyncState,
  joinPlaybackSync,
  leavePlaybackSync,
  updatePagePoll,
  updatePlaybackSyncState,
} from '../lib/api/pdfs';
import type { PagePoll, PdfDetailPage } from '../types';
import { pollOptionPercent } from '../lib/pollPercent';
import { formatPollResultsMarkdown } from '../lib/pollResultsMarkdown';
import { copyTextToClipboard } from '../lib/clipboard';

const REMOTE_DRAWING_COLOR = '#ef4444';
const REMOTE_DRAWING_LINE_WIDTH = 8; // ref-space units (REF_H = 1080)

const POLL_INTERVAL_MS = 2000;

export default function RemoteControllerPage() {
  const { id: pdfId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [title, setTitle] = useState('');
  const [pages, setPages] = useState<PdfDetailPage[]>([]);
  const [clientId] = useState(() => `remote-${Math.random().toString(36).slice(2, 10)}`);
  const [syncActive, setSyncActive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [onlineCount, setOnlineCount] = useState(0);
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [polls, setPolls] = useState<PagePoll[]>([]);
  const [pollsLoading, setPollsLoading] = useState(false);
  const [togglingPollId, setTogglingPollId] = useState<number | null>(null);
  const [pollCopyMsg, setPollCopyMsg] = useState<string | null>(null);

  const syncActiveRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drawing canvas refs (all drawing state in refs to avoid re-renders on every pointer event)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingStrokesRef = useRef<[number, number][][]>([]);
  const currentStrokeRef = useRef<[number, number][]>([]);
  const isDrawingRef = useRef(false);
  const drawPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    syncActiveRef.current = syncActive;
  }, [syncActive]);

  useEffect(() => {
    if (!pdfId) return;
    void (async () => {
      try {
        const detail = await fetchPdfDetail(pdfId);
        setTitle(detail.title ?? detail.original_filename);
        setPages(detail.pages);
        setLoading(false);
      } catch {
        setError(t('remote.loadError'));
        setLoading(false);
      }
    })();
  }, [pdfId, t]);

  useEffect(() => {
    const page = pages.find((p) => p.page_number === currentPage);
    if (!page?.script_url) {
      setScript('');
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const resp = await fetch(page.script_url!);
        if (alive && resp.ok) setScript(await resp.text());
        else if (alive) setScript('');
      } catch {
        if (alive) setScript('');
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentPage, pages]);

  // Fetch polls for current page
  useEffect(() => {
    if (!pdfId) return;
    let alive = true;
    setPollsLoading(true);
    setPolls([]);
    void (async () => {
      try {
        const data = await fetchPagePolls(pdfId, currentPage);
        if (alive) setPolls(data);
      } catch {
        if (alive) setPolls([]);
      } finally {
        if (alive) setPollsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdfId, currentPage]);

  useEffect(() => {
    if (!syncActive || !pdfId) return;
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const state = await fetchPlaybackSyncState(pdfId, clientId);
          setCurrentPage(state.page_number);
          setOnlineCount(state.online_count ?? 0);
        } catch {
          // ignore transient errors
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [syncActive, pdfId, clientId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pdfId && syncActiveRef.current) {
        void leavePlaybackSync(pdfId, clientId);
      }
    };
  }, [pdfId, clientId]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const paintStroke = (pts: [number, number][]) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = REMOTE_DRAWING_COLOR;
      ctx.lineWidth = (REMOTE_DRAWING_LINE_WIDTH / 1080) * canvas.height;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const p0 = pts[0];
      if (!p0) return;
      ctx.moveTo(p0[0] * canvas.width, p0[1] * canvas.height);
      for (let i = 1; i < pts.length; i++) {
        const pi = pts[i];
        if (!pi) continue;
        ctx.lineTo(pi[0] * canvas.width, pi[1] * canvas.height);
      }
      ctx.stroke();
    };
    for (const stroke of drawingStrokesRef.current) paintStroke(stroke);
    paintStroke(currentStrokeRef.current);
  }, []);

  const pushDrawingToSync = useCallback(() => {
    if (!syncActiveRef.current || !pdfId) return;
    if (drawPushTimerRef.current) clearTimeout(drawPushTimerRef.current);
    drawPushTimerRef.current = setTimeout(() => {
      const strokes = drawingStrokesRef.current.map((pts) => ({
        color: REMOTE_DRAWING_COLOR,
        lineWidth: REMOTE_DRAWING_LINE_WIDTH,
        points: pts,
      }));
      void updatePlaybackSyncState(pdfId, clientId, {
        page_number: currentPage,
        is_playing: false,
        current_time: 0,
        drawing_page_number: currentPage,
        drawing_json: JSON.stringify({ strokes }),
      }).catch(() => { /* ignore transient errors */ });
    }, 100);
  }, [pdfId, clientId, currentPage]);

  const clearDrawing = useCallback(() => {
    drawingStrokesRef.current = [];
    currentStrokeRef.current = [];
    renderCanvas();
    if (syncActiveRef.current && pdfId) {
      void updatePlaybackSyncState(pdfId, clientId, {
        page_number: currentPage,
        is_playing: false,
        current_time: 0,
        drawing_page_number: currentPage,
        drawing_json: JSON.stringify({ strokes: [] }),
      }).catch(() => { /* ignore */ });
    }
  }, [pdfId, clientId, currentPage, renderCanvas]);

  const getNormCoords = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  };

  const handleCanvasPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    currentStrokeRef.current = [getNormCoords(e)];
    renderCanvas();
  };

  const handleCanvasPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    currentStrokeRef.current.push(getNormCoords(e));
    renderCanvas();
  };

  const handleCanvasPointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const pts = currentStrokeRef.current;
    if (pts.length > 1) {
      drawingStrokesRef.current = [...drawingStrokesRef.current, pts];
      pushDrawingToSync();
    }
    currentStrokeRef.current = [];
    renderCanvas();
  };

  // Clear drawing strokes when page changes
  useEffect(() => {
    drawingStrokesRef.current = [];
    currentStrokeRef.current = [];
    renderCanvas();
  }, [currentPage, renderCanvas]);

  // Resize canvas to match its CSS dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width) || 1;
      const h = Math.round(rect.height) || 1;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        renderCanvas();
      }
    });
    observer.observe(canvas);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width) || 300;
    canvas.height = Math.round(rect.height) || 169;
    return () => observer.disconnect();
  }, [renderCanvas]);

  const handleStartSync = async () => {
    if (!pdfId) return;
    try {
      const state = await joinPlaybackSync(pdfId, clientId);
      setCurrentPage(state.page_number);
      setOnlineCount(state.online_count ?? 0);
      setSyncActive(true);
    } catch {
      setError(t('remote.joinError'));
    }
  };

  const handleEndSync = async () => {
    if (!pdfId) return;
    setSyncActive(false);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      await leavePlaybackSync(pdfId, clientId);
    } catch {
      // ignore
    }
  };

  const handleGoToPage = async (page: number) => {
    setCurrentPage(page);
    if (!pdfId || !syncActive) return;
    try {
      await updatePlaybackSyncState(pdfId, clientId, {
        page_number: page,
        is_playing: false,
        current_time: 0,
      });
    } catch {
      // ignore
    }
  };

  const handleCopyPollResults = async () => {
    const md = formatPollResultsMarkdown(polls, {
      heading: t('remote.pollControl.title'),
      votesUnit: t('remote.votesSuffix'),
    });
    const ok = await copyTextToClipboard(md);
    setPollCopyMsg(ok ? t('remote.pollControl.copyDone') : t('remote.pollControl.copyFail'));
    window.setTimeout(() => setPollCopyMsg(null), 2000);
  };

  const handleTogglePoll = async (poll: PagePoll) => {
    if (!pdfId || togglingPollId != null) return;
    setTogglingPollId(poll.id);
    try {
      const updated = await updatePagePoll(pdfId, poll.id, { is_active: !poll.is_active });
      setPolls((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      // ignore
    } finally {
      setTogglingPollId(null);
    }
  };

  const totalPages = pages.length;
  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <p className="text-slate-400">{t('remote.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100">
        <p className="text-rose-400">{error}</p>
        <button
          type="button"
          className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
          onClick={() => navigate(-1)}
        >
          {t('remote.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 select-none">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(`/play/${pdfId ?? ''}`)}
          className="text-slate-400 hover:text-slate-200 text-sm"
        >
          ← {t('remote.back')}
        </button>
        <span className="max-w-[55%] truncate text-sm font-medium text-slate-200">{title}</span>
        <span className="text-xs text-emerald-400 min-w-[4rem] text-right">
          {syncActive ? t('remote.online').replace('{n}', String(onlineCount)) : ''}
        </span>
      </div>

      <div className="flex flex-col items-center gap-4 py-8">
        {(() => {
          const page = pages[currentPage - 1];
          const imgSrc = page?.thumbnail_url ?? page?.image_url;
          return imgSrc ? (
            <img src={imgSrc} alt={`${t('remote.slideAltPrefix')}${currentPage}${t('remote.slideAltSuffix')}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-28 rounded-lg object-contain shadow-lg" />
          ) : null;
        })()}
        <div className="flex items-center">
          <span className="text-7xl font-bold tabular-nums text-slate-100 leading-none">
            {currentPage}
          </span>
          <span className="mx-4 text-3xl text-slate-600">/</span>
          <span className="text-3xl tabular-nums text-slate-400">{totalPages}</span>
        </div>
      </div>

      <div className="flex gap-4 px-6">
        <button
          type="button"
          onClick={() => void handleGoToPage(currentPage - 1)}
          disabled={!canPrev}
          className="flex-1 rounded-2xl border border-slate-700 bg-slate-800 py-10 text-4xl font-bold text-slate-200 disabled:opacity-25 active:bg-slate-700 transition-colors"
          aria-label={t('remote.prevPage')}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => void handleGoToPage(currentPage + 1)}
          disabled={!canNext}
          className="flex-1 rounded-2xl border border-slate-700 bg-slate-800 py-10 text-4xl font-bold text-slate-200 disabled:opacity-25 active:bg-slate-700 transition-colors"
          aria-label={t('remote.nextPage')}
        >
          ›
        </button>
      </div>

      {script && (
        <div className="mx-4 mt-6 max-h-40 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-300 leading-relaxed">
          {script}
        </div>
      )}

      {/* Poll control section */}
      <div className="mx-4 mt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('remote.pollControl.title')}
          </p>
          {polls.length > 0 && (
            <button
              type="button"
              onClick={() => void handleCopyPollResults()}
              className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              {pollCopyMsg ?? t('remote.pollControl.copyResults')}
            </button>
          )}
        </div>
        {pollsLoading ? (
          <p className="text-xs text-slate-500">{t('remote.pollControl.loading')}</p>
        ) : polls.length === 0 ? (
          <p className="text-xs text-slate-600">{t('remote.pollControl.noPolls')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {polls.map((poll) => (
              <div
                key={poll.id}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-slate-200">{poll.question}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {poll.is_active ? t('remote.pollControl.statusOpen') : t('remote.pollControl.statusClosed')}
                      {' · '}{poll.total_votes}{t('remote.votesSuffix')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={togglingPollId === poll.id}
                    onClick={() => void handleTogglePoll(poll)}
                    className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      poll.is_active
                        ? 'bg-rose-600/80 text-white active:bg-rose-700'
                        : 'bg-emerald-600/80 text-white active:bg-emerald-700'
                    }`}
                  >
                    {togglingPollId === poll.id
                      ? '…'
                      : poll.is_active
                        ? t('remote.pollControl.close')
                        : t('remote.pollControl.open')}
                  </button>
                </div>
                {poll.options.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {poll.options.map((option, idx) => {
                      const ratio = pollOptionPercent(option.votes, poll.total_votes);
                      return (
                        <div key={`${poll.id}-${idx}`}>
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
                            <span className="truncate">{option.text}</span>
                            <span className="flex-shrink-0 font-mono text-[10px] text-slate-400">
                              {option.votes}{t('remote.votesSuffix')} · {ratio}%
                            </span>
                          </div>
                          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full rounded-full bg-cyan-400 transition-[width] duration-300" style={{ width: `${ratio}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawing canvas section — shown only while sync is active */}
      {syncActive && (
        <div className="mx-4 mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('remote.drawing.title')}
            </p>
            <button
              type="button"
              onClick={clearDrawing}
              className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 active:bg-slate-700"
            >
              {t('remote.drawing.clear')}
            </button>
          </div>
          <canvas
            ref={canvasRef}
            className="w-full rounded-xl border border-slate-700 bg-slate-900"
            style={{ height: '180px', touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
          />
          <p className="mt-1 text-center text-[10px] text-slate-600">
            {t('remote.drawing.hint')}
          </p>
        </div>
      )}

      <div className="mt-auto px-6 pb-10 pt-8">
        {!syncActive ? (
          <button
            type="button"
            onClick={() => void handleStartSync()}
            className="w-full rounded-2xl bg-emerald-600 py-5 text-base font-semibold text-white active:bg-emerald-700 transition-colors"
          >
            {t('remote.startSync')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleEndSync()}
            className="w-full rounded-2xl bg-rose-600/80 py-5 text-base font-semibold text-white active:bg-rose-700 transition-colors"
          >
            {t('remote.endSync')}
          </button>
        )}
      </div>
    </div>
  );
}
