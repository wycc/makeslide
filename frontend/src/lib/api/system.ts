import { parseErrorBody } from './common';
import type { SlaSettingsResponse, SlaTargetKind } from '../../types';

export type AppLanguage = 'zh-TW' | 'en';
export type LlmProvider = 'openai' | 'gemini' | 'cgu-air' | 'openrouter';
/** How the backend reaches audio.cpp: spawn its CLI, or POST to a running audiocpp_server. */
export type AudioCppMode = 'auto' | 'cli' | 'server';
/** Compute backend for the CLI mode — this is the CPU/GPU switch. */
export type AudioCppBackendSetting = 'auto' | 'cpu' | 'cuda' | 'vulkan' | 'metal' | 'hip' | 'best';
// 'openrouter' reaches Gemini TTS through OpenRouter; 'audiocpp' is the local engine
// (services/audiocpp.ts on the backend) and needs no API key.
export type TtsProvider = 'openai' | 'gemini' | 'openrouter' | 'audiocpp';
/**
 * Providers that authenticate with nothing because they run on the server's own hardware.
 * Mirrors the backend's providerAvailability.isKeylessProvider: anywhere the UI reasons about
 * "is this provider set up", these must not be judged by whether a key was pasted.
 */
export const KEYLESS_PROVIDERS: readonly string[] = ['audiocpp'];
export type SubtitleSyncMode = 'estimate' | 'whisper';

export interface ImagePromptTemplate {
  key: string;
  label: string;
  description: string;
  prompt_en: string;
  prompt_zh: string;
}

export interface ImagePromptTemplatesResponse {
  templates: ImagePromptTemplate[];
  default_template_key: string | null;
}

export async function getImagePromptTemplates(): Promise<ImagePromptTemplatesResponse> {
  const resp = await fetch('api/system/image-prompt-templates');
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as ImagePromptTemplatesResponse;
}

export interface OpenAIKeyStatusResponse {
  has_key: boolean;
  has_openai_key?: boolean;
  has_gemini_key?: boolean;
  has_cgu_air_key?: boolean;
  has_openrouter_key?: boolean;
  llm_provider?: LlmProvider;
  tts_provider?: TtsProvider;
  /** 選定的 LLM provider（或已設定的次要 provider）有 key，LLM 相關功能才可用。 */
  llm_enabled?: boolean;
  /** 同上，對應 TTS。 */
  tts_enabled?: boolean;
  secondary_llm_provider?: LlmProvider | '';
  secondary_tts_provider?: TtsProvider | '';
}

export interface SystemAiSettings {
  account_id?: string;
  account_settings_dir?: string;
  account_settings_file?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  gemini_api_key?: string;
  cgu_air_api_key?: string;
  cgu_air_base_url?: string;
  openrouter_api_key?: string;
  openrouter_base_url?: string;
  has_openai_key: boolean;
  has_gemini_key: boolean;
  has_cgu_air_key?: boolean;
  has_openrouter_key?: boolean;
  /** 選定的 provider（或次要 provider）有 key，對應功能才可用；後端 providerAvailability.ts 算好的。 */
  llm_enabled?: boolean;
  tts_enabled?: boolean;
  llm_provider: LlmProvider;
  tts_provider: TtsProvider;
  /** Fallback provider used for the rest of a run when the primary above fails permanently mid-run. '' = none configured. */
  secondary_llm_provider?: LlmProvider | '';
  secondary_tts_provider?: TtsProvider | '';
  openai_llm_model: string;
  gemini_llm_model: string;
  cgu_air_llm_model?: string;
  openrouter_llm_model?: string;
  cgu_air_image_model?: string;
  openrouter_image_model?: string;
  openai_tts_model: string;
  gemini_tts_model: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
  gemini_tts_speaker1_voice?: string;
  gemini_tts_speaker2_voice?: string;
  openai_tts_speaker1?: string;
  openai_tts_speaker2?: string;
  openai_tts_speaker1_voice?: string;
  openai_tts_speaker2_voice?: string;
  openrouter_tts_model?: string;
  openrouter_tts_speaker1?: string;
  openrouter_tts_speaker2?: string;
  openrouter_tts_speaker1_voice?: string;
  openrouter_tts_speaker2_voice?: string;
  audiocpp_tts_mode?: AudioCppMode;
  audiocpp_tts_base_url?: string;
  audiocpp_tts_bin?: string;
  audiocpp_tts_model?: string;
  audiocpp_tts_family?: string;
  audiocpp_tts_backend?: AudioCppBackendSetting;
  audiocpp_tts_speaker1?: string;
  audiocpp_tts_speaker2?: string;
  audiocpp_tts_speaker1_voice?: string;
  audiocpp_tts_speaker2_voice?: string;
  user_code?: string;
  ui_language: AppLanguage;
  content_language: AppLanguage;
  is_admin?: boolean;
  google_auth_enabled?: boolean;
  google_client_id?: string;
  google_client_secret?: string;
  google_redirect_uri?: string;
  admin_account_ids?: string[];
  has_mcp_auth_token?: boolean;
  github_repo_url?: string;
  github_token?: string;
  auto_generate_animation?: boolean;
  subtitle_sync_mode?: SubtitleSyncMode;
  monthly_budget_usd?: number | null;
  semantic_search_max_pdfs?: number;
  default_source_weekly_usage?: DefaultSourceWeeklyUsage;
}

export interface DefaultSourceWeeklyUsage {
  weekStart: string;
  nextReset: string;
  costUsd: number;
  quotaUsd: number;
  remainingUsd: number;
}

export interface UpdateSystemAiSettingsPayload {
  openai_api_key?: string;
  openai_base_url?: string;
  gemini_api_key?: string;
  cgu_air_api_key?: string;
  cgu_air_base_url?: string;
  openrouter_api_key?: string;
  openrouter_base_url?: string;
  llm_provider?: LlmProvider;
  tts_provider?: TtsProvider;
  secondary_llm_provider?: LlmProvider | '';
  secondary_tts_provider?: TtsProvider | '';
  openai_llm_model?: string;
  gemini_llm_model?: string;
  cgu_air_llm_model?: string;
  openrouter_llm_model?: string;
  cgu_air_image_model?: string;
  openrouter_image_model?: string;
  openai_tts_model?: string;
  gemini_tts_model?: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
  gemini_tts_speaker1_voice?: string;
  gemini_tts_speaker2_voice?: string;
  openai_tts_speaker1?: string;
  openai_tts_speaker2?: string;
  openai_tts_speaker1_voice?: string;
  openai_tts_speaker2_voice?: string;
  openrouter_tts_model?: string;
  openrouter_tts_speaker1?: string;
  openrouter_tts_speaker2?: string;
  openrouter_tts_speaker1_voice?: string;
  openrouter_tts_speaker2_voice?: string;
  audiocpp_tts_mode?: AudioCppMode;
  audiocpp_tts_base_url?: string;
  audiocpp_tts_bin?: string;
  audiocpp_tts_model?: string;
  audiocpp_tts_family?: string;
  audiocpp_tts_backend?: AudioCppBackendSetting;
  audiocpp_tts_speaker1?: string;
  audiocpp_tts_speaker2?: string;
  audiocpp_tts_speaker1_voice?: string;
  audiocpp_tts_speaker2_voice?: string;
  user_code?: string;
  ui_language?: AppLanguage;
  content_language?: AppLanguage;
  google_auth_enabled?: boolean;
  google_client_id?: string;
  google_client_secret?: string;
  google_redirect_uri?: string;
  github_repo_url?: string;
  github_token?: string;
  auto_generate_animation?: boolean;
  subtitle_sync_mode?: SubtitleSyncMode;
  monthly_budget_usd?: number | null;
  semantic_search_max_pdfs?: number;
}

export interface MonthlyCostResponse {
  month: string;
  total_cost_usd: number | null;
  run_count: number;
}

export async function getMonthlyCost(): Promise<MonthlyCostResponse> {
  const resp = await fetch('api/usage/monthly-cost');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as MonthlyCostResponse;
}

export async function getOpenAIKeyStatus(): Promise<OpenAIKeyStatusResponse> {
  const resp = await fetch('api/system/openai-key-status');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as OpenAIKeyStatusResponse;
}

export async function getSystemAiSettings(): Promise<SystemAiSettings> {
  const resp = await fetch('api/system/ai-settings');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SystemAiSettings;
}

export async function updateSystemAiSettings(
  payload: UpdateSystemAiSettingsPayload,
): Promise<SystemAiSettings> {
  const resp = await fetch('api/system/ai-settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SystemAiSettings;
}

export async function transferAdminAccount(accountId: string): Promise<{ ok: boolean; admin_account_ids: string[] }> {
  const resp = await fetch('api/system/admin', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: accountId }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean; admin_account_ids: string[] };
}

export interface DeleteAccountResponse {
  ok: boolean;
  account_id: string;
  deleted_pdf_count: number;
  deleted_pdfs: string[];
  account_deleted: boolean;
}

export async function deleteAccount(accountId: string): Promise<DeleteAccountResponse> {
  const resp = await fetch(`api/system/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as DeleteAccountResponse;
}

/** Deletes the caller's own account (and every presentation it owns); the backend also clears the session cookie. */
export async function deleteMyAccount(): Promise<DeleteAccountResponse> {
  const resp = await fetch('api/system/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as DeleteAccountResponse;
}

export interface GenerateMcpAuthTokenResponse {
  ok: boolean;
  token: string;
  has_mcp_auth_token: boolean;
}

export async function generateMcpAuthToken(): Promise<GenerateMcpAuthTokenResponse> {
  const resp = await fetch('api/system/mcp-auth-token', { method: 'POST' });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as GenerateMcpAuthTokenResponse;
}

export interface RevealMcpAuthTokenResponse {
  ok: boolean;
  token: string | null;
  has_mcp_auth_token: boolean;
}

/** 只顯示目前已設定的 token，不會重新產生（產生請用 generateMcpAuthToken）。 */
export async function revealMcpAuthToken(): Promise<RevealMcpAuthTokenResponse> {
  const resp = await fetch('api/system/mcp-auth-token');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RevealMcpAuthTokenResponse;
}

export async function setOpenAIApiKey(apiKey: string): Promise<{ ok: boolean; has_key: boolean }> {
  const resp = await fetch('api/system/openai-api-key', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean; has_key: boolean };
}

export interface AuthStatus {
  google_enabled: boolean;
  authenticated: boolean;
  is_admin?: boolean;
  user: null | {
    provider: 'google';
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  };
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const resp = await fetch('api/auth/status');
  if (!resp.ok) {
    const err = await parseErrorBody(resp);
    // 舊版後端可能尚未提供 /api/auth/status，避免前端直接崩潰。
    if (resp.status === 404) {
      return {
        google_enabled: false,
        authenticated: false,
        user: null,
      };
    }
    throw err;
  }
  return (await resp.json()) as AuthStatus;
}

export async function logoutAuth(): Promise<{ ok: boolean }> {
  const resp = await fetch('api/auth/logout', { method: 'POST' });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean };
}

export interface EmbeddingStats {
  indexed_pages: number;
  indexed_pdfs: number;
  total_pages: number;
}

export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  const resp = await fetch('api/me/embedding-stats');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as EmbeddingStats;
}

export interface ObservabilityStatusCount {
  status: string;
  count: number;
}

export interface ObservabilityMetrics {
  generated_at: string;
  pdfs: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
    success_rate: number;
    failure_rate: number;
  };
  pipeline_runs: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    success_rate: number;
    failure_rate: number;
    average_duration_ms: number | null;
  };
  stages: ObservabilityStatusCount[];
  artifacts: ObservabilityStatusCount[];
  llm_usage: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_latency_ms: number;
    average_latency_ms: number | null;
    estimated_cost_usd: number | null;
  };
}

export async function getObservabilityMetrics(): Promise<ObservabilityMetrics> {
  const resp = await fetch('api/system/observability');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as ObservabilityMetrics;
}

export async function getSlaSettings(): Promise<SlaSettingsResponse> {
  const resp = await fetch('api/system/sla-settings');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SlaSettingsResponse;
}

export async function updateSlaTargetOverride(kind: SlaTargetKind, name: string, targetMs: number | null): Promise<SlaSettingsResponse> {
  const resp = await fetch('api/system/sla-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, name, target_ms: targetMs }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SlaSettingsResponse;
}

export async function clearThumbnailCache(): Promise<{ files_deleted: number; bytes_freed: number }> {
  const resp = await fetch('api/system/thumbnail-cache', { method: 'DELETE' });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { files_deleted: number; bytes_freed: number };
}

export async function clearArtifactCache(): Promise<{ dirs_cleared: number; bytes_freed: number }> {
  const resp = await fetch('api/admin/cache', { method: 'DELETE' });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { dirs_cleared: number; bytes_freed: number };
}

/**
 * Synthesize the fixed preview line for one speaker and return it as a playable blob URL.
 *
 * `voice`/`persona` are the values currently in the settings form rather than the saved ones, so
 * a persona can be judged by ear before it is committed. Callers own the returned URL and must
 * `URL.revokeObjectURL` it once the clip is done.
 */
export async function previewSpeakerVoice(params: {
  provider: TtsProvider;
  /** Which host — decides which global voice an empty `voice` inherits, as a deck would. */
  speaker: '1' | '2';
  voice: string;
  persona: string;
}): Promise<string> {
  const resp = await fetch('api/system/tts-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return URL.createObjectURL(await resp.blob());
}

export interface UploadedVoiceRef {
  /** Absolute path on the server — this is what the voice field stores and `--voice-ref` gets. */
  path: string;
  bytes: number;
  seconds: number;
  max_seconds: number;
  /**
   * What the clip says. Qwen3-TTS Base refuses to clone without it, so the server fills this in
   * with Whisper when it can — it comes back empty when there is no key for that, and then it is
   * the user's to type.
   */
  transcript: string;
}

/**
 * Upload a reference clip for audio.cpp voice cloning.
 *
 * The server re-encodes it (mono 24 kHz WAV) and trims it, so what comes back is not the file that
 * went up — the returned path is the only thing worth keeping.
 */
export async function uploadAudioCppVoiceRef(file: File): Promise<UploadedVoiceRef> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('api/system/audiocpp/voice-ref', { method: 'POST', body: form });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as UploadedVoiceRef;
}

/** Correct the transcript of an already-uploaded clip (Whisper's guess is only a starting point). */
export async function setAudioCppVoiceRefTranscript(path: string, transcript: string): Promise<void> {
  const resp = await fetch('api/system/audiocpp/voice-ref/transcript', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, transcript }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
}
