import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadProgressPercent } from '../lib/uploadProgress';
import {
  ApiError,
  continuePromptOutlineChat,
  mapApiErrorToHumanMessage,
  uploadPdf,
  type PromptChatMessage,
} from '../lib/api';
import { useI18n, type TranslationKey } from '../i18n';

type ImportMode = 'paste' | 'prompt';

function formatTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
}

function buildRecoveryGuide(err: unknown, t: (key: TranslationKey) => string): string[] {
  if (err instanceof ApiError) {
    if (err.code === 'API_KEY_MISSING') return [t('importText.recoveryApiKey1'), t('importText.recoveryApiKey2')];
    if (err.code === 'POPPLER_NOT_FOUND' || err.code === 'DEPENDENCY_MISSING') return [t('importText.recoveryDependency1'), t('importText.recoveryDependency2')];
    if (err.code === 'MODEL_QUOTA_EXCEEDED' || err.code === 'MODEL_UNAVAILABLE') return [t('importText.recoveryModel1'), t('importText.recoveryModel2')];
    if (err.code === 'INVALID_UPLOAD_TYPE' || err.code === 'INVALID_URL') return [t('importText.recoveryInvalidInput1'), t('importText.recoveryInvalidInput2')];
  }
  return [t('importText.recoveryDefault1'), t('importText.recoveryDefault2')];
}

export default function ImportTextPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [mode, setMode] = useState<ImportMode>('paste');
  const [hostMode, setHostMode] = useState<'solo' | 'dual'>('solo');
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recoveryGuide, setRecoveryGuide] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<PromptChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [outlineText, setOutlineText] = useState('');
  const uploadProgressLabel = formatTemplate(t('importText.uploadingProgress'), { progress: String(progress) });

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content) {
      setError(t('importText.errorPasteContentRequired'));
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = await uploadPdf(new File([content], 'pasted.txt', { type: 'text/plain' }), {
        hostMode,
        onProgress: (loaded, total) => {
          if (total > 0) setProgress(uploadProgressPercent(loaded, total));
        },
      });
      navigate(`/?openPrompt=${encodeURIComponent(resp.id)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(formatTemplate(t('importText.uploadFailedDetail'), { title: h.title, message: h.message, nextStep: h.nextStep }));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(formatTemplate(t('importText.uploadFailedDetail'), { title: h.title, message: h.message, nextStep: h.nextStep }));
      } else {
        setError(t('importText.uploadFailedUnknown'));
      }
      setRecoveryGuide(buildRecoveryGuide(err, t));
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  const handleSendChat = async () => {
    const content = chatInput.trim();
    if (!content) {
      setError(t('importText.errorPromptRequired'));
      return;
    }
    const nextMessages: PromptChatMessage[] = [...chatMessages, { role: 'user', content }];
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatting(true);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = await continuePromptOutlineChat({ messages: nextMessages });
      setOutlineText(resp.outline_text);
      setText(resp.outline_text);
      setChatMessages([...nextMessages, { role: 'assistant', content: resp.assistant_message }]);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(formatTemplate(t('importText.chatFailedDetail'), { title: h.title, message: h.message, nextStep: h.nextStep }));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(formatTemplate(t('importText.chatFailedDetail'), { title: h.title, message: h.message, nextStep: h.nextStep }));
      } else {
        setError(t('importText.chatFailedUnknown'));
      }
      setRecoveryGuide(buildRecoveryGuide(err, t));
    } finally {
      setIsChatting(false);
    }
  };

  const handleCreateFromOutline = async () => {
    const content = (outlineText || text).trim();
    if (!content) {
      setError(t('importText.errorOutlineRequired'));
      return;
    }
    setText(content);
    setIsUploading(true);
    setProgress(0);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = await uploadPdf(new File([content], 'prompt-outline.txt', { type: 'text/plain' }), {
        hostMode,
        onProgress: (loaded, total) => {
          if (total > 0) setProgress(uploadProgressPercent(loaded, total));
        },
      });
      navigate(`/?openPrompt=${encodeURIComponent(resp.id)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(formatTemplate(t('importText.createFailedDetail'), { title: h.title, message: h.message, nextStep: h.nextStep }));
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err, t);
        setError(formatTemplate(t('importText.createFailedDetail'), { title: h.title, message: h.message, nextStep: h.nextStep }));
      } else {
        setError(t('importText.createFailedUnknown'));
      }
      setRecoveryGuide(buildRecoveryGuide(err, t));
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('importText.title')}</h1>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            {t('importText.backHome')}
          </button>
        </div>

        <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="text-sm font-semibold">{t('importText.firstTimeGuide')}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>{t('importText.step1')}</li>
            <li>{t('importText.step2')}</li>
            <li>{t('importText.step3')}</li>
            <li>{t('importText.step4')}</li>
          </ol>
          <a className="mt-2 inline-block text-xs underline underline-offset-2 text-slate-400 hover:text-slate-200" href="/docs/error-codes.md" target="_blank" rel="noreferrer">
            {t('importText.errorCodeGuide')}
          </a>
        </section>

        <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="text-sm font-semibold">{t('importText.importMethod')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                mode === 'paste'
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100'
                  : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="block text-sm font-medium">{t('importText.modePasteTitle')}</span>
              <span className="mt-1 block text-xs text-slate-400">{t('importText.modePasteDescription')}</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('prompt')}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                mode === 'prompt'
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100'
                  : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="block text-sm font-medium">{t('importText.modePromptTitle')}</span>
              <span className="mt-1 block text-xs text-slate-400">{t('importText.modePromptDescription')}</span>
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {mode === 'paste' ? t('importText.currentModePaste') : t('importText.currentModePrompt')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-slate-400">{t('upload.hostModeLabel')}</span>
            <div className="flex overflow-hidden rounded-md border border-slate-600">
              {(['solo', 'dual'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setHostMode(m)}
                  aria-pressed={hostMode === m}
                  className={`px-3 py-1 text-xs ${
                    hostMode === m
                      ? 'bg-cyan-500/25 font-medium text-cyan-100'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {m === 'solo' ? t('upload.hostModeSolo') : t('upload.hostModeDual')}
                </button>
              ))}
            </div>
          </div>
        </section>

        {mode === 'paste' ? (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('importText.pastePlaceholder')}
              className="min-h-[20rem] h-[calc(100vh-25rem)] w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400"
            />
            {isUploading && (
              <div className="rounded-lg border border-indigo-400/40 bg-indigo-500/10 p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-indigo-100">
                  <span>{uploadProgressLabel}</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-indigo-400 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    aria-label={uploadProgressLabel}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
            <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-slate-100">{t('importText.aiOutlineChat')}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {t('importText.aiOutlineDescription')}
                </p>
              </div>
              <div className="mb-3 h-[44vh] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                {chatMessages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                    {t('importText.chatExample')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((message, idx) => (
                      <div
                        key={`${message.role}-${idx}`}
                        className={`rounded-lg px-3 py-2 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'ml-8 bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/30'
                            : 'mr-8 bg-slate-800 text-slate-100 ring-1 ring-slate-700'
                        }`}
                      >
                        <div className="mb-1 text-xs font-medium text-slate-400">
                          {message.role === 'user' ? t('importText.chatRoleUser') : t('importText.chatRoleAi')}
                        </div>
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t('importText.chatInputPlaceholder')}
                className="h-28 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 outline-none focus:border-indigo-400"
                disabled={isChatting || isUploading}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={isChatting || isUploading}
                  className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChatting ? t('importText.aiThinking') : chatMessages.length === 0 ? t('importText.startPlanning') : t('importText.sendAndUpdateOutline')}
                </button>
                {chatMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setChatMessages([]);
                      setChatInput('');
                      setOutlineText('');
                      setText('');
                    }}
                    disabled={isChatting || isUploading}
                    className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('importText.restart')}
                  </button>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">{t('importText.currentOutline')}</h2>
                  <p className="mt-1 text-xs text-slate-400">{t('importText.currentOutlineDescription')}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCreateFromOutline}
                  disabled={isUploading || isChatting || !(outlineText || text).trim()}
                  className="shrink-0 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? formatTemplate(t('importText.creatingProgress'), { progress: String(progress) }) : t('importText.createFromOutline')}
                </button>
              </div>
              <textarea
                value={outlineText || text}
                onChange={(e) => {
                  setOutlineText(e.target.value);
                  setText(e.target.value);
                }}
                placeholder={t('importText.outlinePlaceholder')}
                className="h-[58vh] w-full rounded-lg border border-slate-700 bg-slate-950 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400"
              />
              {isUploading && (
                <div className="mt-3 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-emerald-100">
                    <span>{uploadProgressLabel}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-200"
                      style={{ width: `${progress}%` }}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      aria-label={uploadProgressLabel}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        <div className="sticky bottom-0 mt-3 flex items-center gap-3 border-t border-slate-800 bg-slate-950/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-slate-950/80">
          {mode === 'paste' && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isUploading}
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? formatTemplate(t('importText.uploadingProgress'), { progress: String(progress) }) : t('importText.submitTxt')}
            </button>
          )}
          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <p>{error}</p>
              {recoveryGuide.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-100/90">
                  {recoveryGuide.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
