import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ApiError, getObservabilityMetrics, type ObservabilityMetrics } from '../lib/api';

function formatInt(value: number): string {
  return new Intl.NumberFormat('zh-TW').format(value);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${Math.round(ms / 100) / 10} 秒`;
}

function formatCost(value: number | null): string {
  if (value == null) return '模型價格未知';
  return `US$${value.toFixed(6)}`;
}

function MetricCard(props: { label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'bad' }) {
  const toneClass =
    props.tone === 'good'
      ? 'text-emerald-200'
      : props.tone === 'bad'
        ? 'text-rose-200'
        : 'text-slate-100';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-400">{props.label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{props.value}</p>
      {props.hint ? <p className="mt-1 text-xs text-slate-500">{props.hint}</p> : null}
    </div>
  );
}

export default function SystemDataPage() {
  const { t } = useI18n();
  const formatMessage = useCallback((key: Parameters<typeof t>[0], replacements: Record<string, string | number>) => {
    let message = t(key);
    for (const [name, value] of Object.entries(replacements)) {
      message = message.replaceAll(`{${name}}`, String(value));
    }
    return message;
  }, [t]);
  const [metrics, setMetrics] = useState<ObservabilityMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setMetrics(await getObservabilityMetrics());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('systemData.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const updatedAt = useMemo(() => {
    if (!metrics) return '';
    return new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(metrics.generated_at));
  }, [metrics]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold">{t('systemData.title')}</h1>
            <p className="mt-1 text-xs text-slate-500">{t('systemData.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => void loadMetrics()}
              disabled={loading}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {t('systemData.refresh')}
            </button>
            <Link className="text-slate-300 hover:text-white" to="/settings">
              {t('systemData.aiSettingsLink')}
            </Link>
            <Link className="text-slate-300 hover:text-white" to="/">
              {t('settings.backHome')}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {loading ? <p className="text-sm text-slate-400">{t('systemData.loading')}</p> : null}
        {err ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        ) : null}
        {metrics ? (
          <>
            <p className="text-xs text-slate-500">{formatMessage('systemData.generatedAt', { time: updatedAt })}</p>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('systemData.pdfSectionTitle')}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label={t('systemData.totalPdfs')} value={formatInt(metrics.pdfs.total)} />
                <MetricCard label={t('systemData.successRate')} value={`${metrics.pdfs.success_rate}%`} hint={formatMessage('systemData.completedHint', { count: formatInt(metrics.pdfs.completed) })} tone="good" />
                <MetricCard label={t('systemData.failureRate')} value={`${metrics.pdfs.failure_rate}%`} hint={formatMessage('systemData.failedHint', { count: formatInt(metrics.pdfs.failed) })} tone="bad" />
                <MetricCard label={t('systemData.processing')} value={formatInt(metrics.pdfs.processing)} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('systemData.pipelineSectionTitle')}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label={t('systemData.totalRuns')} value={formatInt(metrics.pipeline_runs.total)} />
                <MetricCard label={t('systemData.runSuccessRate')} value={`${metrics.pipeline_runs.success_rate}%`} hint={formatMessage('systemData.runSucceededHint', { count: formatInt(metrics.pipeline_runs.succeeded) })} tone="good" />
                <MetricCard label={t('systemData.runFailureRate')} value={`${metrics.pipeline_runs.failure_rate}%`} hint={formatMessage('systemData.runFailedHint', { count: formatInt(metrics.pipeline_runs.failed) })} tone="bad" />
                <MetricCard label={t('systemData.averageDuration')} value={formatDuration(metrics.pipeline_runs.average_duration_ms)} hint={formatMessage('systemData.runningHint', { count: formatInt(metrics.pipeline_runs.running) })} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('systemData.llmSectionTitle')}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label={t('systemData.llmResponses')} value={formatInt(metrics.llm_usage.requests)} />
                <MetricCard label={t('systemData.totalTokens')} value={formatInt(metrics.llm_usage.total_tokens)} hint={formatMessage('systemData.tokensHint', { prompt: formatInt(metrics.llm_usage.prompt_tokens), completion: formatInt(metrics.llm_usage.completion_tokens) })} />
                <MetricCard label={t('systemData.averageLatency')} value={formatDuration(metrics.llm_usage.average_latency_ms)} />
                <MetricCard label={t('systemData.estimatedCost')} value={formatCost(metrics.llm_usage.estimated_cost_usd)} hint={t('systemData.costHint')} />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('systemData.stageDistribution')}</h2>
                {metrics.stages.length ? (
                  <ul className="space-y-2 text-sm">
                    {metrics.stages.map((item) => (
                      <li key={item.status} className="flex justify-between rounded-md bg-slate-950/60 px-3 py-2">
                        <span className="text-slate-300">{item.status}</span>
                        <span className="font-medium">{formatInt(item.count)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">{t('systemData.noStageData')}</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('systemData.artifactDistribution')}</h2>
                {metrics.artifacts.length ? (
                  <ul className="space-y-2 text-sm">
                    {metrics.artifacts.map((item) => (
                      <li key={item.status} className="flex justify-between rounded-md bg-slate-950/60 px-3 py-2">
                        <span className="text-slate-300">{item.status}</span>
                        <span className="font-medium">{formatInt(item.count)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">{t('systemData.noArtifactData')}</p>
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
