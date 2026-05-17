import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  const [metrics, setMetrics] = useState<ObservabilityMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setMetrics(await getObservabilityMetrics());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '讀取可觀測性資料失敗');
    } finally {
      setLoading(false);
    }
  }, []);

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
            <h1 className="text-lg font-semibold">系統可觀測性儀表</h1>
            <p className="mt-1 text-xs text-slate-500">成功率、失敗率、處理時間與 LLM token 成本概覽</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => void loadMetrics()}
              disabled={loading}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              重新整理
            </button>
            <Link className="text-slate-300 hover:text-white" to="/settings">
              AI 設定
            </Link>
            <Link className="text-slate-300 hover:text-white" to="/">
              返回首頁
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {loading ? <p className="text-sm text-slate-400">載入中…</p> : null}
        {err ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        ) : null}
        {metrics ? (
          <>
            <p className="text-xs text-slate-500">資料產生時間：{updatedAt}</p>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-200">簡報處理狀態</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="總簡報數" value={formatInt(metrics.pdfs.total)} />
                <MetricCard label="成功率" value={`${metrics.pdfs.success_rate}%`} hint={`${formatInt(metrics.pdfs.completed)} 份完成`} tone="good" />
                <MetricCard label="失敗率" value={`${metrics.pdfs.failure_rate}%`} hint={`${formatInt(metrics.pdfs.failed)} 份失敗`} tone="bad" />
                <MetricCard label="處理中" value={formatInt(metrics.pdfs.processing)} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-200">Pipeline 執行狀態</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="總 Run 數" value={formatInt(metrics.pipeline_runs.total)} />
                <MetricCard label="Run 成功率" value={`${metrics.pipeline_runs.success_rate}%`} hint={`${formatInt(metrics.pipeline_runs.succeeded)} 次成功`} tone="good" />
                <MetricCard label="Run 失敗率" value={`${metrics.pipeline_runs.failure_rate}%`} hint={`${formatInt(metrics.pipeline_runs.failed)} 次失敗`} tone="bad" />
                <MetricCard label="平均耗時" value={formatDuration(metrics.pipeline_runs.average_duration_ms)} hint={`${formatInt(metrics.pipeline_runs.running)} 個執行中`} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-200">LLM 使用量與估算成本</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="LLM 回應數" value={formatInt(metrics.llm_usage.requests)} />
                <MetricCard label="總 Tokens" value={formatInt(metrics.llm_usage.total_tokens)} hint={`輸入 ${formatInt(metrics.llm_usage.prompt_tokens)} / 輸出 ${formatInt(metrics.llm_usage.completion_tokens)}`} />
                <MetricCard label="平均延遲" value={formatDuration(metrics.llm_usage.average_latency_ms)} />
                <MetricCard label="估算成本" value={formatCost(metrics.llm_usage.estimated_cost_usd)} hint="依已知 OpenAI 模型價格估算" />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-200">Stage 狀態分布</h2>
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
                  <p className="text-sm text-slate-500">尚無 stage timing 資料。</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-200">頁面 Artifact 狀態分布</h2>
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
                  <p className="text-sm text-slate-500">尚無頁面 artifact timing 資料。</p>
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
