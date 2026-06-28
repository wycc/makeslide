import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { copyTextToClipboard } from '../../lib/clipboard';
import type { SyncFollowerQuestion } from '../../types';

function CopyAllQuestionsButton({ questions }: { questions: SyncFollowerQuestion[] }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState<string | null>(null);
  const handleCopy = () => {
    const text = questions
      .map((q) => `[${q.code || q.display_name || t('play.sync.anonymous')}] ${q.question}`)
      .join('\n');
    void copyTextToClipboard(text).then((ok) => {
      setMsg(ok ? t('play.header.copyAllQuestionsDone') : t('play.header.copyAllQuestionsFail'));
      setTimeout(() => setMsg(null), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {msg ?? t('play.header.copyAllQuestions')}
    </button>
  );
}

/**
 * 同步提問面板：follower 看到的是提問輸入列，master 看到的是問題清單與控制按鈕。
 * 抽成共用元件，讓 header（編輯模式）與全螢幕的訊息面板共用同一份內容。
 */
export function SyncQuestionsPanel() {
  const { t } = useI18n();
  const {
    pdfId,
    syncRole,
    syncFollowerQuestionInput,
    setSyncFollowerQuestionInput,
    handleSubmitFollowerQuestion,
    handleRaiseHand,
    syncFollowerQuestions,
    syncDisplayedQuestionId,
    handleToggleDisplayedQuestion,
    handleDeleteFollowerQuestion,
    handleClearFollowerQuestions,
    handleAiAnswerFollowerQuestions,
    handleHideAiAnswer,
    handleSummarizeFollowerQuestions,
    syncAiAnswer,
    syncAiAnswerBusy,
    questionSummary,
    questionSummaryBusy,
  } = usePlayPageContext();

  const followerQuestionCountText = t('play.sync.followerQuestionCount').replace('{count}', String(syncFollowerQuestions.length));

  if (syncRole === 'follower') {
    return (
      <div className="flex gap-2">
        <input
          value={syncFollowerQuestionInput}
          onChange={(e) => setSyncFollowerQuestionInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmitFollowerQuestion();
          }}
          placeholder={t('play.sync.questionPlaceholder')}
          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-text dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          maxLength={500}
        />
        <button
          type="button"
          onClick={() => void handleSubmitFollowerQuestion()}
          disabled={!syncFollowerQuestionInput.trim()}
          className="rounded border border-cyan-300 bg-cyan-50 px-3 py-1 text-cyan-700 disabled:opacity-40 dark:border-cyan-500/50 dark:bg-cyan-500/15 dark:text-cyan-100"
        >
          {t('play.sync.submitQuestion')}
        </button>
        <button
          type="button"
          onClick={() => void handleRaiseHand()}
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-100"
          title={t('play.sync.raiseHandTitle')}
        >
          🖐 {t('play.sync.raiseHand')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-text">
          {followerQuestionCountText}
          <span className="ml-2 text-muted">{t('play.sync.aiAnswerShortcut')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/remote/${encodeURIComponent(pdfId ?? '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-violet-800 dark:border-violet-500/50 dark:bg-violet-500/15 dark:text-violet-100"
          >
            {t('play.header.remoteController')}
          </Link>
          <button
            type="button"
            onClick={() => void handleToggleDisplayedQuestion()}
            disabled={syncFollowerQuestions.length === 0}
            className="rounded border border-border px-2 py-1 text-text hover:bg-surface disabled:opacity-40 dark:hover:bg-transparent"
          >
            {syncDisplayedQuestionId ? t('play.sync.hideQuestion') : t('play.sync.showLatestQuestion')}
          </button>
          <button
            type="button"
            onClick={() => void handleAiAnswerFollowerQuestions()}
            disabled={syncAiAnswerBusy || syncFollowerQuestions.length === 0}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-800 disabled:opacity-40 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-100"
          >
            {syncAiAnswerBusy ? t('play.sync.aiAnswerBusy') : t('play.sync.aiAnswer')}
          </button>
          <button
            type="button"
            onClick={() => void handleSummarizeFollowerQuestions()}
            disabled={questionSummaryBusy || syncFollowerQuestions.length === 0}
            className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-violet-800 disabled:opacity-40 dark:border-violet-500/50 dark:bg-violet-500/15 dark:text-violet-100"
          >
            {questionSummaryBusy ? t('play.sync.summarizeQuestionsBusy') : t('play.sync.summarizeQuestions')}
          </button>
          <button
            type="button"
            onClick={() => void handleClearFollowerQuestions()}
            disabled={syncFollowerQuestions.length === 0}
            className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-800 disabled:opacity-40 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-100"
          >
            {t('play.sync.clearAllQuestions')}
          </button>
        </div>
      </div>
      {syncAiAnswer ? (
        <div className="rounded border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-500/30 dark:bg-cyan-500/10">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleHideAiAnswer()}
              className="rounded border border-cyan-300 px-2 py-1 text-xs text-cyan-800 hover:bg-cyan-100 dark:border-cyan-500/50 dark:text-cyan-100 dark:hover:bg-cyan-500/20"
            >
              {t('play.sync.hideAiAnswer')}
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-cyan-900 dark:text-cyan-50">
            {syncAiAnswer.answer}
          </div>
        </div>
      ) : null}
      {questionSummary ? (
        <div className="max-h-72 overflow-y-auto rounded border border-violet-200 bg-violet-50 p-3 text-violet-900 whitespace-pre-wrap dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-50">
          {questionSummary}
        </div>
      ) : null}
      <div className="max-h-28 space-y-1 overflow-auto">
        {syncFollowerQuestions.slice(0, 5).map((q) => (
          <div key={q.id} className={`flex items-start gap-2 rounded px-2 py-1 ${q.question === '🖐' ? 'border border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/15' : 'bg-surface dark:bg-slate-950/70'}`}>
            <div className="min-w-0 flex-1">
              <span className={q.question === '🖐' ? 'text-amber-700 dark:text-amber-300' : 'text-cyan-700 dark:text-cyan-300'}>{q.code || q.display_name || t('play.sync.anonymous')}：</span>
              {q.question === '🖐' ? <span className="text-amber-800 dark:text-amber-200">🖐 {t('play.sync.raiseHand')}</span> : q.question}
            </div>
            <button
              type="button"
              onClick={() => void handleDeleteFollowerQuestion(q.id)}
              aria-label={t('play.sync.deleteQuestion')}
              title={t('play.sync.deleteQuestion')}
              className="shrink-0 rounded px-1 leading-none text-muted hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20 dark:hover:text-rose-200"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {syncFollowerQuestions.length > 0 && (
        <CopyAllQuestionsButton questions={syncFollowerQuestions} />
      )}
    </div>
  );
}
