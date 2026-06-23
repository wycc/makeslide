import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import {
  fetchPdfDetail,
  fetchPlaybackSyncState,
  joinPlaybackSync,
  leavePlaybackSync,
  updatePlaybackSyncState,
} from '../lib/api/pdfs';
import type { PdfDetailPage } from '../types';

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
  const syncActiveRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
            <img src={imgSrc} alt={`第 ${currentPage} 頁`} className="h-28 rounded-lg object-contain shadow-lg" />
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
