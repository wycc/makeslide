import type { FastifyInstance } from 'fastify';
import { canEditPdf } from './permissions';
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
  clampSemanticSearchMaxPdfs,
} from '../../services/aiSettings';
import { invalidateOpenAIClientCache, setOpenAIApiKeyRuntime, setOpenAIBaseUrlRuntime } from '../../services/openai';
import { getAccountWeeklyUsage } from '../../services/defaultSourceQuota';
import { currentAccountId } from '../../services/accountContext';
import { hasProviderKey, llmAvailability, missingKeyMessage, ttsAvailability } from '../../services/providerAvailability';
import { synthesizeTtsPreview } from '../../services/ttsPreview';
import {
  VOICE_REF_MAX_SECONDS,
  VoiceRefError,
  audioCppVoiceRefDir,
  saveAudioCppVoiceRef,
  writeVoiceRefTranscript,
} from '../../services/audiocppVoiceRef';
import { transcribeAudioBuffer } from '../../services/openai';
import { IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';
import { pushPresentationToGitHub } from '../../services/presentationGit';
import { SESSION_COOKIE, clearCookie, sessionSub } from '../auth';
import { db } from '../../db';
import type { PdfRow } from '../../types';
import {
  IdParamSchema,
  TtsPreviewBodySchema,
  UpdateSystemAiSettingsBodySchema,
  VoiceRefTranscriptBodySchema,
  errorResponse,
} from './shared';
import { DEFAULT_ACCOUNT_ID, sanitizeAccountId } from '../../services/accountContext';
import { removePdfDir, artifactCacheDir } from '../../services/storage';
import { config } from '../../config';
import path from 'node:path';
import { clearRegenerateJob } from '../../worker/regenerate';
import { clearAddPagesJob } from '../../worker/addPagesFromPrompt';
import { clearSyncSession } from './sync';

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
    has_openai_key: hasProviderKey(runtime, 'openai'),
    has_gemini_key: hasProviderKey(runtime, 'gemini'),
    has_cgu_air_key: hasProviderKey(runtime, 'cgu-air'),
    has_openrouter_key: hasProviderKey(runtime, 'openrouter'),
    // 「這類功能現在能不能用」的單一判斷來源，前端據此停用對應按鈕（見 useProviderStatus）。
    llm_enabled: llmAvailability(accountId).enabled,
    tts_enabled: ttsAvailability(accountId).enabled,
    llm_provider: runtime.llmProvider,
    tts_provider: runtime.ttsProvider,
    secondary_llm_provider: runtime.secondaryLlmProvider,
    secondary_tts_provider: runtime.secondaryTtsProvider,
    openai_llm_model: runtime.openaiLlmModel,
    gemini_llm_model: runtime.geminiLlmModel,
    cgu_air_llm_model: runtime.cguAirLlmModel,
    openrouter_llm_model: runtime.openrouterLlmModel,
    cgu_air_image_model: runtime.cguAirImageModel,
    openrouter_image_model: runtime.openrouterImageModel,
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
    openrouter_tts_model: runtime.openrouterTtsModel,
    openrouter_tts_speaker1: runtime.openrouterTtsSpeaker1,
    openrouter_tts_speaker2: runtime.openrouterTtsSpeaker2,
    openrouter_tts_speaker1_voice: runtime.openrouterTtsSpeaker1Voice,
    openrouter_tts_speaker2_voice: runtime.openrouterTtsSpeaker2Voice,
    audiocpp_tts_mode: runtime.audiocppTtsMode,
    audiocpp_tts_base_url: runtime.audiocppTtsBaseUrl,
    audiocpp_tts_bin: runtime.audiocppTtsBinPath,
    audiocpp_tts_model: runtime.audiocppTtsModel,
    audiocpp_tts_family: runtime.audiocppTtsFamily,
    audiocpp_tts_backend: runtime.audiocppTtsBackend,
    audiocpp_tts_speaker1: runtime.audiocppTtsSpeaker1,
    audiocpp_tts_speaker2: runtime.audiocppTtsSpeaker2,
    audiocpp_tts_speaker1_voice: runtime.audiocppTtsSpeaker1Voice,
    audiocpp_tts_speaker2_voice: runtime.audiocppTtsSpeaker2Voice,
    user_code: runtime.userCode,
    ui_language: runtime.uiLanguage,
    content_language: runtime.contentLanguage,
    github_repo_url: runtime.githubRepoUrl,
    github_token: runtime.githubToken,
    auto_generate_animation: runtime.autoGenerateAnimation,
    has_mcp_auth_token: runtime.mcpAuthToken.trim().length > 0,
    subtitle_sync_mode: runtime.subtitleSyncMode,
    monthly_budget_usd: runtime.monthlyBudgetUsd,
    semantic_search_max_pdfs: runtime.semanticSearchMaxPdfs,
    default_source_weekly_usage: getAccountWeeklyUsage(accountId),
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
    const llm = llmAvailability();
    const tts = ttsAvailability();
    return reply.code(200).send({
      // has_key 維持原義（選定的 LLM provider 自己有沒有 key），前端的 onboarding 提示看它；
      // llm_enabled/tts_enabled 才是「功能能不能用」——把次要 provider 的備援也算進去。
      has_key: llm.hasPrimaryKey,
      has_openai_key: hasProviderKey(runtime, 'openai'),
      has_gemini_key: hasProviderKey(runtime, 'gemini'),
      has_cgu_air_key: hasProviderKey(runtime, 'cgu-air'),
      has_openrouter_key: hasProviderKey(runtime, 'openrouter'),
      llm_provider: runtime.llmProvider,
      tts_provider: runtime.ttsProvider,
      llm_enabled: llm.enabled,
      tts_enabled: tts.enabled,
      secondary_llm_provider: runtime.secondaryLlmProvider,
      secondary_tts_provider: runtime.secondaryTtsProvider,
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
      secondaryLlmProvider: data.secondary_llm_provider,
      secondaryTtsProvider: data.secondary_tts_provider,
      openaiLlmModel: data.openai_llm_model,
      geminiLlmModel: data.gemini_llm_model,
      cguAirLlmModel: data.cgu_air_llm_model,
      openrouterLlmModel: data.openrouter_llm_model,
      cguAirImageModel: data.cgu_air_image_model,
      openrouterImageModel: data.openrouter_image_model,
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
      openrouterTtsModel: data.openrouter_tts_model,
      openrouterTtsSpeaker1: data.openrouter_tts_speaker1,
      openrouterTtsSpeaker2: data.openrouter_tts_speaker2,
      openrouterTtsSpeaker1Voice: data.openrouter_tts_speaker1_voice,
      openrouterTtsSpeaker2Voice: data.openrouter_tts_speaker2_voice,
      audiocppTtsMode: data.audiocpp_tts_mode,
      audiocppTtsBaseUrl: data.audiocpp_tts_base_url,
      audiocppTtsBinPath: data.audiocpp_tts_bin,
      audiocppTtsModel: data.audiocpp_tts_model,
      audiocppTtsFamily: data.audiocpp_tts_family,
      audiocppTtsBackend: data.audiocpp_tts_backend,
      audiocppTtsSpeaker1: data.audiocpp_tts_speaker1,
      audiocppTtsSpeaker2: data.audiocpp_tts_speaker2,
      audiocppTtsSpeaker1Voice: data.audiocpp_tts_speaker1_voice,
      audiocppTtsSpeaker2Voice: data.audiocpp_tts_speaker2_voice,
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
      monthlyBudgetUsd: data.monthly_budget_usd,
      semanticSearchMaxPdfs:
        typeof data.semantic_search_max_pdfs === 'number'
          ? clampSemanticSearchMaxPdfs(data.semantic_search_max_pdfs)
          : undefined,
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
  // Read one speaker's persona/voice aloud so it can be judged by ear before being saved.
  // `voice`/`persona` come from the form, not from storage: a preview of the stored value would
  // make you save an untested persona first, which is the opposite of what the button is for.
  app.post('/api/system/tts-preview', async (request, reply) => {
    const parsed = TtsPreviewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { provider, speaker, voice, persona } = parsed.data;
    const accountId = currentAccountId();
    if (!hasProviderKey(getRuntimeAiSettings(accountId), provider)) {
      return reply.code(422).send(errorResponse('API_KEY_MISSING', missingKeyMessage('TTS', provider)));
    }
    try {
      const preview = await synthesizeTtsPreview({ provider, speaker, voice, persona });
      return reply
        .code(200)
        .header('content-type', preview.contentType)
        // Which voice the fallback chain landed on — the UI can say so when the box is on
        // 「沿用設定」 and the name is therefore not visible anywhere on the form.
        .header('x-preview-voice', preview.voice)
        // A preview is generated fresh each time (the persona in the box may have just changed),
        // so letting a proxy or the browser hand back an earlier clip would be actively wrong.
        .header('cache-control', 'no-store')
        .send(preview.audio);
    } catch (err) {
      request.log.warn({ err, provider }, 'tts-preview: synthesis failed');
      return reply.code(502).send(errorResponse('TTS_FAILED', err instanceof Error ? err.message : String(err)));
    }
  });

  // 上傳語音複製用的參考音檔。存進這個帳號自己的 voice-refs/，回傳的絕對路徑就是聲音欄位要填的
  // 值——這個欄位一直都收路徑，只是在這台機器以外的地方沒人生得出檔案來。
  app.post('/api/system/audiocpp/voice-ref', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Expected multipart/form-data'));
    }
    let file;
    try {
      file = await request.file();
    } catch {
      return reply.code(413).send(errorResponse('INVALID_REQUEST', '參考音檔超過大小上限'));
    }
    if (!file) return reply.code(400).send(errorResponse('INVALID_REQUEST', '沒有收到音檔'));
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send(errorResponse('INVALID_REQUEST', '參考音檔超過大小上限'));
    }
    try {
      const saved = await saveAudioCppVoiceRef({
        accountId: currentAccountId(),
        buffer,
        filename: file.filename ?? 'voice',
      });
      // Qwen3-TTS Base will not clone without knowing what the clip says, so a transcript is not
      // optional here — it just doesn't have to be typed. Whisper's guess is a starting point the
      // user can correct; if there is no key for it, the field simply comes back empty.
      const provided = typeof file.fields.transcript === 'object' && file.fields.transcript && 'value' in file.fields.transcript
        ? String((file.fields.transcript as { value: unknown }).value ?? '')
        : '';
      let transcript = provided.trim();
      if (!transcript) {
        try {
          transcript = (await transcribeAudioBuffer(buffer, file.filename ?? 'voice.wav', file.mimetype || 'audio/wav')).trim();
        } catch (err) {
          request.log.info({ err }, 'voice-ref: auto-transcription unavailable, leaving it to the user');
        }
      }
      if (transcript) await writeVoiceRefTranscript(saved.path, transcript);
      return reply.code(200).send({
        path: saved.path,
        bytes: saved.bytes,
        seconds: Math.round(saved.seconds * 10) / 10,
        max_seconds: VOICE_REF_MAX_SECONDS,
        transcript,
      });
    } catch (err) {
      if (err instanceof VoiceRefError) {
        return reply.code(400).send(errorResponse('VOICE_REF_INVALID', err.message));
      }
      request.log.warn({ err }, 'voice-ref: upload failed');
      return reply.code(500).send(errorResponse('VOICE_REF_FAILED', err instanceof Error ? err.message : String(err)));
    }
  });

  // 校對逐字稿。Whisper 的結果只是起點，而唸錯一個字就會影響複製出來的聲音，所以要能改。
  app.put('/api/system/audiocpp/voice-ref/transcript', async (request, reply) => {
    const parsed = VoiceRefTranscriptBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid body'));
    }
    // 只認自己帳號的 voice-refs/ 底下的檔案：這個欄位收的是路徑，而路徑是使用者自己填的。
    const dir = audioCppVoiceRefDir(currentAccountId());
    const target = path.resolve(parsed.data.path);
    if (path.dirname(target) !== dir || !fs.existsSync(target)) {
      return reply.code(404).send(errorResponse('VOICE_REF_NOT_FOUND', '找不到這個參考音檔'));
    }
    await writeVoiceRefTranscript(target, parsed.data.transcript);
    return reply.code(200).send({ path: target, transcript: parsed.data.transcript.trim() });
  });

  app.post('/api/system/mcp-auth-token', async (_request, reply) => {
    const accountId = currentAccountId();
    const token = generateMcpAuthToken();
    setRuntimeAiSettings(accountId, { mcpAuthToken: token });
    await persistEnvSettings(accountId, { mcpAuthToken: token });
    return reply.code(200).send({ ok: true, token, has_mcp_auth_token: true });
  });

  // 顯示（不輪替）目前這個帳號已設定的 token 明文。登入者本來就能隨時產生一份等效憑證，
  // 讓他看自己的既有 token 不會擴大任何權限，卻能省下「忘了複製就得重新產生、順手作廢
  // 既有 MCP client 設定」的麻煩。`/api/system/ai-settings` 仍然只回布林值，明文只從這個
  // 明確要求顯示的端點吐出來。
  app.get('/api/system/mcp-auth-token', async (_request, reply) => {
    const accountId = currentAccountId();
    const token = getRuntimeAiSettings(accountId).mcpAuthToken.trim();
    return reply.code(200).send({
      ok: true,
      token: token.length > 0 ? token : null,
      has_mcp_auth_token: token.length > 0,
    });
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

  app.delete('/api/admin/cache', async (request, reply) => {
    const sub = sessionSub(request) ?? undefined;
    if (!isAdminAccount(sub)) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以清除生成快取'));
    }

    let dirsCleared = 0;
    let bytesFreed = 0;

    try {
      const pdfIds = await fs.promises.readdir(config.storageRoot).catch(() => [] as string[]);
      for (const pdfId of pdfIds) {
        const cacheDir = artifactCacheDir(pdfId);
        const stat = await fs.promises.stat(cacheDir).catch(() => null);
        if (!stat?.isDirectory()) continue;
        const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const entryPath = path.join(cacheDir, entry.name);
          const entryStat = await fs.promises.stat(entryPath).catch(() => null);
          if (entryStat) bytesFreed += entryStat.size;
        }
        await fs.promises.rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
        dirsCleared++;
      }
    } catch (err) {
      app.log.warn({ err }, 'admin-cache: scan failed');
      return reply.code(500).send(errorResponse('SCAN_FAILED', 'Failed to scan storage root'));
    }

    return reply.code(200).send({ ok: true, dirs_cleared: dirsCleared, bytes_freed: bytesFreed });
  });

  app.delete('/api/system/thumbnail-cache', async (request, reply) => {
    const sub = sessionSub(request) ?? undefined;
    if (!isAdminAccount(sub)) {
      return reply.code(403).send(errorResponse('ADMIN_REQUIRED', '只有 admin 可以清除縮圖快取'));
    }

    let filesDeleted = 0;
    let bytesFreed = 0;

    try {
      const pdfIds = await fs.promises.readdir(config.storageRoot);
      for (const pdfId of pdfIds) {
        const dir = path.join(config.storageRoot, pdfId);
        const stat = await fs.promises.stat(dir).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const coverThumb = path.join(dir, 'cover.thumb.jpg');
        const coverStat = await fs.promises.stat(coverThumb).catch(() => null);
        if (coverStat) {
          bytesFreed += coverStat.size;
          await fs.promises.unlink(coverThumb).catch(() => undefined);
          filesDeleted++;
        }

        const pagesDir = path.join(dir, 'pages');
        const pagesDirStat = await fs.promises.stat(pagesDir).catch(() => null);
        if (pagesDirStat?.isDirectory()) {
          const pageFiles = await fs.promises.readdir(pagesDir).catch(() => [] as string[]);
          for (const file of pageFiles) {
            if (!file.endsWith('.thumb.jpg')) continue;
            const thumbPath = path.join(pagesDir, file);
            const thumbStat = await fs.promises.stat(thumbPath).catch(() => null);
            if (thumbStat) {
              bytesFreed += thumbStat.size;
              await fs.promises.unlink(thumbPath).catch(() => undefined);
              filesDeleted++;
            }
          }
        }
      }
    } catch (err) {
      app.log.warn({ err }, 'thumbnail-cache: scan failed');
      return reply.code(500).send(errorResponse('SCAN_FAILED', 'Failed to scan storage root'));
    }

    return reply.code(200).send({ ok: true, files_deleted: filesDeleted, bytes_freed: bytesFreed });
  });
}
