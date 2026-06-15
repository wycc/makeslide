import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  getAuthStatus,
  getSlaSettings,
  getSystemAiSettings,
  logoutAuth,
  transferAdminAccount,
  updateSlaTargetOverride,
  updateSystemAiSettings,
  type AuthStatus,
  type SystemAiSettings,
} from '../lib/api';
import type { SlaSettingsResponse, SlaTargetKind, SlaTargetSetting } from '../types';
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
import { GEMINI_TTS_VOICES, OPENAI_TTS_VOICES, geminiVoiceLabel, openaiVoiceLabel } from '../lib/ttsVoices';

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
  const [geminiTtsSpeaker1Voice, setGeminiTtsSpeaker1Voice] = useState('');
  const [geminiTtsSpeaker2Voice, setGeminiTtsSpeaker2Voice] = useState('');
  const [openaiTtsSpeaker1, setOpenaiTtsSpeaker1] = useState('');
  const [openaiTtsSpeaker2, setOpenaiTtsSpeaker2] = useState('');
  const [openaiTtsSpeaker1Voice, setOpenaiTtsSpeaker1Voice] = useState('');
  const [openaiTtsSpeaker2Voice, setOpenaiTtsSpeaker2Voice] = useState('');
  const [accountId, setAccountId] = useState('default');
  const [userCode, setUserCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [settingsIsAdmin, setSettingsIsAdmin] = useState(false);
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleRedirectUri, setGoogleRedirectUri] = useState('');
  const [adminAccountIds, setAdminAccountIds] = useState<string[]>([]);
  const [adminTransferAccountId, setAdminTransferAccountId] = useState('');
  const [adminTransferBusy, setAdminTransferBusy] = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [cguAirEnabled, setCguAirEnabled] = useState(false);
  const [autoGenerateAnimation, setAutoGenerateAnimation] = useState(false);
  const [slaSettings, setSlaSettings] = useState<SlaSettingsResponse | null>(null);
  const [slaOverrideInputs, setSlaOverrideInputs] = useState<Record<string, string>>({});
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaBusyKey, setSlaBusyKey] = useState<string | null>(null);

  const CGU_AIR_BASE_URL = 'https://air.cgu.edu.tw/cgullmapi/v1';

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s: SystemAiSettings = await getSystemAiSettings();
      const auth = await getAuthStatus();
      setAuthStatus(auth);
      setSettingsIsAdmin(Boolean(s.is_admin));
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
      setGeminiTtsSpeaker1Voice(s.gemini_tts_speaker1_voice ?? '');
      setGeminiTtsSpeaker2Voice(s.gemini_tts_speaker2_voice ?? '');
      setOpenaiTtsSpeaker1(s.openai_tts_speaker1 ?? '');
      setOpenaiTtsSpeaker2(s.openai_tts_speaker2 ?? '');
      setOpenaiTtsSpeaker1Voice(s.openai_tts_speaker1_voice ?? '');
      setOpenaiTtsSpeaker2Voice(s.openai_tts_speaker2_voice ?? '');
      setAccountId(s.account_id ?? 'default');
      const loadedUiLanguage = s.ui_language ?? getStoredUiLanguage();
      const loadedContentLanguage = s.content_language ?? getStoredContentLanguage();
      setUiLanguage(loadedUiLanguage);
      setContentLanguage(loadedContentLanguage);
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, loadedUiLanguage);
      window.localStorage.setItem(CONTENT_LANGUAGE_STORAGE_KEY, loadedContentLanguage);
      setPlaybackSpeed(getStoredPlaybackSpeed());
      setGoogleAuthEnabled(Boolean(s.google_auth_enabled));
      setGoogleClientId(s.google_client_id ?? '');
      setGoogleClientSecret(s.google_client_secret ?? '');
      setGoogleRedirectUri(s.google_redirect_uri ?? '');
      setAdminAccountIds(s.admin_account_ids ?? []);
      setGithubRepoUrl(s.github_repo_url ?? '');
      setGithubToken(s.github_token ?? '');
      setCguAirEnabled(s.openai_base_url === CGU_AIR_BASE_URL);
      setAutoGenerateAnimation(Boolean(s.auto_generate_animation));
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

  const isAdmin = Boolean(authStatus?.is_admin || settingsIsAdmin);

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
        openai_base_url: cguAirEnabled ? CGU_AIR_BASE_URL : '',
        gemini_api_key: geminiApiKey.trim() || undefined,
        llm_provider: llmProvider,
        tts_provider: ttsProvider,
        openai_llm_model: openaiLlmModel.trim(),
        gemini_llm_model: geminiLlmModel.trim(),
        openai_tts_model: openaiTtsModel.trim(),
        gemini_tts_model: geminiTtsModel.trim(),
        gemini_tts_speaker1: geminiTtsSpeaker1.trim(),
        gemini_tts_speaker2: geminiTtsSpeaker2.trim(),
        gemini_tts_speaker1_voice: geminiTtsSpeaker1Voice.trim(),
        gemini_tts_speaker2_voice: geminiTtsSpeaker2Voice.trim(),
        openai_tts_speaker1: openaiTtsSpeaker1.trim(),
        openai_tts_speaker2: openaiTtsSpeaker2.trim(),
        openai_tts_speaker1_voice: openaiTtsSpeaker1Voice.trim(),
        openai_tts_speaker2_voice: openaiTtsSpeaker2Voice.trim(),
        user_code: authStatus?.authenticated ? userCode.trim() : undefined,
        ui_language: uiLanguage,
        content_language: contentLanguage,
        ...(isAdmin
          ? {
              google_auth_enabled: googleAuthEnabled,
              google_client_id: googleClientId.trim(),
              google_client_secret: googleClientSecret.trim(),
              google_redirect_uri: googleRedirectUri.trim(),
            }
          : {}),
        github_repo_url: githubRepoUrl.trim(),
        github_token: githubToken.trim(),
        auto_generate_animation: autoGenerateAnimation,
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
    geminiTtsSpeaker1Voice,
    geminiTtsSpeaker2Voice,
    openaiTtsSpeaker1,
    openaiTtsSpeaker2,
    openaiTtsSpeaker1Voice,
    openaiTtsSpeaker2Voice,
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
    googleAuthEnabled,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    isAdmin,
    githubRepoUrl,
    githubToken,
    cguAirEnabled,
    autoGenerateAnimation,
    CGU_AIR_BASE_URL,
    t,
  ]);

  const onTransferAdmin = useCallback(async () => {
    const target = adminTransferAccountId.trim();
    if (!target) return;
    setErr(null);
    setMsg(null);
    setAdminTransferBusy(true);
    try {
      const result = await transferAdminAccount(target);
      setAdminAccountIds(result.admin_account_ids);
      setAdminTransferAccountId('');
      setMsg(t('settings.adminTransferred'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.adminTransferError'));
    } finally {
      setAdminTransferBusy(false);
    }
  }, [adminTransferAccountId, t]);

  const applySlaSettingsResponse = useCallback((result: SlaSettingsResponse) => {
    setSlaSettings(result);
    const inputs: Record<string, string> = {};
    for (const item of [...result.stages, ...result.artifacts]) {
      inputs[`${item.kind}:${item.name}`] = item.override_ms != null ? String(item.override_ms / 1000) : '';
    }
    setSlaOverrideInputs(inputs);
  }, []);

  const loadSlaSettings = useCallback(async () => {
    setSlaLoading(true);
    try {
      applySlaSettingsResponse(await getSlaSettings());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.slaLoadError'));
    } finally {
      setSlaLoading(false);
    }
  }, [applySlaSettingsResponse, t]);

  useEffect(() => {
    if (isAdmin) {
      void loadSlaSettings();
    }
  }, [isAdmin, loadSlaSettings]);

  const onSlaOverrideSave = useCallback(async (kind: SlaTargetKind, name: string, targetMs: number | null) => {
    const key = `${kind}:${name}`;
    setErr(null);
    setMsg(null);
    setSlaBusyKey(key);
    try {
      applySlaSettingsResponse(await updateSlaTargetOverride(kind, name, targetMs));
      setMsg(t('settings.slaSaved'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.slaSaveError'));
    } finally {
      setSlaBusyKey(null);
    }
  }, [applySlaSettingsResponse, t]);

  const onSlaOverrideApply = useCallback((item: SlaTargetSetting) => {
    const key = `${item.kind}:${item.name}`;
    const raw = (slaOverrideInputs[key] ?? '').trim();
    if (raw === '') {
      void onSlaOverrideSave(item.kind, item.name, null);
      return;
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) {
      setErr(t('settings.slaInvalidValue'));
      return;
    }
    void onSlaOverrideSave(item.kind, item.name, Math.round(seconds * 1000));
  }, [onSlaOverrideSave, slaOverrideInputs, t]);

  const renderSlaRow = (item: SlaTargetSetting) => {
    const key = `${item.kind}:${item.name}`;
    const busy = slaBusyKey === key;
    return (
      <tr key={key}>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">{item.name}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-400">{item.default_ms / 1000}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-200">{item.effective_ms / 1000}</td>
        <td className="whitespace-nowrap px-3 py-2">
          <input
            type="number"
            min={slaSettings ? slaSettings.bounds.min_ms / 1000 : undefined}
            max={slaSettings ? slaSettings.bounds.max_ms / 1000 : undefined}
            step="any"
            value={slaOverrideInputs[key] ?? ''}
            onChange={(e) => setSlaOverrideInputs((prev) => ({ ...prev, [key]: e.target.value }))}
            placeholder={String(item.default_ms / 1000)}
            className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
          {item.updated_at ? new Date(item.updated_at).toLocaleString() : '-'}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSlaOverrideApply(item)}
              disabled={busy}
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {t('settings.slaApply')}
            </button>
            <button
              type="button"
              onClick={() => void onSlaOverrideSave(item.kind, item.name, null)}
              disabled={busy || item.override_ms == null}
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {t('settings.slaClear')}
            </button>
          </div>
        </td>
      </tr>
    );
  };

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
            <label className="block text-sm text-slate-300 sm:col-span-2">
              <span className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoGenerateAnimation}
                  onChange={(e) => setAutoGenerateAnimation(e.target.checked)}
                />
                {t('settings.autoGenerateAnimation')}
              </span>
              <span className="mt-1 block text-xs text-slate-500">{t('settings.autoGenerateAnimationHint')}</span>
            </label>
            {isAdmin ? (
              <>
                <label className="block text-sm text-slate-300 sm:col-span-2">
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={googleAuthEnabled}
                      onChange={(e) => setGoogleAuthEnabled(e.target.checked)}
                    />
                    {t('settings.googleAuthEnabled')}
                  </span>
                </label>
                {googleAuthEnabled ? (
                  <>
                    <label className="block text-sm text-slate-300 sm:col-span-2">
                      GOOGLE_CLIENT_ID
                      <input
                        value={googleClientId}
                        onChange={(e) => setGoogleClientId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                      />
                    </label>
                    <label className="block text-sm text-slate-300 sm:col-span-2">
                      GOOGLE_CLIENT_SECRET
                      <input
                        type="password"
                        value={googleClientSecret}
                        onChange={(e) => setGoogleClientSecret(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="GOCSPX-..."
                      />
                    </label>
                    <label className="block text-sm text-slate-300 sm:col-span-2">
                      GOOGLE_REDIRECT_URI
                      <input
                        value={googleRedirectUri}
                        onChange={(e) => setGoogleRedirectUri(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="https://your-domain.example/api/auth/google/callback"
                      />
                    </label>
                  </>
                ) : null}
                <div className="sm:col-span-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-200">{t('settings.adminTransfer')}</div>
                  <div className="mb-2 text-xs text-slate-500">
                    {t('settings.currentAdmins')}
                    <span className="font-mono text-slate-300">{adminAccountIds.join(', ') || accountId}</span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={adminTransferAccountId}
                      onChange={(e) => setAdminTransferAccountId(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder={t('settings.adminTransferPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => void onTransferAdmin()}
                      disabled={adminTransferBusy || !adminTransferAccountId.trim()}
                      className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {adminTransferBusy ? t('settings.saving') : t('settings.adminTransferButton')}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-1 text-base font-semibold text-slate-100">{t('settings.githubSync')}</h2>
            <p className="mb-3 text-sm text-slate-400">{t('settings.githubSyncHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-300 sm:col-span-2">
                GITHUB_REPO_URL
                <input
                  value={githubRepoUrl}
                  onChange={(e) => setGithubRepoUrl(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  placeholder="https://github.com/your-name/your-repo.git"
                />
              </label>
              <label className="block text-sm text-slate-300 sm:col-span-2">
                GITHUB_TOKEN
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </label>
            </div>
          </div>

          {isAdmin ? (
            <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="mb-1 text-base font-semibold text-slate-100">{t('settings.slaSettings')}</h2>
              <p className="mb-3 text-sm text-slate-400">{t('settings.slaSettingsHint')}</p>
              {slaLoading ? (
                <p className="text-sm text-slate-400">{t('settings.loading')}</p>
              ) : slaSettings ? (
                <>
                  <p className="mb-3 text-xs text-slate-500">
                    {t('settings.slaBoundsHint')}：{slaSettings.bounds.min_ms / 1000} - {slaSettings.bounds.max_ms / 1000} {t('settings.slaSecondsUnit')}
                  </p>
                  <h3 className="mb-1 text-sm font-semibold text-slate-200">{t('settings.slaStages')}</h3>
                  <div className="mb-4 overflow-x-auto rounded-md border border-slate-800">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                      <thead className="bg-slate-900/70 text-slate-400">
                        <tr>
                          <th className="px-3 py-2">{t('settings.slaColName')}</th>
                          <th className="px-3 py-2">{t('settings.slaColDefault')}</th>
                          <th className="px-3 py-2">{t('settings.slaColEffective')}</th>
                          <th className="px-3 py-2">{t('settings.slaColOverride')}</th>
                          <th className="px-3 py-2">{t('settings.slaColUpdatedAt')}</th>
                          <th className="px-3 py-2">{t('settings.slaColAction')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                        {slaSettings.stages.map(renderSlaRow)}
                      </tbody>
                    </table>
                  </div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-200">{t('settings.slaArtifacts')}</h3>
                  <div className="overflow-x-auto rounded-md border border-slate-800">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                      <thead className="bg-slate-900/70 text-slate-400">
                        <tr>
                          <th className="px-3 py-2">{t('settings.slaColName')}</th>
                          <th className="px-3 py-2">{t('settings.slaColDefault')}</th>
                          <th className="px-3 py-2">{t('settings.slaColEffective')}</th>
                          <th className="px-3 py-2">{t('settings.slaColOverride')}</th>
                          <th className="px-3 py-2">{t('settings.slaColUpdatedAt')}</th>
                          <th className="px-3 py-2">{t('settings.slaColAction')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                        {slaSettings.artifacts.map(renderSlaRow)}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <label className="mb-2 block text-sm text-slate-300">OPENAI_API_KEY</label>
          <input
            type="password"
            value={openaiApiKey}
            onChange={(e) => setOpenaiApiKey(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            placeholder="sk-..."
          />

          <label className="mt-2 block text-sm text-slate-300">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={cguAirEnabled}
                onChange={(e) => setCguAirEnabled(e.target.checked)}
              />
              {t('settings.cguAirEnabled')}
            </span>
          </label>

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
              {t('settings.geminiSpeaker1Voice')}
              <select
                value={geminiTtsSpeaker1Voice}
                onChange={(e) => setGeminiTtsSpeaker1Voice(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">{t('settings.geminiSpeakerVoiceInherit')}</option>
                {GEMINI_TTS_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {geminiVoiceLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.geminiSpeaker2')}
              <input value={geminiTtsSpeaker2} onChange={(e) => setGeminiTtsSpeaker2(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder={t('settings.geminiSpeaker2Placeholder')} />
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.geminiSpeaker2Voice')}
              <select
                value={geminiTtsSpeaker2Voice}
                onChange={(e) => setGeminiTtsSpeaker2Voice(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">{t('settings.geminiSpeakerVoiceInherit')}</option>
                {GEMINI_TTS_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {geminiVoiceLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.openaiSpeaker1')}
              <input value={openaiTtsSpeaker1} onChange={(e) => setOpenaiTtsSpeaker1(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder={t('settings.openaiSpeaker1Placeholder')} />
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.openaiSpeaker1Voice')}
              <select
                value={openaiTtsSpeaker1Voice}
                onChange={(e) => setOpenaiTtsSpeaker1Voice(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">{t('settings.openaiSpeakerVoiceInherit')}</option>
                {OPENAI_TTS_VOICES.map((v) => (
                  <option key={v} value={v}>{openaiVoiceLabel(v)}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.openaiSpeaker2')}
              <input value={openaiTtsSpeaker2} onChange={(e) => setOpenaiTtsSpeaker2(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder={t('settings.openaiSpeaker2Placeholder')} />
            </label>
            <label className="block text-sm text-slate-300">
              {t('settings.openaiSpeaker2Voice')}
              <select
                value={openaiTtsSpeaker2Voice}
                onChange={(e) => setOpenaiTtsSpeaker2Voice(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">{t('settings.openaiSpeakerVoiceInherit')}</option>
                {OPENAI_TTS_VOICES.map((v) => (
                  <option key={v} value={v}>{openaiVoiceLabel(v)}</option>
                ))}
              </select>
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
