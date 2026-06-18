import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getAccountSettingsLocation,
  getAdminAccountIds,
  getRuntimeAiSettings,
  isAdminAccount,
  persistEnvSettings,
  setRuntimeAiSettings,
  transferAdminAccount,
} from '../../services/aiSettings';
import { setOpenAIApiKeyRuntime, setOpenAIBaseUrlRuntime } from '../../services/openai';
import { currentAccountId } from '../../services/accountContext';
import { IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { pushPresentationToGitHub } from '../../services/presentationGit';
import { decodeSession, parseCookies } from '../auth';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { IdParamSchema, UpdateSystemAiSettingsBodySchema, errorResponse } from './shared';

function sessionSub(request: FastifyRequest): string | null {
  const session = decodeSession(parseCookies(request).makeslide_session);
  return session?.sub ?? null;
}

function canEditPdf(sub: string | null, row: Pick<PdfRow, 'owner_sub' | 'visibility'>): boolean {
  if (!row.owner_sub) return true;
  if (sub && row.owner_sub === sub) return true;
  return row.visibility === 'public_editable';
}

const TransferAdminBodySchema = z.object({
  account_id: z.string().trim().min(1).max(256),
});

const SYSTEM_AUTH_SETTING_KEYS = [
  'google_auth_enabled',
  'google_client_id',
  'google_client_secret',
  'google_redirect_uri',
] as const;

function hasSystemAuthSettingsUpdate(data: Record<string, unknown>): boolean {
  return SYSTEM_AUTH_SETTING_KEYS.some((key) => data[key] !== undefined);
}

function aiSettingsResponse(accountId: string, isAdmin: boolean) {
  const runtime = getRuntimeAiSettings(accountId);
  const location = getAccountSettingsLocation(accountId);
  const response: Record<string, unknown> = {
    account_id: location.accountId,
    account_settings_dir: location.accountDir,
    account_settings_file: location.envPath,
    is_admin: isAdmin,
    openai_api_key: runtime.openaiApiKey,
    openai_base_url: runtime.openaiBaseUrl,
    gemini_api_key: runtime.geminiApiKey,
    llm_provider: runtime.llmProvider,
    tts_provider: runtime.ttsProvider,
    openai_llm_model: runtime.openaiLlmModel,
    gemini_llm_model: runtime.geminiLlmModel,
    openai_tts_model: runtime.openaiTtsModel,
    gemini_tts_model: runtime.geminiTtsModel,
    gemini_tts_speaker1: runtime.geminiTtsSpeaker1,
    gemini_tts_speaker2: runtime.geminiTtsSpeaker2,
    gemini_tts_speaker1_voice: runtime.geminiTtsSpeaker1Voice,
    gemini_tts_speaker2_voice: runtime.geminiTtsSpeaker2Voice,
    openai_tts_speaker1: runtime.openaiTtsSpeaker1,
    openai_tts_speaker2: runtime.openaiTtsSpeaker2,
    openai_tts_speaker1_voice: runtime.openaiTtsSpeaker1Voice,
    openai_tts_speaker2_voice: runtime.openaiTtsSpeaker2Voice,
    user_code: runtime.userCode,
    ui_language: runtime.uiLanguage,
    content_language: runtime.contentLanguage,
    github_repo_url: runtime.githubRepoUrl,
    github_token: runtime.githubToken,
    auto_generate_animation: runtime.autoGenerateAnimation,
  };
  if (isAdmin) {
    response.google_auth_enabled = runtime.googleAuthEnabled;
    response.google_client_id = runtime.googleClientId;
    response.google_client_secret = runtime.googleClientSecret;
    response.google_redirect_uri = runtime.googleRedirectUri;
    response.admin_account_ids = getAdminAccountIds();
  }
  return response;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/image-prompt-templates', async (_request, reply) => {
    return reply.code(200).send({
      templates: IMAGE_PROMPT_TEMPLATES,
      default_template_key: IMAGE_PROMPT_TEMPLATES[0]?.key ?? null,
    });
  });

  app.get('/api/system/openai-key-status', async (_request, reply) => {
    const runtime = getRuntimeAiSettings();
    return reply.code(200).send({ has_key: runtime.openaiApiKey.trim().length > 0 });
  });

  app.patch('/api/system/openai-api-key', async (request, reply) => {
    const body = request.body as { api_key?: string };
    const apiKey = (body?.api_key ?? '').trim();
    const accountId = currentAccountId();
    setOpenAIApiKeyRuntime(accountId, apiKey);
    setRuntimeAiSettings(accountId, { openaiApiKey: apiKey });
    await persistEnvSettings(accountId, { openaiApiKey: apiKey });
    return reply.code(200).send({ ok: true, has_key: apiKey.length > 0 });
  });

  app.get('/api/system/ai-settings', async (_request, reply) => {
    const accountId = currentAccountId();
    return reply.code(200).send(aiSettingsResponse(accountId, isAdminAccount(accountId)));
  });

  app.patch('/api/system/ai-settings', async (request, reply) => {
    const parsed = UpdateSystemAiSettingsBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const data = parsed.data;
    const accountId = currentAccountId();
    const accountIsAdmin = isAdminAccount(accountId);
    if (!accountIsAdmin && hasSystemAuthSettingsUpdate(data)) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以修改 Google 登入設定'));
    }
    const next = {
      openaiApiKey: data.openai_api_key,
      openaiBaseUrl: data.openai_base_url,
      geminiApiKey: data.gemini_api_key,
      llmProvider: data.llm_provider,
      ttsProvider: data.tts_provider,
      openaiLlmModel: data.openai_llm_model,
      geminiLlmModel: data.gemini_llm_model,
      openaiTtsModel: data.openai_tts_model,
      geminiTtsModel: data.gemini_tts_model,
      geminiTtsSpeaker1: data.gemini_tts_speaker1,
      geminiTtsSpeaker2: data.gemini_tts_speaker2,
      geminiTtsSpeaker1Voice: data.gemini_tts_speaker1_voice,
      geminiTtsSpeaker2Voice: data.gemini_tts_speaker2_voice,
      openaiTtsSpeaker1: data.openai_tts_speaker1,
      openaiTtsSpeaker2: data.openai_tts_speaker2,
      openaiTtsSpeaker1Voice: data.openai_tts_speaker1_voice,
      openaiTtsSpeaker2Voice: data.openai_tts_speaker2_voice,
      userCode: data.user_code,
      uiLanguage: data.ui_language,
      contentLanguage: data.content_language,
      googleAuthEnabled: data.google_auth_enabled,
      googleClientId: data.google_client_id,
      googleClientSecret: data.google_client_secret,
      googleRedirectUri: data.google_redirect_uri,
      githubRepoUrl: data.github_repo_url,
      githubToken: data.github_token,
      autoGenerateAnimation: data.auto_generate_animation,
    };
    if (typeof next.openaiApiKey === 'string') setOpenAIApiKeyRuntime(accountId, next.openaiApiKey);
    if (typeof next.openaiBaseUrl === 'string') setOpenAIBaseUrlRuntime(accountId, next.openaiBaseUrl);
    setRuntimeAiSettings(accountId, next);
    await persistEnvSettings(accountId, next);
    return reply.code(200).send(aiSettingsResponse(accountId, accountIsAdmin));
  });

  app.patch('/api/system/admin', async (request, reply) => {
    const accountId = currentAccountId();
    if (!isAdminAccount(accountId)) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以移交 admin 權限'));
    }
    const parsed = TransferAdminBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    try {
      const adminAccountIds = await transferAdminAccount(parsed.data.account_id);
      return reply.code(200).send({ ok: true, admin_account_ids: adminAccountIds });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send(errorResponse('INVALID_ADMIN_ACCOUNT', message));
    }
  });

  app.post('/api/pdfs/:id/github-sync', async (request, reply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id'));
    }
    const { id } = parsed.data;
    const row = db.prepare(`SELECT id, owner_sub, visibility FROM pdfs WHERE id = ?`).get(id) as
      | Pick<PdfRow, 'id' | 'owner_sub' | 'visibility'>
      | undefined;
    if (!row) return reply.code(404).send(errorResponse('PDF_NOT_FOUND', `PDF ${id} not found`));
    if (!canEditPdf(sessionSub(request), row)) {
      return reply.code(403).send(errorResponse('FORBIDDEN', '無權限同步此簡報到 GitHub'));
    }

    const runtime = getRuntimeAiSettings();
    const repoUrl = runtime.githubRepoUrl.trim();
    if (!repoUrl) {
      return reply.code(400).send(errorResponse('GITHUB_NOT_CONFIGURED', '尚未設定 GitHub Repository'));
    }

    try {
      await pushPresentationToGitHub(id, repoUrl, runtime.githubToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.warn({ err, pdfId: id }, 'github-sync: push failed');
      return reply.code(502).send(errorResponse('GITHUB_SYNC_FAILED', message));
    }

    return reply.code(200).send({ ok: true, id, branch: id, repo_url: repoUrl });
  });
}
