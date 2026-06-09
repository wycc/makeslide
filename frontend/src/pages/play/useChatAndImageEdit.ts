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
        setChatError(err instanceof ApiError ? err.message : '讀取問答紀錄失敗');
      })
      .finally(() => {
        if (!cancelled) setChatBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, currentPage?.page_number]);

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
    const nextHistory = [...chatHistory, { role: 'user' as const, content: question }];
    setChatHistory(nextHistory);
    setChatInput('');
    setChatBusy(true);
    setChatError(null);
    try {
      const res = await chatWithPageContext(
        pdfId,
        currentPage.page_number,
        question,
        limitChatHistoryForRequest(chatHistory),
      );
      setChatHistory((prev) => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : '對話失敗');
    } finally {
      setChatBusy(false);
    }
  }, [pdfId, currentPage, chatInput, chatHistory, isReadOnlyProcessing]);

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
      setChatError(err instanceof ApiError ? err.message : '清除問答失敗');
    } finally {
      setChatBusy(false);
    }
  }, [pdfId, currentPage, isReadOnlyProcessing]);

  const handleInpaintImage = useCallback(async () => {
    if (isReadOnlyProcessing || !pdfId || !currentPage) return;
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
        currentPage.page_number,
        maskFile,
        chatPastedImage,
        prompt,
      );
      const preview = `${res.image_url}?t=${encodeURIComponent(res.updated_at)}`;
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: `${IMAGE_MSG_PREFIX}${preview}` },
      ]);
      clearChatPastedImage();
      clearImageEditRegion();
      setImageEditSelectMode(false);
    } catch (err) {
      setChatHistory(chatHistory);
      setChatInpaintError(err instanceof ApiError ? err.message : '修改圖片失敗');
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
  ]);

  const handleRegenerateImageWithPrompt = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
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
        currentPage.page_number,
        merged,
        limitChatHistoryForRequest(chatHistory),
      );
      const preview = `${res.image_url}${res.image_url.includes('?') ? '&' : '?'}t=${encodeURIComponent(res.updated_at)}`;
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: `${IMAGE_MSG_PREFIX}${preview}` },
      ]);
    } catch (err) {
      setChatHistory(chatHistory);
      setSlideError(err instanceof ApiError ? err.message : '修改圖片失敗');
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
      setSlideError(err instanceof ApiError ? err.message : '套用圖片失敗');
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
