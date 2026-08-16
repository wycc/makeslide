import { useState, useCallback, useRef } from 'react';
import { askPageQuestion, mapApiErrorToHumanMessage, type PageAskMessage } from '../../lib/api';
import { useI18n } from '../../i18n';
import { interpolateTemplate } from '../../lib/interpolateTemplate';

export type PageAskVerbosity = 'brief' | 'detailed';

type TFn = ReturnType<typeof useI18n>['t'];

/** Turn a tool call into a localized, human-readable note shown in the tutor bubble. */
function describeToolCall(call: { name: string; args: Record<string, unknown> }, t: TFn): string {
  const page = typeof call.args.page === 'number' ? call.args.page : Number(call.args.page);
  const hasPage = Number.isInteger(page) && page > 0;
  switch (call.name) {
    case 'get_page_text':
      return hasPage ? interpolateTemplate(t('play.sidebar.pageAsk.toolGetPageText'), { page }) : t('play.sidebar.pageAsk.toolGeneric');
    case 'get_page_script':
      return hasPage ? interpolateTemplate(t('play.sidebar.pageAsk.toolGetPageScript'), { page }) : t('play.sidebar.pageAsk.toolGeneric');
    case 'get_page_image':
      return hasPage ? interpolateTemplate(t('play.sidebar.pageAsk.toolGetPageImage'), { page }) : t('play.sidebar.pageAsk.toolGeneric');
    case 'get_presentation':
      return t('play.sidebar.pageAsk.toolGetPresentation');
    case 'list_presentations':
      return t('play.sidebar.pageAsk.toolListPresentations');
    default:
      return interpolateTemplate(t('play.sidebar.pageAsk.toolGenericNamed'), { name: call.name });
  }
}

export interface PageAskState {
  pageAskInput: string;
  setPageAskInput: (v: string) => void;
  // Full multi-turn conversation (user + assistant), oldest first.
  pageAskMessages: PageAskMessage[];
  pageAskBusy: boolean;
  pageAskError: string | null;
  setPageAskError: (v: string | null) => void;
  // Answer-length preference sent with each question (default 'detailed').
  pageAskVerbosity: PageAskVerbosity;
  setPageAskVerbosity: (v: PageAskVerbosity) => void;
  handleAskPage: () => Promise<void>;
  clearPageAsk: () => void;
  cancelAskPage: () => void;
}

export function usePageAsk({
  pdfId,
  currentPageNumber,
  shareToken,
}: {
  pdfId: string | undefined;
  currentPageNumber: number | null;
  shareToken: string;
}): PageAskState {
  const { t } = useI18n();
  const [pageAskInput, setPageAskInput] = useState('');
  const [pageAskMessages, setPageAskMessages] = useState<PageAskMessage[]>([]);
  const [pageAskBusy, setPageAskBusy] = useState(false);
  const [pageAskError, setPageAskError] = useState<string | null>(null);
  const [pageAskVerbosity, setPageAskVerbosity] = useState<PageAskVerbosity>('detailed');
  // Lets handleAskPage's in-flight request be cancelled by the user (cancelAskPage) or by a
  // fresh question superseding it; cleared once the request settles either way.
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleAskPage = useCallback(async () => {
    if (!pdfId || currentPageNumber == null || !pageAskInput.trim()) return;
    const question = pageAskInput.trim();
    const history = pageAskMessages;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPageAskBusy(true);
    setPageAskError(null);
    // Optimistically show the question plus an empty assistant bubble that fills in
    // token-by-token as the SSE stream arrives; clear the input for the next follow-up.
    setPageAskMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setPageAskInput('');
    try {
      const result = await askPageQuestion(
        pdfId,
        currentPageNumber,
        question,
        shareToken || undefined,
        history,
        pageAskVerbosity,
        // Append each streamed chunk to the last (assistant) message as it arrives.
        (delta) => setPageAskMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        }),
        // Record each tool the tutor calls as a human-readable note on the pending answer.
        (call) => setPageAskMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, toolNotes: [...(last.toolNotes ?? []), describeToolCall(call, t)] };
          }
          return next;
        }),
        controller.signal,
      );
      // Replace the streamed raw text with the server-normalized final answer.
      setPageAskMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: result.answer };
        return next;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User-initiated cancellation: keep whatever streamed so far as the final answer
        // instead of rolling it back — that's the whole point of "stop, but keep this".
        return;
      }
      // Roll back the optimistic question + assistant placeholder so the user can retry.
      setPageAskMessages((prev) => prev.slice(0, -2));
      setPageAskInput(question);
      // Route the backend error through the shared human-readable mapper (code-aware,
      // localized) instead of surfacing the raw backend message.
      setPageAskError(mapApiErrorToHumanMessage(err, t).message);
    } finally {
      setPageAskBusy(false);
      abortControllerRef.current = null;
    }
  }, [pdfId, currentPageNumber, pageAskInput, pageAskMessages, shareToken, pageAskVerbosity, t]);

  const cancelAskPage = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearPageAsk = useCallback(() => {
    setPageAskInput('');
    setPageAskMessages([]);
    setPageAskError(null);
  }, []);

  return {
    pageAskInput,
    setPageAskInput,
    pageAskMessages,
    pageAskBusy,
    pageAskError,
    setPageAskError,
    pageAskVerbosity,
    setPageAskVerbosity,
    handleAskPage,
    clearPageAsk,
    cancelAskPage,
  };
}
