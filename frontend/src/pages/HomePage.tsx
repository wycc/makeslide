import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  deletePdf,
  duplicatePdf,
  fetchPdfs,
  retryFailedPdf,
  startProcessing,
} from '../lib/api';
import type { PdfListItem, UploadResponse } from '../types';
import PdfCard from '../components/PdfCard';
import PromptModal from '../components/PromptModal';
import UploadButton from '../components/UploadButton';

const POLL_INTERVAL_ACTIVE_MS = 5000;
const POLL_INTERVAL_IDLE_MS = 30000;

interface PromptTarget {
  id: string;
  title: string | null;
  initialValue: string;
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<PdfListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [promptTarget, setPromptTarget] = useState<PromptTarget | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const list = await fetchPdfs();
      setItems(list);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '載入失敗';
      setError(msg);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Adaptive polling: 5s while any item is still processing, 30s otherwise.
  // `awaiting_prompt` is *not* considered active (server is idle waiting for
  // the user), so we stay on the slow cadence when all outstanding PDFs are
  // blocked on prompt input.
  useEffect(() => {
    const hasActive = items.some(
      (p) => p.status === 'uploaded' || p.status === 'processing',
    );
    const interval = hasActive ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, interval);
    return () => {
      window.clearInterval(timer);
    };
  }, [items, load]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deletePdf(id);
        setItems((prev) => prev.filter((p) => p.id !== id));
        showToast('已刪除');
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '刪除失敗';
        showToast(`刪除失敗：${msg}`);
      }
    },
    [showToast],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const copied = await duplicatePdf(id);
        setItems((prev) => [copied, ...prev]);
        showToast('已複製');
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '複製失敗';
        showToast(`複製失敗：${msg}`);
      }
    },
    [showToast],
  );

  const openPromptFor = useCallback((pdf: PdfListItem | UploadResponse) => {
    const title = 'title' in pdf ? pdf.title : null;
    const initial =
      'user_prompt' in pdf && typeof pdf.user_prompt === 'string'
        ? pdf.user_prompt
        : '';
    setPromptTarget({
      id: pdf.id,
      title,
      initialValue: initial,
    });
  }, []);

  useEffect(() => {
    const openPromptId = searchParams.get('openPrompt')?.trim();
    if (!openPromptId) return;
    const target = items.find((p) => p.id === openPromptId);
    if (!target) return;
    openPromptFor(target);
    const next = new URLSearchParams(searchParams);
    next.delete('openPrompt');
    setSearchParams(next, { replace: true });
  }, [items, openPromptFor, searchParams, setSearchParams]);

  const handleUploaded = useCallback(
    (resp: UploadResponse) => {
      // Refresh the list in the background so the new card (in
      // awaiting_prompt state) shows up immediately, then open the prompt
      // modal for the user.
      void load({ silent: true });
      openPromptFor(resp);
    },
    [load, openPromptFor],
  );

  const handlePromptSubmit = useCallback(
    async (
      prompt: string,
      requireScriptConfirmation: boolean,
      opts: {
        ttsVoice: string;
        ttsSpeed: number;
        scriptMaxCharsPerPage: number;
      },
    ) => {
      if (!promptTarget) return;
      await startProcessing(promptTarget.id, prompt, requireScriptConfirmation, opts);
      setPromptTarget(null);
      showToast(prompt ? '已送出提示詞，開始生成' : '使用預設風格，開始生成');
      void load({ silent: true });
    },
    [promptTarget, showToast, load],
  );

  const handlePromptClose = useCallback(() => {
    setPromptTarget(null);
  }, []);

  const handleCardClick = useCallback(
    (pdf: PdfListItem) => {
      if (pdf.status === 'awaiting_prompt') {
        openPromptFor(pdf);
        return;
      }
      if (pdf.status !== 'ready') {
        if (pdf.status === 'failed') {
          void (async () => {
            try {
              await retryFailedPdf(pdf.id);
              showToast('已重新排入處理佇列');
              await load({ silent: true });
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : '重試失敗';
              showToast(`重試失敗：${msg}`);
            }
          })();
          return;
        }
        showToast('尚未處理完成');
        return;
      }
      navigate(`/play/${pdf.id}`);
    },
    [navigate, openPromptFor, showToast],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">makeslide</h1>
            <p className="text-xs text-slate-400">PDF 語音簡報生成與播放（M2 預覽）</p>
          </div>
          <UploadButton onUploaded={handleUploaded} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {loading && items.length === 0 && (
          <p className="text-sm text-slate-400">載入中…</p>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
            <p className="text-slate-300">尚無任何 PDF</p>
            <p className="mt-1 text-sm text-slate-500">點擊右上角「上傳 PDF」開始使用</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((pdf) => (
              <PdfCard
                key={pdf.id}
                pdf={pdf}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onClick={handleCardClick}
              />
            ))}
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-100 shadow-lg ring-1 ring-slate-700">
          {toast}
        </div>
      )}

      {promptTarget && (
        <PromptModal
          pdfTitle={promptTarget.title}
          initialValue={promptTarget.initialValue}
          onSubmit={handlePromptSubmit}
          onClose={handlePromptClose}
        />
      )}
    </div>
  );
}
