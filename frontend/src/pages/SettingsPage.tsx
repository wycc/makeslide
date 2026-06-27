import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  getAuthStatus,
  getSlaSettings,
  getSystemAiSettings,
  generateMcpAuthToken,
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  deleteAccount,
  deleteMyAccount,
  toggleBuiltInSkill,
  logoutAuth,
  transferAdminAccount,
  updateSlaTargetOverride,
  updateSystemAiSettings,
  type AuthStatus,
  type LlmProvider,
  type SubtitleSyncMode,
  type SystemAiSettings,
  type TtsProvider,
  type Skill,
  getEmbeddingStats,
  type EmbeddingStats,
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
import {
  type ThemePreference,
  getStoredThemePreference,
  setStoredThemePreference,
  applyThemePreference,
} from '../lib/theme';
import { GEMINI_TTS_VOICES, OPENAI_TTS_VOICES, geminiVoiceLabel, openaiVoiceLabel } from '../lib/ttsVoices';
import { formatSlaOverrideRangeMessage, validateSlaOverrideSecondsInput } from '../lib/slaOverrideValidation';
import { progressPercent } from '../lib/progressPercent';
import { copyTextToClipboard } from '../lib/clipboard';
import { bytesToRoundedKb } from '../lib/bytesFreed';
import { LLM_PRICE_PER_1M_TOKENS, TTS_PRICE_PER_1K_CHARS, formatUsd } from '../lib/costEstimate';
import { createTemplate } from '../lib/api/templates';

type SettingsCategory = 'account' | 'ai' | 'sync' | 'skills' | 'admin';

export default function SettingsPage() { 
  const LOCAL_USER_CODE_KEY = 'makeslide.user_code';
  const navigate = useNavigate();
  const { t } = useI18n();
  const voiceGenderLabels = { male: t('tts.voiceGenderMale'), female: t('tts.voiceGenderFemale') };
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('account');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [cguAirApiKey, setCguAirApiKey] = useState('');
  const [cguAirBaseUrl, setCguAirBaseUrl] = useState('https://air.cgu.edu.tw/cgullmapi/v1');
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [openrouterBaseUrl, setOpenrouterBaseUrl] = useState('https://openrouter.ai/api/v1');
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('openai');
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>('openai');
  const [uiLanguage, setUiLanguage] = useState<AppLanguage>(() => getStoredUiLanguage());
  const [contentLanguage, setContentLanguage] = useState<AppLanguage>(() => getStoredContentLanguage());
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => getStoredPlaybackSpeed());
  // Theme 偏好為純本機設定（尚未納入後端 SystemAiSettings），切換後立即套用、不經 Save。
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getStoredThemePreference());
  const handleThemeChange = (next: ThemePreference) => {
    setThemePreference(next);
    setStoredThemePreference(next);
    applyThemePreference(next);
  };
  const [openaiLlmModel, setOpenaiLlmModel] = useState('gpt-4o-mini');
  const [geminiLlmModel, setGeminiLlmModel] = useState('gemini-2.0-flash');
  const [cguAirLlmModel, setCguAirLlmModel] = useState('gpt-4o-mini');
  const [cguAirImageModel, setCguAirImageModel] = useState('');
  const [openrouterLlmModel, setOpenrouterLlmModel] = useState('openai/gpt-4o-mini');
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
  const [adminDeleteAccountId, setAdminDeleteAccountId] = useState('');
  const [adminDeleteConfirm, setAdminDeleteConfirm] = useState('');
  const [adminDeleteBusy, setAdminDeleteBusy] = useState(false);
  const [thumbnailCacheBusy, setThumbnailCacheBusy] = useState(false);
  const [thumbnailCacheMsg, setThumbnailCacheMsg] = useState<string | null>(null);
  const [artifactCacheBusy, setArtifactCacheBusy] = useState(false);
  const [artifactCacheMsg, setArtifactCacheMsg] = useState<string | null>(null);
  const [selfDeleteConfirm, setSelfDeleteConfirm] = useState('');
  const [selfDeleteBusy, setSelfDeleteBusy] = useState(false);
  const [hasMcpAuthToken, setHasMcpAuthToken] = useState(false);
  const [generatedMcpAuthToken, setGeneratedMcpAuthToken] = useState('');
  const [mcpTokenBusy, setMcpTokenBusy] = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [autoGenerateAnimation, setAutoGenerateAnimation] = useState(false);
  const [subtitleSyncMode, setSubtitleSyncMode] = useState<SubtitleSyncMode>('estimate');
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState<string>('');
  const [semanticSearchMaxPdfs, setSemanticSearchMaxPdfs] = useState<string>('');
  const [slaSettings, setSlaSettings] = useState<SlaSettingsResponse | null>(null);
  const [slaOverrideInputs, setSlaOverrideInputs] = useState<Record<string, string>>({});
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaBusyKey, setSlaBusyKey] = useState<string | null>(null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [embeddingStats, setEmbeddingStats] = useState<EmbeddingStats | null>(null);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillPrompt, setNewSkillPrompt] = useState('');
  const [newSkillApplyTo, setNewSkillApplyTo] = useState<'script' | 'all'>('script');
  const [addingSkill, setAddingSkill] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editApplyTo, setEditApplyTo] = useState<'script' | 'all'>('script');
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [publishingSkillId, setPublishingSkillId] = useState<string | null>(null);
  const [publishedSkillId, setPublishedSkillId] = useState<string | null>(null);

  const DEFAULT_CGU_AIR_BASE_URL = 'https://air.cgu.edu.tw/cgullmapi/v1';
  const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s: SystemAiSettings = await getSystemAiSettings();
      const auth = await getAuthStatus();
      setAuthStatus(auth);
      setSettingsIsAdmin(Boolean(s.is_admin));
      setOpenaiApiKey(s.openai_api_key ?? '');
      setGeminiApiKey(s.gemini_api_key ?? '');
      setCguAirApiKey(s.cgu_air_api_key ?? '');
      setCguAirBaseUrl(s.cgu_air_base_url ?? DEFAULT_CGU_AIR_BASE_URL);
      setOpenrouterApiKey(s.openrouter_api_key ?? '');
      setOpenrouterBaseUrl(s.openrouter_base_url ?? DEFAULT_OPENROUTER_BASE_URL);
      setLlmProvider(s.llm_provider);
      setTtsProvider(s.tts_provider);
      setOpenaiLlmModel(s.openai_llm_model);
      setGeminiLlmModel(s.gemini_llm_model);
      setCguAirLlmModel(s.cgu_air_llm_model ?? 'gpt-4o-mini');
      setCguAirImageModel(s.cgu_air_image_model ?? '');
      setOpenrouterLlmModel(s.openrouter_llm_model ?? 'openai/gpt-4o-mini');
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
      setHasMcpAuthToken(Boolean(s.has_mcp_auth_token));
      setGeneratedMcpAuthToken('');
      setGithubRepoUrl(s.github_repo_url ?? '');
      setGithubToken(s.github_token ?? '');
      setAutoGenerateAnimation(Boolean(s.auto_generate_animation));
      setSubtitleSyncMode(s.subtitle_sync_mode ?? 'estimate');
      setMonthlyBudgetUsd(typeof s.monthly_budget_usd === 'number' ? String(s.monthly_budget_usd) : '');
      setSemanticSearchMaxPdfs(typeof s.semantic_search_max_pdfs === 'number' ? String(s.semantic_search_max_pdfs) : '');
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
    setSkillsLoading(true);
    listSkills().then(setSkills).catch(() => {}).finally(() => setSkillsLoading(false));
    getEmbeddingStats().then(setEmbeddingStats).catch(() => setEmbeddingStats(null));
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
    if (llmProvider === 'cgu-air' && !cguAirApiKey.trim()) {
      setErr(t('settings.cguAirKeyRequiredForLlm'));
      return;
    }
    if (llmProvider === 'openrouter' && !openrouterApiKey.trim()) {
      setErr(t('settings.openrouterKeyRequiredForLlm'));
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
        openai_base_url: '',
        gemini_api_key: geminiApiKey.trim() || undefined,
        cgu_air_api_key: cguAirApiKey.trim() || undefined,
        cgu_air_base_url: cguAirBaseUrl.trim() || DEFAULT_CGU_AIR_BASE_URL,
        openrouter_api_key: openrouterApiKey.trim() || undefined,
        openrouter_base_url: openrouterBaseUrl.trim() || DEFAULT_OPENROUTER_BASE_URL,
        llm_provider: llmProvider,
        tts_provider: ttsProvider,
        openai_llm_model: openaiLlmModel.trim(),
        gemini_llm_model: geminiLlmModel.trim(),
        cgu_air_llm_model: cguAirLlmModel.trim(),
        cgu_air_image_model: cguAirImageModel.trim(),
        openrouter_llm_model: openrouterLlmModel.trim(),
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
        subtitle_sync_mode: subtitleSyncMode,
        monthly_budget_usd: monthlyBudgetUsd.trim() === '' ? null : Number(monthlyBudgetUsd.trim()),
        // 空白＝不更動（schema 不接受 null）；有值才送整數
        ...(semanticSearchMaxPdfs.trim() === ''
          ? {}
          : { semantic_search_max_pdfs: Math.round(Number(semanticSearchMaxPdfs.trim())) }),
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
      setCguAirApiKey('');
      setOpenrouterApiKey('');
      window.setTimeout(() => navigate('/'), 300);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.saveError'));
    } finally {
      setSaving(false);
    }
  }, [
    geminiApiKey,
    geminiLlmModel,
    cguAirApiKey,
    cguAirBaseUrl,
    cguAirLlmModel,
    cguAirImageModel,
    openrouterApiKey,
    openrouterBaseUrl,
    openrouterLlmModel,
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
    autoGenerateAnimation,
    subtitleSyncMode,
    monthlyBudgetUsd,
    semanticSearchMaxPdfs,
    DEFAULT_CGU_AIR_BASE_URL,
    DEFAULT_OPENROUTER_BASE_URL,
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

  const onClearThumbnailCache = useCallback(async () => {
    setThumbnailCacheBusy(true);
    setThumbnailCacheMsg(null);
    try {
      const resp = await fetch('api/system/thumbnail-cache', { method: 'DELETE' });
      if (!resp.ok) { setThumbnailCacheMsg(t('settings.clearThumbnailCacheButton')); return; }
      const data = (await resp.json()) as { files_deleted: number; bytes_freed: number };
      const kb = bytesToRoundedKb(data.bytes_freed);
      setThumbnailCacheMsg(t('settings.clearThumbnailCacheDone').replace('{files}', String(data.files_deleted)).replace('{kb}', String(kb)));
    } catch {
      setThumbnailCacheMsg(null);
    } finally {
      setThumbnailCacheBusy(false);
    }
  }, [t]);

  const onClearArtifactCache = useCallback(async () => {
    setArtifactCacheBusy(true);
    setArtifactCacheMsg(null);
    try {
      const resp = await fetch('api/admin/cache', { method: 'DELETE' });
      if (!resp.ok) { setArtifactCacheMsg(t('settings.clearArtifactCacheButton')); return; }
      const data = (await resp.json()) as { dirs_cleared: number; bytes_freed: number };
      const kb = bytesToRoundedKb(data.bytes_freed);
      setArtifactCacheMsg(t('settings.clearArtifactCacheDone').replace('{dirs}', String(data.dirs_cleared)).replace('{kb}', String(kb)));
    } catch {
      setArtifactCacheMsg(null);
    } finally {
      setArtifactCacheBusy(false);
    }
  }, [t]);

  const onDeleteAccount = useCallback(async () => {
    const target = adminDeleteAccountId.trim();
    if (!target) return;
    if (adminDeleteConfirm.trim() !== target) {
      setErr(t('settings.accountDeleteConfirmMismatch'));
      return;
    }
    setErr(null);
    setMsg(null);
    setAdminDeleteBusy(true);
    try {
      const result = await deleteAccount(target);
      setAdminDeleteAccountId('');
      setAdminDeleteConfirm('');
      setMsg(t('settings.accountDeleted').replace('{account}', result.account_id).replace('{count}', String(result.deleted_pdf_count)));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.accountDeleteError'));
    } finally {
      setAdminDeleteBusy(false);
    }
  }, [adminDeleteAccountId, adminDeleteConfirm, t]);

  const onDeleteMyAccount = useCallback(async () => {
    if (selfDeleteConfirm.trim() !== accountId) {
      setErr(t('settings.selfDeleteConfirmMismatch'));
      return;
    }
    setErr(null);
    setMsg(null);
    setSelfDeleteBusy(true);
    try {
      const result = await deleteMyAccount();
      setSelfDeleteConfirm('');
      setMsg(t('settings.selfDeleted').replace('{count}', String(result.deleted_pdf_count)));
      await loadStatus();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.selfDeleteError'));
    } finally {
      setSelfDeleteBusy(false);
    }
  }, [selfDeleteConfirm, accountId, t, loadStatus]);

  const onGenerateMcpAuthToken = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setMcpTokenBusy(true);
    try {
      const result = await generateMcpAuthToken();
      setHasMcpAuthToken(result.has_mcp_auth_token);
      setGeneratedMcpAuthToken(result.token);
      setMsg(t('settings.mcpTokenGenerated'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('settings.mcpTokenGenerateError'));
    } finally {
      setMcpTokenBusy(false);
    }
  }, [t]);

  const onCopyGeneratedMcpToken = useCallback(async () => {
    if (!generatedMcpAuthToken) return;
    const result = await copyTextToClipboard(generatedMcpAuthToken);
    if (result.ok) {
      setMsg(t('settings.mcpTokenCopied'));
    } else {
      setErr(t('settings.mcpTokenCopyError'));
    }
  }, [generatedMcpAuthToken, t]);

  const getMcpConfigJson = useCallback(() => {
    const backendUrl = window.location.origin;
    const pathPlaceholder = t('settings.mcpConfigPathPlaceholder');
    const config = {
      makeslide: {
        command: 'npx',
        args: ['--prefix', pathPlaceholder, 'tsx', 'src/mcp-server.ts'],
        env: {
          MAKESLIDE_URL: backendUrl,
          MAKESLIDE_MCP_TOKEN: generatedMcpAuthToken,
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }, [generatedMcpAuthToken, t]);

  const onCopyMcpConfigTemplate = useCallback(async () => {
    const result = await copyTextToClipboard(getMcpConfigJson());
    if (result.ok) {
      setMsg(t('settings.mcpConfigCopied'));
    } else {
      setErr(t('settings.mcpConfigCopyError'));
    }
  }, [getMcpConfigJson, t]);

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
    const validation = validateSlaOverrideSecondsInput(slaOverrideInputs[key] ?? '', slaSettings?.bounds);
    if (!validation.ok) {
      setErr(
        validation.reason === 'out-of-range'
          ? formatSlaOverrideRangeMessage(t('settings.slaOutOfRange'), validation.minSeconds ?? 0, validation.maxSeconds ?? 0)
          : t('settings.slaInvalidValue'),
      );
      return;
    }
    void onSlaOverrideSave(item.kind, item.name, validation.targetMs);
  }, [onSlaOverrideSave, slaOverrideInputs, slaSettings, t]);

  const renderSlaRow = (item: SlaTargetSetting) => {
    const key = `${item.kind}:${item.name}`;
    const busy = slaBusyKey === key;
    return (
      <tr key={key}>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-text">{item.name}</td>
        <td className="whitespace-nowrap px-3 py-2 text-muted">{item.default_ms / 1000}</td>
        <td className="whitespace-nowrap px-3 py-2 text-text">{item.effective_ms / 1000}</td>
        <td className="whitespace-nowrap px-3 py-2">
          <input
            type="number"
            min={slaSettings ? slaSettings.bounds.min_ms / 1000 : undefined}
            max={slaSettings ? slaSettings.bounds.max_ms / 1000 : undefined}
            step="any"
            value={slaOverrideInputs[key] ?? ''}
            onChange={(e) => setSlaOverrideInputs((prev) => ({ ...prev, [key]: e.target.value }))}
            placeholder={String(item.default_ms / 1000)}
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"
          />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
          {item.updated_at ? new Date(item.updated_at).toLocaleString() : '-'}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => onSlaOverrideApply(item)} disabled={busy} className="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-border disabled:opacity-50">
              {t('settings.slaApply')}
            </button>
            <button type="button" onClick={() => void onSlaOverrideSave(item.kind, item.name, null)} disabled={busy || item.override_ms == null} className="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-border disabled:opacity-50">
              {t('settings.slaClear')}
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const settingsCategories: Array<{ id: SettingsCategory; label: string; description: string; adminOnly?: boolean }> = [
    { id: 'account', label: t('settings.nav.account'), description: t('settings.nav.accountDesc') },
    { id: 'ai', label: t('settings.nav.ai'), description: t('settings.nav.aiDesc') },
    { id: 'sync', label: t('settings.nav.sync'), description: t('settings.nav.syncDesc') },
    { id: 'skills', label: t('settings.nav.skills'), description: t('settings.nav.skillsDesc') },
    { id: 'admin', label: t('settings.nav.admin'), description: t('settings.nav.adminDesc'), adminOnly: true },
  ];

  const visibleSettingsCategories = settingsCategories.filter((category) => !category.adminOnly || isAdmin);
  const activeCategoryInfo = (visibleSettingsCategories.find((category) => category.id === activeCategory) ?? settingsCategories[0])!;

  useEffect(() => {
    if (!isAdmin && activeCategory === 'admin') {
      setActiveCategory('account');
    }
  }, [activeCategory, isAdmin]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
          <div className="flex items-center gap-3 text-sm">
            <Link className="text-text hover:text-text" to="/system">
              {t('settings.systemDashboard')}
            </Link>
            <Link className="text-text hover:text-text" to="/">
              {t('settings.backHome')}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {loading ? <p className="mb-3 text-sm text-muted">{t('settings.loading')}</p> : null}
        {err ? (
          <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-danger">
            {err}
          </div>
        ) : null}
        {msg ? (
          <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-200">
            {msg}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border bg-surface/40 p-3 lg:sticky lg:top-4 lg:self-start">
            <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('settings.navTitle')}
            </div>
            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label={t('settings.navTitle')}>
              {visibleSettingsCategories.map((category) => {
                const active = category.id === activeCategoryInfo.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                    className={`min-w-44 rounded-lg px-3 py-2 text-left transition lg:min-w-0 ${active ? 'border border-indigo-400/60 bg-indigo-500/15 text-text' : 'border border-transparent text-text hover:border-border hover:bg-border/60 hover:text-text'}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="block text-sm font-medium">{category.label}</span>
                    <span className="mt-1 block text-xs text-muted">{category.description}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="rounded-xl border border-border bg-surface/40 p-4">
              <h2 className="text-base font-semibold text-text">{activeCategoryInfo.label}</h2>
              <p className="mt-1 text-sm text-muted">{activeCategoryInfo.description}</p>
            </div>

            {activeCategoryInfo.id === 'account' ? (
              <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
                {authStatus?.google_enabled || authStatus?.authenticated ? (
                  <div className="rounded-lg border border-border bg-bg/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-text">{t('settings.googleAccount')}</h3>
                        {authStatus?.authenticated && authStatus.user ? (
                          <p className="mt-1 text-sm text-text">
                            {t('settings.signedInAs')}{authStatus.user.name ? `${authStatus.user.name}（${authStatus.user.email}）` : authStatus.user.email}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-muted">{t('settings.googleLoginHint')}</p>
                        )}
                      </div>
                      {authStatus?.authenticated ? (
                        <button type="button" onClick={() => void onLogout()} className="rounded-md border border-border px-4 py-2 text-sm text-text hover:bg-border">
                          {t('settings.logout')}
                        </button>
                      ) : (
                        <a href="api/auth/google/start" className="rounded-md bg-text px-4 py-2 text-center text-sm font-medium text-bg hover:bg-slate-200 dark:hover:bg-white">
                          {t('settings.googleLogin')}
                        </a>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border bg-bg/60 px-3 py-2 text-xs text-muted">
                  <div>{t('settings.currentAccount')}<span className="font-mono text-text">{accountId}</span></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-text sm:col-span-2">
                    {t('settings.userCode')}
                    <input value={userCode} onChange={(e) => setUserCode(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.userCodePlaceholder')} maxLength={128} />
                    <span className="mt-1 block text-xs text-muted">{authStatus?.authenticated ? t('settings.userCodeAccount') : t('settings.userCodeLocal')}</span>
                  </label>
                  <label className="block text-sm text-text">
                    {t('settings.uiLanguage')}
                    <select value={uiLanguage} onChange={(e) => setUiLanguage(e.target.value as AppLanguage)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.nativeLabel}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-text">
                    {t('settings.contentLanguage')}
                    <select value={contentLanguage} onChange={(e) => setContentLanguage(e.target.value as AppLanguage)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.nativeLabel}</option>)}
                    </select>
                    <span className="mt-1 block text-xs text-muted">{t('settings.contentLanguageHint')}</span>
                  </label>
                  <label className="block text-sm text-text">
                    {t('settings.playbackSpeed')}
                    <select value={String(playbackSpeed)} onChange={(e) => setPlaybackSpeed(Number(e.target.value))} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => <option key={speed} value={String(speed)}>{speed}x</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-text">
                    {t('settings.theme')}
                    <select value={themePreference} onChange={(e) => handleThemeChange(e.target.value as ThemePreference)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      <option value="system">{t('settings.themeSystem')}</option>
                      <option value="light">{t('settings.themeLight')}</option>
                      <option value="dark">{t('settings.themeDark')}</option>
                    </select>
                    <span className="mt-1 block text-xs text-muted">{t('settings.themeHint')}</span>
                  </label>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => void onSave()} disabled={saving} className="rounded-md bg-text px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">
                    {saving ? t('settings.saving') : t('settings.save')}
                  </button>
                </div>
                <div className="rounded-lg border border-border bg-bg/60 p-3">
                  <div className="mb-1 text-sm font-medium text-text">{t('settings.mcpTokenTitle')}</div>
                  <p className="mb-3 text-xs text-muted">{t('settings.mcpTokenHint')}</p>
                  <div className="mb-3 text-xs text-muted">{hasMcpAuthToken ? t('settings.mcpTokenConfigured') : t('settings.mcpTokenNotConfigured')}</div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => void onGenerateMcpAuthToken()} disabled={mcpTokenBusy} className="rounded-md border border-border px-4 py-2 text-sm text-text hover:bg-border disabled:opacity-50">
                      {mcpTokenBusy ? t('settings.saving') : t('settings.mcpTokenGenerateButton')}
                    </button>
                    {generatedMcpAuthToken ? <button type="button" onClick={() => void onCopyGeneratedMcpToken()} className="rounded-md bg-text px-4 py-2 text-sm font-medium text-bg hover:bg-slate-200 dark:hover:bg-white">{t('settings.mcpTokenCopyButton')}</button> : null}
                  </div>
                  {generatedMcpAuthToken ? (
                    <>
                      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                        <div className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-100">{t('settings.mcpTokenOneTimeNotice')}</div>
                        <code className="block break-all rounded bg-bg px-2 py-1 font-mono text-xs text-text">{generatedMcpAuthToken}</code>
                      </div>
                      <div className="mt-3 rounded-md border border-indigo-500/30 bg-indigo-500/10 p-3">
                        <div className="mb-1 text-xs font-medium text-indigo-800 dark:text-indigo-100">{t('settings.mcpConfigTemplateTitle')}</div>
                        <p className="mb-2 text-xs text-muted">{t('settings.mcpConfigTemplateHint')}</p>
                        <pre className="mb-2 overflow-x-auto rounded bg-bg px-2 py-2 font-mono text-xs text-text">{getMcpConfigJson()}</pre>
                        <button type="button" onClick={() => void onCopyMcpConfigTemplate()} className="rounded-md border border-indigo-500/50 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/20">
                          {t('settings.mcpConfigCopyButton')}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
                {authStatus?.authenticated ? (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
                    <div className="mb-1 text-sm font-medium text-danger">{t('settings.selfDeleteTitle')}</div>
                    <p className="mb-3 text-xs text-danger/80">{t('settings.selfDeleteHint')}</p>
                    {isAdmin ? (
                      <p className="text-xs text-amber-800 dark:text-amber-200">{t('settings.selfDeleteAdminBlocked')}</p>
                    ) : (
                      <>
                        <label className="block text-xs text-text">
                          {t('settings.selfDeleteConfirmLabel')}
                          <input
                            value={selfDeleteConfirm}
                            onChange={(e) => setSelfDeleteConfirm(e.target.value)}
                            className="mt-1 w-full rounded-md border border-rose-500/40 bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"
                            placeholder={accountId}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void onDeleteMyAccount()}
                          disabled={selfDeleteBusy || selfDeleteConfirm.trim() !== accountId}
                          className="mt-3 rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                        >
                          {selfDeleteBusy ? t('settings.accountDeleting') : t('settings.selfDeleteButton')}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeCategoryInfo.id === 'ai' ? (
              <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-text">
                    {t('settings.llmProvider')}
                    <select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value as LlmProvider)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Gemini</option>
                      <option value="cgu-air">CGU Air</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </label>
                  <label className="block text-sm text-text">
                    {t('settings.ttsProvider')}
                    <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value as TtsProvider)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </label>
                  <label className="block text-sm text-text sm:col-span-2">
                    <span className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={autoGenerateAnimation} onChange={(e) => setAutoGenerateAnimation(e.target.checked)} />
                      {t('settings.autoGenerateAnimation')}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{t('settings.autoGenerateAnimationHint')}</span>
                  </label>
                  <label className="block text-sm text-text sm:col-span-2">
                    {t('settings.subtitleSyncMode')}
                    <select value={subtitleSyncMode} onChange={(e) => setSubtitleSyncMode(e.target.value as SubtitleSyncMode)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted">
                      <option value="estimate">{t('settings.subtitleSyncModeEstimate')}</option>
                      <option value="whisper">{t('settings.subtitleSyncModeWhisper')}</option>
                    </select>
                    <span className="mt-1 block text-xs text-muted">
                      {subtitleSyncMode === 'whisper' ? t('settings.subtitleSyncModeWhisperHint') : t('settings.subtitleSyncModeEstimateHint')}
                    </span>
                  </label>
                  <label className="block text-sm text-text sm:col-span-2">
                    {t('settings.monthlyBudgetUsd')}
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={monthlyBudgetUsd}
                      onChange={(e) => setMonthlyBudgetUsd(e.target.value)}
                      placeholder={t('settings.monthlyBudgetUsdPlaceholder')}
                      className="mt-1 w-48 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"
                    />
                    <span className="mt-1 block text-xs text-muted">{t('settings.monthlyBudgetUsdHint')}</span>
                  </label>
                  <label className="block text-sm text-text sm:col-span-2">
                    {t('settings.semanticSearchMaxPdfs')}
                    <input
                      type="number"
                      min={1}
                      max={200}
                      step="1"
                      value={semanticSearchMaxPdfs}
                      onChange={(e) => setSemanticSearchMaxPdfs(e.target.value)}
                      placeholder={t('settings.semanticSearchMaxPdfsPlaceholder')}
                      className="mt-1 w-48 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"
                    />
                    <span className="mt-1 block text-xs text-muted">{t('settings.semanticSearchMaxPdfsHint')}</span>
                  </label>
                  <div className="block text-sm text-text sm:col-span-2">
                    <span>{t('settings.priceReferenceTitle')}</span>
                    <span className="mt-1 block text-xs text-muted">{t('settings.priceReferenceHint')}</span>
                    <div className="mt-2 grid grid-cols-1 gap-3 rounded-md border border-border bg-bg/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <p className="mb-1 font-medium text-muted">{t('settings.priceReferenceLlm')}</p>
                        <ul className="space-y-0.5">
                          {Object.entries(LLM_PRICE_PER_1M_TOKENS).map(([model, price]) => (
                            <li key={model} className="flex items-baseline justify-between gap-2">
                              <span className="truncate font-mono text-muted">{model}</span>
                              <span className="shrink-0 tabular-nums text-muted">
                                {t('settings.priceReferenceInOut').replace('{in}', formatUsd(price.input)).replace('{out}', formatUsd(price.output))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1 font-medium text-muted">{t('settings.priceReferenceTts')}</p>
                        <ul className="space-y-0.5">
                          {Object.entries(TTS_PRICE_PER_1K_CHARS).map(([provider, price]) => (
                            <li key={provider} className="flex items-baseline justify-between gap-2">
                              <span className="truncate font-mono text-muted">{provider}</span>
                              <span className="shrink-0 tabular-nums text-muted">{formatUsd(price)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <label className="block text-sm text-text sm:col-span-2">
                    <span className="flex items-center gap-1.5">
                      OPENAI_API_KEY
                      {openaiApiKey.trim() === '' ? (
                        <span className="text-xs text-muted" title={t('settings.apiKeyEmpty')}>—</span>
                      ) : openaiApiKey.trim().startsWith('sk-') ? (
                        <span className="text-xs text-emerald-400" title={t('settings.apiKeyValid')}>✓</span>
                      ) : (
                        <span className="text-xs text-amber-400" title={t('settings.apiKeyInvalid')}>?</span>
                      )}
                    </span>
                    <input type="password" value={openaiApiKey} onChange={(e) => setOpenaiApiKey(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted outline-none ring-0 focus:border-primary" placeholder="sk-..." />
                  </label>
                  <label className="block text-sm text-text sm:col-span-2">
                    <span className="flex items-center gap-1.5">
                      GEMINI_API_KEY
                      {geminiApiKey.trim() === '' ? (
                        <span className="text-xs text-muted" title={t('settings.apiKeyEmpty')}>—</span>
                      ) : geminiApiKey.trim().startsWith('AIza') ? (
                        <span className="text-xs text-emerald-400" title={t('settings.apiKeyValid')}>✓</span>
                      ) : (
                        <span className="text-xs text-amber-400" title={t('settings.apiKeyInvalid')}>?</span>
                      )}
                    </span>
                    <input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted outline-none ring-0 focus:border-primary" placeholder="AIza..." />
                  </label>
                  <label className="block text-sm text-text sm:col-span-2">CGU_AIR_API_KEY<input type="password" value={cguAirApiKey} onChange={(e) => setCguAirApiKey(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted outline-none ring-0 focus:border-primary" placeholder="cgusk-..." /></label>
                  <label className="block text-sm text-text sm:col-span-2">CGU_AIR_BASE_URL<input value={cguAirBaseUrl} onChange={(e) => setCguAirBaseUrl(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={DEFAULT_CGU_AIR_BASE_URL} /></label>
                  <label className="block text-sm text-text sm:col-span-2">OPENROUTER_API_KEY<input type="password" value={openrouterApiKey} onChange={(e) => setOpenrouterApiKey(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted outline-none ring-0 focus:border-primary" placeholder="sk-or-..." /></label>
                  <label className="block text-sm text-text sm:col-span-2">OPENROUTER_BASE_URL<input value={openrouterBaseUrl} onChange={(e) => setOpenrouterBaseUrl(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={DEFAULT_OPENROUTER_BASE_URL} /></label>
                  <label className="block text-sm text-text">OpenAI LLM Model<input value={openaiLlmModel} onChange={(e) => setOpenaiLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /></label>
                  <label className="block text-sm text-text">Gemini LLM Model<input value={geminiLlmModel} onChange={(e) => setGeminiLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /></label>
                  <label className="block text-sm text-text">CGU Air LLM Model<input value={cguAirLlmModel} onChange={(e) => setCguAirLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /></label>
                  <label className="block text-sm text-text">{t('settings.cguAirImageModelLabel')}<input value={cguAirImageModel} onChange={(e) => setCguAirImageModel(e.target.value)} placeholder={t('settings.cguAirImageModelPlaceholder')} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /><span className="mt-1 block text-xs text-muted">{t('settings.cguAirImageModelHint')}</span></label>
                  <label className="block text-sm text-text">OpenRouter LLM Model<input value={openrouterLlmModel} onChange={(e) => setOpenrouterLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /></label>
                  <label className="block text-sm text-text">OpenAI TTS Model<input value={openaiTtsModel} onChange={(e) => setOpenaiTtsModel(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /></label>
                  <label className="block text-sm text-text">Gemini TTS Model<input value={geminiTtsModel} onChange={(e) => setGeminiTtsModel(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" /></label>
                  <label className="block text-sm text-text">{t('settings.geminiSpeaker1')}<input value={geminiTtsSpeaker1} onChange={(e) => setGeminiTtsSpeaker1(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.geminiSpeaker1Placeholder')} /></label>
                  <label className="block text-sm text-text">{t('settings.geminiSpeaker1Voice')}<select value={geminiTtsSpeaker1Voice} onChange={(e) => setGeminiTtsSpeaker1Voice(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"><option value="">{t('settings.geminiSpeakerVoiceInherit')}</option>{GEMINI_TTS_VOICES.map((v) => <option key={v} value={v}>{geminiVoiceLabel(v, voiceGenderLabels)}</option>)}</select></label>
                  <label className="block text-sm text-text">{t('settings.geminiSpeaker2')}<input value={geminiTtsSpeaker2} onChange={(e) => setGeminiTtsSpeaker2(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.geminiSpeaker2Placeholder')} /></label>
                  <label className="block text-sm text-text">{t('settings.geminiSpeaker2Voice')}<select value={geminiTtsSpeaker2Voice} onChange={(e) => setGeminiTtsSpeaker2Voice(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"><option value="">{t('settings.geminiSpeakerVoiceInherit')}</option>{GEMINI_TTS_VOICES.map((v) => <option key={v} value={v}>{geminiVoiceLabel(v, voiceGenderLabels)}</option>)}</select></label>
                  <label className="block text-sm text-text">{t('settings.openaiSpeaker1')}<input value={openaiTtsSpeaker1} onChange={(e) => setOpenaiTtsSpeaker1(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.openaiSpeaker1Placeholder')} /></label>
                  <label className="block text-sm text-text">{t('settings.openaiSpeaker1Voice')}<select value={openaiTtsSpeaker1Voice} onChange={(e) => setOpenaiTtsSpeaker1Voice(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"><option value="">{t('settings.openaiSpeakerVoiceInherit')}</option>{OPENAI_TTS_VOICES.map((v) => <option key={v} value={v}>{openaiVoiceLabel(v, voiceGenderLabels)}</option>)}</select></label>
                  <label className="block text-sm text-text">{t('settings.openaiSpeaker2')}<input value={openaiTtsSpeaker2} onChange={(e) => setOpenaiTtsSpeaker2(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.openaiSpeaker2Placeholder')} /></label>
                  <label className="block text-sm text-text">{t('settings.openaiSpeaker2Voice')}<select value={openaiTtsSpeaker2Voice} onChange={(e) => setOpenaiTtsSpeaker2Voice(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted"><option value="">{t('settings.openaiSpeakerVoiceInherit')}</option>{OPENAI_TTS_VOICES.map((v) => <option key={v} value={v}>{openaiVoiceLabel(v, voiceGenderLabels)}</option>)}</select></label>
                </div>
                <div className="flex justify-end"><button type="button" onClick={() => void onSave()} disabled={saving} className="rounded-md bg-text px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{saving ? t('settings.saving') : t('settings.save')}</button></div>
              </div>
            ) : null}

            {activeCategoryInfo.id === 'sync' ? (
              <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
                <div>
                  <h2 className="mb-1 text-base font-semibold text-text">{t('settings.githubSync')}</h2>
                  <p className="mb-3 text-sm text-muted">{t('settings.githubSyncHint')}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm text-text sm:col-span-2">GITHUB_REPO_URL<input value={githubRepoUrl} onChange={(e) => setGithubRepoUrl(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder="https://github.com/your-name/your-repo.git" /></label>
                  <label className="block text-sm text-text sm:col-span-2">GITHUB_TOKEN<input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></label>
                </div>
                <div className="flex justify-end"><button type="button" onClick={() => void onSave()} disabled={saving} className="rounded-md bg-text px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{saving ? t('settings.saving') : t('settings.save')}</button></div>
              </div>
            ) : null}

            {activeCategoryInfo.id === 'admin' && isAdmin ? (
              <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-text sm:col-span-2"><span className="inline-flex items-center gap-2"><input type="checkbox" checked={googleAuthEnabled} onChange={(e) => setGoogleAuthEnabled(e.target.checked)} />{t('settings.googleAuthEnabled')}</span></label>
                  {googleAuthEnabled ? <>
                    <label className="block text-sm text-text sm:col-span-2">GOOGLE_CLIENT_ID<input value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder="xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com" /></label>
                    <label className="block text-sm text-text sm:col-span-2">GOOGLE_CLIENT_SECRET<input type="password" value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder="GOCSPX-..." /></label>
                    <label className="block text-sm text-text sm:col-span-2">GOOGLE_REDIRECT_URI<input value={googleRedirectUri} onChange={(e) => setGoogleRedirectUri(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder="https://your-domain.example/api/auth/google/callback" /></label>
                  </> : null}
                  <div className="sm:col-span-2 rounded-lg border border-border bg-bg/60 p-3">
                    <div className="mb-2 text-sm font-medium text-text">{t('settings.adminTransfer')}</div>
                    <div className="mb-2 text-xs text-muted">{t('settings.currentAdmins')}<span className="font-mono text-text">{adminAccountIds.join(', ') || accountId}</span></div>
                    <div className="flex flex-col gap-2 sm:flex-row"><input value={adminTransferAccountId} onChange={(e) => setAdminTransferAccountId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.adminTransferPlaceholder')} /><button type="button" onClick={() => void onTransferAdmin()} disabled={adminTransferBusy || !adminTransferAccountId.trim()} className="rounded-md border border-border px-4 py-2 text-sm text-text hover:bg-border disabled:opacity-50">{adminTransferBusy ? t('settings.saving') : t('settings.adminTransferButton')}</button></div>
                  </div>
                  <div className="sm:col-span-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
                    <div className="mb-1 text-sm font-medium text-danger">{t('settings.accountDeleteTitle')}</div>
                    <p className="mb-3 text-xs text-danger/80">{t('settings.accountDeleteHint')}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-xs text-text">
                        {t('settings.accountDeleteTarget')}
                        <input value={adminDeleteAccountId} onChange={(e) => setAdminDeleteAccountId(e.target.value)} className="mt-1 w-full rounded-md border border-rose-500/40 bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={t('settings.accountDeletePlaceholder')} />
                      </label>
                      <label className="block text-xs text-text">
                        {t('settings.accountDeleteConfirmLabel')}
                        <input value={adminDeleteConfirm} onChange={(e) => setAdminDeleteConfirm(e.target.value)} className="mt-1 w-full rounded-md border border-rose-500/40 bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted" placeholder={adminDeleteAccountId.trim() || t('settings.accountDeleteConfirmPlaceholder')} />
                      </label>
                    </div>
                    <button type="button" onClick={() => void onDeleteAccount()} disabled={adminDeleteBusy || !adminDeleteAccountId.trim() || adminDeleteConfirm.trim() !== adminDeleteAccountId.trim()} className="mt-3 rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50">
                      {adminDeleteBusy ? t('settings.accountDeleting') : t('settings.accountDeleteButton')}
                    </button>
                  </div>
                </div>
                <div className="flex justify-end"><button type="button" onClick={() => void onSave()} disabled={saving} className="rounded-md bg-text px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{saving ? t('settings.saving') : t('settings.save')}</button></div>
                <div className="rounded-lg border border-border bg-bg/60 p-3">
                  <div className="mb-1 text-sm font-medium text-text">{t('settings.clearThumbnailCache')}</div>
                  <p className="mb-2 text-xs text-muted">{t('settings.clearThumbnailCacheHint')}</p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void onClearThumbnailCache()}
                      disabled={thumbnailCacheBusy}
                      className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {thumbnailCacheBusy ? t('settings.clearThumbnailCacheClearing') : t('settings.clearThumbnailCacheButton')}
                    </button>
                    {thumbnailCacheMsg ? <span className="text-xs text-emerald-300">{thumbnailCacheMsg}</span> : null}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-bg/60 p-3">
                  <div className="mb-1 text-sm font-medium text-text">{t('settings.clearArtifactCache')}</div>
                  <p className="mb-2 text-xs text-muted">{t('settings.clearArtifactCacheHint')}</p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void onClearArtifactCache()}
                      disabled={artifactCacheBusy}
                      className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {artifactCacheBusy ? t('settings.clearArtifactCacheClearing') : t('settings.clearArtifactCacheButton')}
                    </button>
                    {artifactCacheMsg ? <span className="text-xs text-emerald-300">{artifactCacheMsg}</span> : null}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-bg/40 p-4">
                  <h2 className="mb-1 text-base font-semibold text-text">{t('settings.slaSettings')}</h2>
                  <p className="mb-3 text-sm text-muted">{t('settings.slaSettingsHint')}</p>
                  {slaLoading ? <p className="text-sm text-muted">{t('settings.loading')}</p> : slaSettings ? <>
                    <p className="mb-3 text-xs text-muted">{t('settings.slaBoundsHint')}：{slaSettings.bounds.min_ms / 1000} - {slaSettings.bounds.max_ms / 1000} {t('settings.slaSecondsUnit')}</p>
                    <h3 className="mb-1 text-sm font-semibold text-text">{t('settings.slaStages')}</h3>
                    <div className="mb-4 overflow-x-auto rounded-md border border-border"><table className="min-w-full divide-y divide-border text-left text-xs"><thead className="bg-surface/70 text-muted"><tr><th className="px-3 py-2">{t('settings.slaColName')}</th><th className="px-3 py-2">{t('settings.slaColDefault')}</th><th className="px-3 py-2">{t('settings.slaColEffective')}</th><th className="px-3 py-2">{t('settings.slaColOverride')}</th><th className="px-3 py-2">{t('settings.slaColUpdatedAt')}</th><th className="px-3 py-2">{t('settings.slaColAction')}</th></tr></thead><tbody className="divide-y divide-border bg-bg/40">{slaSettings.stages.map(renderSlaRow)}</tbody></table></div>
                    <h3 className="mb-1 text-sm font-semibold text-text">{t('settings.slaArtifacts')}</h3>
                    <div className="overflow-x-auto rounded-md border border-border"><table className="min-w-full divide-y divide-border text-left text-xs"><thead className="bg-surface/70 text-muted"><tr><th className="px-3 py-2">{t('settings.slaColName')}</th><th className="px-3 py-2">{t('settings.slaColDefault')}</th><th className="px-3 py-2">{t('settings.slaColEffective')}</th><th className="px-3 py-2">{t('settings.slaColOverride')}</th><th className="px-3 py-2">{t('settings.slaColUpdatedAt')}</th><th className="px-3 py-2">{t('settings.slaColAction')}</th></tr></thead><tbody className="divide-y divide-border bg-bg/40">{slaSettings.artifacts.map(renderSlaRow)}</tbody></table></div>
                  </> : null}
                </div>
              </div>
            ) : null}

            {activeCategoryInfo.id === 'skills' ? (
              <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-text">{t('settings.skills')}</h2>
                  <Link to="/templates" className="text-xs text-indigo-400 hover:text-indigo-300">{t('templates.browseCta')} →</Link>
                </div>
                <p className="text-xs text-muted">{t('settings.skillsDesc')}</p>
                {skillsLoading ? <div className="text-xs text-muted">{t('settings.loading')}</div> : (
                  <div className="space-y-2">
                    {skills.map((skill) => (
                      <div key={skill.id} className="rounded-lg border border-border bg-bg/60 p-3">
                        {editingSkillId === skill.id ? (
                          <div className="space-y-2">
                            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-muted" />
                            <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={3} maxLength={2000} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-muted" />
                            <div className="flex items-center gap-2"><select value={editApplyTo} onChange={(e) => setEditApplyTo(e.target.value as 'script' | 'all')} className="rounded border border-border bg-surface px-2 py-1 text-xs text-text"><option value="script">{t('settings.skillApplyToScript')}</option><option value="all">{t('settings.skillApplyToAll')}</option></select><button type="button" disabled={savingSkillId === skill.id || !editName.trim() || !editPrompt.trim()} onClick={() => { setSavingSkillId(skill.id); void updateSkill(skill.id, { name: editName.trim(), prompt: editPrompt.trim(), applyTo: editApplyTo }).then((updated) => { setSkills((prev) => prev.map((s) => s.id === skill.id ? updated : s)); setEditingSkillId(null); }).finally(() => setSavingSkillId(null)); }} className="ml-auto rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 hover:bg-indigo-500">{savingSkillId === skill.id ? t('settings.saving') : t('settings.skillSave')}</button><button type="button" onClick={() => setEditingSkillId(null)} className="rounded border border-border px-2.5 py-1 text-xs text-muted hover:text-text">{t('settings.skillCancel')}</button></div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <input type="checkbox" checked={skill.enabled} onChange={() => { if (skill.isBuiltIn) { void toggleBuiltInSkill(skill.id).then((res) => { setSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, enabled: res.enabled } : s)); }); } else { void updateSkill(skill.id, { enabled: !skill.enabled }).then((updated) => { setSkills((prev) => prev.map((s) => s.id === skill.id ? updated : s)); }); } }} className="mt-0.5 h-4 w-4 rounded border-border bg-border accent-indigo-500" />
                            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-medium text-text">{skill.isBuiltIn ? (t('settings.skillLangZh') === 'zh-TW' ? skill.nameZh ?? skill.name : skill.name) : skill.name}</span>{skill.isBuiltIn && <span className="rounded bg-border px-1.5 py-0.5 text-xs text-muted">{t('settings.skillBuiltIn')}</span>}<span className="rounded bg-border px-1.5 py-0.5 text-xs text-muted">{skill.applyTo}</span></div>{skill.isBuiltIn && skill.descriptionZh && <p className="mt-1 text-xs text-muted">{skill.descriptionZh}</p>}{!skill.isBuiltIn && <p className="mt-1 text-xs text-muted line-clamp-2">{skill.prompt}</p>}</div>
                            {!skill.isBuiltIn && <div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => { setEditingSkillId(skill.id); setEditName(skill.name); setEditPrompt(skill.prompt); setEditApplyTo(skill.applyTo); }} className="text-xs text-muted hover:text-text">{t('settings.skillEdit')}</button><button type="button" disabled={publishingSkillId === skill.id} onClick={() => { setPublishingSkillId(skill.id); void createTemplate({ name: skill.name, description: '', category: 'general', skill_data: { prompt: skill.prompt, applyTo: skill.applyTo, imageStylePrompt: skill.imageStylePrompt, quizPrompt: skill.quizPrompt, ttsProvider: skill.ttsProvider, ttsVoice: skill.ttsVoice } }).then(() => { setPublishedSkillId(skill.id); setTimeout(() => setPublishedSkillId(null), 2000); }).catch(() => {}).finally(() => setPublishingSkillId(null)); }} className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50">{publishingSkillId === skill.id ? '…' : publishedSkillId === skill.id ? t('templates.publishDone') : t('settings.publishSkillAsTemplate')}</button><button type="button" onClick={() => { void deleteSkill(skill.id).then(() => { setSkills((prev) => prev.filter((s) => s.id !== skill.id)); }); }} className="text-xs text-red-400 hover:text-red-300">{t('settings.delete')}</button></div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2 rounded-lg border border-border bg-bg/40 p-3">
                  <h3 className="text-xs font-medium text-text">{t('settings.addSkill')}</h3>
                  <input type="text" value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)} placeholder={t('settings.skillNamePlaceholder')} maxLength={80} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-muted" />
                  <textarea value={newSkillPrompt} onChange={(e) => setNewSkillPrompt(e.target.value)} placeholder={t('settings.skillPromptPlaceholder')} rows={3} maxLength={2000} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-muted" />
                  <div className="flex items-center gap-3"><label className="flex items-center gap-1.5 text-xs text-muted">{t('settings.skillApplyTo')}<select value={newSkillApplyTo} onChange={(e) => setNewSkillApplyTo(e.target.value as 'script' | 'all')} className="rounded border border-border bg-surface px-2 py-1 text-xs text-text"><option value="script">{t('settings.skillApplyToScript')}</option><option value="all">{t('settings.skillApplyToAll')}</option></select></label><button type="button" disabled={addingSkill || !newSkillName.trim() || !newSkillPrompt.trim()} onClick={() => { setAddingSkill(true); void createSkill({ name: newSkillName.trim(), prompt: newSkillPrompt.trim(), applyTo: newSkillApplyTo }).then((skill) => { setSkills((prev) => [...prev, skill]); setNewSkillName(''); setNewSkillPrompt(''); }).finally(() => setAddingSkill(false)); }} className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-indigo-500">{addingSkill ? t('settings.saving') : t('settings.addSkillBtn')}</button></div>
                </div>
                {embeddingStats ? (
                  <div className="space-y-1 rounded-lg border border-border bg-bg/40 p-3">
                    <h3 className="text-xs font-medium text-text">{t('settings.embeddingIndex')}</h3>
                    <p className="text-xs text-muted">
                      {t('settings.embeddingIndexStats')
                        .replace('{pages}', String(embeddingStats.indexed_pages))
                        .replace('{pdfs}', String(embeddingStats.indexed_pdfs))}
                    </p>
                    {embeddingStats.total_pages > 0 ? (() => {
                      const pct = progressPercent(embeddingStats.indexed_pages, embeddingStats.total_pages);
                      return (
                        <div className="space-y-1">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[11px] text-muted">
                            {t('settings.embeddingIndexCoverage')
                              .replace('{percent}', String(pct))
                              .replace('{indexed}', String(embeddingStats.indexed_pages))
                              .replace('{total}', String(embeddingStats.total_pages))}
                          </p>
                        </div>
                      );
                    })() : null}
                    <p className="text-[11px] text-muted">{t('settings.embeddingIndexHint')}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
