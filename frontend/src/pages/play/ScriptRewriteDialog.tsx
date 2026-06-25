import { useState } from 'react';
import { ApiError, rewritePageScript } from '../../lib/api';
import type { ChatMessage, PdfDetailPage } from '../../types';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';

const HISTORY_REQUEST_LIMIT = 20;

/**
 * Builds the previous/current/next script context for a rewrite request from the
 * deck state. Pure so it can be unit-tested without rendering. `currentScript`
 * is the latest editor draft (already-applied rewrites), while previous/next
 * come from the saved `scripts` map by page number.
 */
export function buildRewriteContext(
  currentIdx: number,
  deckPages: PdfDetailPage[],
  scripts: Record<number, string>,
  currentScript: string,
): { previousScript: string; currentScript: string; nextScript: string } {
  const prevPage = currentIdx > 0 ? deckPages[currentIdx - 1]?.page_number ?? -1 : -1;
  const nextPage = currentIdx < deckPages.length - 1 ? deckPages[currentIdx + 1]?.page_number ?? -1 : -1;
  return {
    previousScript: (scripts[prevPage] ?? '').trim(),
    currentScript: currentScript.trim(),
    nextScript: (scripts[nextPage] ?? '').trim(),
  };
}

export function ScriptRewriteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const {
    pdfId,
    currentPage,
    currentIdx,
    deckPages,
    scripts,
    editingScript,
    setEditingScript,
    isReadOnlyProcessing,
  } = usePlayPageContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSend = async () => {
    if (isReadOnlyProcessing || busy) return;
    const prompt = input.trim();
    if (!pdfId || !currentPage || !prompt) return;
    const sourceScript = editingScript.trim();
    setBusy(true);
    setError(null);
    const historyForRequest = messages.slice(-HISTORY_REQUEST_LIMIT);
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setInput('');
    try {
      const res = await rewritePageScript(
        pdfId,
        currentPage.page_number,
        prompt,
        sourceScript,
        buildRewriteContext(currentIdx, deckPages, scripts, sourceScript),
        historyForRequest,
      );
      setEditingScript(res.script);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.script }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('play.scriptRewrite.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="script-rewrite-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <h2 id="script-rewrite-title" className="text-lg font-semibold text-fuchsia-200">
              {t('play.scriptRewrite.title')}
            </h2>
            <p className="mt-1 text-xs text-slate-400">{t('play.scriptRewrite.intro')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMessages([])}
              disabled={busy || messages.length === 0}
              className="rounded-md border border-rose-500/50 bg-rose-500/15 px-2.5 py-1 text-xs text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('play.scriptRewrite.clear')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              {t('play.scriptRewrite.close')}
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">{t('play.scriptRewrite.empty')}</p>
          ) : (
            messages.map((m, idx) => (
              <div
                key={idx}
                className={
                  m.role === 'user'
                    ? 'ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-fuchsia-500/20 px-3 py-2 text-sm text-fuchsia-100'
                    : 'mr-auto max-w-[90%] rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200'
                }
              >
                <div className="mb-1 text-[11px] uppercase opacity-70">
                  {m.role === 'user' ? t('play.scriptRewrite.roleUser') : t('play.scriptRewrite.roleAssistant')}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.role === 'assistant' ? (
                  <div className="mt-1 text-[11px] text-emerald-300">{t('play.scriptRewrite.applied')}</div>
                ) : null}
              </div>
            ))
          )}
          {busy ? <p className="text-xs text-slate-400">{t('play.scriptRewrite.sending')}</p> : null}
          {error ? <p className="text-xs text-rose-300">{error}</p> : null}
        </div>

        <div className="border-t border-slate-800 p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={3}
            disabled={isReadOnlyProcessing || busy}
            placeholder={t('play.scriptRewrite.inputPlaceholder')}
            className="w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={isReadOnlyProcessing || busy || !input.trim()}
              className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? t('play.scriptRewrite.sending') : t('play.scriptRewrite.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
