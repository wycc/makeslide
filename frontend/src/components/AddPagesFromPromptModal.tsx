import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  cancelAddPagesJob,
  continueAddPagesOutlineChat,
  fetchAddPagesStatus,
  startAddPagesFromPrompt,
  type AddPagesJobState,
  type AddPagesOutlineChatMessage,
} from '../lib/api';

interface Props {
  pdfId: string;
  insertAfterPage: number;
  onClose: () => void;
  onDone: (totalPagesAfter: number) => void;
}

type Phase = 'mode-select' | 'outline-input' | 'review' | 'generating';
type Mode = 'manual' | 'ai';

const STEP_LABELS: Record<string, string> = {
  generating_outline: '生成投影片大綱…',
  rendering_images: '生成頁面圖片…',
  generating_scripts: '生成逐字稿…',
  synthesizing_audio: '合成語音…',
};

const POLL_INTERVAL_MS = 2000;

export default function AddPagesFromPromptModal({
  pdfId,
  insertAfterPage,
  onClose,
  onDone,
}: Props) {
  const [phase, setPhase] = useState<Phase>('mode-select');
  const [mode, setMode] = useState<Mode>('ai');

  // Manual mode
  const [manualText, setManualText] = useState('');

  // AI mode
  const [chatMessages, setChatMessages] = useState<AddPagesOutlineChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  // Review phase
  const [outlineText, setOutlineText] = useState('');

  // Generation phase
  const [jobState, setJobState] = useState<AddPagesJobState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Common
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

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
      } else if (state.status === 'cancelled') {
        stopPolling();
      }
    } catch {
      // ignore transient poll errors
    }
  }, [pdfId, stopPolling, onDone]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleSendChat = async () => {
    const content = chatInput.trim();
    if (!content || isChatting) return;
    const nextMessages: AddPagesOutlineChatMessage[] = [
      ...chatMessages,
      { role: 'user', content },
    ];
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatting(true);
    setError(null);
    try {
      const resp = await continueAddPagesOutlineChat(pdfId, nextMessages, insertAfterPage);
      setOutlineText(resp.outline_text);
      setChatMessages([...nextMessages, { role: 'assistant', content: resp.assistant_message }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI 生成失敗，請稍後重試');
    } finally {
      setIsChatting(false);
    }
  };

  const handleConfirmOutline = () => {
    const text = mode === 'manual' ? manualText.trim() : outlineText.trim();
    if (!text) {
      setError('請先輸入或生成大綱內容');
      return;
    }
    setOutlineText(text);
    setError(null);
    setPhase('review');
  };

  const handleStartGeneration = async () => {
    const text = outlineText.trim();
    if (!text) {
      setError('大綱內容不可為空');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const state = await startAddPagesFromPrompt(pdfId, {
        prompt: '',
        outlineText: text,
        insertAfterPage,
      });
      setJobState(state);
      setPhase('generating');
      pollRef.current = window.setInterval(() => void pollStatus(), POLL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '啟動失敗，請稍後重試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await cancelAddPagesJob(pdfId);
      stopPolling();
      const state = await fetchAddPagesStatus(pdfId).catch(() => null);
      if (state) setJobState(state);
    } catch {
      // already cancelled or error — refetch state
      try {
        const state = await fetchAddPagesStatus(pdfId);
        setJobState(state);
      } catch {}
    } finally {
      setIsCancelling(false);
    }
  };

  const isRunning = jobState?.status === 'pending' || jobState?.status === 'running';
  const isDone = jobState?.status === 'done';
  const isFailed = jobState?.status === 'failed';
  const isCancelled = jobState?.status === 'cancelled';

  const stepLabel = jobState?.step ? (STEP_LABELS[jobState.step] ?? jobState.step) : null;
  const progress = jobState?.progress;
  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  const pageResults = jobState?.pageResults ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="mx-4 flex w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-100">從大綱新增多頁投影片</h2>
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

        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Phase: mode-select */}
          {phase === 'mode-select' && (
            <>
              <p className="mb-4 text-xs text-slate-400">
                新頁面會插入在目前第 {insertAfterPage} 頁之後。選擇輸入方式：
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { setMode('manual'); setPhase('outline-input'); }}
                  className="rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-left hover:border-slate-500 hover:bg-slate-800/60 transition"
                >
                  <span className="block text-sm font-medium text-slate-100">✏️ 手動輸入大綱</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    自行撰寫每頁的標題與重點，AI 依此生成圖片與語音
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('ai'); setPhase('outline-input'); }}
                  className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-4 py-3 text-left hover:bg-indigo-500/20 transition"
                >
                  <span className="block text-sm font-medium text-indigo-100">✨ AI 生成大綱</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    描述你想補充的主題，AI 根據現有簡報內容生成大綱
                  </span>
                </button>
              </div>
            </>
          )}

          {/* Phase: outline-input (manual) */}
          {phase === 'outline-input' && mode === 'manual' && (
            <>
              <p className="mb-3 text-xs text-slate-400">
                每個投影片以標題開頭，下一行起用 <code className="rounded bg-slate-800 px-1">-</code> 列重點，空白行分隔各頁。
              </p>
              <div className="mb-2 rounded bg-slate-800/60 px-3 py-2 text-xs text-slate-400 font-mono leading-5">
                深度學習應用<br />
                - CNN 圖像辨識<br />
                - RNN 序列處理<br />
                <br />
                模型訓練技巧<br />
                - 資料擴增<br />
                - 正則化方法
              </div>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="在此輸入大綱…"
                rows={10}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 outline-none focus:border-indigo-400"
              />
              {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            </>
          )}

          {/* Phase: outline-input (ai - chat) */}
          {phase === 'outline-input' && mode === 'ai' && (
            <>
              <p className="mb-3 text-xs text-slate-400">
                描述你想補充的主題，AI 會根據現有簡報內容生成大綱。可以多輪對話調整。
              </p>
              {chatMessages.length > 0 && (
                <div className="mb-3 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3">
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`text-xs leading-5 ${msg.role === 'user' ? 'text-slate-100' : 'text-indigo-200'}`}
                    >
                      <span className="font-semibold">{msg.role === 'user' ? '你' : 'AI'}：</span>
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  ))}
                  {isChatting && <p className="text-xs text-slate-500">AI 思考中…</p>}
                  <div ref={chatBottomRef} />
                </div>
              )}
              {outlineText && (
                <div className="mb-3">
                  <p className="mb-1 text-xs text-slate-500">目前大綱預覽：</p>
                  <pre className="max-h-40 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300 leading-5 whitespace-pre-wrap">
                    {outlineText}
                  </pre>
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendChat();
                    }
                  }}
                  placeholder="例如：新增一節介紹深度學習應用，包含 CNN、RNN 和 Transformer 的比較"
                  rows={3}
                  disabled={isChatting}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 outline-none focus:border-indigo-400 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleSendChat()}
                  disabled={isChatting || !chatInput.trim()}
                  className="self-end rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                >
                  送出
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            </>
          )}

          {/* Phase: review */}
          {phase === 'review' && (
            <>
              <p className="mb-2 text-xs text-slate-400">
                確認或修改大綱後，點擊「開始生成」。新頁面將插入在第 {insertAfterPage} 頁之後。
              </p>
              <textarea
                value={outlineText}
                onChange={(e) => setOutlineText(e.target.value)}
                rows={14}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 outline-none focus:border-indigo-400"
              />
              {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            </>
          )}

          {/* Phase: generating */}
          {phase === 'generating' && (
            <div className="space-y-4">
              {/* Step + progress bar */}
              {(isRunning || isCancelling) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                    <span>{isCancelling ? '正在取消…' : (stepLabel ?? '處理中…')}</span>
                  </div>
                  {progressPct !== null && !isCancelling && (
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
                </div>
              )}

              {/* Per-page preview grid */}
              {pageResults.length > 0 && (
                <div>
                  <p className="mb-2 text-xs text-slate-400">生成中的頁面預覽：</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {pageResults.map((pr) => (
                      <div
                        key={pr.pageNumber}
                        className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
                      >
                        {/* Image area */}
                        <div className="relative aspect-[3/2] w-full bg-slate-800">
                          {pr.imageDone ? (
                            <img
                              src={`api/pdfs/${encodeURIComponent(pdfId)}/pages/${pr.pageNumber}/thumbnail`}
                              alt={`第 ${pr.pageNumber} 頁`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
                            </div>
                          )}
                          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-xs text-slate-300">
                            第 {pr.pageNumber} 頁
                          </span>
                        </div>
                        {/* Script preview */}
                        <div className="px-2 py-1.5">
                          {pr.scriptPreview ? (
                            <p className="line-clamp-3 text-xs leading-4 text-slate-400">
                              {pr.scriptPreview}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-600">逐字稿生成中…</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isDone && (
                <p className="text-sm text-emerald-300">
                  已成功新增 {jobState.addedPageNumbers.length} 頁！（總頁數：{jobState.totalPagesAfter}）
                </p>
              )}

              {isCancelled && (
                <p className="text-sm text-amber-300">已取消。已完成的頁面已儲存。</p>
              )}

              {isFailed && (
                <p className="text-sm text-rose-400">
                  新增失敗：{jobState?.error ?? '未知錯誤'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-5 py-3">
          {phase === 'mode-select' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                取消
              </button>
            </div>
          )}

          {phase === 'outline-input' && (
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => { setPhase('mode-select'); setError(null); }}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                ← 返回
              </button>
              <button
                type="button"
                onClick={handleConfirmOutline}
                disabled={mode === 'manual' ? !manualText.trim() : !outlineText.trim()}
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
              >
                預覽大綱 →
              </button>
            </div>
          )}

          {phase === 'review' && (
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => { setPhase('outline-input'); setError(null); }}
                className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                ← 返回修改
              </button>
              <button
                type="button"
                onClick={() => void handleStartGeneration()}
                disabled={isSubmitting || !outlineText.trim()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSubmitting ? '啟動中…' : '開始生成'}
              </button>
            </div>
          )}

          {phase === 'generating' && (
            <div className="flex justify-between">
              {isRunning && (
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={isCancelling}
                  className="rounded-md border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  {isCancelling ? '取消中…' : '中斷生成'}
                </button>
              )}
              {(isDone || isCancelled || isFailed) && (
                <button
                  type="button"
                  onClick={onClose}
                  className={`rounded-md px-4 py-2 text-sm font-medium text-white ${isDone ? 'bg-emerald-600 hover:bg-emerald-500' : 'border border-slate-600 text-slate-200 hover:bg-slate-800'}`}
                >
                  {isDone ? '完成' : '關閉'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
