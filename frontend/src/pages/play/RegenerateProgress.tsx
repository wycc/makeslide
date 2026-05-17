import type { RegenJobState, RegenStepName } from '../../types';
import { formatEta } from './formatters';

const STEP_LABELS: Record<RegenStepName, string> = {
  script: '逐字稿',
  audio: '語音',
  image: '圖檔',
};

export function RegenerateProgress({ job }: { job: RegenJobState | null }) {
  if (!job) return null;
  const currentStepIndex = Math.max(0, job.step_index);
  const jobEta = formatEta(job.eta_seconds);
  const finishAt = job.estimated_completion_at
    ? new Date(job.estimated_completion_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div className="mb-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-200">
          重生進度
          {job.status === 'running' || job.status === 'pending' ? (
            <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400 align-middle" />
          ) : null}
        </span>
        <span className="text-[11px] text-slate-400">
          步驟 {Math.min(currentStepIndex + 1, job.steps.length)}/{job.steps.length}
          {` · `}
          {job.status === 'running'
            ? '執行中'
            : job.status === 'completed'
              ? '已完成'
              : job.status === 'failed'
                ? '失敗'
                : '等待中'}
        </span>
      </div>
      {(jobEta || finishAt) && (
        <div className="mb-2 rounded border border-cyan-900/60 bg-cyan-950/30 px-2 py-1 text-[11px] text-cyan-100">
          預估剩餘：{jobEta ?? '計算中'}
          {finishAt ? ` · 預計 ${finishAt} 完成` : ''}
        </div>
      )}
      <ul className="space-y-1.5">
        {job.steps.map((s) => {
          const ratio = s.total > 0 ? Math.min(100, Math.round((s.completed / s.total) * 100)) : 0;
          const isCurrent = job.current_step === s.name;
          const stepEta = isCurrent ? formatEta(s.eta_seconds) : null;
          const color =
            s.status === 'failed'
              ? 'bg-rose-500'
              : s.status === 'completed'
                ? 'bg-emerald-500'
                : isCurrent
                  ? 'bg-cyan-500'
                  : 'bg-slate-600';
          return (
            <li key={s.name}>
              <div className="flex items-center justify-between">
                <span>
                  {STEP_LABELS[s.name]}
                  {isCurrent && s.status === 'running' ? '（進行中）' : ''}
                </span>
                <span className="tabular-nums text-slate-400">
                  {s.status === 'pending'
                    ? '等待中'
                    : s.status === 'failed'
                      ? `失敗：${s.error ?? '未知錯誤'}`
                      : `${s.completed}/${s.total} (${ratio}%)${stepEta ? ` · 剩 ${stepEta}` : ''}`}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${color} transition-all`}
                  style={{ width: `${s.status === 'completed' ? 100 : ratio}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
