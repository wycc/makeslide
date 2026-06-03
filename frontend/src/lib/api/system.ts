import { parseErrorBody } from './common';

export type AppLanguage = 'zh-TW' | 'en';

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
}

export interface SystemAiSettings {
  account_id?: string;
  account_settings_dir?: string;
  account_settings_file?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  gemini_api_key?: string;
  has_openai_key: boolean;
  has_gemini_key: boolean;
  llm_provider: 'openai' | 'gemini';
  tts_provider: 'openai' | 'gemini';
  openai_llm_model: string;
  gemini_llm_model: string;
  openai_tts_model: string;
  gemini_tts_model: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
  gemini_tts_speaker1_voice?: string;
  gemini_tts_speaker2_voice?: string;
  user_code?: string;
  ui_language: AppLanguage;
  content_language: AppLanguage;
  google_auth_enabled?: boolean;
  google_client_id?: string;
  google_client_secret?: string;
  google_redirect_uri?: string;
}

export interface UpdateSystemAiSettingsPayload {
  openai_api_key?: string;
  openai_base_url?: string;
  gemini_api_key?: string;
  llm_provider?: 'openai' | 'gemini';
  tts_provider?: 'openai' | 'gemini';
  openai_llm_model?: string;
  gemini_llm_model?: string;
  openai_tts_model?: string;
  gemini_tts_model?: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
  gemini_tts_speaker1_voice?: string;
  gemini_tts_speaker2_voice?: string;
  user_code?: string;
  ui_language?: AppLanguage;
  content_language?: AppLanguage;
  google_auth_enabled?: boolean;
  google_client_id?: string;
  google_client_secret?: string;
  google_redirect_uri?: string;
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
