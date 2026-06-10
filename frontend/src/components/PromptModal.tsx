import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TTS_VOICE_BY_PROVIDER,
  TTS_VOICES_BY_PROVIDER,
  geminiVoiceLabel,
  openaiVoiceLabel,
  type TtsProvider,
} from '../lib/ttsVoices';
import { getImagePromptTemplates, type ImagePromptTemplate } from '../lib/api';
import { useI18n, type TranslationKey } from '../i18n';

export interface PromptPreset {
  key: string;
  labelKey: TranslationKey;
  promptKey: TranslationKey;
}

/**
 * Built-in style presets — click to fill the textarea. Pure hints; the
 * actual LLM is free to interpret them.
 */
const PRESETS: PromptPreset[] = [
  {
    key: 'teacher',
    labelKey: 'promptModal.presetTeacherLabel',
    promptKey: 'promptModal.presetTeacherPrompt',
  },
  {
    key: 'business',
    labelKey: 'promptModal.presetBusinessLabel',
    promptKey: 'promptModal.presetBusinessPrompt',
  },
  {
    key: 'podcast',
    labelKey: 'promptModal.presetPodcastLabel',
    promptKey: 'promptModal.presetPodcastPrompt',
  },
  {
    key: 'tech',
    labelKey: 'promptModal.presetTechLabel',
    promptKey: 'promptModal.presetTechPrompt',
  },
];

const MAX_PROMPT_CHARS = 2000;

interface PromptModalProps {
  /** Display title for the modal header (usually the PDF filename). */
  pdfTitle: string | null;
  /** Initial prompt text (e.g. a previously submitted prompt). */
  initialValue?: string;
  ttsProvider?: TtsProvider;
  showSplitConfirmation?: boolean;
  /** Called when user clicks submit. Should throw on failure to show error. */
  onSubmit: (
    prompt: string,
    requireScriptConfirmation: boolean,
    opts: {
      ttsVoice: string;
      ttsSpeed: number;
      scriptMaxCharsPerPage: number;
      tonePrompt?: string;
      imageStylePrompt?: string;
      requireSplitConfirmation?: boolean;
    },
  ) => Promise<void>;
  /** Called when the user cancels / dismisses the modal. */
  onClose: () => void;
}

export default function PromptModal({
  pdfTitle,
  initialValue = '',
  ttsProvider = 'openai',
  showSplitConfirmation = true,
  onSubmit,
  onClose,
}: PromptModalProps) {
  const { language, t } = useI18n();
  const availableTtsVoices = TTS_VOICES_BY_PROVIDER[ttsProvider];
  const [value, setValue] = useState<string>(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [requireScriptConfirmation, setRequireScriptConfirmation] = useState(false);
  const [requireSplitConfirmation, setRequireSplitConfirmation] = useState(false);
  const [ttsVoice, setTtsVoice] = useState<string>(DEFAULT_TTS_VOICE_BY_PROVIDER[ttsProvider]);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [scriptMaxCharsPerPage, setScriptMaxCharsPerPage] = useState(150);
  const [tonePrompt, setTonePrompt] = useState(t('promptModal.defaultTonePrompt'));
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(PRESETS[0]?.key ?? '');
  const [imageTemplates, setImageTemplates] = useState<ImagePromptTemplate[]>([]);
  const [selectedImageTemplateKey, setSelectedImageTemplateKey] = useState<string>('');
  const [imageStylePrompt, setImageStylePrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus the textarea on open.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resp = await getImagePromptTemplates();
        if (!active) return;
        setImageTemplates(resp.templates);
        const key = resp.default_template_key ?? resp.templates[0]?.key ?? '';
        setSelectedImageTemplateKey(key);
        const hit = resp.templates.find((t) => t.key === key) ?? resp.templates[0];
        setImageStylePrompt(hit ? getLocalizedImagePrompt(hit) : '');
      } catch {
        // non-fatal: keep modal usable even if template endpoint fails
      }
    })();
    return () => {
      active = false;
    };
  }, [language]);

  useEffect(() => {
    if (availableTtsVoices.some((voice) => voice === ttsVoice)) return;
    setTtsVoice(DEFAULT_TTS_VOICE_BY_PROVIDER[ttsProvider]);
  }, [availableTtsVoices, ttsProvider, ttsVoice]);

  // Esc closes (only when not submitting).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const handleSubmit = async (prompt: string) => {
    if (submitting) return;
    if (prompt.length > MAX_PROMPT_CHARS) {
      setError(t('promptModal.errorPromptTooLong').replace('{max}', String(MAX_PROMPT_CHARS)));
      return;
    }
    setSubmitting(true);
    setError(null);
    const normalizedTtsSpeed = Number.isFinite(ttsSpeed)
      ? Math.min(4, Math.max(0.25, ttsSpeed))
      : 1;
    try {
      await onSubmit(prompt, requireScriptConfirmation, {
        ttsVoice,
        ttsSpeed: normalizedTtsSpeed,
        scriptMaxCharsPerPage,
        tonePrompt: tonePrompt.trim() || undefined,
        imageStylePrompt: imageStylePrompt.trim() || undefined,
        requireSplitConfirmation,
      });
      // Parent is responsible for closing the modal on success.
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : t('promptModal.submitFailed');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = () => {
    void handleSubmit(value.trim());
  };

  const handleSkip = () => {
    void handleSubmit('');
  };

  const onSelectPreset = (key: string) => {
    setSelectedPresetKey(key);
  };

  const applySelectedPreset = () => {
    const hit = PRESETS.find((p) => p.key === selectedPresetKey);
    if (hit) {
      setValue(t(hit.promptKey));
      textareaRef.current?.focus();
    }
  };

  const onSelectImageTemplate = (key: string) => {
    setSelectedImageTemplateKey(key);
    const hit = imageTemplates.find((t) => t.key === key);
    if (hit) setImageStylePrompt(getLocalizedImagePrompt(hit));
  };

  const getLocalizedImagePrompt = (template: ImagePromptTemplate) =>
    language === 'zh-TW' ? template.prompt_zh : template.prompt_en;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('promptModal.dialogLabel')}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">{t('promptModal.title')}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {(pdfTitle ? t('promptModal.uploadCompleteNamed').replace('{title}', pdfTitle) : t('promptModal.uploadCompleteUnnamed'))}{' '}
            {t('promptModal.description')}
          </p>
        </div>

        <div className="px-4 py-3">
          <label
            htmlFor="prompt-textarea"
            className="mb-1 block text-xs font-medium text-slate-300"
          >
            {t('promptModal.promptLabel')}
          </label>
          <textarea
            id="prompt-textarea"
            ref={textareaRef}
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            disabled={submitting}
            rows={4}
            maxLength={MAX_PROMPT_CHARS + 50}
            placeholder={t('promptModal.promptPlaceholder')}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>{t('promptModal.blankHint')}</span>
            <span
              className={
                value.length > MAX_PROMPT_CHARS ? 'text-rose-400' : undefined
              }
            >
              {value.length} / {MAX_PROMPT_CHARS}
            </span>
          </div>

          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <p className="mb-2 text-xs font-medium text-slate-300">{t('promptModal.presetsSection')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <label className="text-xs text-slate-300">
                {t('promptModal.template')}
                <select
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                  value={selectedPresetKey}
                  onChange={(ev) => onSelectPreset(ev.target.value)}
                  disabled={submitting}
                >
                  {PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>{t(p.labelKey)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={applySelectedPreset}
                disabled={submitting}
                className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-60"
              >
                套用模板
              </button>
            </div>
          </div>

          <div className="mt-3">
            {showSplitConfirmation ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={requireSplitConfirmation}
                    onChange={(ev) => setRequireSplitConfirmation(ev.target.checked)}
                    disabled={submitting}
                  />
                  <span>{t('promptModal.requireSplitConfirmation')}</span>
                </label>

                <label className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={requireScriptConfirmation}
                    onChange={(ev) => setRequireScriptConfirmation(ev.target.checked)}
                    disabled={submitting}
                  />
                  <span>{t('promptModal.requireScriptConfirmation')}</span>
                </label>
              </div>
            ) : (
              <label className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={requireScriptConfirmation}
                  onChange={(ev) => setRequireScriptConfirmation(ev.target.checked)}
                  disabled={submitting}
                />
                <span>{t('promptModal.requireScriptConfirmation')}</span>
              </label>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs text-slate-300">
              {t('promptModal.ttsVoice')}
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={ttsVoice}
                onChange={(ev) => setTtsVoice(ev.target.value)}
                disabled={submitting}
              >
                {availableTtsVoices.map((v) => (
                  <option key={v} value={v}>{ttsProvider === 'gemini' ? geminiVoiceLabel(v) : openaiVoiceLabel(v)}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-300">
              {t('promptModal.ttsSpeed')}
              <input
                type="number"
                min={0.25}
                max={4}
                step={0.05}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={ttsSpeed}
                onChange={(ev) => setTtsSpeed(Number(ev.target.value) || 1)}
                disabled={submitting}
              />
            </label>

            <label className="text-xs text-slate-300">
              {t('promptModal.maxLengthPerPage')}
              <input
                type="number"
                min={80}
                max={2000}
                step={10}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={scriptMaxCharsPerPage}
                onChange={(ev) => setScriptMaxCharsPerPage(Number(ev.target.value) || 150)}
                disabled={submitting}
              />
            </label>
          </div>

          <label className="mt-2 block text-xs text-slate-300">
            {t('promptModal.tonePromptLabel')}
            <textarea
              rows={1}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              value={tonePrompt}
              onChange={(ev) => setTonePrompt(ev.target.value)}
              disabled={submitting}
              placeholder={t('promptModal.tonePromptPlaceholder')}
            />
          </label>

          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <p className="mb-2 text-xs font-medium text-slate-300">{t('promptModal.imageTemplateSection')}</p>
            <label className="text-xs text-slate-300">
              {t('promptModal.template')}
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={selectedImageTemplateKey}
                onChange={(ev) => onSelectImageTemplate(ev.target.value)}
                disabled={submitting || imageTemplates.length === 0}
              >
                {imageTemplates.map((t) => (
                  <option key={t.key} value={t.key}>{language === 'zh-TW' ? t.label : t.key.replaceAll('_', ' ')}</option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-xs text-slate-300">
              {t('promptModal.templateContent')}
              <textarea
                rows={2}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={imageStylePrompt}
                onChange={(ev) => setImageStylePrompt(ev.target.value)}
                disabled={submitting}
              />
            </label>
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-900/80 px-4 py-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
          >
            {t('promptModal.setLater')}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
          >
            {t('promptModal.useDefault')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? t('promptModal.submitting') : t('promptModal.startGeneration')}
          </button>
        </div>
      </div>
    </div>
  );
}
