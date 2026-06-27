import { geminiVoiceLabel, openaiVoiceLabel, type TtsProvider } from '../../lib/ttsVoices';
import { normalizeScriptMaxChars } from '../../lib/scriptMaxChars';
import { useI18n } from '../../i18n';

interface TtsDialogProps {
  ttsProvider: TtsProvider;
  availableTtsVoices: readonly string[];
  ttsVoice: string;
  onTtsVoiceChange: (voice: string) => void;
  hostMode: 'solo' | 'dual';
  onHostModeChange: (mode: 'solo' | 'dual') => void;
  ttsSpeed: number;
  onTtsSpeedChange: (speed: number) => void;
  scriptMaxCharsPerPage: number | null;
  onScriptMaxCharsPerPageChange: (value: number | null) => void;
  ttsMsg: string | null;
  ttsBusy: boolean;
  isReadOnlyProcessing: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function TtsDialog({
  ttsProvider,
  availableTtsVoices,
  ttsVoice,
  onTtsVoiceChange,
  hostMode,
  onHostModeChange,
  ttsSpeed,
  onTtsSpeedChange,
  scriptMaxCharsPerPage,
  onScriptMaxCharsPerPageChange,
  ttsMsg,
  ttsBusy,
  isReadOnlyProcessing,
  onClose,
  onSave,
}: TtsDialogProps) {
  const { t } = useI18n();
  const voiceGenderLabels = { male: t('tts.voiceGenderMale'), female: t('tts.voiceGenderFemale') };
  const disabled = isReadOnlyProcessing || ttsBusy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">{t('play.ttsDialog.title')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">{t('play.ttsDialog.voice')}</span>
            <select
              value={ttsVoice}
              onChange={(e) => onTtsVoiceChange(e.target.value)}
              disabled={disabled}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
            >
              {availableTtsVoices.map((v) => (
                <option key={v} value={v}>{ttsProvider === 'gemini' ? geminiVoiceLabel(v, voiceGenderLabels) : openaiVoiceLabel(v, voiceGenderLabels)}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300">{t('play.ttsDialog.hostMode')}</span>
              <div className="flex overflow-hidden rounded border border-slate-700">
                {([
                  ['solo', t('play.ttsDialog.hostModeSolo')],
                  ['dual', t('play.ttsDialog.hostModeDual')],
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
              {t('play.ttsDialog.hostModeHint')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300">{t('play.ttsDialog.speed')}</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={ttsSpeed}
              onChange={(e) => onTtsSpeedChange(Number(e.target.value))}
              disabled={disabled}
              className="flex-1 accent-cyan-500"
            />
            <span className="w-10 text-right text-xs tabular-nums text-slate-300">{ttsSpeed.toFixed(2)}</span>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300">{t('play.ttsDialog.scriptMaxChars')}</span>
              <span className="text-xs text-slate-500">{t('play.ttsDialog.scriptMaxCharsHint')}</span>
            </div>
            <input
              type="number"
              min={80}
              max={2000}
              step={10}
              placeholder={t('play.ttsDialog.scriptMaxCharsPlaceholder')}
              value={scriptMaxCharsPerPage ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') { onScriptMaxCharsPerPageChange(null); return; }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                onScriptMaxCharsPerPageChange(normalizeScriptMaxChars(n));
              }}
              disabled={disabled}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>
          {ttsMsg ? <p className="text-xs text-slate-400">{ttsMsg}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.ttsDialog.close')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={disabled}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
          >
            {ttsBusy ? t('play.ttsDialog.saving') : t('play.ttsDialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
