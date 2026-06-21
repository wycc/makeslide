import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
import { invalidateOpenAIClientCache, setOpenAIApiKeyRuntime, setOpenAIBaseUrlRuntime } from '../../services/openai';
import { currentAccountId } from '../../services/accountContext';
import { IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { pushPresentationToGitHub } from '../../services/presentationGit';
import { SESSION_COOKIE, clearCookie, decodeSession, parseCookies } from '../auth';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import { IdParamSchema, UpdateSystemAiSettingsBodySchema, errorResponse } from './shared';
import { DEFAULT_ACCOUNT_ID, sanitizeAccountId } from '../../services/accountContext';
import { removePdfDir } from '../../services/storage';
import { clearRegenerateJob } from '../../worker/regenerate';
import { clearAddPagesJob } from '../../worker/addPagesFromPrompt';
import { clearSyncSession } from './sync';

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

const DeleteAccountBodySchema = z.object({
  account_id: z.string().trim().min(1).max(256),
});

const DeleteSelfAccountBodySchema = z.object({
  confirm: z.literal(true),
});

const UpdateOpenAiApiKeyBodySchema = z.object({
  api_key: z.string().optional(),
});

const SYSTEM_AUTH_SETTING_KEYS = [
  'google_auth_enabled',
  'google_client_id',
  'google_client_secret',
  'google_redirect_uri',
] as const;

export function generateMcpAuthToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

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
    cgu_air_api_key: runtime.cguAirApiKey,
    cgu_air_base_url: runtime.cguAirBaseUrl,
    openrouter_api_key: runtime.openrouterApiKey,
    openrouter_base_url: runtime.openrouterBaseUrl,
    has_openai_key: runtime.openaiApiKey.trim().length > 0,
    has_gemini_key: runtime.geminiApiKey.trim().length > 0,
    has_cgu_air_key: runtime.cguAirApiKey.trim().length > 0,
    has_openrouter_key: runtime.openrouterApiKey.trim().length > 0,
    llm_provider: runtime.llmProvider,
    tts_provider: runtime.ttsProvider,
    openai_llm_model: runtime.openaiLlmModel,
    gemini_llm_model: runtime.geminiLlmModel,
    cgu_air_llm_model: runtime.cguAirLlmModel,
    openrouter_llm_model: runtime.openrouterLlmModel,
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
    has_mcp_auth_token: runtime.mcpAuthToken.trim().length > 0,
    subtitle_sync_mode: runtime.subtitleSyncMode,
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

async function removeAccountDir(accountId: string): Promise<void> {
  const location = getAccountSettingsLocation(accountId);
  if (location.accountId !== accountId) {
    throw new Error('Refusing to remove a mismatched account directory');
  }
  await fs.promises.rm(location.accountDir, { recursive: true, force: true });
}

async function deleteAccountData(targetAccountId: string): Promise<{ deleted_pdfs: string[]; deleted_pdf_count: number; account_deleted: boolean }> {
  const rows = db.prepare(`SELECT id FROM pdfs WHERE owner_sub = ? ORDER BY created_at ASC`).all(targetAccountId) as Array<{ id: string }>;
  const pdfIds = rows.map((row) => row.id);
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
    }
  });
  tx(pdfIds);

  for (const id of pdfIds) {
    await removePdfDir(id);
    clearRegenerateJob(id);
    clearAddPagesJob(id);
    clearSyncSession(id);
  }
  await removeAccountDir(targetAccountId);

  return { deleted_pdfs: pdfIds, deleted_pdf_count: pdfIds.length, account_deleted: true };
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
    const hasOpenAiKey = runtime.openaiApiKey.trim().length > 0;
    const hasGeminiKey = runtime.geminiApiKey.trim().length > 0;
    const hasCguAirKey = runtime.cguAirApiKey.trim().length > 0;
    const hasOpenrouterKey = runtime.openrouterApiKey.trim().length > 0;
    const hasSelectedLlmKey =
      (runtime.llmProvider === 'openai' && hasOpenAiKey)
      || (runtime.llmProvider === 'gemini' && hasGeminiKey)
      || (runtime.llmProvider === 'cgu-air' && hasCguAirKey)
      || (runtime.llmProvider === 'openrouter' && hasOpenrouterKey);
    return reply.code(200).send({
      has_key: hasSelectedLlmKey,
      has_openai_key: hasOpenAiKey,
      has_gemini_key: hasGeminiKey,
      has_cgu_air_key: hasCguAirKey,
      has_openrouter_key: hasOpenrouterKey,
      llm_provider: runtime.llmProvider,
      tts_provider: runtime.ttsProvider,
    });
  });

  app.patch('/api/system/openai-api-key', async (request, reply) => {
    const parsed = UpdateOpenAiApiKeyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const apiKey = (parsed.data.api_key ?? '').trim();
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
      cguAirApiKey: data.cgu_air_api_key,
      cguAirBaseUrl: data.cgu_air_base_url,
      openrouterApiKey: data.openrouter_api_key,
      openrouterBaseUrl: data.openrouter_base_url,
      llmProvider: data.llm_provider,
      ttsProvider: data.tts_provider,
      openaiLlmModel: data.openai_llm_model,
      geminiLlmModel: data.gemini_llm_model,
      cguAirLlmModel: data.cgu_air_llm_model,
      openrouterLlmModel: data.openrouter_llm_model,
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
      subtitleSyncMode: data.subtitle_sync_mode,
    };
    if (typeof next.openaiApiKey === 'string') setOpenAIApiKeyRuntime(accountId, next.openaiApiKey);
    if (typeof next.openaiBaseUrl === 'string') setOpenAIBaseUrlRuntime(accountId, next.openaiBaseUrl);
    // cgu-air/openrouter have no override layer of their own (unlike openai above) — their
    // cached client must be invalidated explicitly or a previously-cached client keeps using
    // the old key/baseURL until the server restarts.
    if (typeof next.cguAirApiKey === 'string' || typeof next.cguAirBaseUrl === 'string') {
      invalidateOpenAIClientCache(accountId, 'cgu-air');
    }
    if (typeof next.openrouterApiKey === 'string' || typeof next.openrouterBaseUrl === 'string') {
      invalidateOpenAIClientCache(accountId, 'openrouter');
    }
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

  app.delete('/api/system/accounts/:account_id', async (request, reply) => {
    const accountId = currentAccountId();
    if (!isAdminAccount(accountId)) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以刪除帳號'));
    }
    const parsed = DeleteAccountBodySchema.safeParse(request.params ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid account id'));
    }

    const targetAccountId = sanitizeAccountId(parsed.data.account_id);
    if (targetAccountId === DEFAULT_ACCOUNT_ID) {
      return reply.code(400).send(errorResponse('DANGEROUS_ACCOUNT', '不能刪除 default 帳號'));
    }
    if (targetAccountId === accountId) {
      return reply.code(400).send(errorResponse('DANGEROUS_ACCOUNT', '不能刪除目前登入的 admin 帳號'));
    }
    if (isAdminAccount(targetAccountId)) {
      return reply.code(400).send(errorResponse('DANGEROUS_ACCOUNT', '不能刪除 admin 帳號；請先移交或移除 admin 權限'));
    }

    const result = await deleteAccountData(targetAccountId);
    return reply.code(200).send({ ok: true, account_id: targetAccountId, ...result });
  });

  // 自助刪除：任何登入的非 admin、非 default 帳號都能刪除自己的帳號與其擁有的所有簡報，
  // 不需要 admin 權限——目標永遠是「目前登入的帳號」本身，沒有指定其他帳號的風險。
  app.delete('/api/system/account', async (request, reply) => {
    const parsed = DeleteSelfAccountBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const accountId = currentAccountId();
    if (accountId === DEFAULT_ACCOUNT_ID) {
      return reply.code(400).send(errorResponse('DANGEROUS_ACCOUNT', '尚未登入或為預設帳號，無法刪除'));
    }
    if (isAdminAccount(accountId)) {
      return reply.code(400).send(errorResponse('DANGEROUS_ACCOUNT', '目前是 admin 帳號，無法刪除；請先在「系統管理」移交 admin 權限'));
    }

    const result = await deleteAccountData(accountId);
    clearCookie(reply, SESSION_COOKIE);
    return reply.code(200).send({ ok: true, account_id: accountId, ...result });
  });

  // 每個帳號各自一份 MCP auth token，任何登入的帳號都能產生/輪替自己的 token，
  // 不需要 admin 權限——這是個人用來讓自己的 MCP client 以自己的帳號身分操作的
  // 憑證，跟系統層級設定（Google 登入、admin 名單）是不同性質的東西。
  app.post('/api/system/mcp-auth-token', async (_request, reply) => {
    const accountId = currentAccountId();
    const token = generateMcpAuthToken();
    setRuntimeAiSettings(accountId, { mcpAuthToken: token });
    await persistEnvSettings(accountId, { mcpAuthToken: token });
    return reply.code(200).send({ ok: true, token, has_mcp_auth_token: true });
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
