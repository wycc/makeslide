export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '尚無紀錄';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `約 ${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.ceil(seconds % 60);
  if (minutes < 60) return remainSeconds > 0 ? `約 ${minutes} 分 ${remainSeconds} 秒` : `約 ${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `約 ${hours} 小時 ${remainMinutes} 分` : `約 ${hours} 小時`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

export function formatCostUsd(cost: number | null): string {
  if (cost == null) return '未知';
  if (cost === 0) return '$0';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}
