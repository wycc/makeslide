import type { PdfReportSummary } from '../../lib/api';
import {
  formatReportNumber,
  formatReportPercent,
  getHardestQuestions,
  getLowestCompletionPages,
  getMostDivergentPollPages,
} from './reportSummary';

interface PostClassReportPanelProps {
  summary: PdfReportSummary | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onReload: () => void;
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-cyan-100">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export function PostClassReportPanel({ summary, loading, error, onClose, onReload }: PostClassReportPanelProps) {
  const hardestQuestions = getHardestQuestions(summary);
  const divergentPollPages = getMostDivergentPollPages(summary);
  const lowestCompletionPages = getLowestCompletionPages(summary);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="post-class-report-title">
      <div className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Post-class report</p>
            <h2 id="post-class-report-title" className="mt-1 text-xl font-semibold text-slate-100">課後報告</h2>
            <p className="mt-1 text-sm text-slate-400">彙整測驗、投票、提問與觀看完成率，協助簡報擁有者快速找出課後補強重點。</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onReload} disabled={loading} className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50">
              {loading ? '更新中…' : '重新整理'}
            </button>
            <button type="button" onClick={onClose} className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700">
              關閉
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
        ) : null}

        {loading && !summary ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-6 text-center text-sm text-slate-300">正在載入課後報告…</div>
        ) : null}

        {summary ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <SummaryCard label="參與人數" value={formatReportNumber(summary.participant_count)} hint="合併測驗、投票、提問與觀看紀錄的唯一參與者" />
              <SummaryCard label="測驗平均分數" value={summary.quiz.average_score == null ? '—' : formatReportNumber(summary.quiz.average_score)} hint={`${summary.quiz.attempt_count} 次作答，${summary.quiz.participant_count} 位作答者`} />
              <SummaryCard label="投票參與率" value={formatReportPercent(summary.polls.participation_rate)} hint={`${summary.polls.vote_count} 票 / ${summary.polls.poll_count} 題投票`} />
              <SummaryCard label="學生提問" value={formatReportNumber(summary.questions.count)} hint={`${summary.questions.participant_count} 位提問者`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="font-semibold text-slate-100">最容易答錯的題目</h3>
                <p className="mt-1 text-xs text-slate-500">後端若提供逐題統計，會依答錯率排序顯示。</p>
                {hardestQuestions.length > 0 ? (
                  <ol className="mt-3 space-y-2 text-sm text-slate-200">
                    {hardestQuestions.map((item, index) => (
                      <li key={item.question_id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                        <span className="text-xs text-cyan-300">#{index + 1} · 答錯率 {formatReportPercent(item.wrong_rate)}</span>
                        <p className="mt-1">{item.question?.trim() || `題目 ${item.question_id}`}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.wrong_count} / {item.attempt_count} 次答錯</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">目前摘要 API 尚未提供逐題答錯細節；總覽仍顯示測驗作答數與平均分數。</div>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="font-semibold text-slate-100">投票分歧最高頁面</h3>
                <p className="mt-1 text-xs text-slate-500">後端若提供頁面分歧分數，會優先呈現最需要討論的頁面。</p>
                {divergentPollPages.length > 0 ? (
                  <ol className="mt-3 space-y-2 text-sm text-slate-200">
                    {divergentPollPages.map((item) => (
                      <li key={`${item.page_number}-${item.question ?? ''}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                        <span className="text-xs text-fuchsia-300">第 {item.page_number} 頁 · 分歧 {formatReportPercent(item.divergence_score)}</span>
                        <p className="mt-1">{item.question?.trim() || '未提供投票題目文字'}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.total_votes} 票</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">目前摘要 API 尚未提供每頁投票分歧細節；總覽仍顯示投票數與參與率。</div>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="font-semibold text-slate-100">觀看完成率最低頁面</h3>
                <p className="mt-1 text-xs text-slate-500">以既有每頁觀看完成率排序，優先找出可能太難或太長的頁面。</p>
                {lowestCompletionPages.length > 0 ? (
                  <ol className="mt-3 space-y-2 text-sm text-slate-200">
                    {lowestCompletionPages.map((item) => (
                      <li key={item.page_number} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                        <span className="text-xs text-amber-300">第 {item.page_number} 頁 · 完成率 {formatReportPercent(item.completion_rate)}</span>
                        <p className="mt-1 text-xs text-slate-500">{item.completed_viewers} / {item.total_viewers} 位完成，平均聽取 {formatReportPercent(item.avg_listened_ratio)}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">尚無觀看紀錄。學生觀看後，這裡會列出完成率最低的頁面。</div>
                )}
              </section>
            </div>

            <p className="text-right text-xs text-slate-500">產生時間：{new Date(summary.generated_at).toLocaleString()}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

