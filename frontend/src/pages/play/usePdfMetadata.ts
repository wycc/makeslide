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
  updatePdfTags,
  type ShareAccessMode,
} from '../../lib/api';
import {
  DEFAULT_TTS_VOICE_BY_PROVIDER,
  TTS_VOICES_BY_PROVIDER,
  type TtsProvider,
} from '../../lib/ttsVoices';
import { useI18n, getStoredTtsSpeed, setStoredTtsSpeed } from '../../i18n';
import { copyTextToClipboard } from '../../lib/clipboard';
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
  shareExpiresDays: number | undefined;
  setShareExpiresDays: Dispatch<SetStateAction<number | undefined>>;
  shareExpiresAt: string | null;
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
  // tags
  tagsInput: string;
  setTagsInput: Dispatch<SetStateAction<string>>;
  tagsBusy: boolean;
  tagsMsg: string | null;
  // handlers
  handleSaveTitle: () => void;
  handleRegenerateTitle: () => void;
  handleSaveTtsSettings: () => void;
  handleCreateShareLink: () => void;
  handleMakeSharePrivate: () => void;
  handleShowPlayQrCode: () => void;
  handleSyncToGithub: () => void;
  handleSaveTags: () => void;
}

export function usePdfMetadata({
  pdfId,
  isReadOnlyProcessing,
  detail,
  setDetail,
}: UsePdfMetadataParams): PdfMetadataState {
  const { t } = useI18n();
  const [titleInput, setTitleInput] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsSpeed, setTtsSpeed] = useState(() => getStoredTtsSpeed());
  const [scriptMaxCharsPerPage, setScriptMaxCharsPerPage] = useState<number | null>(null);
  const [hostMode, setHostMode] = useState<'solo' | 'dual'>('solo');
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);
  const [ttsDialogOpen, setTtsDialogOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareAccess, setShareAccess] = useState<ShareAccessMode>('read_only');
  const [shareExpiresDays, setShareExpiresDays] = useState<number | undefined>(undefined);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [playQrCodeUrl, setPlayQrCodeUrl] = useState<string | null>(null);
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
  const [githubSyncMessage, setGithubSyncMessage] = useState<string | null>(null);
  const [githubSyncError, setGithubSyncError] = useState<string | null>(null);
  const [tagsInput, setTagsInput] = useState('');
  const [tagsBusy, setTagsBusy] = useState(false);
  const [tagsMsg, setTagsMsg] = useState<string | null>(null);

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
      setTitleMsg(t('play.metadata.titleRequired'));
      return;
    }
    setTitleBusy(true);
    setTitleMsg(null);
    try {
      const res = await updatePdfTitle(pdfId, nextTitle);
      setDetail((prev) =>
        prev ? { ...prev, title: res.title, updated_at: res.updated_at } : prev,
      );
      setTitleMsg(t('play.metadata.titleUpdated'));
    } catch (err) {
      setTitleMsg(err instanceof ApiError ? err.message : t('play.metadata.titleUpdateFailed'));
    } finally {
      setTitleBusy(false);
    }
  }, [pdfId, titleInput, isReadOnlyProcessing, setDetail, t]);

  const handleSaveTags = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    setTagsBusy(true);
    setTagsMsg(null);
    try {
      const res = await updatePdfTags(pdfId, tagsInput);
      setDetail((prev) => prev ? { ...prev, tags: res.tags, updated_at: res.updated_at } : prev);
      setTagsMsg(t('play.metadata.tagsSaved'));
    } catch (err) {
      setTagsMsg(err instanceof ApiError ? err.message : t('play.metadata.tagsSaveFailed'));
    } finally {
      setTagsBusy(false);
    }
  }, [pdfId, tagsInput, isReadOnlyProcessing, setDetail, t]);

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
      setTitleMsg(t('play.metadata.titleRegenerated'));
    } catch (err) {
      setTitleMsg(err instanceof ApiError ? err.message : t('play.metadata.titleRegenerateFailed'));
    } finally {
      setTitleBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing, setDetail, t]);

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
      setStoredTtsSpeed(ttsSpeed);
      setTtsMsg(t('play.metadata.ttsSettingsSaved'));
    } catch (err) {
      setTtsMsg(err instanceof ApiError ? err.message : t('play.metadata.ttsSettingsSaveFailed'));
    } finally {
      setTtsBusy(false);
    }
  }, [pdfId, ttsVoice, ttsSpeed, scriptMaxCharsPerPage, hostMode, isReadOnlyProcessing, setDetail, t]);

  const handleCreateShareLink = useCallback(async () => {
    if (!pdfId || isReadOnlyProcessing) return;
    setShareBusy(true);
    setShareMessage(null);
    setShareError(null);
    try {
      const res = await createPdfShare(pdfId, shareAccess, shareExpiresDays);
      const absoluteUrl = `${window.location.origin}${res.share_url}`;
      setShareUrl(absoluteUrl);
      setShareExpiresAt(res.expires_at ?? null);
      setDetail((prev) => prev ? { ...prev, visibility: res.visibility ?? (shareAccess === 'editable' ? 'public_editable' : 'public'), updated_at: res.updated_at } : prev);
      setShareDialogOpen(true);
      const copyResult = await copyTextToClipboard(absoluteUrl);
      if (copyResult.ok) {
        setShareMessage(
          t('play.share.createAndCopySuccess').replace(
            '{access}',
            shareAccess === 'editable' ? t('play.share.accessEditable') : t('play.share.accessReadOnly'),
          ),
        );
      } else {
        setShareMessage(t('play.share.createdWithUrl').replace('{url}', absoluteUrl));
        setShareError(t('play.share.copyBlockedManual'));
      }
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : t('play.share.createFailed'));
    } finally {
      setShareBusy(false);
    }
  }, [pdfId, shareAccess, shareExpiresDays, isReadOnlyProcessing, setDetail, t]);

  const handleMakeSharePrivate = useCallback(async () => {
    if (!pdfId || isReadOnlyProcessing) return;
    setShareBusy(true);
    setShareMessage(null);
    setShareError(null);
    try {
      const res = await updatePdfVisibility(pdfId, 'private');
      setDetail((prev) => prev ? { ...prev, visibility: res.visibility, updated_at: res.updated_at } : prev);
      setShareUrl('');
      setShareMessage(t('play.share.makePrivateSuccess'));
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : t('play.share.makePrivateFailed'));
    } finally {
      setShareBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing, setDetail, t]);

  const handleShowPlayQrCode = useCallback(async () => {
    if (!pdfId) return;
    try {
      const res = await createPdfShare(pdfId, shareAccess);
      const absoluteUrl = `${window.location.origin}${res.share_url}`;
      setShareUrl(absoluteUrl);
      setDetail((prev) => prev ? { ...prev, visibility: res.visibility ?? (shareAccess === 'editable' ? 'public_editable' : 'public'), updated_at: res.updated_at } : prev);
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=${encodeURIComponent(absoluteUrl)}`;
      setPlayQrCodeUrl(qrSrc);
      setShareMessage(
        t('play.share.qrCodeCreated').replace(
          '{access}',
          shareAccess === 'editable' ? t('play.share.accessEditable') : t('play.share.accessReadOnly'),
        ),
      );
      setShareError(null);
    } catch (err) {
      setShareError(err instanceof ApiError ? err.message : t('play.share.qrCodeCreateFailed'));
    }
  }, [pdfId, shareAccess, setDetail, t]);

  const handleSyncToGithub = useCallback(async () => {
    if (!pdfId || isReadOnlyProcessing) return;
    setGithubSyncBusy(true);
    setGithubSyncError(null);
    setGithubSyncMessage(null);
    try {
      await syncPresentationToGitHub(pdfId);
      setGithubSyncMessage(t('play.githubSync.success'));
    } catch (err) {
      setGithubSyncError(err instanceof ApiError ? err.message : t('play.githubSync.failed'));
    } finally {
      setGithubSyncBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing, t]);

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
    shareExpiresDays,
    setShareExpiresDays,
    shareExpiresAt,
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
    tagsInput,
    setTagsInput,
    tagsBusy,
    tagsMsg,
    handleSaveTitle,
    handleRegenerateTitle,
    handleSaveTtsSettings,
    handleCreateShareLink,
    handleMakeSharePrivate,
    handleShowPlayQrCode,
    handleSyncToGithub,
    handleSaveTags,
  };
}
