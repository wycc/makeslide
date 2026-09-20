import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useI18n } from '../../i18n';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { usePlayPageContext } from './PlayPageContext';
import {
  fetchTutorQuizUsage,
  fetchTutorQuizUsageRound,
  type TutorQuizUsage,
  type TutorQuizUsageLearner,
  type TutorQuizUsagePeriod,
  type TutorQuizUsageRound,
  type TutorQuizUsageRoundDetail,
  type TutorQuizUsageTotals,
} from '../../lib/api';
import { accuracyPercent, levelToneClass } from '../../lib/tutorQuizProgress';
import { averageSeconds, formatUsageDuration, learnerDisplayName, weekRangeLabel } from '../../lib/tutorQuizUsage';

type PeriodTab = 'weekly' | 'monthly' | 'all';

const TH = 'px-2 py-1.5 text-left text-[11px] font-medium text-muted';
const TH_NUM = 'px-2 py-1.5 text-right text-[11px] font-medium text-muted';
const TD = 'px-2 py-1.5 text-xs text-text';
const TD_NUM = 'px-2 py-1.5 text-right text-xs tabular-nums text-text';

/**
 * 課後輔導測試的使用記錄（只有簡報擁有者開得到）：上半是整體每週／每月／全部的使用次數與時間，
 * 下半是每位使用者的使用時間與成績，點開可以看他每一輪、每一題答了什麼。
 */
export function TutorQuizUsageDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { pdfId } = usePlayPageContext();
  const [usage, setUsage] = useState<TutorQuizUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<PeriodTab>('weekly');
  const [openLearner, setOpenLearner] = useState<string | null>(null);

  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const units = useMemo(
    () => ({
      hour: t('play.tutorQuiz.usage.unit.hour'),
      minute: t('play.tutorQuiz.usage.unit.minute'),
      second: t('play.tutorQuiz.usage.unit.second'),
    }),
    [t],
  );
  const duration = useCallback((seconds: number) => formatUsageDuration(seconds, units), [units]);

  const load = useCallback(async () => {
    if (!pdfId) return;
    setLoading(true);
    setFailed(false);
    try {
      setUsage(await fetchTutorQuizUsage(pdfId, timeZone));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [pdfId, timeZone]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const periodRows: TutorQuizUsagePeriod[] = useMemo(() => {
    if (!usage) return [];
    if (tab === 'weekly') return usage.weekly.map((w) => ({ ...w, period: weekRangeLabel(w.period) }));
    if (tab === 'monthly') return usage.monthly;
    return [{ period: t('play.tutorQuiz.usage.allTime'), ...usage.totals }];
  }, [usage, tab, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onBackdropClick} role="presentation">
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('play.tutorQuiz.usage.title')}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text">📊 {t('play.tutorQuiz.usage.title')}</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {interpolateTemplate(t('play.tutorQuiz.usage.subtitle'), { minutes: Math.round((usage?.idle_gap_seconds ?? 600) / 60) })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { void load(); }}
              disabled={loading}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
            >
              {t('play.tutorQuiz.usage.refresh')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted hover:text-text"
            >
              {t('play.tutorQuiz.usage.close')}
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {loading && !usage ? (
            <p className="py-8 text-center text-sm text-muted">{t('play.tutorQuiz.usage.loading')}</p>
          ) : failed || !usage ? (
            <p className="py-8 text-center text-sm text-red-600 dark:text-red-300">{t('play.tutorQuiz.usage.loadError')}</p>
          ) : usage.totals.sessions === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t('play.tutorQuiz.usage.empty')}</p>
          ) : (
            <>
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text">{t('play.tutorQuiz.usage.overall')}</h3>
                  <div className="flex overflow-hidden rounded-md border border-border text-xs" role="tablist">
                    {(['weekly', 'monthly', 'all'] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => setTab(key)}
                        className={`px-3 py-1 ${tab === key ? 'bg-primary text-white' : 'text-muted hover:bg-surface-muted hover:text-text'}`}
                      >
                        {t(`play.tutorQuiz.usage.tab.${key}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label={t('play.tutorQuiz.usage.col.sessions')} value={String(usage.totals.sessions)} />
                  <StatTile label={t('play.tutorQuiz.usage.col.learners')} value={String(usage.totals.learners)} />
                  <StatTile label={t('play.tutorQuiz.usage.col.time')} value={duration(usage.totals.active_seconds)} />
                  <StatTile
                    label={t('play.tutorQuiz.usage.col.avgTime')}
                    value={duration(averageSeconds(usage.totals.active_seconds, usage.totals.sessions))}
                  />
                </div>
                <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse">
                    <thead className="bg-surface-muted">
                      <tr>
                        <th className={TH}>{t('play.tutorQuiz.usage.col.period')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.sessions')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.learners')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.answered')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.accuracy')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.time')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.avgTime')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodRows.map((row) => (
                        <tr key={row.period} className="border-t border-border">
                          <td className={`${TD} whitespace-nowrap tabular-nums`}>{row.period}</td>
                          <TotalsCells totals={row} duration={duration} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {tab !== 'all' && (
                  <p className="mt-1 text-[11px] text-muted">
                    {interpolateTemplate(t('play.tutorQuiz.usage.periodsNote'), { count: 12, tz: usage.time_zone })}
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-text">
                  {interpolateTemplate(t('play.tutorQuiz.usage.learners'), { count: usage.learners.length })}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse">
                    <thead className="bg-surface-muted">
                      <tr>
                        <th className={TH}>{t('play.tutorQuiz.usage.col.name')}</th>
                        <th className={TH}>{t('play.tutorQuiz.usage.col.code')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.sessions')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.time')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.answered')}</th>
                        <th className={TH_NUM}>{t('play.tutorQuiz.usage.col.accuracy')}</th>
                        <th className={TH}>{t('play.tutorQuiz.usage.col.level')}</th>
                        <th className={TH}>{t('play.tutorQuiz.usage.col.lastActive')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.learners.map((learner) => (
                        <LearnerRows
                          key={learner.key}
                          learner={learner}
                          open={openLearner === learner.key}
                          onToggle={() => setOpenLearner((cur) => (cur === learner.key ? null : learner.key))}
                          duration={duration}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-base font-semibold tabular-nums text-text">{value}</div>
    </div>
  );
}

function TotalsCells({ totals, duration }: { totals: TutorQuizUsageTotals; duration: (s: number) => string }) {
  return (
    <>
      <td className={TD_NUM}>{totals.sessions}</td>
      <td className={TD_NUM}>{totals.learners}</td>
      <td className={TD_NUM}>{totals.answered}</td>
      <td className={TD_NUM}>{totals.answered > 0 ? `${accuracyPercent(totals.correct, totals.answered)}%` : '—'}</td>
      <td className={`${TD_NUM} whitespace-nowrap`}>{duration(totals.active_seconds)}</td>
      <td className={`${TD_NUM} whitespace-nowrap`}>{duration(averageSeconds(totals.active_seconds, totals.sessions))}</td>
    </>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function LearnerRows({
  learner,
  open,
  onToggle,
  duration,
}: {
  learner: TutorQuizUsageLearner;
  open: boolean;
  onToggle: () => void;
  duration: (s: number) => string;
}) {
  const { t } = useI18n();
  const name = learnerDisplayName(learner, {
    anonymous: t('play.tutorQuiz.usage.anonymous'),
    unnamed: t('play.tutorQuiz.usage.unnamed'),
  });
  return (
    <Fragment>
      <tr className="cursor-pointer border-t border-border hover:bg-surface-muted" onClick={onToggle}>
        <td className={TD}>
          <button type="button" aria-expanded={open} className="flex items-center gap-1 text-left" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <span className="w-3 text-muted">{open ? '▾' : '▸'}</span>
            <span className={learner.display_name ? '' : 'text-muted'}>{name}</span>
          </button>
        </td>
        <td className={`${TD} tabular-nums`}>{learner.code || t('play.tutorQuiz.usage.noCode')}</td>
        <td className={TD_NUM}>{learner.sessions_count}</td>
        <td className={`${TD_NUM} whitespace-nowrap`}>{duration(learner.active_seconds)}</td>
        <td className={TD_NUM}>{learner.answered}</td>
        <td className={TD_NUM}>{learner.answered > 0 ? `${accuracyPercent(learner.correct, learner.answered)}%` : '—'}</td>
        <td className={TD}>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${levelToneClass(learner.latest_level)}`}>L{learner.latest_level}</span>
        </td>
        <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatWhen(learner.last_active_at)}</td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-surface-muted/50">
          <td colSpan={8} className="px-3 py-3">
            <div className="mb-1 text-[11px] font-medium text-muted">{t('play.tutorQuiz.usage.rounds')}</div>
            <div className="space-y-2">
              {learner.sessions.map((round) => (
                <RoundCard key={round.id} round={round} duration={duration} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function RoundCard({ round, duration }: { round: TutorQuizUsageRound; duration: (s: number) => string }) {
  const { t } = useI18n();
  const { pdfId } = usePlayPageContext();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TutorQuizUsageRoundDetail | null>(null);
  const [failed, setFailed] = useState(false);

  // 題目只在點開時才抓：清單一次列出全班每一輪，全部預載就是幾百題。
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail || !pdfId) return;
    setFailed(false);
    try {
      setDetail(await fetchTutorQuizUsageRound(pdfId, round.id));
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text">
        <span className="whitespace-nowrap tabular-nums">{formatWhen(round.created_at)}</span>
        <span className="whitespace-nowrap">{duration(round.active_seconds)}</span>
        <span className="whitespace-nowrap tabular-nums">
          {round.correct}/{round.answered}
          {round.answered > 0 ? `（${accuracyPercent(round.correct, round.answered)}%）` : ''}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${levelToneClass(round.current_level)}`}>L{round.current_level}</span>
        {round.level_estimate !== null && (
          <span className="whitespace-nowrap text-muted">
            {t('play.tutorQuiz.usage.round.estimate')} L{round.level_estimate.toFixed(1)}
          </span>
        )}
        <span className="text-muted">{t(round.status === 'active' ? 'play.tutorQuiz.usage.round.active' : 'play.tutorQuiz.usage.round.ended')}</span>
        <button type="button" onClick={() => { void toggle(); }} aria-expanded={open} className="ml-auto text-xs text-primary hover:underline">
          {t(open ? 'play.tutorQuiz.usage.round.hide' : 'play.tutorQuiz.usage.round.show')}
        </button>
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {t('play.tutorQuiz.usage.round.topics')}：
        {round.topics.length > 0 ? round.topics.join('、') : t('play.tutorQuiz.usage.round.allTopics')}
      </div>
      {open && (
        <div className="mt-2 border-t border-border pt-2">
          {failed ? (
            <p className="text-xs text-red-600 dark:text-red-300">{t('play.tutorQuiz.usage.round.loadError')}</p>
          ) : !detail ? (
            <p className="text-xs text-muted">{t('play.tutorQuiz.usage.loading')}</p>
          ) : detail.questions.length === 0 ? (
            <p className="text-xs text-muted">{t('play.tutorQuiz.usage.round.noQuestions')}</p>
          ) : (
            <ol className="space-y-2">
              {detail.questions.map((q) => {
                const mark = q.is_correct === null ? '·' : q.is_correct ? '✓' : '✗';
                const tone = q.is_correct === null ? 'text-muted' : q.is_correct ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300';
                const assessment = detail.assessments.find((a) => a.through_seq === q.seq);
                return (
                  <li key={q.seq} className="text-xs text-text">
                    <div className="flex gap-2">
                      <span className={`w-4 shrink-0 text-center font-semibold ${tone}`}>{mark}</span>
                      <div className="min-w-0">
                        <div>
                          <span className="mr-1 text-muted">{q.seq}. L{q.level}</span>
                          {q.question}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {t('play.tutorQuiz.usage.round.chosen')}：
                          {q.answered_index === null || q.answered_index === undefined
                            ? t('play.tutorQuiz.usage.round.unanswered')
                            : q.options[q.answered_index] ?? '—'}
                          {q.is_correct !== true && q.correct_index !== undefined && (
                            <span className="ml-3">
                              {t('play.tutorQuiz.usage.round.correctAnswer')}：{q.options[q.correct_index] ?? '—'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {assessment && (
                      <div className="ml-6 mt-1 rounded-md border border-border bg-surface-muted px-2 py-1 text-[11px] text-muted">
                        {interpolateTemplate(t('play.tutorQuiz.usage.round.assessment'), {
                          seq: assessment.through_seq,
                          level: assessment.level_estimate.toFixed(1),
                          correct: assessment.correct_count,
                        })}
                        {assessment.summary ? <div className="mt-0.5 text-text">{assessment.summary}</div> : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
