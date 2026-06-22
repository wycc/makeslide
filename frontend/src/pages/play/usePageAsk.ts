import { useState, useCallback } from 'react';
import { askPageQuestion, ApiError } from '../../lib/api';

export interface PageAskState {
  pageAskInput: string;
  setPageAskInput: (v: string) => void;
  pageAskAnswer: string | null;
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
  const [pageAskAnswer, setPageAskAnswer] = useState<string | null>(null);
  const [pageAskBusy, setPageAskBusy] = useState(false);
  const [pageAskError, setPageAskError] = useState<string | null>(null);

  const handleAskPage = useCallback(async () => {
    if (!pdfId || currentPageNumber == null || !pageAskInput.trim()) return;
    setPageAskBusy(true);
    setPageAskError(null);
    try {
      const result = await askPageQuestion(pdfId, currentPageNumber, pageAskInput.trim(), shareToken || undefined);
      setPageAskAnswer(result.answer);
    } catch (err) {
      setPageAskError(err instanceof ApiError ? err.message : '問答失敗，請稍後再試');
    } finally {
      setPageAskBusy(false);
    }
  }, [pdfId, currentPageNumber, pageAskInput, shareToken]);

  const clearPageAsk = useCallback(() => {
    setPageAskInput('');
    setPageAskAnswer(null);
    setPageAskError(null);
  }, []);

  return {
    pageAskInput,
    setPageAskInput,
    pageAskAnswer,
    pageAskBusy,
    pageAskError,
    setPageAskError,
    handleAskPage,
    clearPageAsk,
  };
}
