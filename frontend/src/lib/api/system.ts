import { parseErrorBody } from './common';

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
  openai_api_key?: string;
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
}

export interface UpdateSystemAiSettingsPayload {
  openai_api_key?: string;
  gemini_api_key?: string;
  llm_provider?: 'openai' | 'gemini';
  tts_provider?: 'openai' | 'gemini';
  openai_llm_model?: string;
  gemini_llm_model?: string;
  openai_tts_model?: string;
  gemini_tts_model?: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
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
