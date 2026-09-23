import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { MarkdownMath } from './MarkdownMath';
import { interpolateTemplate } from '../lib/interpolateTemplate';
import { correctPercent } from '../lib/quizAnalysis';
import type { QuizQuestionStat } from '../lib/quizAnalysis';
import type { QuizQuestion } from '../types';

export interface QuizReviewFullscreenProps {
  title: string;
  questions: QuizQuestion[];
  /** 與 questions 同順序的作答統計；沒有作答紀錄時傳 null（只講評題目與解析）。 */
  stats: QuizQuestionStat[] | null;
  onClose: () => void;
}

/**
 * 逐題全螢幕講評：一次一題，放大顯示題目、選項（標出正解與各選項被選的人數）與完整解析。
 * 投影用，所以字要大、一屏只講一題；每題分兩段：先只有題目與選項，再按一次「下一頁」或 → 才顯示解析，
 * 老師可以先講選項再揭曉解析。← → PageUp PageDown 空白鍵前進／後退，Esc 或離開全螢幕就關閉。
 *
 * 全螢幕採 best-effort：瀏覽器拒絕 requestFullscreen 時仍以覆蓋整個視窗的方式顯示。
 */
export function QuizReviewFullscreen({ title, questions, stats, onClose }: QuizReviewFullscreenProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  /** 展開中的選項（列出選了它的人的代碼）；換題就收起，null 為全部收起。 */
  const [openOption, setOpenOption] = useState<number | null>(null);
  /** 第二段：這一題的解析已揭曉。換題時重設。 */
  const [showExplanation, setShowExplanation] = useState(false);
  const total = questions.length;
  const question = questions[index];
  const stat = stats?.[index] ?? null;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 進入全螢幕；離開全螢幕（Esc 或系統手勢）等同關閉講評，否則會留下一個看似全螢幕的覆蓋層。
  useEffect(() => {
    const el = containerRef.current;
    el?.requestFullscreen?.().catch(() => { /* 被拒絕：維持視窗內的覆蓋層 */ });
    const onFsChange = () => { if (!document.fullscreenElement) onCloseRef.current(); };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // 前進：先揭曉解析，再換下一題；後退：先收起解析，再回上一題（回到上一題時解析是揭曉的，和投影片的分段一樣對稱）。
  const go = useCallback((delta: number) => {
    if (delta > 0) {
      if (!showExplanation) {
        setShowExplanation(true);
        return;
      }
      if (index >= total - 1) return;
      setIndex(index + 1);
      setShowExplanation(false);
    } else {
      if (showExplanation) {
        setShowExplanation(false);
        return;
      }
      if (index <= 0) return;
      setIndex(index - 1);
      setShowExplanation(true);
    }
    setOpenOption(null);
  }, [index, showExplanation, total]);

  const toggleOption = useCallback((oIdx: number) => {
    setOpenOption((prev) => (prev === oIdx ? null : oIdx));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Escape') {
        // 全螢幕時瀏覽器自己會退出（由 fullscreenchange 收尾）；被拒絕全螢幕時這裡才是唯一的關閉路徑。
        if (!document.fullscreenElement) onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!question) return null;

  const percent = stat ? correctPercent(stat) : null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[300] flex flex-col overflow-y-auto bg-slate-950 p-6 text-slate-100 sm:p-10"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-400">{title}</p>
          <p className="text-base font-semibold text-fuchsia-200">
            {interpolateTemplate(t('quiz.analysis.progress'), { index: index + 1, total })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {stat && stat.answered + stat.unanswered > 0 ? (
            <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-300">
              {percent === null
                ? t('quiz.analysis.noAnswers')
                : interpolateTemplate(t('quiz.analysis.correctRate'), { correct: stat.correct, answered: stat.answered, percent })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            {t('quiz.analysis.exitFullscreen')}
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl flex-1">
        <MarkdownMath content={question.question} className="text-2xl font-semibold leading-relaxed text-slate-50 sm:text-3xl" />

        {question.type === 'essay' ? (
          <p className="mt-6 text-lg text-slate-400">{t('quiz.analysis.essayNoStats')}</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {question.options.map((option, oIdx) => {
              const optionStat = stat?.options[oIdx] ?? null;
              const isAnswer = question.answer_indices.includes(oIdx);
              const picked = optionStat?.count ?? 0;
              const isOpen = optionStat !== null && openOption === oIdx;
              return (
                <li
                  key={oIdx}
                  onClick={optionStat ? () => toggleOption(oIdx) : undefined}
                  className={`relative overflow-hidden rounded-lg border px-4 py-3 text-xl sm:text-2xl ${
                    isAnswer ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-100' : 'border-slate-700 bg-slate-900 text-slate-200'
                  } ${optionStat ? 'cursor-pointer' : ''} ${isOpen ? 'ring-2 ring-fuchsia-400/70' : ''}`}
                >
                  {/* 被選比例的底色長條：一眼看出大家錯到哪個選項去了。 */}
                  {optionStat && optionStat.ratio > 0 ? (
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 ${isAnswer ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}
                      style={{ width: `${Math.round(optionStat.ratio * 100)}%` }}
                    />
                  ) : null}
                  <span className="relative flex items-start gap-3">
                    <span className="shrink-0 font-mono text-slate-400">{String.fromCharCode(65 + oIdx)}.</span>
                    <MarkdownMath content={option.text} className="min-w-0 flex-1 break-words" />
                    {isAnswer ? <span className="shrink-0 text-base text-emerald-300">{t('quiz.correctAnswer')}</span> : null}
                    {optionStat ? (
                      <span className={`shrink-0 text-base tabular-nums ${isAnswer ? 'text-emerald-200' : picked > 0 ? 'text-rose-300' : 'text-slate-500'}`}>
                        {interpolateTemplate(t(isAnswer ? 'quiz.analysis.optionPicked' : 'quiz.analysis.optionWrongPicked'), { count: picked })}
                      </span>
                    ) : null}
                  </span>
                  {/* 點選項展開：列出選了它的人的代碼（答錯選項就是答錯的人），投影時直接點名講評。 */}
                  {isOpen && optionStat ? (
                    <div className="relative mt-3 border-t border-slate-600/60 pt-3">
                      <p className={`mb-2 text-base ${isAnswer ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {optionStat.pickers.length === 0
                          ? t('quiz.analysis.noPickers')
                          : interpolateTemplate(t('quiz.analysis.pickers'), { count: optionStat.pickers.length })}
                      </p>
                      {optionStat.pickers.length > 0 ? (
                        <ul className="flex flex-wrap gap-2">
                          {optionStat.pickers.map((p, pIdx) => (
                            <li
                              key={pIdx}
                              className={`rounded-md border px-3 py-1 font-mono text-lg sm:text-xl ${
                                isAnswer
                                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                                  : 'border-rose-500/50 bg-rose-500/15 text-rose-100'
                              } ${p.label === null ? 'italic opacity-70' : ''}`}
                            >
                              {p.label ?? t('quiz.analysis.pickerAnonymous')}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {question.type !== 'essay' && stat ? (
          <p className="mt-2 text-sm text-slate-500">{t('quiz.analysis.pickersHint')}</p>
        ) : null}

        {showExplanation ? (
          <div className="mt-8 rounded-lg border border-slate-700 bg-slate-900/70 p-5">
            <p className="mb-2 text-base text-slate-400">{t('quiz.explanationLabel')}</p>
            <MarkdownMath content={question.explanation || t('quiz.noExplanation')} className="text-xl leading-relaxed text-slate-100 sm:text-2xl" />
          </div>
        ) : (
          <p className="mt-8 rounded-lg border border-dashed border-slate-700 p-5 text-base text-slate-500">
            {t('quiz.analysis.explanationHidden')}
          </p>
        )}

        {stat && stat.unanswered > 0 ? (
          <p className="mt-3 text-base text-amber-300">
            {interpolateTemplate(t('quiz.analysis.unanswered'), { count: stat.unanswered })}
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0 && !showExplanation}
          className="rounded-md border border-slate-600 bg-slate-800 px-5 py-2.5 text-base text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('quiz.analysis.prev')}
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={showExplanation && index >= total - 1}
          className="rounded-md border border-fuchsia-500/60 bg-fuchsia-500/20 px-5 py-2.5 text-base text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t(showExplanation ? 'quiz.analysis.next' : 'quiz.analysis.showExplanation')}
        </button>
      </div>
    </div>
  );
}
