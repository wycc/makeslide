import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadProgressPercent } from '../lib/uploadProgress';
import {
  ApiError,
  cancelAddPagesJob,
  continueAddPagesOutlineChat,
  fetchAddPagesStatus,
  startAddPagesFromPrompt,
  type AddPagesJobState,
  type AddPagesOutlineChatMessage,
} from '../lib/api';
import { useI18n, type TranslationKey } from '../i18n';

interface Props {
  pdfId: string;
  insertAfterPage: number;
  onClose: () => void;
  onDone: (totalPagesAfter: number) => void;
}

type Phase = 'mode-select' | 'outline-input' | 'review' | 'generating';
type Mode = 'manual' | 'ai';

const STEP_LABEL_KEYS: Record<string, TranslationKey> = {
  generating_outline: 'play.addPages.step.generatingOutline',
  rendering_images: 'play.addPages.step.renderingImages',
  generating_scripts: 'play.addPages.step.generatingScripts',
  synthesizing_audio: 'play.addPages.step.synthesizingAudio',
};

function formatMessage(template: string, replacements: Record<string, string | number>): string {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

const POLL_INTERVAL_MS = 2000;

export default function AddPagesFromPromptModal({
  pdfId,
  insertAfterPage,
  onClose,
  onDone,
}: Props) {
  const { t } = useI18n();
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
        setError(state.error ?? t('play.addPages.error.addFailed'));
      } else if (state.status === 'cancelled') {
        stopPolling();
      }
    } catch {
      // ignore transient poll errors
    }
  }, [pdfId, stopPolling, onDone, t]);

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
      setError(err instanceof ApiError ? err.message : t('play.addPages.error.aiFailed'));
    } finally {
      setIsChatting(false);
    }
  };

  const handleConfirmOutline = () => {
    const text = mode === 'manual' ? manualText.trim() : outlineText.trim();
    if (!text) {
      setError(t('play.addPages.error.outlineRequired'));
      return;
    }
    setOutlineText(text);
    setError(null);
    setPhase('review');
  };

  const handleStartGeneration = async () => {
    const text = outlineText.trim();
    if (!text) {
      setError(t('play.addPages.error.outlineEmpty'));
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
      setError(err instanceof ApiError ? err.message : t('play.addPages.error.startFailed'));
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

  const stepLabelKey = jobState?.step ? STEP_LABEL_KEYS[jobState.step] : undefined;
  const stepLabel = jobState?.step
    ? (stepLabelKey ? t(stepLabelKey) : jobState.step)
    : null;
  const progress = jobState?.progress;
  const progressPct =
    progress && progress.total > 0
      ? uploadProgressPercent(progress.current, progress.total)
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
          <h2 className="text-sm font-semibold text-slate-100">{t('play.addPages.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            aria-label={t('play.addPages.close')}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Phase: mode-select */}
          {phase === 'mode-select' && (
            <>
              <p className="mb-4 text-xs text-slate-400">
                {formatMessage(t('play.addPages.modeSelectDescription'), { page: insertAfterPage })}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { setMode('manual'); setPhase('outline-input'); }}
                  className="rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-left hover:border-slate-500 hover:bg-slate-800/60 transition"
                >
                  <span className="block text-sm font-medium text-slate-100">✏️ {t('play.addPages.manualModeTitle')}</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {t('play.addPages.manualModeDescription')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('ai'); setPhase('outline-input'); }}
                  className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-4 py-3 text-left hover:bg-indigo-500/20 transition"
                >
                  <span className="block text-sm font-medium text-indigo-100">✨ {t('play.addPages.aiModeTitle')}</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {t('play.addPages.aiModeDescription')}
                  </span>
                </button>
              </div>
            </>
          )}

          {/* Phase: outline-input (manual) */}
          {phase === 'outline-input' && mode === 'manual' && (
            <>
              <p className="mb-3 text-xs text-slate-400">
                {t('play.addPages.manualInstructionsPrefix')} <code className="rounded bg-slate-800 px-1">-</code> {t('play.addPages.manualInstructionsSuffix')}
              </p>
              <div className="mb-2 rounded bg-slate-800/60 px-3 py-2 text-xs text-slate-400 font-mono leading-5">
                {t('play.addPages.manualExampleTitle1')}<br />
                - {t('play.addPages.manualExampleBullet1')}<br />
                - {t('play.addPages.manualExampleBullet2')}<br />
                <br />
                {t('play.addPages.manualExampleTitle2')}<br />
                - {t('play.addPages.manualExampleBullet3')}<br />
                - {t('play.addPages.manualExampleBullet4')}
              </div>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={t('play.addPages.manualPlaceholder')}
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
                {t('play.addPages.aiInstructions')}
              </p>
              {chatMessages.length > 0 && (
                <div className="mb-3 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3">
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`text-xs leading-5 ${msg.role === 'user' ? 'text-slate-100' : 'text-indigo-200'}`}
                    >
                      <span className="font-semibold">{msg.role === 'user' ? t('play.addPages.chatRoleUser') : t('play.addPages.chatRoleAi')}：</span>
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  ))}
                  {isChatting && <p className="text-xs text-slate-500">{t('play.addPages.aiThinking')}</p>}
                  <div ref={chatBottomRef} />
                </div>
              )}
              {outlineText && (
                <div className="mb-3">
                  <p className="mb-1 text-xs text-slate-500">{t('play.addPages.outlinePreview')}</p>
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
                  placeholder={t('play.addPages.aiPlaceholder')}
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
                  {t('play.addPages.send')}
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            </>
          )}

          {/* Phase: review */}
          {phase === 'review' && (
            <>
              <p className="mb-2 text-xs text-slate-400">
                {formatMessage(t('play.addPages.reviewDescription'), { page: insertAfterPage })}
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
                    <span>{isCancelling ? t('play.addPages.cancelling') : (stepLabel ?? t('play.addPages.processing'))}</span>
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
                  <p className="mb-2 text-xs text-slate-400">{t('play.addPages.generatingPreview')}</p>
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
                              alt={formatMessage(t('play.addPages.pageAlt'), { page: pr.pageNumber })}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
                            </div>
                          )}
                          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-xs text-slate-300">
                            {formatMessage(t('play.addPages.pageBadge'), { page: pr.pageNumber })}
                          </span>
                        </div>
                        {/* Script preview */}
                        <div className="px-2 py-1.5">
                          {pr.scriptPreview ? (
                            <p className="line-clamp-3 text-xs leading-4 text-slate-400">
                              {pr.scriptPreview}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-600">{t('play.addPages.scriptGenerating')}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isDone && (
                <p className="text-sm text-emerald-300">
                  {formatMessage(t('play.addPages.success'), {
                    count: jobState.addedPageNumbers.length,
                    total: jobState.totalPagesAfter ?? 0,
                  })}
                </p>
              )}

              {isCancelled && (
                <p className="text-sm text-amber-300">{t('play.addPages.cancelled')}</p>
              )}

              {isFailed && (
                <p className="text-sm text-rose-400">
                  {formatMessage(t('play.addPages.failed'), { error: jobState?.error ?? t('play.addPages.unknownError') })}
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
                {t('play.addPages.cancel')}
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
                ← {t('play.addPages.back')}
              </button>
              <button
                type="button"
                onClick={handleConfirmOutline}
                disabled={mode === 'manual' ? !manualText.trim() : !outlineText.trim()}
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
              >
                {t('play.addPages.previewOutline')} →
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
                ← {t('play.addPages.backToEdit')}
              </button>
              <button
                type="button"
                onClick={() => void handleStartGeneration()}
                disabled={isSubmitting || !outlineText.trim()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSubmitting ? t('play.addPages.starting') : t('play.addPages.startGeneration')}
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
                  {isCancelling ? t('play.addPages.cancelingButton') : t('play.addPages.abortGeneration')}
                </button>
              )}
              {(isDone || isCancelled || isFailed) && (
                <button
                  type="button"
                  onClick={onClose}
                  className={`rounded-md px-4 py-2 text-sm font-medium text-white ${isDone ? 'bg-emerald-600 hover:bg-emerald-500' : 'border border-slate-600 text-slate-200 hover:bg-slate-800'}`}
                >
                  {isDone ? t('play.addPages.done') : t('play.addPages.close')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
