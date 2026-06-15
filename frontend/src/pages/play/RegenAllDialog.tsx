import { RegenerateProgress } from './RegenerateProgress';
import type { RegenJobState } from '../../types';

interface RegenOptions {
  image: boolean;
  script: boolean;
  audio: boolean;
  animation: boolean;
}

interface RegenAllDialogProps {
  deckPagesCount: number;
  regenSelectedPages: Set<number>;
  regenOptions: RegenOptions;
  onRegenOptionsChange: (updater: (prev: RegenOptions) => RegenOptions) => void;
  regenAllPrompt: string;
  onRegenAllPromptChange: (value: string) => void;
  regenScriptPrompt: string;
  onRegenScriptPromptChange: (value: string) => void;
  regenScriptMaxCharsPerPage: number;
  onRegenScriptMaxCharsPerPageChange: (value: number) => void;
  hostMode: 'solo' | 'dual';
  onHostModeChange: (mode: 'solo' | 'dual') => void;
  regenJob: RegenJobState | null;
  regenAllMsg: string | null;
  regenAllBusy: boolean;
  regenJobRunning: boolean;
  regenAnySelected: boolean;
  isReadOnlyProcessing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RegenAllDialog({
  deckPagesCount,
  regenSelectedPages,
  regenOptions,
  onRegenOptionsChange,
  regenAllPrompt,
  onRegenAllPromptChange,
  regenScriptPrompt,
  onRegenScriptPromptChange,
  regenScriptMaxCharsPerPage,
  onRegenScriptMaxCharsPerPageChange,
  hostMode,
  onHostModeChange,
  regenJob,
  regenAllMsg,
  regenAllBusy,
  regenJobRunning,
  regenAnySelected,
  isReadOnlyProcessing,
  onClose,
  onConfirm,
}: RegenAllDialogProps) {
  const disabled = isReadOnlyProcessing || regenAllBusy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">選擇重生項目</h3>
        <p className="mb-3 text-xs text-slate-400">
          可多選；執行順序固定為 <span className="font-semibold text-slate-200">圖檔 → 逐字稿 → 語音 → 動畫</span>。
        </p>
        <div className="mb-3 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-200">
          {regenSelectedPages.size > 0
            ? `僅重生已選取的 ${regenSelectedPages.size} 張投影片（第 ${Array.from(regenSelectedPages).sort((a, b) => a - b).join('、') } 頁）`
            : `重生全部 ${deckPagesCount} 張投影片`}
        </div>
        <div className="mb-3 space-y-2">
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            已套用整份圖片風格設定（可於上方「🖼️ 風格」調整）。
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.image}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, image: e.target.checked }))}
              disabled={disabled}
            />
            <span>圖檔</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.script}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, script: e.target.checked }))}
              disabled={disabled}
            />
            <span>逐字稿</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.audio}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, audio: e.target.checked }))}
              disabled={disabled}
            />
            <span>語音</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.animation}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, animation: e.target.checked }))}
              disabled={disabled}
            />
            <span>動畫</span>
          </label>
        </div>
        {regenOptions.animation ? (
          <p className="mb-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
            將依每頁逐字稿的句子數量，自動產生對應的「醒目方框」焦點動畫（與動畫編輯分頁的「一次性產生」效果相同），並覆寫該頁原有的動畫設定。
          </p>
        ) : null}
        {regenOptions.script || regenOptions.audio ? (
          <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300">主持模式</span>
              <div className="flex overflow-hidden rounded border border-slate-700">
                {([
                  ['solo', '單人旁白'],
                  ['dual', '雙人對談'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onHostModeChange(mode)}
                    disabled={disabled}
                    aria-pressed={hostMode === mode}
                    className={`px-3 py-1 text-xs ${
                      hostMode === mode
                        ? 'bg-cyan-500/25 font-medium text-cyan-100'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              重生逐字稿／語音時套用此主持模式；雙人對談會使用 Speaker 1／2 人設與聲音設定。
            </p>
          </div>
        ) : null}
        {regenOptions.image ? (
          <div className="mb-2">
            <label className="mb-1 block text-xs text-slate-400">圖檔重生提示詞</label>
            <textarea
              value={regenAllPrompt}
              onChange={(e) => onRegenAllPromptChange(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
              placeholder="輸入整份風格調整提示詞..."
              disabled={disabled}
            />
          </div>
        ) : null}
        {regenOptions.script ? (
          <div className="mb-2">
            <label className="mb-1 block text-xs text-slate-400">逐字稿重生提示詞</label>
            <textarea
              value={regenScriptPrompt}
              onChange={(e) => onRegenScriptPromptChange(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
              placeholder="例如：請以更精煉、口語、易懂的方式重寫，並保留每頁核心重點"
              disabled={disabled}
            />
            <div className="mt-2">
              <label className="mb-1 block text-xs text-slate-400">逐字稿每頁最大長度</label>
              <input
                type="number"
                min={80}
                max={2000}
                step={1}
                value={regenScriptMaxCharsPerPage}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  const normalized = Math.max(80, Math.min(2000, Math.round(raw)));
                  onRegenScriptMaxCharsPerPageChange(normalized);
                }}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
                disabled={disabled}
              />
            </div>
          </div>
        ) : null}
        {regenOptions.script && regenOptions.audio ? null : regenOptions.script ? (
          <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            提醒：若僅重生逐字稿，原有語音可能與新的逐字稿不相符，建議同時勾選「語音」。
          </p>
        ) : null}
        <RegenerateProgress job={regenJob} />
        {regenAllMsg ? (
          <p
            className={`mt-2 text-xs ${
              regenJob?.status === 'completed'
                ? 'text-emerald-300'
                : regenJob?.status === 'failed'
                  ? 'text-rose-300'
                  : 'text-slate-300'
            }`}
          >
            {regenAllMsg}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={regenAllBusy}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {regenJobRunning ? '關閉（背景繼續）' : regenJob ? '關閉' : '取消'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isReadOnlyProcessing || regenAllBusy || !regenAnySelected}
            className="rounded border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-sm text-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-40"
            title={!regenAnySelected ? '請至少選擇一個項目' : ''}
          >
            {regenAllBusy ? '重生中…' : regenJob?.status === 'completed' ? '再次重生' : '確認'}
          </button>
        </div>
      </div>
    </div>
  );
}
