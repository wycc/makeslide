import { useState, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  ApiError,
  addPdfFileSource,
  addPdfTextSource,
  fetchPagePrompt,
  updatePdfPrompt,
  type PageGenerationPrompt,
} from '../../lib/api';
import type { PdfDetail, PdfDetailPage } from '../../types';

interface UsePromptAndSourceParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  isReadOnlyProcessing: boolean;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
}

export interface PromptAndSourceState {
  promptInput: string;
  setPromptInput: Dispatch<SetStateAction<string>>;
  sourceTextName: string;
  setSourceTextName: Dispatch<SetStateAction<string>>;
  sourceTextContent: string;
  setSourceTextContent: Dispatch<SetStateAction<string>>;
  sourceBusy: boolean;
  sourceMsg: string | null;
  sourceErr: string | null;
  genPrompts: PageGenerationPrompt[];
  setGenPrompts: Dispatch<SetStateAction<PageGenerationPrompt[]>>;
  genPromptsLoading: boolean;
  setGenPromptsLoading: Dispatch<SetStateAction<boolean>>;
  expandedGenPrompt: string | null;
  setExpandedGenPrompt: Dispatch<SetStateAction<string | null>>;
  promptBusy: boolean;
  promptMsg: string | null;
  pagePrompts: Record<number, string>;
  handleSavePrompt: () => Promise<void>;
  handleAddTxtSource: () => Promise<void>;
  handleAddPdfSource: (file: File) => Promise<void>;
}

export function usePromptAndSource({
  pdfId,
  currentPage,
  isReadOnlyProcessing,
  setDetail,
}: UsePromptAndSourceParams): PromptAndSourceState {
  const [promptInput, setPromptInput] = useState('');
  const [sourceTextName, setSourceTextName] = useState('');
  const [sourceTextContent, setSourceTextContent] = useState('');
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceMsg, setSourceMsg] = useState<string | null>(null);
  const [sourceErr, setSourceErr] = useState<string | null>(null);
  const [genPrompts, setGenPrompts] = useState<PageGenerationPrompt[]>([]);
  const [genPromptsLoading, setGenPromptsLoading] = useState(false);
  const [expandedGenPrompt, setExpandedGenPrompt] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptMsg, setPromptMsg] = useState<string | null>(null);
  const [pagePrompts, setPagePrompts] = useState<Record<number, string>>({});

  // 換頁時從 pagePrompts cache 填入 promptInput
  useEffect(() => {
    const n = currentPage?.page_number;
    if (!n) {
      setPromptInput('');
      return;
    }
    setPromptInput(pagePrompts[n] ?? '');
  }, [currentPage?.page_number, pagePrompts]);

  // 換頁時從後端拉取該頁的 prompt
  useEffect(() => {
    if (!pdfId || !currentPage) return;
    const n = currentPage.page_number;
    let cancelled = false;
    fetchPagePrompt(pdfId, n)
      .then((res) => {
        if (cancelled) return;
        setPagePrompts((prev) => ({ ...prev, [n]: res.page_prompt ?? '' }));
      })
      .catch(() => {
        // keep local fallback
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, currentPage?.page_number]);

  const handleSavePrompt = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    setPromptBusy(true);
    setPromptMsg(null);
    try {
      const res = await updatePdfPrompt(pdfId, currentPage.page_number, promptInput);
      setPagePrompts((prev) => ({ ...prev, [res.page_number]: res.page_prompt ?? '' }));
      setDetail((prev) => (prev ? { ...prev, updated_at: res.updated_at } : prev));
      setPromptMsg('提示詞已更新');
    } catch (err) {
      setPromptMsg(err instanceof ApiError ? err.message : '更新提示詞失敗');
    } finally {
      setPromptBusy(false);
    }
  }, [pdfId, currentPage, promptInput, isReadOnlyProcessing, setDetail]);

  const handleAddTxtSource = useCallback(async () => {
    if (!pdfId) return;
    const content = sourceTextContent.trim();
    if (!content) {
      setSourceErr('請先輸入來源文字內容');
      return;
    }
    setSourceBusy(true);
    setSourceErr(null);
    setSourceMsg(null);
    try {
      const created = await addPdfTextSource(pdfId, {
        source_name: sourceTextName.trim() || undefined,
        content_text: content,
      });
      setDetail((prev) => {
        if (!prev) return prev;
        const prevSources = prev.sources ?? [];
        return { ...prev, sources: [...prevSources, created] };
      });
      setSourceTextContent('');
      setSourceMsg('已新增文字來源');
    } catch (err) {
      setSourceErr(err instanceof ApiError ? err.message : '新增文字來源失敗');
    } finally {
      setSourceBusy(false);
    }
  }, [pdfId, sourceTextContent, sourceTextName, setDetail]);

  const handleAddPdfSource = useCallback(
    async (file: File) => {
      if (!pdfId) return;
      setSourceBusy(true);
      setSourceErr(null);
      setSourceMsg(null);
      try {
        const created = await addPdfFileSource(pdfId, file);
        setDetail((prev) => {
          if (!prev) return prev;
          const prevSources = prev.sources ?? [];
          return { ...prev, sources: [...prevSources, created] };
        });
        setSourceMsg('已新增 PDF 來源');
      } catch (err) {
        setSourceErr(err instanceof ApiError ? err.message : '新增 PDF 來源失敗');
      } finally {
        setSourceBusy(false);
      }
    },
    [pdfId, setDetail],
  );

  return {
    promptInput,
    setPromptInput,
    sourceTextName,
    setSourceTextName,
    sourceTextContent,
    setSourceTextContent,
    sourceBusy,
    sourceMsg,
    sourceErr,
    genPrompts,
    setGenPrompts,
    genPromptsLoading,
    setGenPromptsLoading,
    expandedGenPrompt,
    setExpandedGenPrompt,
    promptBusy,
    promptMsg,
    pagePrompts,
    handleSavePrompt,
    handleAddTxtSource,
    handleAddPdfSource,
  };
}
