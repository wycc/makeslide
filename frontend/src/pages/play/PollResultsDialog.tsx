import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { pollOptionPercent } from '../../lib/pollPercent';
import { fetchPagePollVoters, ApiError } from '../../lib/api';
import { useOverlayDismiss } from '../../components/useOverlayDismiss';
import type { PagePoll, PagePollVoter } from '../../types';

interface PollResultsDialogProps {
  pdfId: string | undefined;
  polls: PagePoll[];
  pageNumber?: number;
  onClose: () => void;
}

/** 匿名投票者（無自設 user_code）的 voter_id 形如 `voter-<時間>-<亂數>`。 */
export function isAnonymousVoterId(voterId: string): boolean {
  return /^voter-/.test(voterId);
}

/** 將投票人名單依選項索引分組（純函式，供顯示與測試）。 */
export function groupVotersByOption(voters: PagePollVoter[]): Map<number, PagePollVoter[]> {
  const grouped = new Map<number, PagePollVoter[]>();
  for (const voter of voters) {
    const list = grouped.get(voter.option_index);
    if (list) list.push(voter);
    else grouped.set(voter.option_index, [voter]);
  }
  return grouped;
}

/**
 * 跳出式對話框：以唯讀方式呈現本頁所有投票的資訊（問題、總票數、已作答人數、
 * 進行中／已結束）與各選項票數和百分比長條，並列出各選項的投票人 code
 * （投票者自設的 user_code，或匿名 voter-xxx）。聚合票數沿用 `PagePoll`，
 * 投票人名單在開啟時向老師專用端點額外抓取。
 */
export function PollResultsDialog({ pdfId, polls, pageNumber, onClose }: PollResultsDialogProps) {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);
  const formatMessage = (key: Parameters<typeof t>[0], values: Record<string, string | number>) =>
    interpolateTemplate(t(key), values);

  const [votersByPoll, setVotersByPoll] = useState<Record<number, PagePollVoter[]>>({});
  const [votersLoading, setVotersLoading] = useState(false);
  const [votersError, setVotersError] = useState<string | null>(null);

  // 開啟時一次抓齊本頁所有投票的投票人名單（老師專用端點）。
  useEffect(() => {
    if (!pdfId || polls.length === 0) return;
    let cancelled = false;
    setVotersLoading(true);
    setVotersError(null);
    void (async () => {
      try {
        const entries = await Promise.all(
          polls.map(async (poll) => [poll.id, await fetchPagePollVoters(pdfId, poll.id)] as const),
        );
        if (cancelled) return;
        setVotersByPoll(Object.fromEntries(entries));
      } catch (err) {
        if (!cancelled) setVotersError(err instanceof ApiError ? err.message : t('play.pollResultsDialog.votersFailed'));
      } finally {
        if (!cancelled) setVotersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // polls 來自輪詢，會頻繁產生新陣列；以 id 串為依賴避免每 3 秒重抓。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId, polls.map((p) => p.id).join(','), t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('play.pollResultsDialog.title')}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-100">
            📊 {t('play.pollResultsDialog.title')}
            {pageNumber != null ? (
              <span className="ml-2 text-sm font-normal text-slate-400">
                {t('play.common.pagePrefix')}{pageNumber}{t('play.common.pageSuffix')}
              </span>
            ) : null}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.pollResultsDialog.close')}
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {votersError ? <p className="text-xs text-rose-300">{votersError}</p> : null}
          {polls.length === 0 ? (
            <p className="text-sm text-slate-400">{t('play.pollResultsDialog.empty')}</p>
          ) : (
            polls.map((poll) => {
              const voters = groupVotersByOption(votersByPoll[poll.id] ?? []);
              return (
                <section key={poll.id} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium text-slate-100">{poll.question}</h4>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                        poll.is_active
                          ? 'border-emerald-500/50 text-emerald-300'
                          : 'border-slate-600 text-slate-400'
                      }`}
                    >
                      {poll.is_active ? t('play.pollResultsDialog.active') : t('play.pollResultsDialog.closed')}
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>
                      {t('play.pollResultsDialog.totalVotes')}：
                      <span className="font-mono text-slate-200">{poll.total_votes}</span>
                    </span>
                    {poll.answered_count != null ? (
                      <span>
                        {t('play.pollResultsDialog.answered')}：
                        <span className="font-mono text-slate-200">{poll.answered_count}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {poll.options.map((option, idx) => {
                      const ratio = pollOptionPercent(option.votes, poll.total_votes);
                      const optionVoters = voters.get(idx) ?? [];
                      return (
                        <div key={`${poll.id}-${idx}`} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2">
                          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-200">
                            <span className="min-w-0 break-words">{option.text}</span>
                            <span className="shrink-0 font-mono text-slate-400">
                              {formatMessage('play.sidebar.poll.voteCount', { count: option.votes })} · {ratio}%
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full rounded-full bg-cyan-400" style={{ width: `${ratio}%` }} />
                          </div>
                          {optionVoters.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {optionVoters.map((voter) =>
                                isAnonymousVoterId(voter.voter_id) ? (
                                  <span
                                    key={voter.voter_id}
                                    className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] italic text-slate-500"
                                  >
                                    {t('play.pollResultsDialog.anonymousVoter')}
                                  </span>
                                ) : (
                                  <span
                                    key={voter.voter_id}
                                    className="rounded border border-cyan-700/50 bg-cyan-900/30 px-1.5 py-0.5 text-[10px] text-cyan-200"
                                  >
                                    {voter.voter_id}
                                  </span>
                                ),
                              )}
                            </div>
                          ) : votersLoading ? (
                            <p className="mt-2 text-[10px] text-slate-500">{t('play.pollResultsDialog.votersLoading')}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
