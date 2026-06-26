import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  ApiError,
  createPagePoll,
  deletePagePoll,
  fetchPagePolls,
  generatePollDraft,
  resetPagePollVotes,
  updatePlaybackSyncState,
  votePagePoll,
} from '../../lib/api';
import type { PagePoll, PdfDetailPage } from '../../types';
import { resolveConfiguredUserCode } from './utils';
import { useI18n } from '../../i18n';

const POLL_INTERVAL_MS = 3000;

interface UsePagePollsParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  // 輪詢觸發條件
  interactiveMode: boolean;
  syncEnabled: boolean;
  syncRole: 'master' | 'follower';
  syncRealtimePollStarted: boolean;
  // handleStopPoll 需要的導航狀態
  totalPages: number;
  setCurrentIdx: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setClassroomAwaitingNext: Dispatch<SetStateAction<boolean>>;
  setFinished: Dispatch<SetStateAction<boolean>>;
  setFullscreenPollControlOpen: Dispatch<SetStateAction<boolean>>;
  // handleSelectDisplayedPoll 需要的 sync 推送狀態
  syncClientIdRef: MutableRefObject<string>;
  currentIdx: number;
  isPlaying: boolean;
  currentTime: number;
  followerAudioUnlocked: boolean;
  syncPollShowResults: boolean;
  setSyncPollShowResults: Dispatch<SetStateAction<boolean>>;
  setSyncDisplayedPollId: Dispatch<SetStateAction<number | null>>;
}

export interface PagePollsState {
  pagePolls: PagePoll[];
  setPagePolls: Dispatch<SetStateAction<PagePoll[]>>;
  pollQuestion: string;
  setPollQuestion: Dispatch<SetStateAction<string>>;
  pollOptionsText: string;
  setPollOptionsText: Dispatch<SetStateAction<string>>;
  pollBusy: boolean;
  aiPollBusy: boolean;
  pollError: string | null;
  setPollError: Dispatch<SetStateAction<string | null>>;
  pollVotes: Record<number, number>;
  pollSettingsOpen: boolean;
  setPollSettingsOpen: Dispatch<SetStateAction<boolean>>;
  pollStarted: boolean;
  setPollStarted: Dispatch<SetStateAction<boolean>>;
  handleGeneratePollDraft: () => Promise<void>;
  handleCreatePoll: () => Promise<void>;
  handleStartPoll: () => void;
  handleStopPoll: () => void;
  handleVotePoll: (pollId: number, optionIndex: number) => Promise<void>;
  handleResetPollVotes: (pollId: number) => Promise<void>;
  handleDeletePoll: (pollId: number) => Promise<void>;
  handleSelectDisplayedPoll: (pollId: number) => Promise<void>;
}

export function usePagePolls({
  pdfId,
  currentPage,
  interactiveMode,
  syncEnabled,
  syncRole,
  syncRealtimePollStarted,
  totalPages,
  setCurrentIdx,
  setIsPlaying,
  setClassroomAwaitingNext,
  setFinished,
  setFullscreenPollControlOpen,
  syncClientIdRef,
  currentIdx,
  isPlaying,
  currentTime,
  followerAudioUnlocked,
  syncPollShowResults,
  setSyncPollShowResults,
  setSyncDisplayedPollId,
}: UsePagePollsParams): PagePollsState {
  const { t } = useI18n();
  const [pagePolls, setPagePolls] = useState<PagePoll[]>([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptionsText, setPollOptionsText] = useState(() => t('play.sidebar.poll.defaultOptions'));
  const [pollBusy, setPollBusy] = useState(false);
  const [aiPollBusy, setAiPollBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollVotes, setPollVotes] = useState<Record<number, number>>({});
  const [pollSettingsOpen, setPollSettingsOpen] = useState(false);
  const [pollStarted, setPollStarted] = useState(false);

  // 投票者識別碼：優先用登入帳號的 user_code，否則用 localStorage 亂數 ID
  const pollVoterIdRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storageKey = 'makeslide.poll.voterId';
      const configured = await resolveConfiguredUserCode();
      if (cancelled) return;
      if (configured) {
        window.localStorage.setItem(storageKey, configured);
        pollVoterIdRef.current = configured;
        return;
      }
      if (!pollVoterIdRef.current) {
        const existing = window.localStorage.getItem(storageKey);
        const next =
          existing || `voter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        window.localStorage.setItem(storageKey, next);
        pollVoterIdRef.current = next;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 只在需要時（投票進行中 / 設定面板開啟 / 互動模式 / follower sync）才輪詢
  const shouldFetchPolls =
    pollStarted ||
    pollSettingsOpen ||
    interactiveMode ||
    (syncEnabled && syncRole === 'follower' && syncRealtimePollStarted);

  useEffect(() => {
    if (!shouldFetchPolls || !pdfId || !currentPage) return;
    let cancelled = false;
    let timer: number | null = null;
    const loadPolls = async () => {
      try {
        const polls = await fetchPagePolls(pdfId, currentPage.page_number);
        if (cancelled) return;
        setPagePolls(polls);
        setPollError(null);
      } catch (err) {
        if (!cancelled) setPollError(err instanceof ApiError ? err.message : t('play.sidebar.poll.loadFailed'));
      }
      if (!cancelled) timer = window.setTimeout(loadPolls, POLL_INTERVAL_MS);
    };
    void loadPolls();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [shouldFetchPolls, pdfId, currentPage?.page_number, t]);

  const handleGeneratePollDraft = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    setAiPollBusy(true);
    setPollError(null);
    try {
      // If the teacher already typed a question, only (re)generate options for it;
      // otherwise let the AI draft both the question and the options from the page.
      const draft = await generatePollDraft(pdfId, currentPage.page_number, pollQuestion);
      setPollQuestion(draft.question);
      setPollOptionsText(draft.options.join('\n'));
      setPollSettingsOpen(true);
    } catch (err) {
      setPollError(err instanceof ApiError ? err.message : t('play.sidebar.poll.aiDraftFailed'));
    } finally {
      setAiPollBusy(false);
    }
  }, [pdfId, currentPage, pollQuestion, t]);

  const handleCreatePoll = useCallback(async () => {
    if (!pdfId || !currentPage) return;
    const question = pollQuestion.trim();
    const options = pollOptionsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!question) {
      setPollError(t('play.sidebar.poll.questionRequired'));
      return;
    }
    if (options.length < 2) {
      setPollError(t('play.sidebar.poll.minTwoOptions'));
      return;
    }
    setPollBusy(true);
    setPollError(null);
    try {
      const poll = await createPagePoll(pdfId, currentPage.page_number, question, options);
      setPagePolls((prev) => [poll, ...prev]);
      setPollQuestion('');
      setPollOptionsText(t('play.sidebar.poll.defaultOptions'));
      setPollStarted(true);
    } catch (err) {
      setPollError(err instanceof ApiError ? err.message : t('play.sidebar.poll.createFailed'));
    } finally {
      setPollBusy(false);
    }
  }, [pdfId, currentPage, pollQuestion, pollOptionsText, t]);

  const handleStartPoll = useCallback(() => {
    setPollStarted(true);
    setPollError(null);
  }, []);

  const handleStopPoll = useCallback(() => {
    setPollStarted(false);
    setSyncPollShowResults(false);
    setSyncDisplayedPollId(null);
    setPagePolls([]);
    setPollVotes({});
    setPollError(null);
    setFullscreenPollControlOpen(false);
    // 互動模式：結束投票後自動進入下一頁（未開同步，或是 master 才執行翻頁）
    if (interactiveMode && (!syncEnabled || syncRole !== 'follower')) {
      setClassroomAwaitingNext(false);
      setFinished(false);
      setCurrentIdx((i) => {
        if (i < totalPages - 1) {
          setIsPlaying(true);
          return i + 1;
        }
        setFinished(true);
        return i;
      });
    }
  }, [
    interactiveMode,
    syncEnabled,
    syncRole,
    totalPages,
    setSyncPollShowResults,
    setSyncDisplayedPollId,
    setFullscreenPollControlOpen,
    setClassroomAwaitingNext,
    setFinished,
    setCurrentIdx,
    setIsPlaying,
  ]);

  const handleVotePoll = useCallback(
    async (pollId: number, optionIndex: number) => {
      if (!pdfId) return;
      const voterId = pollVoterIdRef.current;
      if (!voterId) return;
      setPollBusy(true);
      setPollError(null);
      try {
        const poll = await votePagePoll(pdfId, pollId, voterId, optionIndex);
        setPagePolls((prev) => prev.map((item) => (item.id === poll.id ? poll : item)));
        setPollVotes((prev) => ({ ...prev, [pollId]: optionIndex }));
      } catch (err) {
        setPollError(err instanceof ApiError ? err.message : t('play.sidebar.poll.voteFailed'));
      } finally {
        setPollBusy(false);
      }
    },
    [pdfId, t],
  );

  const handleResetPollVotes = useCallback(
    async (pollId: number) => {
      if (!pdfId) return;
      setPollBusy(true);
      setPollError(null);
      try {
        const poll = await resetPagePollVotes(pdfId, pollId);
        setPagePolls((prev) => prev.map((item) => (item.id === poll.id ? poll : item)));
        setPollVotes((prev) => {
          const next = { ...prev };
          delete next[pollId];
          return next;
        });
      } catch (err) {
        setPollError(err instanceof ApiError ? err.message : t('play.sidebar.poll.clearResultsFailed'));
      } finally {
        setPollBusy(false);
      }
    },
    [pdfId, t],
  );

  const handleDeletePoll = useCallback(
    async (pollId: number) => {
      if (!pdfId) return;
      setPollBusy(true);
      setPollError(null);
      try {
        await deletePagePoll(pdfId, pollId);
        setPagePolls((prev) => prev.filter((item) => item.id !== pollId));
        setPollVotes((prev) => {
          const next = { ...prev };
          delete next[pollId];
          return next;
        });
      } catch (err) {
        setPollError(err instanceof ApiError ? err.message : t('play.sidebar.poll.deleteFailed'));
      } finally {
        setPollBusy(false);
      }
    },
    [pdfId, t],
  );

  const handleSelectDisplayedPoll = useCallback(
    async (pollId: number) => {
      setSyncDisplayedPollId(pollId);
      if (!syncEnabled || syncRole !== 'master' || !pdfId || !syncClientIdRef.current) return;
      try {
        await updatePlaybackSyncState(pdfId, syncClientIdRef.current, {
          page_number: Math.max(1, currentIdx + 1),
          is_playing: isPlaying,
          current_time: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
          follower_audio_unlocked: followerAudioUnlocked,
          realtime_poll_started: pollStarted,
          quiz_show_answers: syncPollShowResults,
          active_quiz_id: pollId,
        });
      } catch {
        // 推送失敗不影響本地 UI，sync mega-effect 會在下次 tick 重新同步
      }
    },
    [
      syncEnabled,
      syncRole,
      pdfId,
      syncClientIdRef,
      currentIdx,
      isPlaying,
      currentTime,
      followerAudioUnlocked,
      pollStarted,
      syncPollShowResults,
      setSyncDisplayedPollId,
    ],
  );

  return {
    pagePolls,
    setPagePolls,
    pollQuestion,
    setPollQuestion,
    pollOptionsText,
    setPollOptionsText,
    pollBusy,
    pollError,
    setPollError,
    pollVotes,
    pollSettingsOpen,
    setPollSettingsOpen,
    pollStarted,
    setPollStarted,
    aiPollBusy,
    handleGeneratePollDraft,
    handleCreatePoll,
    handleStartPoll,
    handleStopPoll,
    handleVotePoll,
    handleResetPollVotes,
    handleDeletePoll,
    handleSelectDisplayedPoll,
  };
}
