import ContentLanguagePicker from '../../components/ContentLanguagePicker';
import { voiceLabelForProvider, type TtsProvider } from '../../lib/ttsVoices';
import { SCRIPT_MAX_CHARS_MIN, SCRIPT_MAX_CHARS_MAX } from '../../lib/scriptMaxChars';
import { useScriptMaxCharsInput } from '../../hooks/useScriptMaxCharsInput';
import { useI18n, type AppLanguage } from '../../i18n';

/** Dropdown items need their own colours — see the comment at the first <option>. */
const OPTION_CLASS = 'bg-slate-900 text-slate-100';

interface TtsDialogProps {
  ttsProvider: TtsProvider;
  availableTtsVoices: readonly string[];
  ttsVoice: string;
  onTtsVoiceChange: (voice: string) => void;
  /** This deck's voice for each host in dual mode; '' = use the global speaker voice. */
  ttsSpeaker1Voice: string;
  onTtsSpeaker1VoiceChange: (voice: string) => void;
  ttsSpeaker2Voice: string;
  onTtsSpeaker2VoiceChange: (voice: string) => void;
  /** The global speaker voices, shown so "use the global voice" says what that is. */
  globalSpeaker1Voice: string | null;
  globalSpeaker2Voice: string | null;
  hostMode: 'solo' | 'dual';
  onHostModeChange: (mode: 'solo' | 'dual') => void;
  ttsSpeed: number;
  onTtsSpeedChange: (speed: number) => void;
  scriptMaxCharsPerPage: number | null;
  onScriptMaxCharsPerPageChange: (value: number | null) => void;
  /** 這份簡報的產生語言；改了要重新產生內容才會套用（見下方提示）。 */
  contentLanguage: AppLanguage;
  onContentLanguageChange: (language: AppLanguage) => void;
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
  ttsSpeaker1Voice,
  onTtsSpeaker1VoiceChange,
  ttsSpeaker2Voice,
  onTtsSpeaker2VoiceChange,
  globalSpeaker1Voice,
  globalSpeaker2Voice,
  hostMode,
  onHostModeChange,
  ttsSpeed,
  onTtsSpeedChange,
  scriptMaxCharsPerPage,
  onScriptMaxCharsPerPageChange,
  contentLanguage,
  onContentLanguageChange,
  ttsMsg,
  ttsBusy,
  isReadOnlyProcessing,
  onClose,
  onSave,
}: TtsDialogProps) {
  const { t } = useI18n();
  const voiceGenderLabels = { male: t('tts.voiceGenderMale'), female: t('tts.voiceGenderFemale') };
  const disabled = isReadOnlyProcessing || ttsBusy;
  const maxChars = useScriptMaxCharsInput(scriptMaxCharsPerPage, onScriptMaxCharsPerPageChange);
  const voiceLabel = (v: string) => voiceLabelForProvider(ttsProvider, v, voiceGenderLabels);
  // What leaving a host's voice empty falls back to: the global speaker voice if one is
  // configured, otherwise this deck's single voice above.
  const inheritLabel = (globalVoice: string | null) =>
    globalVoice?.trim()
      ? t('play.ttsDialog.speakerVoiceInherit').replace('{voice}', voiceLabel(globalVoice.trim()))
      : t('play.ttsDialog.speakerVoiceInheritDeck');

  const speakerVoiceRow = (
    label: string,
    value: string,
    onChange: (voice: string) => void,
    globalVoice: string | null,
  ) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="max-w-[60%] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
      >
        {/* The colours are repeated on each <option> on purpose: the expanded list is drawn
            by the OS, which ignores the <select>'s own colours, so without these the items
            render as light text on the platform's white popup. */}
        <option value="" className={OPTION_CLASS}>{inheritLabel(globalVoice)}</option>
        {availableTtsVoices.map((v) => (
          <option key={v} value={v} className={OPTION_CLASS}>{voiceLabel(v)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">{t('play.ttsDialog.title')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">
              {hostMode === 'dual' ? t('play.ttsDialog.voiceSolo') : t('play.ttsDialog.voice')}
            </span>
            <select
              value={ttsVoice}
              onChange={(e) => onTtsVoiceChange(e.target.value)}
              disabled={disabled}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              {/* A provider with no enumerable voices (audio.cpp: they belong to whichever model
                  family is installed) would otherwise render an empty dropdown that silently
                  submits ''. Say where the voice comes from instead. */}
              {availableTtsVoices.length === 0 ? (
                <option value="" className={OPTION_CLASS}>{t('play.ttsDialog.voiceFromSettings')}</option>
              ) : null}
              {availableTtsVoices.map((v) => (
                <option key={v} value={v} className={OPTION_CLASS}>{voiceLabel(v)}</option>
              ))}
            </select>
          </div>
          {hostMode === 'dual' ? (
            <div className="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-2">
              {speakerVoiceRow(
                t('play.ttsDialog.speaker1Voice'),
                ttsSpeaker1Voice,
                onTtsSpeaker1VoiceChange,
                globalSpeaker1Voice,
              )}
              {speakerVoiceRow(
                t('play.ttsDialog.speaker2Voice'),
                ttsSpeaker2Voice,
                onTtsSpeaker2VoiceChange,
                globalSpeaker2Voice,
              )}
              <p className="text-[11px] text-slate-500">{t('play.ttsDialog.speakerVoiceHint')}</p>
            </div>
          ) : null}
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
              <span className="text-xs text-slate-300">{t('play.ttsDialog.contentLanguage')}</span>
              <ContentLanguagePicker
                value={contentLanguage}
                onChange={onContentLanguageChange}
                disabled={disabled}
                showLabel={false}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">{t('play.ttsDialog.contentLanguageHint')}</p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300">{t('play.ttsDialog.scriptMaxChars')}</span>
              <span className="text-xs text-slate-500">{t('play.ttsDialog.scriptMaxCharsHint')}</span>
            </div>
            <input
              type="number"
              min={SCRIPT_MAX_CHARS_MIN}
              max={SCRIPT_MAX_CHARS_MAX}
              step={10}
              placeholder={t('play.ttsDialog.scriptMaxCharsPlaceholder')}
              value={maxChars.raw}
              onChange={(e) => maxChars.onRawChange(e.target.value)}
              aria-invalid={maxChars.invalid}
              disabled={disabled}
              className={`mt-1 w-full rounded border bg-slate-900 px-2 py-1 text-xs placeholder:text-slate-500 ${
                maxChars.invalid ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-slate-100'
              }`}
            />
            <p className={`mt-1 text-[11px] ${maxChars.invalid ? 'text-rose-400' : 'text-slate-500'}`}>
              {(maxChars.invalid ? t('play.scriptMaxCharsInvalid') : t('play.scriptMaxCharsRange'))
                .replace('{min}', String(SCRIPT_MAX_CHARS_MIN))
                .replace('{max}', String(SCRIPT_MAX_CHARS_MAX))}
            </p>
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
            disabled={disabled || maxChars.invalid}
            className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
          >
            {ttsBusy ? t('play.ttsDialog.saving') : t('play.ttsDialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
