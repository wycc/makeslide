import { RegenerateProgress } from './RegenerateProgress';
import type { RegenJobState } from '../../types';
import { useI18n } from '../../i18n';
import { formatRegenSelectedPagesSummary } from './formatters';

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
  const { t } = useI18n();
  const disabled = isReadOnlyProcessing || regenAllBusy;
  const selectedPagesSummary = formatRegenSelectedPagesSummary({
    deckPagesCount,
    selectedPages: regenSelectedPages,
    t,
  });
  const executionOrder = [
    t('play.regenDialog.optionImage'),
    t('play.regenDialog.optionScript'),
    t('play.regenDialog.optionAudio'),
    t('play.regenDialog.optionAnimation'),
  ].join(t('play.regenDialog.executionOrderSeparator'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">{t('play.regenDialog.title')}</h3>
        <p className="mb-3 text-xs text-slate-400">
          {t('play.regenDialog.descriptionPrefix')}{' '}
          <span className="font-semibold text-slate-200">{executionOrder}</span>
          {t('play.regenDialog.descriptionSuffix')}
        </p>
        <div className="mb-3 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-200">
          {selectedPagesSummary}
        </div>
        <div className="mb-3 space-y-2">
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            {t('play.regenDialog.imageStyleApplied')}
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.image}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, image: e.target.checked }))}
              disabled={disabled}
            />
            <span>{t('play.regenDialog.optionImage')}</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.script}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, script: e.target.checked }))}
              disabled={disabled}
            />
            <span>{t('play.regenDialog.optionScript')}</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.audio}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, audio: e.target.checked }))}
              disabled={disabled}
            />
            <span>{t('play.regenDialog.optionAudio')}</span>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="accent-fuchsia-500"
              checked={regenOptions.animation}
              onChange={(e) => onRegenOptionsChange((prev) => ({ ...prev, animation: e.target.checked }))}
              disabled={disabled}
            />
            <span>{t('play.regenDialog.optionAnimation')}</span>
          </label>
        </div>
        {regenOptions.animation ? (
          <p className="mb-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
            {t('play.regenDialog.animationNotice')}
          </p>
        ) : null}
        {regenOptions.script || regenOptions.audio ? (
          <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300">{t('play.regenDialog.hostMode')}</span>
              <div className="flex overflow-hidden rounded border border-slate-700">
                {([
                  ['solo', t('play.regenDialog.hostModeSolo')],
                  ['dual', t('play.regenDialog.hostModeDual')],
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
              {t('play.regenDialog.hostModeHint')}
            </p>
          </div>
        ) : null}
        {regenOptions.image ? (
          <div className="mb-2">
            <label className="mb-1 block text-xs text-slate-400">{t('play.regenDialog.imagePromptLabel')}</label>
            <textarea
              value={regenAllPrompt}
              onChange={(e) => onRegenAllPromptChange(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
              placeholder={t('play.regenDialog.imagePromptPlaceholder')}
              disabled={disabled}
            />
          </div>
        ) : null}
        {regenOptions.script ? (
          <div className="mb-2">
            <label className="mb-1 block text-xs text-slate-400">{t('play.regenDialog.scriptPromptLabel')}</label>
            <textarea
              value={regenScriptPrompt}
              onChange={(e) => onRegenScriptPromptChange(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-fuchsia-500/40 placeholder:text-slate-500 focus:ring"
              placeholder={t('play.regenDialog.scriptPromptPlaceholder')}
              disabled={disabled}
            />
            <div className="mt-2">
              <label className="mb-1 block text-xs text-slate-400">{t('play.regenDialog.scriptMaxCharsLabel')}</label>
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
            {t('play.regenDialog.scriptOnlyWarning')}
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
            {regenJobRunning
              ? t('play.regenDialog.closeInBackground')
              : regenJob
                ? t('play.regenDialog.close')
                : t('play.regenDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isReadOnlyProcessing || regenAllBusy || !regenAnySelected}
            className="rounded border border-fuchsia-500/50 bg-fuchsia-500/15 px-3 py-1.5 text-sm text-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-40"
            title={!regenAnySelected ? t('play.regenDialog.selectAtLeastOne') : ''}
          >
            {regenAllBusy
              ? t('play.regenDialog.regenerating')
              : regenJob?.status === 'completed'
                ? t('play.regenDialog.regenerateAgain')
                : t('play.regenDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
