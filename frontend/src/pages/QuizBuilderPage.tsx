import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError,
  fetchPdfDetail,
  fetchPlaybackSyncState,
  fetchQuizSets,
  generateQuizSet,
  joinPlaybackSync,
  saveQuizSet,
  updatePlaybackSyncState,
} from '../lib/api';
import type { PdfDetail, QuizQuestion, QuizQuestionType, QuizSet } from '../types';

function emptyQuestion(index: number): QuizQuestion {
  return {
    id: `q${index + 1}`,
    type: 'single',
    question: '',
    options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }],
    answer_indices: [0],
    explanation: '',
  };
}

export default function QuizBuilderPage() {
  const { id: pdfId } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PdfDetail | null>(null);
  const [savedQuizzes, setSavedQuizzes] = useState<QuizSet[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<number | null>(null);
  const [title, setTitle] = useState('課堂測驗');
  const [prompt, setPrompt] = useState('請依整份簡報產生 5 題單選或多選題，難度適中，包含解析。');
  const [questions, setQuestions] = useState<QuizQuestion[]>([emptyQuestion(0)]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncRole, setSyncRole] = useState<'master' | 'follower'>('follower');
  const [syncActiveQuizId, setSyncActiveQuizId] = useState<number | null>(null);
  const [syncQuizShowAnswers, setSyncQuizShowAnswers] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, number[]>>({});
  const syncClientIdRef = useRef('');

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
        }
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : '載入測驗資料失敗');
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdfId]);

  const canSave = useMemo(
    () => title.trim() && questions.length > 0 && questions.every((q) => q.question.trim() && q.options.filter((o) => o.text.trim()).length >= 2),
    [questions, title],
  );

  const activeQuiz = useMemo(
    () => savedQuizzes.find((quiz) => quiz.id === syncActiveQuizId) ?? null,
    [savedQuizzes, syncActiveQuizId],
  );

  const isFollowerTesting = syncRole === 'follower' && activeQuiz != null;

  useEffect(() => {
    if (!pdfId) return;
    const storageKey = `makeslide.sync.client.${pdfId}`;
    const existing = window.localStorage.getItem(storageKey);
    const next = existing || `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, next);
    syncClientIdRef.current = next;
    let cancelled = false;

    const refresh = async () => {
      try {
        try {
          const joined = await joinPlaybackSync(pdfId, next);
          if (cancelled) return;
          setSyncRole(joined.role);
          setSyncActiveQuizId(joined.active_quiz_id ?? null);
          setSyncQuizShowAnswers(joined.quiz_show_answers ?? false);
        } catch (err) {
          const state = await fetchPlaybackSyncState(pdfId, next);
          if (cancelled) return;
          setSyncRole(state.role);
          setSyncActiveQuizId(state.active_quiz_id ?? null);
          setSyncQuizShowAnswers(state.quiz_show_answers ?? false);
        }
        setSyncError(null);
      } catch (err) {
        if (!cancelled) setSyncError(err instanceof ApiError ? err.message : '同步測驗狀態讀取失敗');
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

  const handleStartQuiz = useCallback(
    async (quizId: number) => {
      try {
        await sendQuizSyncState(quizId, false);
        setMessage('已開始測驗，follower 會進入測驗模式且暫不顯示答案。');
      } catch (err) {
        setSyncError(err instanceof ApiError ? err.message : '開始測驗失敗');
      }
    },
    [sendQuizSyncState],
  );

  const handleFinishQuiz = useCallback(
    async (quizId: number) => {
      try {
        await sendQuizSyncState(quizId, true);
        setMessage('已結束測驗，follower 現在會顯示正確答案與解析。');
      } catch (err) {
        setSyncError(err instanceof ApiError ? err.message : '結束測驗失敗');
      }
    },
    [sendQuizSyncState],
  );

  const handleGenerate = async () => {
    if (!pdfId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const generated = await generateQuizSet(pdfId, prompt, questions.filter((q) => q.question.trim()));
      setTitle(generated.title);
      setQuestions(generated.questions);
      setMessage('AI 已依提示詞更新問題列表，可繼續下指令或手動微調。');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI 產生測驗失敗');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!pdfId || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveQuizSet(pdfId, { title, prompt, questions, quizId: selectedQuizId });
      setSelectedQuizId(saved.id);
      setSavedQuizzes((prev) => [saved, ...prev.filter((q) => q.id !== saved.id)]);
      setMessage('測驗已儲存，可之後重複載入使用。');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存測驗失敗');
    } finally {
      setBusy(false);
    }
  };

  const renderQuizTakingView = (quiz: QuizSet) => (
    <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-fuchsia-50">測驗進行中：{quiz.title}</h2>
        <p className="mt-1 text-sm text-fuchsia-100/80">
          {syncQuizShowAnswers ? '測驗已結束，以下顯示正確答案與解析。' : '請作答；測驗結束前不會顯示正確答案。'}
        </p>
      </div>
      <div className="space-y-4">
        {quiz.questions.map((q, qIdx) => {
          const selected = studentAnswers[q.id] ?? [];
          return (
            <div key={q.id} className="rounded-lg border border-slate-700 bg-slate-950/70 p-4">
              <h3 className="font-medium text-slate-100">第 {qIdx + 1} 題：{q.question}</h3>
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
                      {syncQuizShowAnswers && isCorrect ? <span className="ml-auto text-xs text-emerald-300">正確答案</span> : null}
                    </label>
                  );
                })}
              </div>
              {syncQuizShowAnswers ? <p className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-slate-200">解析：{q.explanation || '（無解析）'}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <Link to={pdfId ? `/play/${pdfId}` : '/'} className="text-sm text-cyan-300 hover:text-cyan-200">← 返回播放頁</Link>
            <h1 className="mt-1 text-xl font-semibold">自動測驗生成</h1>
            <p className="text-xs text-slate-400">{detail?.title ?? '載入簡報中…'}</p>
          </div>
          <button type="button" onClick={() => { setSelectedQuizId(null); setTitle('課堂測驗'); setQuestions([emptyQuestion(0)]); }} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">新增測驗</button>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <h2 className="text-sm font-semibold text-slate-200">已儲存測驗</h2>
          <p className="mt-1 text-xs text-slate-500">同步角色：{syncRole === 'master' ? 'master' : 'follower'}</p>
          {syncError ? <p className="mt-2 text-xs text-rose-300">{syncError}</p> : null}
          <div className="mt-3 space-y-2">
            {savedQuizzes.length === 0 ? <p className="text-xs text-slate-500">尚未儲存測驗。</p> : null}
            {savedQuizzes.map((quiz) => (
              <div key={quiz.id} className={`rounded-md border px-3 py-2 text-sm ${selectedQuizId === quiz.id ? 'border-cyan-500 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 text-slate-300'}`}>
                <button type="button" onClick={() => { setSelectedQuizId(quiz.id); setTitle(quiz.title); setPrompt(quiz.prompt); setQuestions(quiz.questions); }} className="block w-full text-left hover:text-white">
                  <span className="block font-medium">{quiz.title}</span>
                  <span className="text-xs text-slate-500">{quiz.questions.length} 題</span>
                </button>
                {syncRole === 'master' ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" onClick={() => void handleStartQuiz(quiz.id)} className="rounded border border-fuchsia-500/50 bg-fuchsia-500/15 px-2 py-1 text-xs text-fuchsia-100">開始測試</button>
                    <button type="button" onClick={() => void handleFinishQuiz(quiz.id)} disabled={syncActiveQuizId !== quiz.id} className="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-100 disabled:opacity-40">結束並顯示答案</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </aside>
        <section className="space-y-4">
          {isFollowerTesting && activeQuiz ? renderQuizTakingView(activeQuiz) : null}
          {isFollowerTesting ? null : (
          <>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <label className="block text-sm text-slate-300">測驗名稱</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            <label className="mt-3 block text-sm text-slate-300">給 AI 的指令</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void handleGenerate()} disabled={busy || !prompt.trim()} className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-4 py-2 text-sm text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-50">{busy ? '處理中…' : '請 AI 產生/修改問題列表'}</button>
              <button type="button" onClick={() => void handleSave()} disabled={busy || !canSave} className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50">儲存測驗</button>
              <button type="button" onClick={() => setQuestions((prev) => [...prev, emptyQuestion(prev.length)])} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">手動新增問題</button>
            </div>
            {message ? <p className="mt-2 text-sm text-emerald-300">{message}</p> : null}
            {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
          </div>
          {questions.map((q, qIdx) => (
            <div key={q.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-100">第 {qIdx + 1} 題</h3>
                <button type="button" onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIdx))} className="text-sm text-rose-300 hover:text-rose-200">刪除</button>
              </div>
              <select value={q.type} onChange={(e) => updateQuestion(qIdx, { type: e.target.value as QuizQuestionType, answer_indices: [0] })} className="mt-3 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm">
                <option value="single">單選</option>
                <option value="multiple">多選</option>
              </select>
              <textarea value={q.question} onChange={(e) => updateQuestion(qIdx, { question: e.target.value })} rows={2} placeholder="輸入題目" className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              <div className="mt-3 space-y-2">
                {q.options.map((option, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-2">
                    <input type={q.type === 'single' ? 'radio' : 'checkbox'} checked={q.answer_indices.includes(oIdx)} onChange={() => toggleAnswer(qIdx, oIdx)} />
                    <input value={option.text} onChange={(e) => updateOption(qIdx, oIdx, e.target.value)} placeholder={`選項 ${oIdx + 1}`} className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                  </div>
                ))}
              </div>
              <textarea value={q.explanation} onChange={(e) => updateQuestion(qIdx, { explanation: e.target.value })} rows={2} placeholder="解析" className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </div>
          ))}
          </>
          )}
        </section>
      </main>
    </div>
  );
}
