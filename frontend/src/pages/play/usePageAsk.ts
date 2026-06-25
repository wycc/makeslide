import { useState, useCallback } from 'react';
import { askPageQuestion, ApiError, type PageAskMessage } from '../../lib/api';

export interface PageAskState {
  pageAskInput: string;
  setPageAskInput: (v: string) => void;
  // Full multi-turn conversation (user + assistant), oldest first.
  pageAskMessages: PageAskMessage[];
  pageAskBusy: boolean;
  pageAskError: string | null;
  setPageAskError: (v: string | null) => void;
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
  const [pageAskInput, setPageAskInput] = useState('');
  const [pageAskMessages, setPageAskMessages] = useState<PageAskMessage[]>([]);
  const [pageAskBusy, setPageAskBusy] = useState(false);
  const [pageAskError, setPageAskError] = useState<string | null>(null);

  const handleAskPage = useCallback(async () => {
    if (!pdfId || currentPageNumber == null || !pageAskInput.trim()) return;
    const question = pageAskInput.trim();
    const history = pageAskMessages;
    setPageAskBusy(true);
    setPageAskError(null);
    // Optimistically show the question; clear the input for the next follow-up.
    setPageAskMessages((prev) => [...prev, { role: 'user', content: question }]);
    setPageAskInput('');
    try {
      const result = await askPageQuestion(pdfId, currentPageNumber, question, shareToken || undefined, history);
      setPageAskMessages((prev) => [...prev, { role: 'assistant', content: result.answer }]);
    } catch (err) {
      // Roll back the optimistic question so the user can retry.
      setPageAskMessages((prev) => prev.slice(0, -1));
      setPageAskInput(question);
      setPageAskError(err instanceof ApiError ? err.message : '問答失敗，請稍後再試');
    } finally {
      setPageAskBusy(false);
    }
  }, [pdfId, currentPageNumber, pageAskInput, pageAskMessages, shareToken]);

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
    handleAskPage,
    clearPageAsk,
  };
}
