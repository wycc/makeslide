import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  ApiError,
  cancelRegenerateJob,
  confirmScript,
  fetchRegenerateStatus,
  rollbackRegenerate,
  startRegenerateJob,
  updatePdfScriptSettings,
} from '../../lib/api';
import { debugWarn } from '../../lib/debugLog';
import type { PdfDetail, RegenJobState } from '../../types';
import { useI18n } from '../../i18n';

export type RegenOptions = { image: boolean; script: boolean; audio: boolean; animation: boolean };

interface UseRegenerationParams {
  pdfId: string | undefined;
  currentIdx: number;
  isReadOnlyProcessing: boolean;
  // ref 避免循環依賴：PlayPage 在 useImageStyle 初始化後同步此 ref
  deckImageStylePromptRef: MutableRefObject<string>;
  reloadDetail: () => Promise<void>;
  setCurrentIdx: Dispatch<SetStateAction<number>>;
  hostMode: 'solo' | 'dual';
  scriptMaxCharsPerPage: number | null;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
}

export interface RegenerationState {
  regenAllDialogOpen: boolean;
  setRegenAllDialogOpen: Dispatch<SetStateAction<boolean>>;
  regenAllPrompt: string;
  setRegenAllPrompt: Dispatch<SetStateAction<string>>;
  regenScriptPrompt: string;
  setRegenScriptPrompt: Dispatch<SetStateAction<string>>;
  regenScriptMaxCharsPerPage: number;
  setRegenScriptMaxCharsPerPage: Dispatch<SetStateAction<number>>;
  regenAllBusy: boolean;
  regenAllMsg: string | null;
  setRegenAllMsg: Dispatch<SetStateAction<string | null>>;
  regenOptions: RegenOptions;
  setRegenOptions: Dispatch<SetStateAction<RegenOptions>>;
  regenJob: RegenJobState | null;
  setRegenJob: Dispatch<SetStateAction<RegenJobState | null>>;
  regenSelectedPages: Set<number>;
  setRegenSelectedPages: Dispatch<SetStateAction<Set<number>>>;
  regenStopBusy: boolean;
  regenRollbackBusy: boolean;
  confirmScriptBusy: boolean;
  regenBannerDismissed: boolean;
  setRegenBannerDismissed: Dispatch<SetStateAction<boolean>>;
  // computed
  regenAnySelected: boolean;
  regenJobRunning: boolean;
  regenJobTerminal: boolean;
  showRegenBanner: boolean;
  // handlers
  handleConfirmRegenerate: () => void;
  handleStopRegenerate: () => void;
  handleRollbackRegenerate: () => void;
  handleConfirmScript: () => void;
}

export function useRegeneration({
  pdfId,
  currentIdx,
  isReadOnlyProcessing,
  deckImageStylePromptRef,
  reloadDetail,
  setCurrentIdx,
  hostMode,
  scriptMaxCharsPerPage,
  setDetail,
}: UseRegenerationParams): RegenerationState {
  const { t } = useI18n();
  const [regenAllDialogOpen, setRegenAllDialogOpen] = useState(false);
  const [regenAllPrompt, setRegenAllPrompt] = useState(
    '請讓整份簡報的圖像風格一致，色調、字體與版面語言維持統一。',
  );
  const [regenScriptPrompt, setRegenScriptPrompt] = useState(
    '請以原始重點為主，語句更口語、自然，並加強頁與頁之間的銜接。',
  );
  const [regenScriptMaxCharsPerPage, setRegenScriptMaxCharsPerPage] = useState<number>(350);
  const [regenAllBusy, setRegenAllBusy] = useState(false);
  const [regenAllMsg, setRegenAllMsg] = useState<string | null>(null);
  const [regenOptions, setRegenOptions] = useState<RegenOptions>({
    image: true,
    script: false,
    audio: false,
    animation: false,
  });
  const [regenJob, setRegenJob] = useState<RegenJobState | null>(null);
  const [regenSelectedPages, setRegenSelectedPages] = useState<Set<number>>(new Set());
  const [regenStopBusy, setRegenStopBusy] = useState(false);
  const [regenRollbackBusy, setRegenRollbackBusy] = useState(false);
  const [confirmScriptBusy, setConfirmScriptBusy] = useState(false);
  const [regenBannerDismissed, setRegenBannerDismissed] = useState(false);

  const preRegenPageIdxRef = useRef<number | null>(null);
  const autoJumpedJobIdRef = useRef<string | null>(null);

  const regenAnySelected = regenOptions.image || regenOptions.script || regenOptions.audio || regenOptions.animation;
  const regenJobRunning =
    regenJob?.status === 'running' ||
    regenJob?.status === 'pending' ||
    regenJob?.status === 'cancelling';
  const regenJobTerminal =
    regenJob?.status === 'completed' ||
    regenJob?.status === 'failed' ||
    regenJob?.status === 'cancelled';
  const showRegenBanner = regenJob != null && !regenBannerDismissed;

  // 頁面載入時，嘗試回復重生任務狀態
  useEffect(() => {
    if (!pdfId) return;
    let cancelled = false;
    const restoreRegenJob = async () => {
      try {
        const job = await fetchRegenerateStatus(pdfId);
        if (cancelled) return;
        const isRunning =
          job.status === 'running' ||
          job.status === 'pending' ||
          job.status === 'cancelling';
        if (isRunning) {
          setRegenJob(job);
          setRegenAllBusy(true);
        }
      } catch (err) {
        // 404 代表沒有重生任務，忽略即可
        if (!(err instanceof ApiError && err.status === 404)) {
          debugWarn('Failed to fetch regenerate status on load', err);
        }
      }
    };
    void restoreRegenJob();
    return () => {
      cancelled = true;
    };
  }, [pdfId]);

  // 輪詢批次重生任務進度。任務進入 completed/failed 後停止輪詢。
  useEffect(() => {
    if (!pdfId || !regenJob || !regenJobRunning) return;
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const next = await fetchRegenerateStatus(pdfId);
        if (cancelled) return;
        setRegenJob(next);
        if (
          next.status === 'running' ||
          next.status === 'pending' ||
          next.status === 'cancelling'
        ) {
          timer = window.setTimeout(tick, 1500);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setRegenJob(null);
          setRegenAllBusy(false);
          return;
        }
        setRegenAllMsg(err instanceof ApiError ? err.message : t('play.regenerate.msg.progressFailed'));
      }
    };
    timer = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [pdfId, regenJob?.job_id, regenJobRunning, t]);

  // 任務結束後：關閉 busy、顯示結果訊息，並重新載入詳情；若有成功完成的頁碼資訊
  // 則自動切到該頁供使用者檢視。每個 job 只自動跳頁一次。
  useEffect(() => {
    if (!regenJob) return;
    const terminal =
      regenJob.status === 'completed' ||
      regenJob.status === 'failed' ||
      regenJob.status === 'cancelled';
    if (!terminal) return;
    setRegenAllBusy(false);
    if (regenJob.status === 'completed') {
      setRegenAllMsg(t('play.regenerate.msg.done'));
    } else if (regenJob.status === 'failed') {
      setRegenAllMsg(regenJob.error ?? t('play.regenerate.msg.failed'));
    } else {
      setRegenAllMsg(t('play.regenerate.msg.stopped'));
    }
    void reloadDetail();
    // 自動跳頁：優先跳到 last_processed_page（使用者可看到剛生成的頁）。
    if (autoJumpedJobIdRef.current !== regenJob.job_id) {
      const lastPage =
        regenJob.last_processed_page ?? regenJob.last_generated_page ?? null;
      if (lastPage != null) {
        // page_number 是 1-based，currentIdx 是 0-based
        setCurrentIdx(Math.max(0, lastPage - 1));
      }
      autoJumpedJobIdRef.current = regenJob.job_id;
    }
  }, [regenJob, reloadDetail, setCurrentIdx, t]);

  const handleConfirmRegenerate = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    if (regenJobRunning) return; // 防重複提交
    if (!regenAnySelected) {
      setRegenAllMsg(t('play.regenerate.msg.selectAtLeastOne'));
      return;
    }
    if (regenOptions.image) {
      const p = regenAllPrompt.trim();
      if (!p) {
        setRegenAllMsg(t('play.regenerate.msg.imagePromptRequired'));
        return;
      }
    }
    setRegenAllBusy(true);
    setRegenAllMsg(null);
    setRegenBannerDismissed(false);
    // 記住啟動前的頁碼，之後 rollback 可以跳回
    preRegenPageIdxRef.current = currentIdx;
    const selectedPageNumbers =
      regenSelectedPages.size > 0
        ? Array.from(regenSelectedPages).sort((a, b) => a - b)
        : undefined;
    try {
      if (regenOptions.script || regenOptions.audio) {
        const scriptRes = await updatePdfScriptSettings(pdfId, scriptMaxCharsPerPage, hostMode);
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                host_mode: hostMode,
                script_max_chars_per_page: scriptRes.script_max_chars_per_page,
              }
            : prev,
        );
      }
      const started = await startRegenerateJob(pdfId, {
        scripts: regenOptions.script
          ? {
              prompt: regenScriptPrompt.trim(),
              script_max_chars_per_page: regenScriptMaxCharsPerPage,
            }
          : null,
        audio: regenOptions.audio ? {} : null,
        images: regenOptions.image
          ? {
              prompt: [
                `整份圖片風格（固定套用）：\n${deckImageStylePromptRef.current?.trim() || '(無)'}`,
                `本次圖片重生需求：\n${regenAllPrompt.trim()}`,
              ].join('\n\n'),
            }
          : null,
        animations: regenOptions.animation ? {} : null,
        page_numbers: selectedPageNumbers,
      });
      autoJumpedJobIdRef.current = null;
      setRegenJob(started);
      setRegenAllDialogOpen(false); // 關閉對話框，讓進度顯示在主畫面
      setRegenAllMsg(t('play.regenerate.msg.started'));
    } catch (err) {
      setRegenAllMsg(err instanceof ApiError ? err.message : t('play.regenerate.msg.failed'));
      setRegenAllBusy(false);
    }
  }, [
    pdfId,
    regenAllPrompt,
    regenScriptPrompt,
    regenScriptMaxCharsPerPage,
    regenAnySelected,
    regenOptions,
    regenJobRunning,
    currentIdx,
    isReadOnlyProcessing,
    regenSelectedPages,
    hostMode,
    scriptMaxCharsPerPage,
    setDetail,
    t,
    // deckImageStylePromptRef omitted: ref 本身穩定，透過 .current 讀最新值
  ]);

  const handleConfirmScript = useCallback(async () => {
    if (!pdfId) return;
    setConfirmScriptBusy(true);
    try {
      await confirmScript(pdfId);
      void reloadDetail();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t('play.regenerate.msg.confirmFailed'));
    } finally {
      setConfirmScriptBusy(false);
    }
  }, [pdfId, reloadDetail, t]);

  const handleStopRegenerate = useCallback(async () => {
    if (!pdfId || !regenJob) return;
    setRegenStopBusy(true);
    try {
      const next = await cancelRegenerateJob(pdfId);
      setRegenJob(next);
      setRegenAllMsg(t('play.regenerate.msg.stopRequested'));
    } catch (err) {
      setRegenAllMsg(err instanceof ApiError ? err.message : t('play.regenerate.msg.stopFailed'));
    } finally {
      setRegenStopBusy(false);
    }
  }, [pdfId, regenJob, t]);

  const handleRollbackRegenerate = useCallback(async () => {
    if (!pdfId) return;
    if (!window.confirm(t('play.regenerate.msg.rollbackConfirm'))) return;
    setRegenRollbackBusy(true);
    try {
      await rollbackRegenerate(pdfId);
      // 還原後重新載入詳情
      await reloadDetail();
      // 回到啟動前的頁碼（若能取得）
      const targetIdx = preRegenPageIdxRef.current;
      if (targetIdx != null) {
        setCurrentIdx(targetIdx);
      }
      // 清除記憶體中的 job，隱藏 banner
      setRegenJob(null);
      setRegenBannerDismissed(false);
      setRegenAllMsg(t('play.regenerate.msg.rolledBack'));
      autoJumpedJobIdRef.current = null;
    } catch (err) {
      setRegenAllMsg(err instanceof ApiError ? err.message : t('play.regenerate.msg.rollbackFailed'));
    } finally {
      setRegenRollbackBusy(false);
    }
  }, [pdfId, reloadDetail, setCurrentIdx, t]);

  return {
    regenAllDialogOpen,
    setRegenAllDialogOpen,
    regenAllPrompt,
    setRegenAllPrompt,
    regenScriptPrompt,
    setRegenScriptPrompt,
    regenScriptMaxCharsPerPage,
    setRegenScriptMaxCharsPerPage,
    regenAllBusy,
    regenAllMsg,
    setRegenAllMsg,
    regenOptions,
    setRegenOptions,
    regenJob,
    setRegenJob,
    regenSelectedPages,
    setRegenSelectedPages,
    regenStopBusy,
    regenRollbackBusy,
    confirmScriptBusy,
    regenBannerDismissed,
    setRegenBannerDismissed,
    regenAnySelected,
    regenJobRunning,
    regenJobTerminal,
    showRegenBanner,
    handleConfirmRegenerate,
    handleStopRegenerate,
    handleRollbackRegenerate,
    handleConfirmScript,
  };
}
