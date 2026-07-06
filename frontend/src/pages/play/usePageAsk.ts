import { useState, useCallback } from 'react';
import { askPageQuestion, mapApiErrorToHumanMessage, type PageAskMessage } from '../../lib/api';
import { useI18n } from '../../i18n';

export type PageAskVerbosity = 'brief' | 'detailed';

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

  const handleAskPage = useCallback(async () => {
    if (!pdfId || currentPageNumber == null || !pageAskInput.trim()) return;
    const question = pageAskInput.trim();
    const history = pageAskMessages;
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
      );
      // Replace the streamed raw text with the server-normalized final answer.
      setPageAskMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: result.answer };
        return next;
      });
    } catch (err) {
      // Roll back the optimistic question + assistant placeholder so the user can retry.
      setPageAskMessages((prev) => prev.slice(0, -2));
      setPageAskInput(question);
      // Route the backend error through the shared human-readable mapper (code-aware,
      // localized) instead of surfacing the raw backend message.
      setPageAskError(mapApiErrorToHumanMessage(err, t).message);
    } finally {
      setPageAskBusy(false);
    }
  }, [pdfId, currentPageNumber, pageAskInput, pageAskMessages, shareToken, pageAskVerbosity, t]);

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
  };
}
