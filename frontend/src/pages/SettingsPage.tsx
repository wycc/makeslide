import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  getAuthStatus,
  getSystemAiSettings,
  logoutAuth,
  updateSystemAiSettings,
  type AuthStatus,
  type SystemAiSettings,
} from '../lib/api';
import {
  CONTENT_LANGUAGE_STORAGE_KEY,
  PLAYBACK_SPEED_STORAGE_KEY,
  LANGUAGE_OPTIONS,
  UI_LANGUAGE_STORAGE_KEY,
  type AppLanguage,
  getStoredContentLanguage,
  getStoredPlaybackSpeed,
  getStoredUiLanguage,
  storeLanguageSettings,
  useI18n,
} from '../i18n';

export default function SettingsPage() { 
  const LOCAL_USER_CODE_KEY = 'makeslide.user_code';
  const navigate = useNavigate();
  const { t } = useI18n();
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [llmProvider, setLlmProvider] = useState<'openai' | 'gemini'>('openai');
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'gemini'>('openai');
  const [uiLanguage, setUiLanguage] = useState<AppLanguage>(() => getStoredUiLanguage());
  const [contentLanguage, setContentLanguage] = useState<AppLanguage>(() => getStoredContentLanguage());
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => getStoredPlaybackSpeed());
  const [openaiLlmModel, setOpenaiLlmModel] = useState('gpt-4o-mini');
  const [geminiLlmModel, setGeminiLlmModel] = useState('gemini-2.0-flash');
  const [openaiTtsModel, setOpenaiTtsModel] = useState('gpt-4o-mini-tts');
  const [geminiTtsModel, setGeminiTtsModel] = useState('gemini-2.5-flash-preview-tts');
  const [geminiTtsSpeaker1, setGeminiTtsSpeaker1] = useState('');
  const [geminiTtsSpeaker2, setGeminiTtsSpeaker2] = useState('');
  const [accountSettingsFile, setAccountSettingsFile] = useState('');
  const [accountId, setAccountId] = useState('default');
  const [userCode, setUserCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s: SystemAiSettings = await getSystemAiSettings();
      const auth = await getAuthStatus();
      setAuthStatus(auth);
      setOpenaiApiKey(s.openai_api_key ?? '');
      setGeminiApiKey(s.gemini_api_key ?? '');
      setLlmProvider(s.llm_provider);
      setTtsProvider(s.tts_provider);
      setOpenaiLlmModel(s.openai_llm_model);
      setGeminiLlmModel(s.gemini_llm_model);
      setOpenaiTtsModel(s.openai_tts_model);
      setGeminiTtsModel(s.gemini_tts_model);
      setGeminiTtsSpeaker1(s.gemini_tts_speaker1 ?? '');
      setGeminiTtsSpeaker2(s.gemini_tts_speaker2 ?? '');
      setAccountId(s.account_id ?? 'default');
      setAccountSettingsFile(s.account_settings_file ?? '');
      const loadedUiLanguage = s.ui_language ?? getStoredUiLanguage();
      const loadedContentLanguage = s.content_language ?? getStoredContentLanguage();
      setUiLanguage(loadedUiLanguage);
      setContentLanguage(loadedContentLanguage);
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, loadedUiLanguage);
      window.localStorage.setItem(CONTENT_LANGUAGE_STORAGE_KEY, loadedContentLanguage);
      setPlaybackSpeed(getStoredPlaybackSpeed());
      const cachedUserCode = window.localStorage.getItem(LOCAL_USER_CODE_KEY)?.trim() ?? '';
      setUserCode((auth?.authenticated ? s.user_code : cachedUserCode) ?? '');
      if (s.has_openai_key || s.has_gemini_key) {
        setMsg(t('settings.loaded'));
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const onLogout = useCallback(async () => {
    setErr(null);
    setMsg(null);
    try {
      await logoutAuth();
      const auth = await getAuthStatus();
      setAuthStatus(auth);
      setMsg(t('settings.logoutSuccess'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.logoutError'));
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const onSave = useCallback(async () => {
    setErr(null);
    setMsg(null);
    if (llmProvider === 'openai' && !openaiApiKey.trim()) {
      setErr(t('settings.openaiKeyRequiredForLlm'));
      return;
    }
    if (llmProvider === 'gemini' && !geminiApiKey.trim()) {
      setErr(t('settings.geminiKeyRequiredForLlm'));
      return;
    }
    if (ttsProvider === 'openai' && !openaiApiKey.trim()) {
      setErr(t('settings.openaiKeyRequiredForTts'));
      return;
    }
    if (ttsProvider === 'gemini' && !geminiApiKey.trim()) {
      setErr(t('settings.geminiKeyRequiredForTts'));
      return;
    }
    setSaving(true);
    try {
      await updateSystemAiSettings({
        openai_api_key: openaiApiKey.trim() || undefined,
        gemini_api_key: geminiApiKey.trim() || undefined,
        llm_provider: llmProvider,
        tts_provider: ttsProvider,
        openai_llm_model: openaiLlmModel.trim(),
        gemini_llm_model: geminiLlmModel.trim(),
        openai_tts_model: openaiTtsModel.trim(),
        gemini_tts_model: geminiTtsModel.trim(),
        gemini_tts_speaker1: geminiTtsSpeaker1.trim(),
        gemini_tts_speaker2: geminiTtsSpeaker2.trim(),
        user_code: authStatus?.authenticated ? userCode.trim() : undefined,
        ui_language: uiLanguage,
        content_language: contentLanguage,
      });
      storeLanguageSettings(uiLanguage, contentLanguage);
      window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(playbackSpeed));
      if (authStatus?.authenticated) {
        window.localStorage.removeItem(LOCAL_USER_CODE_KEY);
      } else {
        window.localStorage.setItem(LOCAL_USER_CODE_KEY, userCode.trim());
      }
      setMsg(t('settings.saved'));
      setOpenaiApiKey('');
      setGeminiApiKey('');
      window.setTimeout(() => navigate('/'), 300);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.saveError'));
    } finally {
      setSaving(false);
    }
  }, [
    geminiApiKey,
    geminiLlmModel,
    geminiTtsModel,
    geminiTtsSpeaker1,
    geminiTtsSpeaker2,
    contentLanguage,
    playbackSpeed,
    llmProvider,
    navigate,
    openaiApiKey,
    openaiLlmModel,
    openaiTtsModel,
    ttsProvider,
    userCode,
    authStatus,
    uiLanguage,
    t,
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
          <div className="flex items-center gap-3 text-sm">
            <Link className="text-slate-300 hover:text-white" to="/system">
              {t('settings.systemDashboard')}
            </Link>
            <Link className="text-slate-300 hover:text-white" to="/">
              {t('settings.backHome')}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {loading ? <p className="text-sm text-slate-400">{t('settings.loading')}</p> : null}
        {err ? (
          <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        ) : null}
        {msg ? (
          <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {msg}
          </div>
        ) : null}
        {authStatus?.google_enabled || authStatus?.authenticated ? (
          <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-100">{t('settings.googleAccount')}</h2>
                {authStatus?.authenticated && authStatus.user ? (
                  <p className="mt-1 text-sm text-slate-300">
                    已登入：{authStatus.user.name ? `${authStatus.user.name}（${authStatus.user.email}）` : authStatus.user.email}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">{t('settings.googleLoginHint')}</p>
                )}
              </div>
              {authStatus?.authenticated ? (
                <button
                  type="button"
                  onClick={() => void onLogout()}
                  className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  {t('settings.logout')}
                </button>
              ) : (
                <a
                  href="api/auth/google/start"
                  className="rounded-md bg-slate-100 px-4 py-2 text-center text-sm font-medium text-slate-900 hover:bg-white"
                >
                  {t('settings.googleLogin')}
                </a>
              )}
            </div>
          </div>
        ) : null}
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
            <div>{t('settings.currentAccount')}<span className="font-mono text-slate-200">{accountId}</span></div>
            {accountSettingsFile ? (
              <div className="mt-1 break-all">{t('settings.accountFilePrefix')}<span className="font-mono text-slate-200">{accountSettingsFile}</span></div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300 sm:col-span-2">
              {t('settings.userCode')}
              <input
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                placeholder={t('settings.userCodePlaceholder')}
                maxLength={128}
              />
              <span className="mt-1 block text-xs text-slate-500">
                {authStatus?.authenticated
                  ? t('settings.userCodeAccount')
                  : t('settings.userCodeLocal')}
              </span>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.uiLanguage')}
              <select
                value={uiLanguage}
                onChange={(e) => setUiLanguage(e.target.value as AppLanguage)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.nativeLabel}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.contentLanguage')}
              <select
                value={contentLanguage}
                onChange={(e) => setContentLanguage(e.target.value as AppLanguage)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.nativeLabel}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">{t('settings.contentLanguageHint')}</span>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.playbackSpeed')}
              <select
                value={String(playbackSpeed)}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                  <option key={speed} value={String(speed)}>{speed}x</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.llmProvider')}
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value as 'openai' | 'gemini')}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.ttsProvider')}
              <select
                value={ttsProvider}
                onChange={(e) => setTtsProvider(e.target.value as 'openai' | 'gemini')}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
          </div>

          <label className="mb-2 block text-sm text-slate-300">OPENAI_API_KEY</label>
          <input
            type="password"
            value={openaiApiKey}
            onChange={(e) => setOpenaiApiKey(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            placeholder="sk-..."
          />

          <label className="mb-2 block text-sm text-slate-300">GEMINI_API_KEY</label>
          <input
            type="password"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            placeholder="AIza..."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              OpenAI LLM Model
              <input value={openaiLlmModel} onChange={(e) => setOpenaiLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              Gemini LLM Model
              <input value={geminiLlmModel} onChange={(e) => setGeminiLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              OpenAI TTS Model
              <input value={openaiTtsModel} onChange={(e) => setOpenaiTtsModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              Gemini TTS Model
              <input value={geminiTtsModel} onChange={(e) => setGeminiTtsModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.geminiSpeaker1')}
              <input value={geminiTtsSpeaker1} onChange={(e) => setGeminiTtsSpeaker1(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder={t('settings.geminiSpeaker1Placeholder')} />
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.geminiSpeaker2')}
              <input value={geminiTtsSpeaker2} onChange={(e) => setGeminiTtsSpeaker2(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder={t('settings.geminiSpeaker2Placeholder')} />
            </label>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
            >
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
