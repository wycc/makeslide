import { useState, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  ApiError,
  createPdfShare,
  regeneratePdfTitle,
  syncPresentationToGitHub,
  updatePdfVisibility,
  updatePdfScriptSettings,
  updatePdfTitle,
  updatePdfTtsSettings,
  type ShareAccessMode,
} from '../../lib/api';
import {
  DEFAULT_TTS_VOICE_BY_PROVIDER,
  TTS_VOICES_BY_PROVIDER,
  type TtsProvider,
} from '../../lib/ttsVoices';
import type { PdfDetail } from '../../types';

interface UsePdfMetadataParams {
  pdfId: string | undefined;
  isReadOnlyProcessing: boolean;
  detail: PdfDetail | null;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
}

export interface PdfMetadataState {
  // title
  titleInput: string;
  setTitleInput: Dispatch<SetStateAction<string>>;
  titleBusy: boolean;
  titleMsg: string | null;
  // TTS
  ttsProvider: TtsProvider;
  availableTtsVoices: readonly string[];
  ttsVoice: string;
  setTtsVoice: Dispatch<SetStateAction<string>>;
  ttsSpeed: number;
  setTtsSpeed: Dispatch<SetStateAction<number>>;
  scriptMaxCharsPerPage: number | null;
  setScriptMaxCharsPerPage: Dispatch<SetStateAction<number | null>>;
  hostMode: 'solo' | 'dual';
  setHostMode: Dispatch<SetStateAction<'solo' | 'dual'>>;
  ttsBusy: boolean;
  ttsMsg: string | null;
  ttsDialogOpen: boolean;
  setTtsDialogOpen: Dispatch<SetStateAction<boolean>>;
  // share
  shareMessage: string | null;
  setShareMessage: Dispatch<SetStateAction<string | null>>;
  shareError: string | null;
  setShareError: Dispatch<SetStateAction<string | null>>;
  shareAccess: ShareAccessMode;
  setShareAccess: Dispatch<SetStateAction<ShareAccessMode>>;
  shareBusy: boolean;
  shareDialogOpen: boolean;
  setShareDialogOpen: Dispatch<SetStateAction<boolean>>;
  shareUrl: string;
  setShareUrl: Dispatch<SetStateAction<string>>;
  playQrCodeUrl: string | null;
  setPlayQrCodeUrl: Dispatch<SetStateAction<string | null>>;
  // github
  githubSyncBusy: boolean;
  githubSyncMessage: string | null;
  githubSyncError: string | null;
  // handlers
  handleSaveTitle: () => void;
  handleRegenerateTitle: () => void;
  handleSaveTtsSettings: () => void;
  handleCreateShareLink: () => void;
  handleMakeSharePrivate: () => void;
  handleShowPlayQrCode: () => void;
  handleSyncToGithub: () => void;
}

export function usePdfMetadata({
  pdfId,
  isReadOnlyProcessing,
  detail,
  setDetail,
}: UsePdfMetadataParams): PdfMetadataState {
  const [titleInput, setTitleInput] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [scriptMaxCharsPerPage, setScriptMaxCharsPerPage] = useState<number | null>(null);
  const [hostMode, setHostMode] = useState<'solo' | 'dual'>('solo');
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);
  const [ttsDialogOpen, setTtsDialogOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareAccess, setShareAccess] = useState<ShareAccessMode>('read_only');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [playQrCodeUrl, setPlayQrCodeUrl] = useState<string | null>(null);
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
  const [githubSyncMessage, setGithubSyncMessage] = useState<string | null>(null);
  const [githubSyncError, setGithubSyncError] = useState<string | null>(null);

  const ttsProvider: TtsProvider = detail?.tts_provider === 'gemini' ? 'gemini' : 'openai';
  const availableTtsVoices = TTS_VOICES_BY_PROVIDER[ttsProvider];

  // 語音提供者切換時，若目前選中的音色不在新清單中則重設為預設值。
  useEffect(() => {
    if (availableTtsVoices.some((voice) => voice === ttsVoice)) return;
    setTtsVoice(DEFAULT_TTS_VOICE_BY_PROVIDER[ttsProvider]);
  }, [availableTtsVoices, ttsProvider, ttsVoice]);

  const handleSaveTitle = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    const nextTitle = titleInput.trim();
    if (!nextTitle) {
      setTitleMsg('標題不可為空');
      return;
    }
    setTitleBusy(true);
    setTitleMsg(null);
    try {
      const res = await updatePdfTitle(pdfId, nextTitle);
      setDetail((prev) =>
        prev ? { ...prev, title: res.title, updated_at: res.updated_at } : prev,
      );
      setTitleMsg('標題已更新');
    } catch (err) {
      setTitleMsg(err instanceof ApiError ? err.message : '更新標題失敗');
    } finally {
      setTitleBusy(false);
    }
  }, [pdfId, titleInput, isReadOnlyProcessing, setDetail]);

  const handleRegenerateTitle = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    setTitleBusy(true);
    setTitleMsg(null);
    try {
      const res = await regeneratePdfTitle(pdfId);
      setTitleInput(res.title);
      setDetail((prev) =>
        prev ? { ...prev, title: res.title, updated_at: res.updated_at } : prev,
      );
      setTitleMsg('標題已重新生成');
    } catch (err) {
      setTitleMsg(err instanceof ApiError ? err.message : '重新生成標題失敗');
    } finally {
      setTitleBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing, setDetail]);

  const handleSaveTtsSettings = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    setTtsBusy(true);
    setTtsMsg(null);
    try {
      const [ttsRes, scriptRes] = await Promise.all([
        updatePdfTtsSettings(pdfId, ttsVoice, ttsSpeed),
        updatePdfScriptSettings(pdfId, scriptMaxCharsPerPage, hostMode),
      ]);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              tts_voice: ttsRes.tts_voice,
              tts_speed: ttsRes.tts_speed,
              host_mode: hostMode,
              script_max_chars_per_page: scriptRes.script_max_chars_per_page,
              updated_at: ttsRes.updated_at,
            }
          : prev,
      );
      setTtsMsg('設定已儲存（主持模式變更需重新產生逐字稿才會套用）');
    } catch (err) {
      setTtsMsg(err instanceof ApiError ? err.message : '儲存設定失敗');
    } finally {
      setTtsBusy(false);
    }
  }, [pdfId, ttsVoice, ttsSpeed, scriptMaxCharsPerPage, hostMode, isReadOnlyProcessing, setDetail]);

  const handleCreateShareLink = useCallback(async () => {
    if (!pdfId || isReadOnlyProcessing) return;
    setShareBusy(true);
    setShareMessage(null);
    setShareError(null);
    try {
      const res = await createPdfShare(pdfId, shareAccess);
      const absoluteUrl = `${window.location.origin}${res.share_url}`;
      setShareUrl(absoluteUrl);
      setDetail((prev) => prev ? { ...prev, visibility: res.visibility ?? (shareAccess === 'editable' ? 'public_editable' : 'public'), updated_at: res.updated_at } : prev);
      setShareDialogOpen(true);
      try {
        await navigator.clipboard.writeText(absoluteUrl);
        setShareMessage(
          `已建立並複製分享連結（${shareAccess === 'editable' ? '可編輯' : '唯讀'}）`,
        );
      } catch {
        setShareMessage(`分享連結已建立：${absoluteUrl}`);
        setShareError('已建立分享連結，但瀏覽器不允許自動複製，請手動複製上述連結。');
      }
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : '建立分享連結失敗');
    } finally {
      setShareBusy(false);
    }
  }, [pdfId, shareAccess, isReadOnlyProcessing]);

  const handleMakeSharePrivate = useCallback(async () => {
    if (!pdfId || isReadOnlyProcessing) return;
    setShareBusy(true);
    setShareMessage(null);
    setShareError(null);
    try {
      const res = await updatePdfVisibility(pdfId, 'private');
      setDetail((prev) => prev ? { ...prev, visibility: res.visibility, updated_at: res.updated_at } : prev);
      setShareUrl('');
      setShareMessage('已將此簡報設為 private；其他帳號將不會在列表中看到它。');
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : '設定 private 失敗');
    } finally {
      setShareBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing, setDetail]);

  const handleShowPlayQrCode = useCallback(async () => {
    if (!pdfId) return;
    try {
      const res = await createPdfShare(pdfId, shareAccess);
      const absoluteUrl = `${window.location.origin}${res.share_url}`;
      setShareUrl(absoluteUrl);
      setDetail((prev) => prev ? { ...prev, visibility: res.visibility ?? (shareAccess === 'editable' ? 'public_editable' : 'public'), updated_at: res.updated_at } : prev);
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=${encodeURIComponent(absoluteUrl)}`;
      setPlayQrCodeUrl(qrSrc);
      setShareMessage(`已產生分享 QR Code（${shareAccess === 'editable' ? '可編輯' : '唯讀'}）`);
      setShareError(null);
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : '建立分享 QR Code 失敗');
    }
  }, [pdfId, shareAccess]);

  const handleSyncToGithub = useCallback(async () => {
    if (!pdfId || isReadOnlyProcessing) return;
    setGithubSyncBusy(true);
    setGithubSyncError(null);
    setGithubSyncMessage(null);
    try {
      await syncPresentationToGitHub(pdfId);
      setGithubSyncMessage('已同步到 GitHub');
    } catch (err) {
      setGithubSyncError(err instanceof ApiError ? err.message : '同步到 GitHub 失敗');
    } finally {
      setGithubSyncBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing]);

  return {
    titleInput,
    setTitleInput,
    titleBusy,
    titleMsg,
    ttsProvider,
    availableTtsVoices,
    ttsVoice,
    setTtsVoice,
    ttsSpeed,
    setTtsSpeed,
    scriptMaxCharsPerPage,
    setScriptMaxCharsPerPage,
    hostMode,
    setHostMode,
    ttsBusy,
    ttsMsg,
    ttsDialogOpen,
    setTtsDialogOpen,
    shareMessage,
    setShareMessage,
    shareError,
    setShareError,
    shareAccess,
    setShareAccess,
    shareBusy,
    shareDialogOpen,
    setShareDialogOpen,
    shareUrl,
    setShareUrl,
    playQrCodeUrl,
    setPlayQrCodeUrl,
    githubSyncBusy,
    githubSyncMessage,
    githubSyncError,
    handleSaveTitle,
    handleRegenerateTitle,
    handleSaveTtsSettings,
    handleCreateShareLink,
    handleMakeSharePrivate,
    handleShowPlayQrCode,
    handleSyncToGithub,
  };
}
