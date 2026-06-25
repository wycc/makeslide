import { useState, useCallback } from 'react';
import {
  ApiError,
  fetchImageHistory,
  fetchScriptHistory,
  fetchScriptVersion,
  restoreImageVersion,
  restoreScriptVersion,
  type FileVersionEntry,
} from '../../lib/api';
import { useI18n } from '../../i18n';

interface UseVersionHistoryParams {
  pdfId: string | undefined;
  reloadDetail: () => Promise<void>;
}

export interface VersionHistoryState {
  versionHistoryOpen: boolean;
  setVersionHistoryOpen: (open: boolean) => void;
  versionHistoryType: 'image' | 'script';
  versionHistoryPage: number | null;
  versionHistoryEntries: FileVersionEntry[];
  versionHistoryLoading: boolean;
  versionPreviewHash: string | null;
  versionPreviewScript: string | null;
  versionRestoring: boolean;
  versionError: string | null;
  openVersionHistory: (type: 'image' | 'script', pageNumber: number) => void;
  handleVersionPreview: (hash: string) => void;
  handleVersionRestore: () => void;
}

export function useVersionHistory({ pdfId, reloadDetail }: UseVersionHistoryParams): VersionHistoryState {
  const { t } = useI18n();
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versionHistoryType, setVersionHistoryType] = useState<'image' | 'script'>('image');
  const [versionHistoryPage, setVersionHistoryPage] = useState<number | null>(null);
  const [versionHistoryEntries, setVersionHistoryEntries] = useState<FileVersionEntry[]>([]);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionPreviewHash, setVersionPreviewHash] = useState<string | null>(null);
  const [versionPreviewScript, setVersionPreviewScript] = useState<string | null>(null);
  const [versionRestoring, setVersionRestoring] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const openVersionHistory = useCallback(async (type: 'image' | 'script', pageNumber: number) => {
    if (!pdfId) return;
    setVersionHistoryType(type);
    setVersionHistoryPage(pageNumber);
    setVersionHistoryEntries([]);
    setVersionPreviewHash(null);
    setVersionPreviewScript(null);
    setVersionError(null);
    setVersionHistoryOpen(true);
    setVersionHistoryLoading(true);
    try {
      const resp = type === 'image'
        ? await fetchImageHistory(pdfId, pageNumber)
        : await fetchScriptHistory(pdfId, pageNumber);
      setVersionHistoryEntries(resp.history);
    } catch {
      setVersionError(t('play.versionHistory.loadListFailed'));
    } finally {
      setVersionHistoryLoading(false);
    }
  }, [pdfId, t]);

  const handleVersionPreview = useCallback(async (hash: string) => {
    if (!pdfId || versionHistoryPage == null) return;
    setVersionPreviewHash(hash);
    if (versionHistoryType === 'script') {
      setVersionError(null);
      try {
        const text = await fetchScriptVersion(pdfId, versionHistoryPage, hash);
        setVersionPreviewScript(text);
      } catch (err) {
        // 清空 versionPreviewHash 讓畫面退回「請選擇版本」提示，搭配上方錯誤訊息，
        // 而不是讓使用者卡在永遠顯示「載入中」、卻其實已經失敗的畫面。
        setVersionPreviewScript(null);
        setVersionPreviewHash(null);
        setVersionError(err instanceof ApiError ? err.message : t('play.versionHistory.loadContentFailed'));
      }
    } else {
      setVersionPreviewScript(null);
    }
  }, [pdfId, versionHistoryPage, versionHistoryType, t]);

  const handleVersionRestore = useCallback(async () => {
    if (!pdfId || versionHistoryPage == null || !versionPreviewHash) return;
    setVersionRestoring(true);
    setVersionError(null);
    try {
      if (versionHistoryType === 'image') {
        await restoreImageVersion(pdfId, versionHistoryPage, versionPreviewHash);
      } else {
        await restoreScriptVersion(pdfId, versionHistoryPage, versionPreviewHash);
      }
      await reloadDetail();
      setVersionHistoryOpen(false);
    } catch (err) {
      setVersionError(err instanceof ApiError ? err.message : t('play.versionHistory.restoreFailed'));
    } finally {
      setVersionRestoring(false);
    }
  }, [pdfId, versionHistoryPage, versionPreviewHash, versionHistoryType, reloadDetail, t]);

  return {
    versionHistoryOpen,
    setVersionHistoryOpen,
    versionHistoryType,
    versionHistoryPage,
    versionHistoryEntries,
    versionHistoryLoading,
    versionPreviewHash,
    versionPreviewScript,
    versionRestoring,
    versionError,
    openVersionHistory,
    handleVersionPreview,
    handleVersionRestore,
  };
}
