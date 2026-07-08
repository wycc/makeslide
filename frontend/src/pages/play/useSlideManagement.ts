import { useState, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  ApiError,
  addSlide,
  deleteSlide,
  moveSlide,
  replaceSlideImage,
  updatePdfCoverFromPage,
} from '../../lib/api';
import { savePageNotebook, generatePageNotebook, fetchPageNotebook } from '../../lib/api/pdfs';
import { defaultNbNotebook } from '../../lib/nbformatModel';
import {
  notebookDownloadFilename,
  serializeNotebookFile,
  parseNotebookFile,
  MAX_IPYNB_UPLOAD_BYTES,
} from '../../lib/notebookFile';
import type { PdfDetailPage } from '../../types';
import { useI18n } from '../../i18n';
import { clamp } from '../../lib/clamp';
import { cleanTranscriptForReview } from '../../lib/transcriptReview';

interface UseSlideManagementParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  currentIdx: number;
  totalPages: number;
  isReadOnlyProcessing: boolean;
  /** Deck title, used only to name the exported `.ipynb` file. */
  deckTitle?: string | null;
  /** Current page's transcript, passed as context when AI-generating a notebook (phase 5c). */
  currentPageScript?: string | null;
  reloadDetail: () => Promise<void>;
  setCurrentIdx: Dispatch<SetStateAction<number>>;
  // 新增/刪除/搬移頁面都會讓既有頁碼重新編號，批次重生的頁碼選取集合（純粹存 page_number）
  // 若不清空，會在重新編號後悄悄指向不同的頁面，讓使用者誤以為自己選的頁面不變、實際卻重生了別的頁。
  setRegenSelectedPages: Dispatch<SetStateAction<Set<number>>>;
}

export interface SlideManagementState {
  slideBusy: boolean;
  setSlideBusy: Dispatch<SetStateAction<boolean>>;
  slideError: string | null;
  setSlideError: Dispatch<SetStateAction<string | null>>;
  handleAddSlideAfterCurrent: () => void;
  handleDeleteCurrentSlide: () => void;
  handleMoveSlide: (fromPageNumber: number, toPageNumber: number) => void;
  handleReplaceImageFile: (file: File, targetPageNumber?: number) => void;
  handleUpdateCoverFromCurrentPage: () => void;
  handleConvertCurrentPageToNotebook: () => void;
  handleGenerateNotebookForCurrentPage: () => void;
  handleExportCurrentPageNotebook: () => void;
  handleImportNotebookFile: (file: File) => void;
}

export function useSlideManagement({
  pdfId,
  currentPage,
  currentIdx,
  totalPages,
  isReadOnlyProcessing,
  deckTitle,
  currentPageScript,
  reloadDetail,
  setCurrentIdx,
  setRegenSelectedPages,
}: UseSlideManagementParams): SlideManagementState {
  const { t } = useI18n();
  const [slideBusy, setSlideBusy] = useState(false);
  const [slideError, setSlideError] = useState<string | null>(null);

  const handleAddSlideAfterCurrent = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      const res = await addSlide(pdfId, currentPage.page_number);
      await reloadDetail();
      setCurrentIdx(res.page_number - 1);
      setRegenSelectedPages(new Set());
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.addFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing, reloadDetail, setCurrentIdx, setRegenSelectedPages, t]);

  const handleDeleteCurrentSlide = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    if (!window.confirm(t('play.slideManagement.deleteConfirm').replace('{page}', String(currentPage.page_number)))) return;
    setSlideBusy(true);
    setSlideError(null);
    const idxBeforeDelete = currentIdx;
    const totalBeforeDelete = totalPages;
    try {
      await deleteSlide(pdfId, currentPage.page_number);
      await reloadDetail();
      setCurrentIdx(clamp(idxBeforeDelete, 0, totalBeforeDelete - 2));
      setRegenSelectedPages(new Set());
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.deleteFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, currentIdx, totalPages, isReadOnlyProcessing, reloadDetail, setCurrentIdx, setRegenSelectedPages, t]);

  const handleMoveSlide = useCallback(
    async (fromPageNumber: number, toPageNumber: number) => {
      if (isReadOnlyProcessing) return;
      if (!pdfId || fromPageNumber === toPageNumber) return;
      setSlideBusy(true);
      setSlideError(null);
      try {
        await moveSlide(pdfId, fromPageNumber, toPageNumber);
        await reloadDetail();
        setCurrentIdx(Math.max(0, toPageNumber - 1));
        setRegenSelectedPages(new Set());
      } catch (err) {
        setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.moveFailed'));
      } finally {
        setSlideBusy(false);
      }
    },
    [pdfId, reloadDetail, isReadOnlyProcessing, setCurrentIdx, setRegenSelectedPages, t],
  );

  const handleReplaceImageFile = useCallback(
    async (file: File, targetPageNumber?: number) => {
      if (isReadOnlyProcessing) return;
      if (!pdfId || !currentPage) return;
      const pageNumber = targetPageNumber ?? currentPage.page_number;
      setSlideBusy(true);
      setSlideError(null);
      try {
        await replaceSlideImage(pdfId, pageNumber, file);
        await reloadDetail();
      } catch (err) {
        setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.replaceImageFailed'));
      } finally {
        setSlideBusy(false);
      }
    },
    [pdfId, currentPage, reloadDetail, isReadOnlyProcessing, t],
  );

  // 把目前頁轉成互動式 Jupyter notebook：寫入一份預設的空 notebook，後端 PUT 端點會把該頁的
  // render_type 翻成 'notebook' 並記錄 notebook_path，reload 後 SlideRenderer 即改用 NotebookPanel。
  // 原本的圖片資產仍保留（只是不再作為呈現方式），故以確認對話框避免誤觸。
  const handleConvertCurrentPageToNotebook = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    if (currentPage.render_type === 'notebook') return;
    if (!window.confirm(t('play.slideManagement.convertToNotebookConfirm').replace('{page}', String(currentPage.page_number)))) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      await savePageNotebook(pdfId, currentPage.page_number, defaultNbNotebook());
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.convertToNotebookFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing, reloadDetail, t]);

  // 由使用者輸入的主題，請後端 AI 產生一整頁可執行的 notebook（後端 generate 端點也會把該頁翻成
  // notebook 頁）。以 window.prompt 取得主題；空白則取消。產生較慢，故沿用 slideBusy 顯示忙碌。
  const handleGenerateNotebookForCurrentPage = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const topic = window.prompt(t('play.slideManagement.generateNotebookPrompt'))?.trim();
    if (!topic) return;
    // Pass the page's existing transcript (if any, cleaned of review markup) as context so the AI
    // notebook fits the page; backend truncates it further.
    const context = cleanTranscriptForReview(currentPageScript).trim() || undefined;
    setSlideBusy(true);
    setSlideError(null);
    try {
      await generatePageNotebook(pdfId, currentPage.page_number, topic, context);
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.generateNotebookFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing, currentPageScript, reloadDetail, t]);

  // 匯出：下載目前頁的 `.ipynb`（重用既有 GET notebook 端點；讀取權限即可，故不擋唯讀觀看者）。
  const handleExportCurrentPageNotebook = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      const res = await fetchPageNotebook(pdfId, currentPage.page_number);
      const blob = new Blob([serializeNotebookFile(res.notebook)], { type: 'application/x-ipynb+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = notebookDownloadFilename(deckTitle, currentPage.page_number);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.exportNotebookFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, deckTitle, t]);

  // 匯入：讀使用者選的 `.ipynb`，經 PUT notebook 端點寫回（後端 validateNotebook 驗證＋翻 render_type），
  // 使該頁成為 notebook 頁並載入檔案內容。需編輯權限。
  const handleImportNotebookFile = useCallback(async (file: File) => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    if (file.size > MAX_IPYNB_UPLOAD_BYTES) {
      setSlideError(t('play.slideManagement.importNotebookTooLarge'));
      return;
    }
    setSlideBusy(true);
    setSlideError(null);
    try {
      const parsed = parseNotebookFile(await file.text());
      if (!parsed.ok) {
        setSlideError(t('play.slideManagement.importNotebookInvalid'));
        return;
      }
      await savePageNotebook(pdfId, currentPage.page_number, parsed.notebook);
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.importNotebookFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing, reloadDetail, t]);

  const handleUpdateCoverFromCurrentPage = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    if (!currentPage.image_url) {
      setSlideError(t('play.slideManagement.coverNoImage'));
      return;
    }
    setSlideBusy(true);
    setSlideError(null);
    try {
      await updatePdfCoverFromPage(pdfId, currentPage.page_number);
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.slideManagement.coverUpdateFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [pdfId, currentPage, reloadDetail, t]);

  return {
    slideBusy,
    setSlideBusy,
    slideError,
    setSlideError,
    handleAddSlideAfterCurrent,
    handleDeleteCurrentSlide,
    handleMoveSlide,
    handleReplaceImageFile,
    handleUpdateCoverFromCurrentPage,
    handleConvertCurrentPageToNotebook,
    handleGenerateNotebookForCurrentPage,
    handleExportCurrentPageNotebook,
    handleImportNotebookFile,
  };
}
