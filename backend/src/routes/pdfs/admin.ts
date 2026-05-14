import type { FastifyInstance } from 'fastify';
import { getRuntimeAiSettings, persistEnvSettings, setRuntimeAiSettings } from '../../services/aiSettings';
import { setOpenAIApiKeyRuntime } from '../../services/openai';
import { UpdateSystemAiSettingsBodySchema, errorResponse } from './shared';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/openai-key-status', async (_request, reply) => {
    const runtime = getRuntimeAiSettings();
    return reply.code(200).send({ has_key: runtime.openaiApiKey.trim().length > 0 });
  });

  app.patch('/api/system/openai-api-key', async (request, reply) => {
    const body = request.body as { api_key?: string };
    const apiKey = (body?.api_key ?? '').trim();
    setOpenAIApiKeyRuntime(apiKey);
    setRuntimeAiSettings({ openaiApiKey: apiKey });
    await persistEnvSettings({ openaiApiKey: apiKey });
    return reply.code(200).send({ ok: true, has_key: apiKey.length > 0 });
  });

  app.get('/api/system/ai-settings', async (_request, reply) => {
    const runtime = getRuntimeAiSettings();
    return reply.code(200).send({
      openai_api_key: runtime.openaiApiKey,
      gemini_api_key: runtime.geminiApiKey,
      llm_provider: runtime.llmProvider,
      tts_provider: runtime.ttsProvider,
      openai_llm_model: runtime.openaiLlmModel,
      gemini_llm_model: runtime.geminiLlmModel,
      openai_tts_model: runtime.openaiTtsModel,
      gemini_tts_model: runtime.geminiTtsModel,
      gemini_tts_speaker1: runtime.geminiTtsSpeaker1,
      gemini_tts_speaker2: runtime.geminiTtsSpeaker2,
    });
  });

  app.patch('/api/system/ai-settings', async (request, reply) => {
    const parsed = UpdateSystemAiSettingsBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const data = parsed.data;
    const next = {
      openaiApiKey: data.openai_api_key,
      geminiApiKey: data.gemini_api_key,
      llmProvider: data.llm_provider,
      ttsProvider: data.tts_provider,
      openaiLlmModel: data.openai_llm_model,
      geminiLlmModel: data.gemini_llm_model,
      openaiTtsModel: data.openai_tts_model,
      geminiTtsModel: data.gemini_tts_model,
      geminiTtsSpeaker1: data.gemini_tts_speaker1,
      geminiTtsSpeaker2: data.gemini_tts_speaker2,
    };
    if (typeof next.openaiApiKey === 'string') setOpenAIApiKeyRuntime(next.openaiApiKey);
    const runtime = setRuntimeAiSettings(next);
    await persistEnvSettings(next);
    return reply.code(200).send({
      openai_api_key: runtime.openaiApiKey,
      gemini_api_key: runtime.geminiApiKey,
      llm_provider: runtime.llmProvider,
      tts_provider: runtime.ttsProvider,
      openai_llm_model: runtime.openaiLlmModel,
      gemini_llm_model: runtime.geminiLlmModel,
      openai_tts_model: runtime.openaiTtsModel,
      gemini_tts_model: runtime.geminiTtsModel,
      gemini_tts_speaker1: runtime.geminiTtsSpeaker1,
      gemini_tts_speaker2: runtime.geminiTtsSpeaker2,
    });
  });
}
