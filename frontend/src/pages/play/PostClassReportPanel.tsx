import { useEffect, useState } from 'react';
import type { PdfReportQuestionStat, PdfReportSummary } from '../../lib/api';
import { resetWatchProgress } from '../../lib/api';
import {
  formatReportNumber,
  formatReportPercent,
  getHardestQuestions,
  getLowestCompletionPages,
  getMostDivergentPollPages,
} from './reportSummary';

interface StudentQuestionResult {
  question_id: string;
  question: string;
  options: string[];
  selected: number[];
  correct_indices: number[];
  is_correct: boolean;
}

interface StudentAttempt {
  attempt_id: number;
  quiz_id: number;
  quiz_title: string;
  score: number | null;
  submitted_at: string;
  question_results: StudentQuestionResult[];
}

interface StudentRecord {
  client_id: string;
  attempt_count: number;
  average_score: number | null;
  attempts: StudentAttempt[];
}

interface PostClassReportPanelProps {
  pdfId: string;
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

export function PostClassReportPanel({ pdfId, summary, loading, error, onClose, onReload }: PostClassReportPanelProps) {
  const hardestQuestions = getHardestQuestions(summary);
  const divergentPollPages = getMostDivergentPollPages(summary);
  const lowestCompletionPages = getLowestCompletionPages(summary);

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');

  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const handleResetWatchProgress = () => {
    if (!window.confirm('確定要重置所有觀看進度紀錄？此動作無法復原。')) return;
    setResetBusy(true);
    void resetWatchProgress(pdfId)
      .then((res) => {
        setResetMsg(`已重置（${res.deleted_rows} 筆）`);
        onReload();
      })
      .catch(() => { setResetMsg('重置失敗'); })
      .finally(() => {
        setResetBusy(false);
        setTimeout(() => setResetMsg(null), 3000);
      });
  };

  useEffect(() => {
    if (!summary) return;
    setStudentsLoading(true);
    fetch(`api/pdfs/${encodeURIComponent(pdfId)}/report/students`)
      .then((r) => r.ok ? r.json() as Promise<{ students: StudentRecord[] }> : Promise.reject(r.status))
      .then((data) => { setStudents(data.students); })
      .catch(() => { setStudents([]); })
      .finally(() => { setStudentsLoading(false); });
  }, [pdfId, summary]);

  const selectedStudent = students.find((s) => s.client_id === selectedClientId) ?? null;
  return (
    <>
      <style>{`
        @media print {
          #pcr-print-root {
            position: static !important;
            overflow: visible !important;
            background: transparent !important;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
            padding: 0 !important;
            display: block !important;
          }
          #pcr-print-root > div {
            background: white !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 1cm !important;
            max-width: none !important;
          }
          [data-no-print] { display: none !important; }
          section { break-inside: avoid; page-break-inside: avoid; }
          h2, h3 { color: black !important; }
          p, span, li, pre { color: #1e293b !important; }
          .border-slate-700, .border-slate-800 { border-color: #cbd5e1 !important; }
          .bg-slate-950\\/80, .bg-slate-900, .bg-slate-950\\/60, .bg-slate-900\\/60,
          .bg-slate-900\\/70, .bg-slate-800 { background-color: white !important; }
          .text-cyan-300 { color: #0369a1 !important; }
          .text-amber-300 { color: #92400e !important; }
          .text-emerald-300, .text-emerald-400 { color: #065f46 !important; }
          .text-rose-200, .text-rose-300, .text-rose-400 { color: #9f1239 !important; }
          .text-fuchsia-300 { color: #86198f !important; }
        }
      `}</style>
      <div id="pcr-print-root" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="post-class-report-title">
        <div className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Post-class report</p>
              <h2 id="post-class-report-title" className="mt-1 text-xl font-semibold text-slate-100">課後報告</h2>
              <p className="mt-1 text-sm text-slate-400">彙整測驗、投票、提問與觀看完成率，協助簡報擁有者快速找出課後補強重點。</p>
            </div>
            <div className="flex items-center gap-2" data-no-print="true">
              <button type="button" onClick={onReload} disabled={loading} className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50">
                {loading ? '更新中…' : '重新整理'}
              </button>
              <a
                href={`api/pdfs/${encodeURIComponent(pdfId)}/quiz-results.csv`}
                download
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-500/25"
              >
                匯出 CSV
              </a>
              <a
                href={`api/pdfs/${encodeURIComponent(pdfId)}/report/students.csv`}
                download
                className="rounded-md border border-teal-500/50 bg-teal-500/15 px-3 py-1.5 text-sm text-teal-100 hover:bg-teal-500/25"
              >
                學生報告 CSV
              </a>
              <button type="button" onClick={() => window.print()} className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-500/25">
                列印 / 儲存 PDF
              </button>
              <button
                type="button"
                onClick={handleResetWatchProgress}
                disabled={resetBusy}
                className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-sm text-rose-100 hover:bg-rose-500/25 disabled:opacity-50"
                title="清除所有觀看進度紀錄，以重新統計課後觀看數據"
              >
                {resetMsg ?? (resetBusy ? '重置中…' : '重置觀看進度')}
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

              {summary.watch_progress.pages.length > 0 ? (
                <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="mb-1 font-semibold text-slate-100">全頁完成率熱力圖</h3>
                  <p className="mb-3 text-xs text-slate-500">每格代表一頁，顏色越深代表完成率越高。</p>
                  <div className="flex flex-wrap gap-1">
                    {summary.watch_progress.pages.map((page) => {
                      const rate = page.completion_rate;
                      const bg = rate >= 0.8 ? 'bg-emerald-500' : rate >= 0.6 ? 'bg-emerald-400/70' : rate >= 0.4 ? 'bg-amber-400/60' : rate >= 0.2 ? 'bg-rose-400/60' : 'bg-rose-600/80';
                      return (
                        <div
                          key={page.page_number}
                          className={`flex h-8 w-8 items-center justify-center rounded text-[10px] font-medium text-white/90 ${bg}`}
                          title={`第 ${page.page_number} 頁：完成率 ${Math.round(rate * 100)}%（${page.completed_viewers}/${page.total_viewers}）`}
                        >
                          {page.page_number}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-rose-600/80" />0–20%</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-400/60" />40–60%</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-400/70" />60–80%</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-500" />80%+</span>
                  </div>
                </section>
              ) : null}
            </div>

            {Array.isArray(summary.quiz.question_stats) && summary.quiz.question_stats.length > 0 ? (
              <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="mb-1 font-semibold text-slate-100">逐題答對率</h3>
                <p className="mb-3 text-xs text-slate-500">依據所有提交紀錄計算每道題目的答對人數與選項分佈。</p>
                <div className="space-y-3">
                  {(summary.quiz.question_stats as PdfReportQuestionStat[]).map((stat, idx) => (
                    <div key={stat.question_id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <p className="text-sm text-slate-200">
                          <span className="mr-1.5 text-xs text-slate-400">#{idx + 1}</span>
                          {stat.question}
                        </p>
                        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${stat.correct_rate >= 0.7 ? 'bg-emerald-500/20 text-emerald-300' : stat.correct_rate >= 0.4 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'}`}>
                          答對率 {formatReportPercent(stat.correct_rate)}
                        </span>
                      </div>
                      <p className="mb-2 text-xs text-slate-500">{stat.correct_count} / {stat.attempt_count} 人答對</p>
                      {stat.option_count > 0 ? (
                        <div className="space-y-1">
                          {stat.option_votes.map((votes, oIdx) => {
                            const pct = stat.attempt_count > 0 ? votes / stat.attempt_count : 0;
                            return (
                              <div key={oIdx} className="flex items-center gap-2 text-xs text-slate-400">
                                <span className="w-6 shrink-0 text-right text-slate-500">{String.fromCharCode(65 + oIdx)}.</span>
                                <div className="flex-1 overflow-hidden rounded-sm bg-slate-800">
                                  <div className="h-2 rounded-sm bg-indigo-500/60" style={{ width: `${Math.round(pct * 100)}%` }} />
                                </div>
                                <span className="w-10 shrink-0 text-right">{Math.round(pct * 100)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="mb-1 font-semibold text-slate-100">個別學生分析</h3>
              <p className="mb-3 text-xs text-slate-500">依學生篩選，檢視其各題作答詳情。</p>
              <div className="flex items-center gap-3">
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  disabled={studentsLoading || students.length === 0}
                  className="w-64 rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                >
                  <option value="">— 選擇學生 —</option>
                  {students.map((s) => (
                    <option key={s.client_id} value={s.client_id}>
                      {s.client_id}（{s.attempt_count} 次作答，平均 {s.average_score != null ? Math.round(s.average_score) : '—'} 分）
                    </option>
                  ))}
                </select>
                {studentsLoading ? <span className="text-xs text-slate-400">載入中…</span> : null}
                {!studentsLoading && students.length === 0 ? <span className="text-xs text-slate-500">尚無作答紀錄。</span> : null}
              </div>

              {selectedStudent ? (
                <div className="mt-4 space-y-4">
                  {selectedStudent.attempts.map((attempt) => (
                    <div key={attempt.attempt_id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-200">{attempt.quiz_title || `測驗 #${attempt.quiz_id}`}</p>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`rounded px-2 py-0.5 font-medium ${attempt.score != null && attempt.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                            {attempt.score != null ? `${Math.round(attempt.score)} 分` : '未計分'}
                          </span>
                          <span className="text-slate-500">{new Date(attempt.submitted_at).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {attempt.question_results.map((qr, qIdx) => (
                          <div key={qr.question_id} className={`rounded-md border p-3 text-sm ${qr.is_correct ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-rose-800/60 bg-rose-950/30'}`}>
                            <div className="flex items-start gap-2">
                              <span className={`mt-0.5 shrink-0 text-base ${qr.is_correct ? 'text-emerald-400' : 'text-rose-400'}`}>{qr.is_correct ? '✓' : '✗'}</span>
                              <div className="flex-1">
                                <p className="text-slate-200"><span className="text-xs text-slate-400">#{qIdx + 1} </span>{qr.question}</p>
                                <div className="mt-1.5 flex flex-wrap gap-2">
                                  {qr.options.map((opt, oIdx) => {
                                    const isSelected = qr.selected.includes(oIdx);
                                    const isCorrect = qr.correct_indices.includes(oIdx);
                                    let cls = 'rounded px-2 py-0.5 text-xs ';
                                    if (isSelected && isCorrect) cls += 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50';
                                    else if (isSelected) cls += 'bg-rose-500/25 text-rose-300 ring-1 ring-rose-500/50';
                                    else if (isCorrect) cls += 'bg-emerald-900/40 text-emerald-500';
                                    else cls += 'bg-slate-800/60 text-slate-400';
                                    return (
                                      <span key={oIdx} className={cls}>
                                        {String.fromCharCode(65 + oIdx)}. {opt}
                                        {isSelected && !isCorrect ? ' ✗' : ''}
                                        {isCorrect ? ' ✓' : ''}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {students.length > 0 ? (() => {
              const allAttempts = students
                .flatMap((s) => s.attempts.map((a) => ({ ...a, client_id: s.client_id })))
                .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime());
              return (
                <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="mb-1 font-semibold text-slate-100">作答時間軸</h3>
                  <p className="mb-3 text-xs text-slate-500">所有學生提交記錄，依時間先後排序。</p>
                  <ol className="relative border-l border-slate-700 pl-4 space-y-3">
                    {allAttempts.map((a) => (
                      <li key={a.attempt_id} className="relative">
                        <span className="absolute -left-[1.3125rem] top-1.5 h-2.5 w-2.5 rounded-full border border-slate-600 bg-slate-900" />
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-400">{new Date(a.submitted_at).toLocaleString()}</span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-300">{a.client_id.slice(0, 8)}</span>
                          <span className="text-slate-400">{a.quiz_title || `測驗 #${a.quiz_id}`}</span>
                          <span className={`rounded px-1.5 py-0.5 font-medium ${a.score != null && a.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                            {a.score != null ? `${Math.round(a.score)} 分` : '未計分'}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })() : null}

            <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-100">AI 教學建議</h3>
                  <p className="mt-1 text-xs text-slate-500">根據測驗答對率與觀看完成率，自動生成下一步教學建議。</p>
                </div>
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={() => {
                    setAiLoading(true);
                    setAiError(null);
                    fetch(`api/pdfs/${encodeURIComponent(pdfId)}/report/ai-suggestions`, { method: 'POST' })
                      .then((r) => r.ok ? r.json() as Promise<{ suggestions: string }> : r.json().then((e: unknown) => Promise.reject(e)))
                      .then((data) => { setAiSuggestions(data.suggestions); })
                      .catch(() => { setAiError('AI 建議生成失敗，請稍後再試。'); })
                      .finally(() => { setAiLoading(false); });
                  }}
                  className="shrink-0 rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
                >
                  {aiLoading ? '生成中…' : aiSuggestions ? '重新生成' : '生成 AI 建議'}
                </button>
              </div>
              {aiError ? <p className="mt-3 text-sm text-rose-300">{aiError}</p> : null}
              {aiSuggestions ? (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm leading-relaxed text-slate-200">
                  {aiSuggestions}
                </pre>
              ) : null}
            </section>

            <p className="text-right text-xs text-slate-500">產生時間：{new Date(summary.generated_at).toLocaleString()}</p>
          </div>
        ) : null}
        </div>
      </div>
    </>
  );
}
