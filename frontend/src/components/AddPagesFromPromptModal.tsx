import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  fetchAddPagesStatus,
  startAddPagesFromPrompt,
  type AddPagesJobState,
} from '../lib/api';

interface Props {
  pdfId: string;
  onClose: () => void;
  onDone: (totalPagesAfter: number) => void;
}

const STEP_LABELS: Record<string, string> = {
  generating_outline: '生成投影片大綱…',
  rendering_images: '生成頁面圖片…',
  generating_scripts: '生成逐字稿…',
  synthesizing_audio: '合成語音…',
};

const POLL_INTERVAL_MS = 2500;

export default function AddPagesFromPromptModal({ pdfId, onClose, onDone }: Props) {
  const [prompt, setPrompt] = useState('');
  const [jobState, setJobState] = useState<AddPagesJobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const state = await fetchAddPagesStatus(pdfId);
      setJobState(state);
      if (state.status === 'done') {
        stopPolling();
        onDone(state.totalPagesAfter ?? 0);
      } else if (state.status === 'failed') {
        stopPolling();
        setError(state.error ?? '新增失敗，請稍後重試');
      }
    } catch {
      // ignore transient poll errors
    }
  }, [pdfId, stopPolling, onDone]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleSubmit = async () => {
    const content = prompt.trim();
    if (!content) {
      setError('請輸入要新增的頁面需求');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const state = await startAddPagesFromPrompt(pdfId, content);
      setJobState(state);
      pollRef.current = window.setInterval(() => void pollStatus(), POLL_INTERVAL_MS);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('啟動失敗，請稍後重試');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRunning =
    jobState?.status === 'pending' || jobState?.status === 'running';
  const isDone = jobState?.status === 'done';
  const isFailed = jobState?.status === 'failed';

  const stepLabel = jobState?.step ? (STEP_LABELS[jobState.step] ?? jobState.step) : null;
  const progress = jobState?.progress;
  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">從提示詞新增多頁</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        <p className="mb-3 text-xs text-slate-400">
          描述你想新增的內容主題，AI 會根據現有簡報內容生成 2～8 頁新投影片，並自動完成圖片、逐字稿和語音。
        </p>

        {!isRunning && !isDone && (
          <>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：新增一節介紹深度學習應用，包含 CNN、RNN 和 Transformer 的比較"
              className="h-32 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 outline-none focus:border-indigo-400 disabled:opacity-50"
              disabled={isSubmitting}
            />
            {error && (
              <p className="mt-2 text-xs text-rose-400">{error}</p>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || !prompt.trim()}
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? '啟動中…' : '開始生成'}
              </button>
            </div>
          </>
        )}

        {isRunning && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              <span>{stepLabel ?? '處理中…'}</span>
            </div>
            {progressPct !== null && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-400">
                  <span>{progress?.current} / {progress?.total}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">
              生成圖片與語音需要一些時間，請稍候…
            </p>
          </div>
        )}

        {isDone && (
          <div className="space-y-3">
            <p className="text-sm text-emerald-300">
              已成功新增 {jobState.addedPageNumbers.length} 頁！
              （總頁數：{jobState.totalPagesAfter}）
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                完成
              </button>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="space-y-3">
            <p className="text-sm text-rose-400">
              新增失敗：{jobState?.error ?? '未知錯誤'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                關閉
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
