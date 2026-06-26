import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import {
  ApiError,
  chatWithPageContext,
  clearPageChatHistory,
  fetchPageChatHistory,
  inpaintImage,
  regenerateSlideImage,
  replaceSlideImage,
} from '../../lib/api';
import type { ChatMessage, PdfDetailPage } from '../../types';
import { useI18n } from '../../i18n';

const CHAT_HISTORY_REQUEST_LIMIT = 20;
export const IMAGE_MSG_PREFIX = '[image] ';

function limitChatHistoryForRequest(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-CHAT_HISTORY_REQUEST_LIMIT);
}

interface UseChatAndImageEditParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  isReadOnlyProcessing: boolean;
  deckImageStylePrompt: string;
  setSlideBusy: Dispatch<SetStateAction<boolean>>;
  setSlideError: Dispatch<SetStateAction<string | null>>;
  reloadDetail: () => Promise<void>;
  imageEditRegionOverlayRef: RefObject<HTMLDivElement | null>;
}

export interface ChatAndImageEditState {
  chatHistory: ChatMessage[];
  setChatHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  chatInput: string;
  setChatInput: Dispatch<SetStateAction<string>>;
  chatBusy: boolean;
  chatError: string | null;
  setChatError: Dispatch<SetStateAction<string | null>>;
  hasChatInput: boolean;
  chatPastedImage: File | null;
  setChatPastedImage: Dispatch<SetStateAction<File | null>>;
  chatPastedImageUrl: string | null;
  setChatPastedImageUrl: Dispatch<SetStateAction<string | null>>;
  chatInpaintBusy: boolean;
  chatInpaintError: string | null;
  setChatInpaintError: Dispatch<SetStateAction<string | null>>;
  imageEditSelectMode: boolean;
  setImageEditSelectMode: Dispatch<SetStateAction<boolean>>;
  imageEditRegion: { x: number; y: number; w: number; h: number } | null;
  setImageEditRegion: Dispatch<SetStateAction<{ x: number; y: number; w: number; h: number } | null>>;
  imagePreviewUrl: string | null;
  setImagePreviewUrl: Dispatch<SetStateAction<string | null>>;
  imagePreviewPageNumber: number | null;
  setImagePreviewPageNumber: Dispatch<SetStateAction<number | null>>;
  imagePreviewOpen: boolean;
  setImagePreviewOpen: Dispatch<SetStateAction<boolean>>;
  handleSendChat: () => Promise<void>;
  handleClearChat: () => Promise<void>;
  clearChatPastedImage: () => void;
  clearImageEditRegion: () => void;
  handleInpaintImage: () => Promise<void>;
  handleRegenerateImageWithPrompt: () => Promise<void>;
  handleApplyPreviewImage: () => Promise<void>;
}

export function useChatAndImageEdit({
  pdfId,
  currentPage,
  isReadOnlyProcessing,
  deckImageStylePrompt,
  setSlideBusy,
  setSlideError,
  reloadDetail,
  imageEditRegionOverlayRef,
}: UseChatAndImageEditParams): ChatAndImageEditState {
  const { t } = useI18n();
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatPastedImage, setChatPastedImage] = useState<File | null>(null);
  const [chatPastedImageUrl, setChatPastedImageUrl] = useState<string | null>(null);
  const [chatInpaintBusy, setChatInpaintBusy] = useState(false);
  const [chatInpaintError, setChatInpaintError] = useState<string | null>(null);
  const [imageEditSelectMode, setImageEditSelectMode] = useState(false);
  const [imageEditRegion, setImageEditRegion] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewPageNumber, setImagePreviewPageNumber] = useState<number | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);

  // 換頁時重新拉取聊天紀錄
  // 使用 ref 暫存 currentPage.page_number 避免 closure stale 問題
  const currentPageNumberRef = useRef<number | null>(null);

  // 卸載時釋放尚未送出/清除的貼上圖片 object URL，避免離開播放頁時洩漏 blob。
  // 用 ref 追蹤最新 URL，讓 [] 相依的 cleanup 能取得卸載當下的值；session 內的
  // 重新貼上/清除已由 clearChatPastedImage 先行 revoke，故不會重複釋放。
  const chatPastedImageUrlRef = useRef<string | null>(null);
  chatPastedImageUrlRef.current = chatPastedImageUrl;
  useEffect(() => () => {
    if (chatPastedImageUrlRef.current) URL.revokeObjectURL(chatPastedImageUrlRef.current);
  }, []);
  useEffect(() => {
    if (!pdfId || !currentPage) return;
    currentPageNumberRef.current = currentPage.page_number;
    let cancelled = false;
    setChatBusy(true);
    setChatError(null);
    fetchPageChatHistory(pdfId, currentPage.page_number)
      .then((res) => {
        if (cancelled) return;
        setChatHistory(res.history);
        setChatInput('');
      })
      .catch((err) => {
        if (cancelled) return;
        setChatHistory([]);
        setChatError(err instanceof ApiError ? err.message : t('play.sidebar.qa.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setChatBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, currentPage?.page_number, t]);

  const hasChatInput = chatInput.trim().length > 0;

  const clearChatPastedImage = useCallback(() => {
    if (chatPastedImageUrl) URL.revokeObjectURL(chatPastedImageUrl);
    setChatPastedImage(null);
    setChatPastedImageUrl(null);
    setChatInpaintError(null);
  }, [chatPastedImageUrl]);

  const clearImageEditRegion = useCallback(() => {
    setImageEditRegion(null);
    const overlay = imageEditRegionOverlayRef.current;
    if (overlay) overlay.style.display = 'none';
  }, [imageEditRegionOverlayRef]);

  const handleSendChat = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const question = chatInput.trim();
    if (!question) return;
    // 記住送出當下的頁碼：聊天屬於長時間的非同步呼叫，若使用者在等待回覆時切到別的頁面，
    // 換頁的效果（上方）會先把 chatHistory 換成新頁面的紀錄，這裡的回覆若不檢查頁碼就直接
    // append，會把舊頁面問題的回答誤植到新頁面的對話顯示裡（伺服器端的紀錄不受影響，純粹是
    // 前端畫面顯示錯了對話串）。
    const pageNumberAtSend = currentPage.page_number;
    const nextHistory = [...chatHistory, { role: 'user' as const, content: question }];
    setChatHistory(nextHistory);
    setChatInput('');
    setChatBusy(true);
    setChatError(null);
    try {
      const res = await chatWithPageContext(
        pdfId,
        pageNumberAtSend,
        question,
        limitChatHistoryForRequest(chatHistory),
      );
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      setChatHistory((prev) => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (err) {
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      setChatError(err instanceof ApiError ? err.message : t('play.sidebar.qa.chatFailed'));
    } finally {
      setChatBusy(false);
    }
  }, [pdfId, currentPage, chatInput, chatHistory, isReadOnlyProcessing, t]);

  const handleClearChat = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    setChatBusy(true);
    setChatError(null);
    try {
      await clearPageChatHistory(pdfId, currentPage.page_number);
      setChatHistory([]);
      setChatInput('');
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : t('play.sidebar.qa.clearFailed'));
    } finally {
      setChatBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing, t]);

  const handleInpaintImage = useCallback(async () => {
    if (isReadOnlyProcessing || !pdfId || !currentPage) return;
    const pageNumberAtSend = currentPage.page_number;
    const prompt = chatInput.trim() || '根據指示修改投影片圖片';

    // Generate mask PNG at 1536×1024 (same as the slide image size used by the API)
    let maskFile: File | null = null;
    if (imageEditRegion) {
      const W = 1536,
        H = 1024;
      const mc = document.createElement('canvas');
      mc.width = W;
      mc.height = H;
      const mctx = mc.getContext('2d');
      if (mctx) {
        mctx.fillStyle = 'white'; // white = keep
        mctx.fillRect(0, 0, W, H);
        mctx.clearRect(
          // transparent = modify
          Math.round(imageEditRegion.x * W),
          Math.round(imageEditRegion.y * H),
          Math.round(imageEditRegion.w * W),
          Math.round(imageEditRegion.h * H),
        );
        const maskBlob: Blob | null = await new Promise((resolve) =>
          mc.toBlob(resolve, 'image/png'),
        );
        if (maskBlob) maskFile = new File([maskBlob], 'mask.png', { type: 'image/png' });
      }
    }

    const regionNote = imageEditRegion ? '（標示區域）' : '';
    const refNote = chatPastedImage ? '（含參考圖）' : '';
    const nextHistory = [
      ...chatHistory,
      { role: 'user' as const, content: `【修改投影片圖片${regionNote}${refNote}】${prompt}` },
    ];
    setChatHistory(nextHistory);
    setChatInpaintBusy(true);
    setChatInpaintError(null);
    try {
      const res = await inpaintImage(
        pdfId,
        pageNumberAtSend,
        maskFile,
        chatPastedImage,
        prompt,
      );
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      const preview = `${res.image_url}?t=${encodeURIComponent(res.updated_at)}`;
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: `${IMAGE_MSG_PREFIX}${preview}` },
      ]);
      clearChatPastedImage();
      clearImageEditRegion();
      setImageEditSelectMode(false);
    } catch (err) {
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      setChatHistory(chatHistory);
      setChatInpaintError(err instanceof ApiError ? err.message : t('play.sidebar.qa.imageEditFailed'));
    } finally {
      setChatInpaintBusy(false);
    }
  }, [
    isReadOnlyProcessing,
    pdfId,
    currentPage,
    chatInput,
    imageEditRegion,
    chatPastedImage,
    chatHistory,
    clearChatPastedImage,
    clearImageEditRegion,
    t,
  ]);

  const handleRegenerateImageWithPrompt = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const pageNumberAtSend = currentPage.page_number;
    const trimmed = chatInput.trim() || '保留版型，讓文字更清晰、重點更聚焦';
    const merged = [
      `整份圖片風格（固定套用）：\n${deckImageStylePrompt.trim() || '(無)'}`,
      `單張調整需求：\n${trimmed}`,
    ].join('\n\n');
    setSlideBusy(true);
    setSlideError(null);
    try {
      const nextHistory = [
        ...chatHistory,
        { role: 'user' as const, content: `【修改圖片】${trimmed}` },
      ];
      setChatHistory(nextHistory);
      const res = await regenerateSlideImage(
        pdfId,
        pageNumberAtSend,
        merged,
        limitChatHistoryForRequest(chatHistory),
      );
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      const preview = `${res.image_url}${res.image_url.includes('?') ? '&' : '?'}t=${encodeURIComponent(res.updated_at)}`;
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: `${IMAGE_MSG_PREFIX}${preview}` },
      ]);
    } catch (err) {
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      setChatHistory(chatHistory);
      setSlideError(err instanceof ApiError ? err.message : t('play.sidebar.qa.imageEditFailed'));
    } finally {
      setSlideBusy(false);
    }
  }, [
    pdfId,
    currentPage,
    chatInput,
    chatHistory,
    deckImageStylePrompt,
    isReadOnlyProcessing,
    setSlideBusy,
    setSlideError,
    t,
  ]);

  const handleApplyPreviewImage = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !imagePreviewUrl || !imagePreviewPageNumber) return;
    setSlideBusy(true);
    setSlideError(null);
    try {
      const resp = await fetch(imagePreviewUrl);
      if (!resp.ok) throw new Error('Failed to fetch preview image');
      const blob = await resp.blob();
      const file = new File([blob], `page-${imagePreviewPageNumber}-candidate.jpg`, {
        type: blob.type || 'image/jpeg',
      });
      await replaceSlideImage(pdfId, imagePreviewPageNumber, file);
      await reloadDetail();
    } catch (err) {
      setSlideError(err instanceof ApiError ? err.message : t('play.sidebar.qa.imageApplyFailed'));
    } finally {
      setSlideBusy(false);
    }
    setImagePreviewOpen(false);
  }, [
    pdfId,
    imagePreviewUrl,
    imagePreviewPageNumber,
    reloadDetail,
    isReadOnlyProcessing,
    setSlideBusy,
    setSlideError,
    t,
  ]);

  return {
    chatHistory,
    setChatHistory,
    chatInput,
    setChatInput,
    chatBusy,
    chatError,
    setChatError,
    hasChatInput,
    chatPastedImage,
    setChatPastedImage,
    chatPastedImageUrl,
    setChatPastedImageUrl,
    chatInpaintBusy,
    chatInpaintError,
    setChatInpaintError,
    imageEditSelectMode,
    setImageEditSelectMode,
    imageEditRegion,
    setImageEditRegion,
    imagePreviewUrl,
    setImagePreviewUrl,
    imagePreviewPageNumber,
    setImagePreviewPageNumber,
    imagePreviewOpen,
    setImagePreviewOpen,
    handleSendChat,
    handleClearChat,
    clearChatPastedImage,
    clearImageEditRegion,
    handleInpaintImage,
    handleRegenerateImageWithPrompt,
    handleApplyPreviewImage,
  };
}
