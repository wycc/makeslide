import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { formatRelativeTime, buildRelativeTimeLabels } from '../lib/relativeTime';
import { summarizeQuizProgress } from '../lib/quizProgress';
import { interpolateTemplate } from '../lib/interpolateTemplate';
import { clamp } from '../lib/clamp';
import {
  ApiError,
  copyQuizSetTo,
  deleteQuizSet,
  fetchPdfDetail,
  fetchPdfs,
  fetchPlaybackSyncState,
  fetchQuizAttempts,
  fetchQuizSets,
  generateAiQuizQuestion,
  getAuthStatus,
  getSystemAiSettings,
  generateQuizSet,
  joinPlaybackSync,
  saveQuizSet,
  submitQuizAttempt,
  submitSyncQuizProgress,
  updatePlaybackSyncState,
} from '../lib/api';
import { shuffleArray } from './play/utils';
import { copyTextToClipboard } from '../lib/clipboard';
import { formatQuizQuestionsText } from '../lib/quizQuestionsText';
import { parseQuizImportJson } from '../lib/quizImport';
import { formatMmSs } from '../lib/formatMmSs';
import { addReviewItems } from '../lib/reviewList';
import type {
  PdfDetail,
  PdfListItem,
  QuizAttemptSession,
  QuizQuestion,
  QuizQuestionType,
  QuizSet,
  SyncQuizProgress,
} from '../types';
import { scoreSumExceedingTotal, normalizeQuestionScores, calcQuestionScore, calcAttemptScore, maxAttemptScore, averageAttemptScore } from '../lib/quizScoring';
import { roundToTwoDecimals } from '../lib/roundTo';

const LOCAL_USER_CODE_KEY = 'makeslide.user_code';

async function resolveConfiguredUserCode(): Promise<string> {
  const localCode = window.localStorage.getItem(LOCAL_USER_CODE_KEY)?.trim() || '';
  try {
    const auth = await getAuthStatus();
    if (!auth.authenticated) return localCode;
    const settings = await getSystemAiSettings();
    return settings.user_code?.trim() || localCode;
  } catch {
    return localCode;
  }
}


function emptyQuestion(index: number): QuizQuestion {
  return {
    id: `q${index + 1}`,
    type: 'single',
    question: '',
    options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }],
    answer_indices: [0],
    explanation: '',
    score: null,
  };
}

export default function QuizBuilderPage() {
  const { id: pdfId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const relativeTimeLabels = buildRelativeTimeLabels(t);
  const formatMessage = useCallback(
    (key: Parameters<typeof t>[0], replacements: Record<string, string | number>) =>
      interpolateTemplate(t(key), replacements),
    [t],
  );
  const [detail, setDetail] = useState<PdfDetail | null>(null);
  const [savedQuizzes, setSavedQuizzes] = useState<QuizSet[]>([]);
  const [savedQuizzesSearch, setSavedQuizzesSearch] = useState('');
  const [allPdfs, setAllPdfs] = useState<PdfListItem[]>([]);
  const [copyingQuizId, setCopyingQuizId] = useState<number | null>(null);
  const [selectedQuizId, setSelectedQuizId] = useState<number | null>(null);
  const [title, setTitle] = useState(() => t('quiz.defaultTitle'));
  const [prompt, setPrompt] = useState(() => t('quiz.defaultPrompt'));
  const [questions, setQuestions] = useState<QuizQuestion[]>([emptyQuestion(0)]);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(0);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffledQuestionsForTaking, setShuffledQuestionsForTaking] = useState<QuizQuestion[] | null>(null);
  const [quizCountdown, setQuizCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyQuestionsStatus, setCopyQuestionsStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncRole, setSyncRole] = useState<'master' | 'follower'>('follower');
  const [syncActiveQuizId, setSyncActiveQuizId] = useState<number | null>(null);
  const [syncQuizSessionId, setSyncQuizSessionId] = useState<string | null>(null);
  const [syncQuizShowAnswers, setSyncQuizShowAnswers] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [deletingQuizId, setDeletingQuizId] = useState<number | null>(null);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, number[]>>({});
  const [resetStudentAnswersBusy, setResetStudentAnswersBusy] = useState(false);
  const [showEditorAnswers, setShowEditorAnswers] = useState(false);
  const [syncQuizProgress, setSyncQuizProgress] = useState<SyncQuizProgress[]>([]);
  const [historyQuizId, setHistoryQuizId] = useState<number | null>(null);
  const [historySessions, setHistorySessions] = useState<QuizAttemptSession[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const [viewingAttemptId, setViewingAttemptId] = useState<number | null>(null);
  const [draggingQIdx, setDraggingQIdx] = useState<number | null>(null);
  const [aiQuizPageNumber, setAiQuizPageNumber] = useState(1);
  const [aiQuizBusy, setAiQuizBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const outcome = parseQuizImportJson(text);
    if (!outcome.ok) {
      setImportMsg(t('quiz.importFailed'));
      window.setTimeout(() => setImportMsg(null), 2500);
      return;
    }
    if (outcome.value.title.trim()) setTitle(outcome.value.title);
    setQuestions(outcome.value.questions);
    setImportMsg(t('quiz.importDone').replace('{n}', String(outcome.value.questions.length)));
    window.setTimeout(() => setImportMsg(null), 2500);
  };
  const syncClientIdRef = useRef('');
  const lastReportedProgressRef = useRef<{ quizId: number; answeredCount: number; submitted: boolean } | null>(null);
  const submittedAttemptRef = useRef<string | null>(null);
  const latestAttemptSnapshotRef = useRef<{
    pdfId: string;
    quizId: number;
    sessionId: string;
    code: string | null;
    answers: Record<string, number[]>;
  } | null>(null);
  const previousActiveQuizIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pdfId) return;
    let alive = true;
    void (async () => {
      try {
        const [nextDetail, nextQuizzes] = await Promise.all([fetchPdfDetail(pdfId), fetchQuizSets(pdfId)]);
        if (!alive) return;
        setDetail(nextDetail);
        setSavedQuizzes(nextQuizzes);
        if (nextQuizzes[0]) {
          setSelectedQuizId(nextQuizzes[0].id);
          setTitle(nextQuizzes[0].title);
          setPrompt(nextQuizzes[0].prompt);
          setQuestions(nextQuizzes[0].questions);
          setTimeLimitSeconds(nextQuizzes[0].time_limit_seconds ?? 0);
          setShuffleQuestions(nextQuizzes[0].shuffle_questions ?? false);
        }
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : t('quiz.loadFailed'));
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdfId]);

  const scoreSumExceeded = useMemo(() => scoreSumExceedingTotal(questions), [questions]);

  const canSave = useMemo(
    () =>
      Boolean(title.trim()) &&
      questions.length > 0 &&
      questions.every((q) => q.question.trim() && q.options.filter((o) => o.text.trim()).length >= 2) &&
      scoreSumExceeded == null,
    [questions, scoreSumExceeded, title],
  );

  const activeQuiz = useMemo(
    () => savedQuizzes.find((quiz) => quiz.id === syncActiveQuizId) ?? null,
    [savedQuizzes, syncActiveQuizId],
  );

  const isFollowerTesting = syncRole === 'follower' && activeQuiz != null;

  useEffect(() => {
    if (!activeQuiz || !activeQuiz.shuffle_questions) {
      setShuffledQuestionsForTaking(null);
      return;
    }
    setShuffledQuestionsForTaking(shuffleArray([...activeQuiz.questions]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuiz?.id, activeQuiz?.shuffle_questions]);

  useEffect(() => {
    if (!pdfId || !isFollowerTesting || !activeQuiz) return;
    const clientId = syncClientIdRef.current;
    if (!clientId) return;
    const totalQuestions = activeQuiz.questions.length;
    const answeredCount = activeQuiz.questions.filter((q) => (studentAnswers[q.id] ?? []).length > 0).length;
    const submitted = totalQuestions > 0 && answeredCount >= totalQuestions;
    const last = lastReportedProgressRef.current;
    if (last && last.quizId === activeQuiz.id && last.answeredCount === answeredCount && last.submitted === submitted) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastReportedProgressRef.current = { quizId: activeQuiz.id, answeredCount, submitted };
      void submitSyncQuizProgress(pdfId, clientId, {
        quiz_id: activeQuiz.id,
        answered_count: answeredCount,
        total_questions: totalQuestions,
        submitted,
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [pdfId, isFollowerTesting, activeQuiz, studentAnswers]);

  useEffect(() => {
    if (!pdfId || syncRole !== 'follower' || !activeQuiz || !syncQuizSessionId) return;
    void (async () => {
      const code = (await resolveConfiguredUserCode()) || null;
      latestAttemptSnapshotRef.current = {
        pdfId,
        quizId: activeQuiz.id,
        sessionId: syncQuizSessionId,
        code,
        answers: studentAnswers,
      };
    })();
  }, [pdfId, syncRole, activeQuiz, syncQuizSessionId, studentAnswers]);

  const submitFollowerAttempt = useCallback(() => {
    const snapshot = latestAttemptSnapshotRef.current;
    const clientId = syncClientIdRef.current;
    if (!snapshot || !clientId) return;
    const key = `${snapshot.sessionId}:${clientId}`;
    if (submittedAttemptRef.current === key) return;
    submittedAttemptRef.current = key;
    const quiz = savedQuizzes.find((q) => q.id === snapshot.quizId);
    let score: number | undefined;
    if (quiz) {
      score = roundToTwoDecimals(calcAttemptScore(quiz.questions, snapshot.answers));
    }
    void submitQuizAttempt(snapshot.pdfId, snapshot.quizId, {
      client_id: clientId,
      session_id: snapshot.sessionId,
      code: snapshot.code,
      answers: snapshot.answers,
      score,
    }).catch(() => {
      submittedAttemptRef.current = null;
    });
  }, [savedQuizzes]);

  useEffect(() => {
    if (syncRole !== 'follower' || !syncQuizShowAnswers) return;
    submitFollowerAttempt();
  }, [syncRole, syncQuizShowAnswers, submitFollowerAttempt]);

  useEffect(() => {
    if (!syncQuizShowAnswers || !activeQuiz || !pdfId) return;
    const scoreTable = normalizeQuestionScores(activeQuiz.questions);
    const wrongWithPage = activeQuiz.questions.filter(
      (q, idx) =>
        typeof q.page_number === 'number' &&
        calcQuestionScore(q, studentAnswers[q.id] ?? [], scoreTable[idx] ?? 0) === 0,
    );
    if (wrongWithPage.length === 0) return;
    addReviewItems(
      wrongWithPage.map((q) => ({
        pdfId,
        pdfTitle: detail?.title ?? '',
        pageNumber: q.page_number as number,
        questionText: q.question,
        addedAt: new Date().toISOString(),
      })),
    );
  }, [syncQuizShowAnswers, activeQuiz, pdfId, detail, studentAnswers]);

  useEffect(() => {
    if (quizCountdown === 0 && isFollowerTesting && !syncQuizShowAnswers) {
      submitFollowerAttempt();
    }
  }, [quizCountdown, isFollowerTesting, syncQuizShowAnswers, submitFollowerAttempt]);

  useEffect(() => {
    if (syncRole !== 'follower' || !activeQuiz || syncQuizShowAnswers) {
      setQuizCountdown(null);
      return;
    }
    const limit = activeQuiz.time_limit_seconds ?? 0;
    if (limit <= 0) {
      setQuizCountdown(null);
      return;
    }
    setQuizCountdown(limit);
    const interval = window.setInterval(() => {
      setQuizCountdown((prev) => {
        if (prev === null || prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [syncRole, activeQuiz, syncQuizShowAnswers]);

  useEffect(() => {
    const previous = previousActiveQuizIdRef.current;
    previousActiveQuizIdRef.current = syncActiveQuizId;
    if (syncRole === 'follower' && previous != null && syncActiveQuizId == null && pdfId) {
      submitFollowerAttempt();
      navigate(`/play/${encodeURIComponent(pdfId)}?fullscreen=1`);
    }
  }, [syncRole, syncActiveQuizId, pdfId, navigate, submitFollowerAttempt]);

  useEffect(() => {
    if (!pdfId) return;
    const storageKey = `makeslide.sync.client.${pdfId}`;
    const roleKey = `makeslide.sync.role.${pdfId}`;
    const existing = window.sessionStorage.getItem(storageKey);
    const preferredRole = window.localStorage.getItem(roleKey) === 'master' ? 'master' : 'follower';
    const next = (existing && existing.trim()) || `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(storageKey, next);
    syncClientIdRef.current = next;
    if (preferredRole === 'master') setSyncRole('master');
    let cancelled = false;
    let joinedOnce = false;

    const resolveRole = (incomingRole: 'master' | 'follower'): 'master' | 'follower' => {
      const localPreferred = window.localStorage.getItem(roleKey) === 'master';
      if (incomingRole === 'master' || localPreferred) return 'master';
      return 'follower';
    };

    const refresh = async () => {
      let clientId = syncClientIdRef.current.trim();
      const userCode = (await resolveConfiguredUserCode()) || undefined;
      if (!clientId) {
        clientId = `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        syncClientIdRef.current = clientId;
        window.sessionStorage.setItem(storageKey, clientId);
      }
      try {
        if (!joinedOnce) {
          try {
            const joined = await joinPlaybackSync(pdfId, clientId, userCode);
            if (cancelled) return;
            joinedOnce = true;
            const nextRole = resolveRole(joined.role);
            setSyncRole(nextRole);
            window.localStorage.setItem(roleKey, nextRole);
            setSyncActiveQuizId(joined.active_quiz_id ?? null);
            setSyncQuizSessionId(joined.quiz_session_id ?? null);
            setSyncQuizShowAnswers(joined.quiz_show_answers ?? false);
            setSyncQuizProgress(joined.quiz_progress ?? []);
          } catch (err) {
            if (err instanceof ApiError && err.status === 400) {
              const regenerated = `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              syncClientIdRef.current = regenerated;
              window.sessionStorage.setItem(storageKey, regenerated);
              const joined = await joinPlaybackSync(pdfId, regenerated, userCode);
              if (cancelled) return;
              joinedOnce = true;
              const nextRole = resolveRole(joined.role);
              setSyncRole(nextRole);
              window.localStorage.setItem(roleKey, nextRole);
              setSyncActiveQuizId(joined.active_quiz_id ?? null);
              setSyncQuizShowAnswers(joined.quiz_show_answers ?? false);
              setSyncQuizProgress(joined.quiz_progress ?? []);
            } else {
              throw err;
            }
          }
        } else {
          const state = await fetchPlaybackSyncState(pdfId, clientId);
          if (cancelled) return;
          const nextRole = resolveRole(state.role);
          setSyncRole(nextRole);
          window.localStorage.setItem(roleKey, nextRole);
          setSyncActiveQuizId(state.active_quiz_id ?? null);
          setSyncQuizSessionId(state.quiz_session_id ?? null);
          setSyncQuizShowAnswers(state.quiz_show_answers ?? false);
          setSyncQuizProgress(state.quiz_progress ?? []);
        }
        setSyncError(null);
      } catch (err) {
        if (!cancelled) setSyncError(err instanceof ApiError ? err.message : t('quiz.syncLoadFailed'));
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pdfId]);

  const updateQuestion = (idx: number, patch: Partial<QuizQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  const updateOption = (qIdx: number, oIdx: number, text: string) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== qIdx) return q;
      return { ...q, options: q.options.map((o, j) => (j === oIdx ? { text } : o)) };
    }));
  };

  const toggleAnswer = (qIdx: number, oIdx: number) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== qIdx) return q;
      if (q.type === 'single') return { ...q, answer_indices: [oIdx] };
      const set = new Set(q.answer_indices);
      if (set.has(oIdx)) set.delete(oIdx);
      else set.add(oIdx);
      return { ...q, answer_indices: Array.from(set).sort((a, b) => a - b) };
    }));
  };

  const toggleStudentAnswer = (question: QuizQuestion, optionIdx: number) => {
    setStudentAnswers((prev) => {
      const current = prev[question.id] ?? [];
      if (question.type === 'single') return { ...prev, [question.id]: [optionIdx] };
      const next = new Set(current);
      if (next.has(optionIdx)) next.delete(optionIdx);
      else next.add(optionIdx);
      return { ...prev, [question.id]: Array.from(next).sort((a, b) => a - b) };
    });
  };

  const handleResetStudentAnswers = useCallback(async () => {
    if (!pdfId || !activeQuiz) return;
    const clientId = syncClientIdRef.current;
    if (!clientId) return;
    const totalQuestions = activeQuiz.questions.length;
    setResetStudentAnswersBusy(true);
    setStudentAnswers({});
    submittedAttemptRef.current = null;
    if (latestAttemptSnapshotRef.current?.quizId === activeQuiz.id) {
      latestAttemptSnapshotRef.current = {
        ...latestAttemptSnapshotRef.current,
        answers: {},
      };
    }
    lastReportedProgressRef.current = { quizId: activeQuiz.id, answeredCount: 0, submitted: false };
    try {
      await submitSyncQuizProgress(pdfId, clientId, {
        quiz_id: activeQuiz.id,
        answered_count: 0,
        total_questions: totalQuestions,
        submitted: false,
      });
      setSyncError(null);
      setMessage(t('quiz.resetAnswersDone'));
    } catch (err) {
      lastReportedProgressRef.current = null;
      setSyncError(err instanceof ApiError ? err.message : t('quiz.resetAnswersFailed'));
    } finally {
      setResetStudentAnswersBusy(false);
    }
  }, [activeQuiz, pdfId, t]);

  const sendQuizSyncState = useCallback(
    async (quizId: number, showAnswers: boolean) => {
      if (!pdfId || !syncClientIdRef.current) return;
      await updatePlaybackSyncState(pdfId, syncClientIdRef.current, {
        page_number: 1,
        is_playing: false,
        current_time: 0,
        quiz_mode: true,
        active_quiz_id: quizId,
        quiz_show_answers: showAnswers,
      });
      setSyncActiveQuizId(quizId);
      setSyncQuizShowAnswers(showAnswers);
      setSyncError(null);
    },
    [pdfId],
  );

  const sendQuizEndState = useCallback(async () => {
    if (!pdfId || !syncClientIdRef.current) return;
    await updatePlaybackSyncState(pdfId, syncClientIdRef.current, {
      page_number: 1,
      is_playing: false,
      current_time: 0,
      quiz_mode: false,
      active_quiz_id: null,
      quiz_show_answers: false,
    });
    setSyncActiveQuizId(null);
    setSyncQuizSessionId(null);
    setSyncQuizShowAnswers(false);
    setSyncError(null);
  }, [pdfId]);

  const handleStartQuiz = useCallback(
    async (quizId: number) => {
      if (syncRole !== 'master') {
        setSyncError(t('quiz.masterOnlyStart'));
        return;
      }
      try {
        await sendQuizSyncState(quizId, false);
        setMessage(t('quiz.startDone'));
      } catch (err) {
        setSyncError(err instanceof ApiError ? err.message : t('quiz.startFailed'));
      }
    },
    [sendQuizSyncState, syncRole, t],
  );

  const handleShowAnswers = useCallback(
    async (quizId: number) => {
      if (syncRole !== 'master') {
        setSyncError(t('quiz.masterOnlyShowAnswers'));
        return;
      }
      try {
        await sendQuizSyncState(quizId, true);
        setMessage(t('quiz.showAnswersDone'));
      } catch (err) {
        setSyncError(err instanceof ApiError ? err.message : t('quiz.showAnswersFailed'));
      }
    },
    [sendQuizSyncState, syncRole, t],
  );

  const handleEndQuiz = useCallback(
    async () => {
      if (syncRole !== 'master') {
        setSyncError(t('quiz.masterOnlyEnd'));
        return;
      }
      try {
        await sendQuizEndState();
        setMessage(t('quiz.endDone'));
      } catch (err) {
        setSyncError(err instanceof ApiError ? err.message : t('quiz.endFailed'));
      }
    },
    [sendQuizEndState, syncRole, t],
  );

  const loadQuizHistory = useCallback(
    async (quizId: number) => {
      if (!pdfId) return;
      setHistoryQuizId(quizId);
      setViewingAttemptId(null);
      setHistoryBusy(true);
      setHistoryError(null);
      try {
        const resp = await fetchQuizAttempts(pdfId, quizId);
        setHistorySessions(resp.sessions);
      } catch (err) {
        setHistoryError(err instanceof ApiError ? err.message : t('quiz.historyLoadFailed'));
      } finally {
        setHistoryBusy(false);
      }
    },
    [pdfId, t],
  );

  const handleAiGenerateQuestion = async () => {
    if (!pdfId) return;
    setAiQuizBusy(true);
    setError(null);
    try {
      const result = await generateAiQuizQuestion(pdfId, aiQuizPageNumber);
      const newQuestion: QuizQuestion = {
        id: `q${Date.now()}`,
        type: 'single',
        question: result.question,
        options: result.options.map((text: string) => ({ text })),
        answer_indices: [result.correct_index],
        explanation: result.explanation,
        score: null,
      };
      setQuestions((prev) => [...prev, newQuestion]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('quiz.aiGenerateFailed'));
    } finally {
      setAiQuizBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!pdfId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const generated = await generateQuizSet(pdfId, prompt, questions.filter((q) => q.question.trim()));
      setTitle(generated.title);
      setQuestions(generated.questions);
      setMessage(t('quiz.generateDone'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('quiz.generateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!pdfId || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveQuizSet(pdfId, { title, prompt, questions, quizId: selectedQuizId, time_limit_seconds: timeLimitSeconds, shuffle_questions: shuffleQuestions });
      setSelectedQuizId(saved.id);
      setSavedQuizzes((prev) => [saved, ...prev.filter((q) => q.id !== saved.id)]);
      setMessage(t('quiz.saveDone'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('quiz.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteQuiz = useCallback(
    async (quiz: QuizSet) => {
      if (!pdfId) return;
      const ok = window.confirm(formatMessage('quiz.confirmDelete', { title: quiz.title }));
      if (!ok) return;
      setDeletingQuizId(quiz.id);
      setError(null);
      try {
        await deleteQuizSet(pdfId, quiz.id);
        setSavedQuizzes((prev) => prev.filter((q) => q.id !== quiz.id));
        if (selectedQuizId === quiz.id) {
          setSelectedQuizId(null);
          setTitle(t('quiz.defaultTitle'));
          setQuestions([emptyQuestion(0)]);
        }
        setMessage(t('quiz.deleteDone'));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('quiz.deleteFailed'));
      } finally {
        setDeletingQuizId(null);
      }
    },
    [pdfId, selectedQuizId, t, formatMessage],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPdfs().then((list) => { if (!cancelled) setAllPdfs(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleCopyQuizTo = useCallback(async (quiz: QuizSet, targetId: string) => {
    if (!pdfId || copyingQuizId != null) return;
    setCopyingQuizId(quiz.id);
    try {
      await copyQuizSetTo(pdfId, quiz.id, targetId);
      setMessage(t('quiz.copyDone'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('quiz.copyFailed'));
    } finally {
      setCopyingQuizId(null);
    }
  }, [pdfId, copyingQuizId, t]);

  const renderQuizTakingView = (quiz: QuizSet) => {
    const effectiveQuestions = shuffledQuestionsForTaking ?? quiz.questions;
    return (
    <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-4">
      {syncQuizShowAnswers ? (() => {
        const score = roundToTwoDecimals(calcAttemptScore(effectiveQuestions, studentAnswers));
        const max = maxAttemptScore(effectiveQuestions);
        return (
          <div className="mb-3 flex items-center justify-between gap-2 rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <span>{formatMessage('quiz.totalScore', { score })}</span>
            <button
              type="button"
              onClick={async () => {
                const text = formatMessage('quiz.shareText', { title: quiz.title, score, max });
                if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                  try {
                    await navigator.share({ title: t('quiz.shareScore'), text });
                    return;
                  } catch {
                    // user cancelled or share unsupported — fall through to clipboard
                  }
                }
                const result = await copyTextToClipboard(text);
                setMessage(result.ok ? t('quiz.copyDone') : t('quiz.copyFailed'));
              }}
              className="shrink-0 rounded border border-amber-400/50 bg-amber-500/20 px-2 py-1 text-xs text-amber-50 hover:bg-amber-500/30"
            >
              {t('quiz.shareScore')}
            </button>
          </div>
        );
      })() : null}
      {quizCountdown !== null && !syncQuizShowAnswers ? (
        <div className={`mb-3 flex items-center gap-2 rounded border px-3 py-2 text-sm font-mono ${quizCountdown <= 10 ? 'border-rose-500/60 bg-rose-500/20 text-rose-200' : 'border-amber-400/40 bg-amber-500/10 text-amber-100'}`}>
          {t('quiz.countdownPrefix') ? <span>{t('quiz.countdownPrefix')}</span> : null}
          <span className="tabular-nums">{formatMmSs(quizCountdown)}</span>
          <span>{t('quiz.countdownSuffix')}</span>
        </div>
      ) : null}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-fuchsia-50">{formatMessage('quiz.inProgressTitle', { title: quiz.title })}</h2>
          <p className="mt-1 text-sm text-fuchsia-100/80">
            {syncQuizShowAnswers ? t('quiz.answersVisibleHint') : t('quiz.answerBeforeEndHint')}
          </p>
          {syncError ? <p className="mt-2 text-xs text-rose-300">{syncError}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void handleResetStudentAnswers()}
          disabled={resetStudentAnswersBusy}
          className="shrink-0 rounded-md border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
          title={t('quiz.resetAnswersHint')}
        >
          {resetStudentAnswersBusy ? t('quiz.resetAnswersBusy') : t('quiz.resetAnswers')}
        </button>
      </div>
      <div className="space-y-4">
        {quiz.questions.map((q, qIdx) => {
          const selected = studentAnswers[q.id] ?? [];
          const scoreTable = normalizeQuestionScores(quiz.questions);
          const qScore = scoreTable[qIdx] ?? 0;
          const earned = calcQuestionScore(q, selected, qScore);
          return (
            <div key={q.id} className="rounded-lg border border-slate-700 bg-slate-950/70 p-4">
              <h3 className="font-medium text-slate-100">
                {formatMessage('quiz.questionScoreHeading', { index: qIdx + 1, score: roundToTwoDecimals(qScore), question: q.question })}
              </h3>
              <div className="mt-3 space-y-2">
                {q.options.map((option, oIdx) => {
                  const isCorrect = q.answer_indices.includes(oIdx);
                  const isSelected = selected.includes(oIdx);
                  return (
                    <label key={oIdx} className={`flex items-center gap-2 rounded border px-3 py-2 ${syncQuizShowAnswers && isCorrect ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100' : 'border-slate-700 bg-slate-900 text-slate-100'}`}>
                      <input
                        type={q.type === 'single' ? 'radio' : 'checkbox'}
                        checked={isSelected}
                        onChange={() => toggleStudentAnswer(q, oIdx)}
                        disabled={syncQuizShowAnswers}
                      />
                      <span>{option.text}</span>
                      {syncQuizShowAnswers && isCorrect ? <span className="ml-auto text-xs text-emerald-300">{t('quiz.correctAnswer')}</span> : null}
                    </label>
                  );
                })}
              </div>
              {syncQuizShowAnswers ? (
                <p className={`mt-2 text-xs ${earned > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {formatMessage('quiz.questionEarnedScore', { earned: roundToTwoDecimals(earned), total: roundToTwoDecimals(qScore) })}
                </p>
              ) : null}
              {syncQuizShowAnswers ? <p className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-slate-200">{formatMessage('quiz.explanation', { explanation: q.explanation || t('quiz.noExplanation') })}</p> : null}
            </div>
          );
        })}
      </div>
      {syncQuizShowAnswers ? (() => {
        const scoreTable = normalizeQuestionScores(quiz.questions);
        const wrongQuestions = quiz.questions.filter((q, idx) => {
          const selected = studentAnswers[q.id] ?? [];
          return calcQuestionScore(q, selected, scoreTable[idx] ?? 0) === 0;
        });
        if (wrongQuestions.length === 0) return null;
        return (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
            <h3 className="mb-1 text-sm font-semibold text-rose-200">{t('quiz.reviewSection')}</h3>
            <p className="mb-3 text-xs text-rose-100/70">{t('quiz.reviewHint')}</p>
            <ul className="space-y-2">
              {wrongQuestions.map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-3 rounded border border-rose-500/20 bg-slate-950/50 px-3 py-2">
                  <span className="text-xs text-slate-200 line-clamp-2">{q.question}</span>
                  <a
                    href={pdfId ? `/play/${encodeURIComponent(pdfId)}${typeof q.page_number === 'number' ? `?page=${q.page_number}` : ''}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/25"
                  >
                    {typeof q.page_number === 'number'
                      ? formatMessage('quiz.reviewPage', { n: q.page_number })
                      : t('quiz.reviewNoPage')}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })() : null}
    </div>
  );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <Link to={pdfId ? `/play/${pdfId}` : '/'} className="text-sm text-cyan-300 hover:text-cyan-200">← {t('quiz.backToPlay')}</Link>
            <h1 className="mt-1 text-xl font-semibold">{t('quiz.pageTitle')}</h1>
            <p className="text-xs text-slate-400">{detail?.title ?? t('quiz.loadingPresentation')}</p>
          </div>
          {syncRole === 'master' ? (
            <button type="button" onClick={() => { setSelectedQuizId(null); setTitle(t('quiz.defaultTitle')); setQuestions([emptyQuestion(0)]); }} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">{t('quiz.newQuiz')}</button>
          ) : null}
        </div>
      </header>
      <main className={`mx-auto grid max-w-5xl gap-4 px-4 py-4 ${isFollowerTesting ? '' : 'lg:grid-cols-[240px_1fr]'}`}>
        {isFollowerTesting ? null : (
        <aside className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <h2 className="text-sm font-semibold text-slate-200">{t('quiz.savedQuizzes')}</h2>
          <p className="mt-1 text-xs text-slate-500">{formatMessage('quiz.syncRole', { role: syncRole === 'master' ? 'master' : 'follower' })}</p>
          {syncError ? <p className="mt-2 text-xs text-rose-300">{syncError}</p> : null}
          {savedQuizzes.length > 3 && (
            <input
              type="search"
              value={savedQuizzesSearch}
              onChange={(e) => setSavedQuizzesSearch(e.target.value)}
              placeholder={t('quiz.searchQuizzes')}
              className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          )}
          <div className="mt-3 space-y-2">
            {savedQuizzes.length === 0 ? <p className="text-xs text-slate-500">{t('quiz.noSavedQuizzes')}</p> : null}
            {savedQuizzes.length > 0 && savedQuizzesSearch.trim() && !savedQuizzes.some((q) => q.title.toLowerCase().includes(savedQuizzesSearch.trim().toLowerCase())) ? (
              <p className="text-xs text-slate-500">{t('quiz.searchNoResults').replace('{q}', savedQuizzesSearch.trim())}</p>
            ) : null}
            {savedQuizzes.filter((q) => !savedQuizzesSearch.trim() || q.title.toLowerCase().includes(savedQuizzesSearch.trim().toLowerCase())).map((quiz) => (
              <div key={quiz.id} className={`rounded-md border px-3 py-2 text-sm ${selectedQuizId === quiz.id ? 'border-cyan-500 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 text-slate-300'}`}>
                <button type="button" onClick={() => { setSelectedQuizId(quiz.id); setTitle(quiz.title); setPrompt(quiz.prompt); setQuestions(quiz.questions); setTimeLimitSeconds(quiz.time_limit_seconds ?? 0); setShuffleQuestions(quiz.shuffle_questions ?? false); }} className="block w-full text-left hover:text-white">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">{quiz.title}</span>
                    {quiz.questions.length > 0 && (
                      <span className="shrink-0 rounded-full bg-slate-700/80 px-1.5 py-0.5 text-[10px] font-normal text-slate-300">
                        {formatMessage('quiz.questionCount', { count: quiz.questions.length })}
                      </span>
                    )}
                  </span>
                </button>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => void handleStartQuiz(quiz.id)}
                    className="rounded border border-fuchsia-500/50 bg-fuchsia-500/15 px-2 py-1 text-xs text-fuchsia-100"
                    title={syncRole === 'master' ? t('quiz.startTitle') : t('quiz.masterOnlyStart')}
                  >
                    {t('quiz.start')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShowAnswers(quiz.id)}
                    disabled={syncActiveQuizId !== quiz.id || syncQuizShowAnswers}
                    className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
                    title={t('quiz.showAnswersTitle')}
                  >
                    {t('quiz.showAnswers')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleEndQuiz()}
                    disabled={syncActiveQuizId !== quiz.id}
                    className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-100 disabled:opacity-40"
                    title={t('quiz.endTitle')}
                  >
                    {t('quiz.end')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadQuizHistory(quiz.id)}
                    className="rounded border border-slate-600 bg-slate-800/60 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    title={t('quiz.historyTitle')}
                  >
                    {t('quiz.history')}
                  </button>
                  {syncRole === 'master' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleDeleteQuiz(quiz)}
                        disabled={deletingQuizId === quiz.id}
                        className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-xs text-rose-100 disabled:opacity-40"
                        title={t('quiz.deleteQuizTitle')}
                      >
                        {t('quiz.delete')}
                      </button>
                      {allPdfs.filter((p) => p.id !== pdfId).length > 0 ? (
                        <select
                          value=""
                          disabled={copyingQuizId === quiz.id}
                          onChange={(e) => { if (e.target.value) void handleCopyQuizTo(quiz, e.target.value); }}
                          className="rounded border border-sky-500/50 bg-sky-500/15 px-1 py-1 text-xs text-sky-100 disabled:opacity-40"
                        >
                          <option value="">{copyingQuizId === quiz.id ? '…' : t('quiz.copyTo')}</option>
                          {allPdfs.filter((p) => p.id !== pdfId).map((p) => (
                            <option key={p.id} value={p.id}>{p.title ?? p.id}</option>
                          ))}
                        </select>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {syncRole !== 'master' ? <p className="mt-2 text-[11px] text-slate-500">{t('quiz.followerReadonlyHint')}</p> : null}
          {syncRole === 'master' && syncActiveQuizId != null ? (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <h2 className="text-sm font-semibold text-slate-200">{t('quiz.studentsInQuiz')}</h2>
              {syncQuizProgress.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">{t('quiz.noStudentProgress')}</p>
              ) : (
                <>
                <p className="mt-1 text-xs text-fuchsia-200">
                  {formatMessage('quiz.progressSummary', { ...summarizeQuizProgress(syncQuizProgress) } as Record<string, number>)}
                </p>
                <ul className="mt-2 space-y-2">
                  {syncQuizProgress.map((p) => {
                    const ratio = p.total_questions > 0 ? Math.min(1, p.answered_count / p.total_questions) : 0;
                    return (
                      <li key={p.client_id} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-slate-200">{p.code || t('quiz.anonymousStudent')}</span>
                          <span className={p.submitted ? 'text-emerald-300' : 'text-slate-400'}>
                            {p.answered_count} / {p.total_questions}{p.submitted ? `・${t('quiz.completed')}` : ''}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full ${p.submitted ? 'bg-emerald-500' : 'bg-fuchsia-500'}`}
                            style={{ width: `${Math.round(ratio * 100)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                </>
              )}
            </div>
          ) : null}
        </aside>
        )}
        <section className="space-y-4">
          {isFollowerTesting && activeQuiz ? renderQuizTakingView(activeQuiz) : null}
          {syncRole === 'master' && historyQuizId != null ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-200">
                  {t('quiz.historyHeading')}
                  {(() => {
                    const quiz = savedQuizzes.find((q) => q.id === historyQuizId);
                    return quiz ? `：${quiz.title}` : '';
                  })()}
                </h2>
                <button type="button" onClick={() => { setHistoryQuizId(null); setHistorySessions([]); setHistoryError(null); setViewingAttemptId(null); }} className="text-xs text-slate-500 hover:text-slate-300">{t('quiz.close')}</button>
              </div>
              {historyBusy ? <p className="mt-1 text-xs text-slate-500">{t('quiz.loading')}</p> : null}
              {historyError ? <p className="mt-1 text-xs text-rose-400">{historyError}</p> : null}
              {!historyBusy && !historyError && historySessions.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">{t('quiz.noHistory')}</p>
              ) : null}
              {!historyBusy && !historyError && historySessions.length > 0 && (() => {
                const allAttempts = historySessions.flatMap((s) => s.attempts);
                const avgRaw = averageAttemptScore(allAttempts);
                const avgScore = avgRaw != null ? roundToTwoDecimals(avgRaw) : null;
                return (
                  <p className="mt-1 text-xs text-slate-400">
                    {t('quiz.historyAvgScore')
                      .replace('{total}', String(allAttempts.length))
                      .replace('{avg}', avgScore != null ? String(avgScore) : t('quiz.notScored'))}
                  </p>
                );
              })()}
              <ul className="mt-2 space-y-3">
                {(historyShowAll ? historySessions : historySessions.slice(0, 5)).map((session) => (
                  <li key={session.session_id} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
                    <div className="font-medium text-slate-300">
                      {formatMessage('quiz.sessionTime', { time: formatRelativeTime(session.submitted_at, relativeTimeLabels) })}
                      <span className="ml-1 text-slate-600" title={new Date(session.submitted_at).toLocaleString()}>ⓘ</span>
                      <span className="ml-2 text-slate-500">{formatMessage('quiz.attemptCount', { count: session.attempts.length })}</span>
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {session.attempts.map((attempt) => {
                        const expanded = viewingAttemptId === attempt.id;
                        const quiz = savedQuizzes.find((q) => q.id === historyQuizId);
                        return (
                          <li key={attempt.id} className="rounded border border-slate-800 bg-slate-900 px-2 py-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-slate-200">{attempt.code || t('quiz.anonymousStudent')}</span>
                              <span className="flex items-center gap-2 text-slate-400">
                                {attempt.score != null ? formatMessage('quiz.scorePoints', { score: roundToTwoDecimals(attempt.score) }) : t('quiz.notScored')}
                                <span className="text-slate-500">{new Date(attempt.submitted_at).toLocaleTimeString()}</span>
                                <button
                                  type="button"
                                  onClick={() => setViewingAttemptId(expanded ? null : attempt.id)}
                                  className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                                >
                                  {expanded ? t('quiz.collapse') : t('quiz.viewAnswers')}
                                </button>
                              </span>
                            </div>
                            {expanded ? (
                              quiz ? (
                                <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2 border-t border-slate-800 pt-1.5">
                                  {quiz.questions.map((q) => {
                                    const selected = attempt.answers[q.id] ?? [];
                                    return (
                                      <li key={q.id} className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5">
                                        <p className="text-slate-200">{q.question}</p>
                                        <ul className="mt-1 space-y-0.5">
                                          {q.options.map((opt, oIdx) => {
                                            const isCorrect = q.answer_indices.includes(oIdx);
                                            const isSelected = selected.includes(oIdx);
                                            return (
                                              <li
                                                key={oIdx}
                                                className={`rounded px-1.5 py-0.5 ${isCorrect ? 'text-emerald-300' : isSelected ? 'text-rose-300' : 'text-slate-400'}`}
                                              >
                                                {isSelected ? '☑' : '☐'} {opt.text}
                                                 {isCorrect ? <span className="ml-1 text-[10px] text-emerald-400">{t('quiz.correctAnswerParen')}</span> : null}
                                                 {isSelected && !isCorrect ? <span className="ml-1 text-[10px] text-rose-400">{t('quiz.selectedWrongParen')}</span> : null}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                         {q.explanation ? <p className="mt-1 text-[11px] text-slate-500">{formatMessage('quiz.explanation', { explanation: q.explanation })}</p> : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                 <p className="mt-1 text-[11px] text-slate-500">{t('quiz.historyQuestionMissing')}</p>
                              )
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              {historySessions.length > 5 && (
                <button
                  type="button"
                  onClick={() => setHistoryShowAll((prev) => !prev)}
                  className="mt-2 text-xs text-cyan-400 hover:text-cyan-300"
                >
                  {historyShowAll ? t('quiz.historyShowLess') : t('quiz.historyShowMore').replace('{n}', String(historySessions.length))}
                </button>
              )}
            </div>
          ) : null}
          {isFollowerTesting ? null : (
          <>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <label className="block text-sm text-slate-300">{t('quiz.titleLabel')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            <label className="mt-3 block text-sm text-slate-300">{t('quiz.promptLabel')}</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            <label className="mt-3 block text-sm text-slate-300">{t('quiz.timeLimitLabel')}</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={3600}
                step={30}
                value={timeLimitSeconds}
                onChange={(e) => setTimeLimitSeconds(clamp(Number(e.target.value), 0, 3600))}
                className="w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <span className="text-xs text-slate-400">{timeLimitSeconds === 0 ? t('quiz.timeLimitNone') : t('quiz.timeLimitUnit')}</span>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
              />
              <span className="text-sm text-slate-300">{t('quiz.shuffleQuestions')}</span>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void handleGenerate()} disabled={busy || !prompt.trim()} className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-4 py-2 text-sm text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-50">{busy ? t('quiz.busy') : t('quiz.generate')}</button>
              <button type="button" onClick={() => void handleSave()} disabled={busy || !canSave} className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50">{t('quiz.save')}</button>
              <button type="button" onClick={() => setQuestions((prev) => [...prev, emptyQuestion(prev.length)])} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">{t('quiz.addQuestion')}</button>
              {questions.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    const text = formatQuizQuestionsText(questions, { explanationLabel: t('quiz.exportExplanationLabel') });
                    const result = await copyTextToClipboard(text);
                    setCopyQuestionsStatus(result.ok ? 'ok' : 'fail');
                    setTimeout(() => setCopyQuestionsStatus('idle'), 2000);
                  }}
                  className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25"
                >
                  {copyQuestionsStatus === 'ok' ? t('quiz.copyQuestionsDone') : copyQuestionsStatus === 'fail' ? t('quiz.copyQuestionsFail') : t('quiz.copyQuestions')}
                </button>
              )}
              {questions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const data = { title, questions };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${title.trim() || 'quiz'}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="rounded-md border border-slate-600 bg-slate-800/70 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
                >
                  {t('quiz.exportJson')}
                </button>
              )}
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleImportFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="rounded-md border border-slate-600 bg-slate-800/70 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
              >
                {importMsg ?? t('quiz.importJson')}
              </button>
              {questions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('quiz.confirmClear'))) {
                      setQuestions([emptyQuestion(0)]);
                    }
                  }}
                  className="rounded-md border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/20"
                >
                  {t('quiz.clearAllQuestions')}
                </button>
              )}
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">{t('quiz.aiGeneratePageLabel')}</span>
                <input
                  type="number"
                  min={1}
                  max={detail?.pages?.length ?? 999}
                  value={aiQuizPageNumber}
                  onChange={(e) => setAiQuizPageNumber(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-center text-xs text-slate-100"
                />
                {t('quiz.aiGeneratePageSuffix') && <span className="text-xs text-slate-400">{t('quiz.aiGeneratePageSuffix')}</span>}
                <button
                  type="button"
                  onClick={() => void handleAiGenerateQuestion()}
                  disabled={aiQuizBusy || busy}
                  className="rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1 text-xs text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
                >
                  {aiQuizBusy ? t('quiz.aiGenerating') : t('quiz.aiGenerateQuestion')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowEditorAnswers((prev) => !prev)}
                className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/20"
              >
                {showEditorAnswers ? t('quiz.hideEditorAnswers') : t('quiz.showEditorAnswers')}
              </button>
            </div>
            {scoreSumExceeded != null ? (
              <p className="mt-2 text-sm text-rose-300">{formatMessage('quiz.scoreSumExceeded', { sum: scoreSumExceeded })}</p>
            ) : null}
            {message ? <p className="mt-2 text-sm text-emerald-300">{message}</p> : null}
            {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
            {questions.length > 20 ? (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {t('quiz.tooManyQuestionsWarning').replace('{count}', String(questions.length))}
              </p>
            ) : null}
          </div>
          {questions.map((q, qIdx) => (
            <div
              key={q.id}
              draggable
              onDragStart={() => setDraggingQIdx(qIdx)}
              onDragEnd={() => setDraggingQIdx(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingQIdx === null || draggingQIdx === qIdx) return;
                setQuestions((prev) => {
                  const next = [...prev];
                  const moved = next.splice(draggingQIdx, 1)[0];
                  if (!moved) return prev;
                  next.splice(qIdx, 0, moved);
                  return next;
                });
                setDraggingQIdx(null);
              }}
              className={`rounded-xl border border-slate-800 bg-slate-900/70 p-4 ${draggingQIdx === qIdx ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="cursor-grab text-slate-500 hover:text-slate-300" title={t('quiz.dragToReorder')}>⠿</span>
                  <h3 className="font-semibold text-slate-100">{formatMessage('quiz.questionHeading', { index: qIdx + 1 })}</h3>
                </div>
                <button type="button" onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIdx))} className="text-sm text-rose-300 hover:text-rose-200">{t('quiz.delete')}</button>
              </div>
              <select value={q.type} onChange={(e) => updateQuestion(qIdx, { type: e.target.value as QuizQuestionType, answer_indices: [0] })} className="mt-3 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm">
                <option value="single">{t('quiz.singleChoice')}</option>
                <option value="multiple">{t('quiz.multipleChoice')}</option>
              </select>
              <div className="relative mt-3">
                <textarea value={q.question} onChange={(e) => updateQuestion(qIdx, { question: e.target.value })} rows={2} placeholder={t('quiz.questionPlaceholder')} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                {q.question.length > 0 && (
                  <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] text-slate-500">{q.question.length}</span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs text-slate-400">{t('quiz.scoreLabel')}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={typeof q.score === 'number' ? q.score : ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        updateQuestion(qIdx, { score: null });
                        return;
                      }
                      const n = Number(raw);
                      updateQuestion(qIdx, { score: Number.isFinite(n) && n >= 0 ? n : null });
                    }}
                    placeholder={t('quiz.scorePlaceholder')}
                    className="mt-1 w-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400">{t('quiz.pageNumberLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={typeof q.page_number === 'number' ? q.page_number : ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        updateQuestion(qIdx, { page_number: null });
                        return;
                      }
                      const n = Number(raw);
                      updateQuestion(qIdx, { page_number: Number.isFinite(n) && n >= 1 ? Math.floor(n) : null });
                    }}
                    placeholder={t('quiz.pageNumberPlaceholder')}
                    className="mt-1 w-24 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {q.options.map((option, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-2">
                    {showEditorAnswers ? (
                      <input type={q.type === 'single' ? 'radio' : 'checkbox'} checked={q.answer_indices.includes(oIdx)} onChange={() => toggleAnswer(qIdx, oIdx)} />
                    ) : null}
                    <input value={option.text} onChange={(e) => updateOption(qIdx, oIdx, e.target.value)} placeholder={formatMessage('quiz.optionPlaceholder', { index: oIdx + 1 })} className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                  </div>
                ))}
              </div>
              {showEditorAnswers ? (
                <textarea value={q.explanation} onChange={(e) => updateQuestion(qIdx, { explanation: e.target.value })} rows={2} placeholder={t('quiz.explanationPlaceholder')} className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              ) : null}
            </div>
          ))}
          </>
          )}
        </section>
      </main>
    </div>
  );
}
