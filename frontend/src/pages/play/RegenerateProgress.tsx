import type { RegenJobState, RegenStepName } from '../../types';
import type { TranslationKey } from '../../i18n';
import { useI18n } from '../../i18n';
import {
  formatRegenerateEtaSummary,
  formatRegenerateEta,
  formatRegenerateJobStatus,
  formatRegenerateStepStatus,
} from './formatters';

const STEP_LABEL_KEYS: Record<RegenStepName, TranslationKey> = {
  script: 'play.regenerate.step.script',
  audio: 'play.regenerate.step.audio',
  image: 'play.regenerate.step.image',
  animation: 'play.regenerate.step.animation',
};

export function RegenerateProgress({ job }: { job: RegenJobState | null }) {
  const { t } = useI18n();
  if (!job) return null;
  const currentStepIndex = Math.max(0, job.step_index);
  const jobEta = formatRegenerateEta(job.eta_seconds, t);
  const finishAt = job.estimated_completion_at
    ? new Date(job.estimated_completion_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div className="mb-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-200">
          {t('play.regenerate.title')}
          {job.status === 'running' || job.status === 'pending' ? (
            <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400 align-middle" />
          ) : null}
        </span>
        <span className="text-[11px] text-slate-400">
          {t('play.regenerate.stepCounter')
            .replace('{current}', String(Math.min(currentStepIndex + 1, job.steps.length)))
            .replace('{total}', String(job.steps.length))}
          {` · `}
          {formatRegenerateJobStatus(job.status, t)}
        </span>
      </div>
      {(jobEta || finishAt) && (
        <div className="mb-2 rounded border border-cyan-900/60 bg-cyan-950/30 px-2 py-1 text-[11px] text-cyan-100">
          {formatRegenerateEtaSummary(t, jobEta, finishAt)}
        </div>
      )}
      <ul className="space-y-1.5">
        {job.steps.map((s) => {
          const ratio = s.total > 0 ? Math.min(100, Math.round((s.completed / s.total) * 100)) : 0;
          const isCurrent = job.current_step === s.name;
          const stepEta = isCurrent ? formatRegenerateEta(s.eta_seconds, t) : null;
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
                  {t(STEP_LABEL_KEYS[s.name])}
                  {isCurrent && s.status === 'running' ? t('play.regenerate.runningSuffix') : ''}
                </span>
                <span className="tabular-nums text-slate-400">
                  {formatRegenerateStepStatus(s.status, t, {
                    completed: s.completed,
                    total: s.total,
                    ratio,
                    eta: stepEta,
                    error: s.error,
                  })}
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
