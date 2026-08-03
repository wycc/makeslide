import { useCallback, useEffect, useState } from 'react';
import { useI18n, type TranslationKey } from '../../i18n';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { useOverlayDismiss } from '../../components/useOverlayDismiss';
import { usePlayPageContext } from './PlayPageContext';
import { OPEN_AI_TUTOR_EVENT } from './notebookTabs';
import { addReviewItems } from '../../lib/reviewList';
import { getOrCreateViewerId } from '../../lib/viewerId';
import {
  ApiError,
  endTutorQuizSession,
  fetchNextTutorQuizQuestion,
  fetchTutorQuizSession,
  fetchTutorQuizTopics,
  startTutorQuizSession,
  submitTutorQuizAnswer,
  type TutorQuizAnswerResult,
  type TutorQuizAssessment,
  type TutorQuizTopic,
  type TutorQuizQuestion,
  type TutorQuizSession,
} from '../../lib/api';
import {
  accuracyPercent,
  countAnswered,
  findPendingQuestion,
  isTopicSelected,
  latestAssessment,
  levelBarPercent,
  levelToneClass,
  toggleTopic,
  topicMastery,
  topicMasteryBorderClass,
  topicMasteryToneClass,
  untilNextAssessment,
} from '../../lib/tutorQuizProgress';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function levelNameKey(level: number): TranslationKey {
  const bounded = Math.min(5, Math.max(1, Math.round(level)));
  return `play.tutorQuiz.levelName.${bounded}` as TranslationKey;
}

function trendKey(trend: TutorQuizAssessment['trend']): TranslationKey {
  return `play.tutorQuiz.trend.${trend ?? 'first'}` as TranslationKey;
}

/** 後端的錯誤碼對到使用者看得懂的說明；未知錯誤退回泛用訊息。 */
function errorKeyFor(err: unknown): TranslationKey {
  if (err instanceof ApiError) {
    if (err.code === 'NO_CONTENT') return 'play.tutorQuiz.errorNoContent';
    if (err.code === 'SESSION_LIMIT_REACHED') return 'play.tutorQuiz.errorLimit';
  }
  return 'play.tutorQuiz.errorGeneric';
}

interface TutorQuizDialogProps {
  onClose: () => void;
  /** 練習狀態變動時通知側欄更新摘要（已答題數／目前難度）。 */
  onSessionChange?: () => void;
}

/**
 * 課後輔導測試的作答視窗：一次一題，答完立刻看到對錯與解說，難度依作答升降，
 * 每 10 題插入一張難度評估卡。正解由後端在作答後才回傳，所以這裡不做也無法做本地判分。
 */
export function TutorQuizDialog({ onClose, onSessionChange }: TutorQuizDialogProps) {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);
  const { pdfId, detail, setCurrentIdx, setPageAskInput } = usePlayPageContext();
  const format = (key: TranslationKey, values: Record<string, string | number>) => interpolateTemplate(t(key), values);
  const clientId = getOrCreateViewerId();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [session, setSession] = useState<TutorQuizSession | null>(null);
  // 選取的主題（複選）；空陣列代表整份簡報。
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState('');
  const [question, setQuestion] = useState<TutorQuizQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<TutorQuizAnswerResult | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [assessment, setAssessment] = useState<TutorQuizAssessment | null>(null);
  const [reviewAdded, setReviewAdded] = useState(false);
  const [topics, setTopics] = useState<TutorQuizTopic[] | null>(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  // 進行中的練習按「重新開始」時先回到主題選擇畫面，而不是沿用舊主題直接開新一輪——
  // 換一輪練習通常就是想換個主題練。
  const [choosing, setChoosing] = useState(false);

  // 開啟時還原進行中的練習：可能停在「已出題但還沒答」，也可能停在「剛答完等下一題」。
  useEffect(() => {
    if (!pdfId) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await fetchTutorQuizSession(pdfId, clientId);
        if (cancelled) return;
        setSession(state.session);
        setSelectedTopics(state.session?.topics ?? []);
        setAnsweredCount(countAnswered(state.questions));
        setCorrectCount(state.session?.correct_count ?? 0);
        setAssessment(latestAssessment(state.assessments));
        setQuestion(findPendingQuestion(state.questions));
      } catch {
        if (!cancelled) setError('play.tutorQuiz.errorGeneric');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfId, clientId]);

  // 沒有進行中的練習，或按了「重新開始」時，顯示主題選擇畫面。
  const showIntro = !session || choosing;

  // 主題清單只在真的要選主題時才抓：第一次會讓後端就地分析（一次 AI 呼叫），
  // 練習進行中重開視窗的人不該為此付代價。
  const loadTopics = useCallback(async (refresh = false) => {
    if (!pdfId) return;
    setTopicsLoading(true);
    try {
      const data = await fetchTutorQuizTopics(pdfId, clientId, refresh);
      setTopics(data.topics);
    } catch {
      setTopics([]); // 抓不到就只留自行輸入，不擋住練習
    } finally {
      setTopicsLoading(false);
    }
  }, [pdfId, clientId]);

  useEffect(() => {
    if (loading || !showIntro || topics !== null || topicsLoading) return;
    void loadTopics();
  }, [loading, showIntro, topics, topicsLoading, loadTopics]);

  const requestNext = useCallback(async (sessionId: number) => {
    if (!pdfId) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fetchNextTutorQuizQuestion(pdfId, sessionId, clientId);
      setQuestion(next);
      setSelected(null);
      setResult(null);
      setReviewAdded(false);
    } catch (err) {
      setError(errorKeyFor(err));
    } finally {
      setBusy(false);
    }
  }, [pdfId, clientId]);

  const handleStart = async () => {
    if (!pdfId) return;
    setBusy(true);
    setError(null);
    try {
      const state = await startTutorQuizSession(pdfId, clientId, selectedTopics);
      setChoosing(false);
      setSession(state.session);
      setAnsweredCount(0);
      setCorrectCount(0);
      setAssessment(null);
      setResult(null);
      setQuestion(null);
      onSessionChange?.();
      if (state.session) await requestNext(state.session.id);
    } catch (err) {
      setError(errorKeyFor(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!pdfId || !session || !question || selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await submitTutorQuizAnswer(pdfId, session.id, clientId, question.seq, selected);
      setResult(answer);
      setAnsweredCount(answer.answered_count);
      setCorrectCount(answer.correct_count);
      if (answer.assessment) setAssessment(answer.assessment);
      setSession((prev) => (prev ? { ...prev, current_level: answer.next_level, correct_count: answer.correct_count } : prev));
      onSessionChange?.();
    } catch (err) {
      setError(errorKeyFor(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (pdfId && session) {
      try { await endTutorQuizSession(pdfId, session.id, clientId); } catch { /* 關閉視窗不該因為收尾失敗而卡住 */ }
      onSessionChange?.();
    }
    onClose();
  };

  // 答錯的題目丟進既有的複習清單，並可直接跳到依據頁或轉給 AI 導師追問。
  const handleAddReview = () => {
    if (!pdfId || !question) return;
    addReviewItems([{
      pdfId,
      pdfTitle: detail?.title ?? '',
      pageNumber: question.page_number ?? 1,
      questionText: question.question,
      addedAt: new Date().toISOString(),
    }]);
    setReviewAdded(true);
  };

  const handleAskTutor = () => {
    if (!question) return;
    if (question.page_number) setCurrentIdx(question.page_number - 1);
    setPageAskInput(question.question);
    window.dispatchEvent(new CustomEvent(OPEN_AI_TUTOR_EVENT));
    onClose();
  };

  const currentLevel = question?.level ?? session?.current_level ?? 2;
  const untilNext = untilNextAssessment(answeredCount);
  // 剛答完的那題若觸發評估就顯示；不在作答狀態（剛開啟／剛還原）時，只有停在評估點才顯示，
  // 免得下一題出來以後上一輪的評估還黏在畫面上。
  const showAssessment = result ? Boolean(result.assessment) : !question && assessment?.through_seq === answeredCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('play.tutorQuiz.title')}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text">🎯 {t('play.tutorQuiz.title')}</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {session
                ? `${format('play.tutorQuiz.scoreLine', { correct: correctCount, answered: answeredCount })} · ${format('play.tutorQuiz.untilAssessment', { n: untilNext })}`
                : t('play.tutorQuiz.hint')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${levelToneClass(currentLevel)}`}>
              L{Math.round(currentLevel)} {t(levelNameKey(currentLevel))}
            </span>
            <button
              type="button"
              onClick={() => void handleEnd()}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted hover:text-text"
            >
              {session ? t('play.tutorQuiz.endButton') : t('play.tutorQuiz.close')}
            </button>
          </div>
        </div>

        {/* 難度軸：讓「現在停在哪一級」一眼可見，而不是只有一個數字 */}
        <div className="h-1 w-full bg-surface-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${levelBarPercent(currentLevel)}%` }} />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted">…</p>
          ) : showIntro ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text">{t('play.tutorQuiz.introTitle')}</h3>
              <p className="text-xs leading-relaxed text-muted">{t('play.tutorQuiz.introBody')}</p>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text">{t('play.tutorQuiz.topicPickLabel')}</span>
                <button
                  type="button"
                  onClick={() => void loadTopics(true)}
                  disabled={topicsLoading}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
                >
                  {t('play.tutorQuiz.topicsRefresh')}
                </button>
              </div>

              {topicsLoading ? (
                <p className="text-xs text-muted">{t('play.tutorQuiz.topicsLoading')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedTopics([])}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selectedTopics.length === 0
                        ? 'border-primary bg-primary/15 text-text'
                        : 'border-border bg-surface text-muted hover:bg-surface-muted hover:text-text'
                    }`}
                  >
                    {t('play.tutorQuiz.topicWholeDeck')}
                  </button>
                  {/* 選單裡的主題，加上使用者自己輸入而不在清單中的（否則自訂主題選了會看不見） */}
                  {[
                    ...(topics ?? []),
                    ...selectedTopics
                      .filter((s) => !(topics ?? []).some((t) => t.topic === s))
                      .map((topic) => ({ topic, answered: 0, correct: 0 })),
                  ].map((item) => {
                    const picked = isTopicSelected(selectedTopics, item.topic);
                    const mastery = topicMastery(item);
                    return (
                      <button
                        key={item.topic}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => setSelectedTopics((prev) => toggleTopic(prev, item.topic))}
                        title={
                          mastery === 'untested'
                            ? t('play.tutorQuiz.topicUntested')
                            : format('play.tutorQuiz.topicScoreTitle', { correct: item.correct, answered: item.answered })
                        }
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                          picked
                            ? 'border-primary bg-primary/15 text-text'
                            : `${topicMasteryBorderClass(mastery)} text-muted hover:bg-surface-muted hover:text-text`
                        }`}
                      >
                        <span>{picked ? `✓ ${item.topic}` : item.topic}</span>
                        {/* 練過的主題標上正確率並依分數著色；沒練過的不標，免得和「零分」混淆 */}
                        {mastery !== 'untested' && (
                          <span className={`font-medium ${topicMasteryToneClass(mastery)}`}>
                            {accuracyPercent(item.correct, item.answered)}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted">
                {selectedTopics.length === 0
                  ? t('play.tutorQuiz.topicNoneHint')
                  : format('play.tutorQuiz.topicSelectedCount', { count: selectedTopics.length })}
              </p>
              {/* 有練習紀錄時才說明配色，沒紀錄時那句話沒有對應的東西可看 */}
              {(topics ?? []).some((item) => item.answered > 0) && (
                <p className="text-[11px] text-muted">{t('play.tutorQuiz.topicLegend')}</p>
              )}
              {!topicsLoading && topics !== null && topics.length === 0 && (
                <p className="text-[11px] text-muted">{t('play.tutorQuiz.topicsEmpty')}</p>
              )}

              <label className="block text-xs font-medium text-text" htmlFor="tutor-quiz-topic">
                {t('play.tutorQuiz.topicCustomLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  id="tutor-quiz-topic"
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || !customTopic.trim()) return;
                    e.preventDefault();
                    setSelectedTopics((prev) => toggleTopic(prev, customTopic));
                    setCustomTopic('');
                  }}
                  maxLength={200}
                  placeholder={t('play.tutorQuiz.topicPlaceholder')}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!customTopic.trim()}
                  onClick={() => {
                    setSelectedTopics((prev) => toggleTopic(prev, customTopic));
                    setCustomTopic('');
                  }}
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-muted hover:text-text disabled:opacity-40"
                >
                  {t('play.tutorQuiz.topicAdd')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {question && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <span>{format('play.tutorQuiz.questionSeq', { seq: question.seq })}</span>
                    <span className={`rounded border px-1.5 py-0.5 ${levelToneClass(question.level)}`}>
                      L{question.level} {t(levelNameKey(question.level))}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-relaxed text-text">{question.question}</p>
                  <div className="space-y-2">
                    {question.options.map((option, idx) => {
                      const isPicked = selected === idx;
                      const isAnswer = result !== null && idx === result.correct_index;
                      const isWrongPick = result !== null && isPicked && !result.correct;
                      const tone = isAnswer
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                        : isWrongPick
                          ? 'border-rose-500/60 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                          : isPicked
                            ? 'border-primary bg-primary/10 text-text'
                            : 'border-border bg-surface text-text hover:bg-surface-muted';
                      return (
                        <button
                          key={`${question.seq}-${idx}`}
                          type="button"
                          disabled={result !== null || busy}
                          onClick={() => setSelected(idx)}
                          className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${tone}`}
                        >
                          <span className="shrink-0 font-semibold">{OPTION_LETTERS[idx] ?? idx + 1}</span>
                          <span className="min-w-0 flex-1">{option}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {result && (
                <div className={`rounded-lg border px-3 py-3 ${result.correct ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-semibold ${result.correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {result.correct ? `✓ ${t('play.tutorQuiz.correct')}` : `✕ ${t('play.tutorQuiz.wrong')}`}
                    </span>
                    <span className="text-[11px] text-muted">
                      {format(
                        result.next_level > result.level
                          ? 'play.tutorQuiz.levelUp'
                          : result.next_level < result.level
                            ? 'play.tutorQuiz.levelDown'
                            : 'play.tutorQuiz.levelSame',
                        { level: result.next_level },
                      )}
                    </span>
                  </div>
                  {result.explanation && <p className="mt-1.5 text-xs leading-relaxed text-text">{result.explanation}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.page_number !== null && (
                      <button
                        type="button"
                        onClick={() => setCurrentIdx((result.page_number ?? 1) - 1)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-muted hover:text-text"
                      >
                        {format('play.tutorQuiz.gotoPage', { page: result.page_number })}
                      </button>
                    )}
                    {!result.correct && (
                      <>
                        <button
                          type="button"
                          onClick={handleAddReview}
                          disabled={reviewAdded}
                          className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-muted hover:text-text disabled:opacity-60"
                        >
                          {reviewAdded ? t('play.tutorQuiz.addedToReview') : t('play.tutorQuiz.addToReview')}
                        </button>
                        <button
                          type="button"
                          onClick={handleAskTutor}
                          className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-muted hover:text-text"
                        >
                          {t('play.tutorQuiz.askTutor')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* 每 10 題的難度評估：作答當下由 result 帶回；重整後若正好停在評估點，由 GET session 還原最後一次。 */}
              {showAssessment && assessment && (
                <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-3">
                  <h4 className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
                    📈 {format('play.tutorQuiz.assessmentTitle', { through: assessment.through_seq })}
                  </h4>
                  <p className="mt-1 text-xs text-indigo-900/90 dark:text-indigo-200/90">
                    {format('play.tutorQuiz.assessmentLevel', { level: assessment.level_estimate })}
                    {' · '}
                    {format('play.tutorQuiz.assessmentAccuracy', {
                      correct: assessment.correct_count,
                      total: assessment.total ?? 10,
                      percent: accuracyPercent(assessment.correct_count, assessment.total ?? 10),
                    })}
                    {' · '}
                    {t(trendKey(assessment.trend))}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-text">
                    {assessment.summary || t('play.tutorQuiz.assessmentNoSummary')}
                  </p>
                  {assessment.weak_topics.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                      <span>{t('play.tutorQuiz.weakTopics')}：</span>
                      {assessment.weak_topics.map((topicName) => (
                        <span key={topicName} className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-indigo-800 dark:text-indigo-200">
                          {topicName}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}

              {!question && !busy && <p className="py-6 text-center text-sm text-muted">{t('play.tutorQuiz.hint')}</p>}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {t(error)}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-[11px] text-muted">{busy ? t('play.tutorQuiz.generating') : ''}</span>
          <div className="flex items-center gap-2">
            {session && !choosing && (
              <button
                type="button"
                onClick={() => setChoosing(true)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
              >
                {t('play.tutorQuiz.restartButton')}
              </button>
            )}
            {session && choosing && (
              <button
                type="button"
                onClick={() => setChoosing(false)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
              >
                {t('play.tutorQuiz.backToPractice')}
              </button>
            )}
            {showIntro ? (
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={busy || loading}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {t('play.tutorQuiz.startButton')}
              </button>
            ) : result ? (
              <button
                type="button"
                onClick={() => void requestNext(session.id)}
                disabled={busy}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {t('play.tutorQuiz.nextQuestion')}
              </button>
            ) : question ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy || selected === null}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {t('play.tutorQuiz.submitAnswer')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void requestNext(session.id)}
                disabled={busy}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {error ? t('play.tutorQuiz.retry') : t('play.tutorQuiz.continueButton')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
