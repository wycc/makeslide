import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { config } from '../src/config';
import { db } from '../src/db';
import { setRuntimeAiSettings, setSystemAuthSettings, type LlmProvider, type TtsProvider } from '../src/services/aiSettings';
import { llmAvailability, ttsAvailability } from '../src/services/providerAvailability';
import { runWithAccountId } from '../src/services/accountContext';

function makeSessionCookie(sub: string): string {
  const session = { provider: 'google', sub, email: `${sub}@example.com` };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const ACCOUNT = 'provider-availability-account';
const HEADERS = { cookie: `makeslide_session=${encodeURIComponent(makeSessionCookie(ACCOUNT))}` };

function setProviders(opts: {
  llmProvider?: LlmProvider;
  ttsProvider?: TtsProvider;
  secondaryLlmProvider?: LlmProvider | '';
  secondaryTtsProvider?: TtsProvider | '';
  openaiApiKey?: string;
  geminiApiKey?: string;
  cguAirApiKey?: string;
  openrouterApiKey?: string;
}): void {
  setRuntimeAiSettings(ACCOUNT, {
    llmProvider: 'openai',
    ttsProvider: 'openai',
    secondaryLlmProvider: '',
    secondaryTtsProvider: '',
    openaiApiKey: '',
    geminiApiKey: '',
    cguAirApiKey: '',
    openrouterApiKey: '',
    ...opts,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string, status: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,?,1,NULL,NULL,NULL,NULL,NULL,0,?,?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, status, ACCOUNT, 'private', t, t);
}

test('llmAvailability/ttsAvailability report a provider as usable only when its own key is set', () => {
  setProviders({ llmProvider: 'gemini', ttsProvider: 'gemini' });
  runWithAccountId(ACCOUNT, () => {
    assert.equal(llmAvailability().enabled, false);
    assert.equal(ttsAvailability().enabled, false);
  });

  // OpenAI 有 key 不代表選定的 Gemini 就能用——每個 provider 各認自己那把 key。
  setProviders({ llmProvider: 'gemini', ttsProvider: 'gemini', openaiApiKey: 'sk-openai' });
  runWithAccountId(ACCOUNT, () => {
    assert.equal(llmAvailability().enabled, false);
    assert.equal(ttsAvailability().enabled, false);
  });

  setProviders({ llmProvider: 'gemini', ttsProvider: 'gemini', geminiApiKey: 'gemini-key' });
  runWithAccountId(ACCOUNT, () => {
    assert.equal(llmAvailability().enabled, true);
    assert.equal(ttsAvailability().enabled, true);
  });
});

test('a configured secondary provider with a key keeps the feature enabled', () => {
  // 主要 provider 沒 key 時流程會 failover 到次要 provider（isPermanentProviderError 認得
  // ApiKeyMissingError），所以功能仍然可用，不該整組停掉。
  setProviders({
    llmProvider: 'gemini',
    secondaryLlmProvider: 'openai',
    openaiApiKey: 'sk-openai',
    ttsProvider: 'gemini',
    secondaryTtsProvider: 'openai',
  });
  runWithAccountId(ACCOUNT, () => {
    const llm = llmAvailability();
    assert.equal(llm.hasPrimaryKey, false);
    assert.equal(llm.hasSecondaryKey, true);
    assert.equal(llm.enabled, true);
    assert.equal(ttsAvailability().enabled, true);
  });
});

test('GET /api/system/openai-key-status reports llm_enabled/tts_enabled per provider', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [] });
  setProviders({ llmProvider: 'openai', ttsProvider: 'gemini', openaiApiKey: 'sk-openai' });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/openai-key-status', headers: HEADERS });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { llm_enabled: boolean; tts_enabled: boolean; has_key: boolean };
    assert.equal(body.llm_enabled, true);
    assert.equal(body.tts_enabled, false);
    assert.equal(body.has_key, true);
  } finally {
    await app.close();
  }
});

test('LLM entry points are refused with API_KEY_MISSING before any work starts', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [] });
  setProviders({ llmProvider: 'openai', ttsProvider: 'openai' });
  seedPdf('provider-guard-start', 'awaiting_prompt');
  const app = await buildApp();
  try {
    const start = await app.inject({
      method: 'POST',
      url: '/api/pdfs/provider-guard-start/start',
      headers: HEADERS,
      payload: { prompt: '' },
    });
    assert.equal(start.statusCode, 400);
    assert.equal((start.json() as { error: { code: string } }).error.code, 'API_KEY_MISSING');

    // 被擋下來的請求不能留下任何副作用：簡報必須還停在 awaiting_prompt，而不是 processing/failed。
    const row = db.prepare(`SELECT status FROM pdfs WHERE id = ?`).get('provider-guard-start') as { status: string };
    assert.equal(row.status, 'awaiting_prompt');

    const promptText = await app.inject({
      method: 'POST',
      url: '/api/prompt-text',
      headers: HEADERS,
      payload: { prompt: '幫我做一份三頁的簡報' },
    });
    assert.equal(promptText.statusCode, 400);
    assert.equal((promptText.json() as { error: { code: string } }).error.code, 'API_KEY_MISSING');
  } finally {
    await app.close();
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run('provider-guard-start');
  }
});

test('an LLM entry point is allowed again once the selected provider has a key', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [] });
  setProviders({ llmProvider: 'openai', ttsProvider: 'openai', openaiApiKey: 'sk-openai' });
  seedPdf('provider-guard-ok', 'awaiting_prompt');
  const app = await buildApp();
  try {
    const start = await app.inject({
      method: 'POST',
      url: '/api/pdfs/provider-guard-ok/start',
      headers: HEADERS,
      payload: { prompt: '' },
    });
    // 有 key 就不該再被這道守門擋住（實際生成是否成功由 pipeline 決定，這裡只確認沒有 400）。
    assert.notEqual(start.statusCode, 400);
  } finally {
    await app.close();
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run('provider-guard-ok');
  }
});

test('regenerate refuses an audio-only request without a TTS key, but allows a mixed one', async () => {
  setSystemAuthSettings({ googleAuthEnabled: false, adminAccountIds: [] });
  setProviders({ llmProvider: 'openai', ttsProvider: 'gemini', openaiApiKey: 'sk-openai' });
  seedPdf('provider-guard-regen', 'ready');
  const app = await buildApp();
  try {
    const audioOnly = await app.inject({
      method: 'POST',
      url: '/api/pdfs/provider-guard-regen/regenerate',
      headers: HEADERS,
      payload: { audio: {} },
    });
    assert.equal(audioOnly.statusCode, 400);
    assert.equal((audioOnly.json() as { error: { code: string } }).error.code, 'API_KEY_MISSING');

    // 腳本＋語音：腳本做得到，就不該整批擋掉（語音由 regenerate job 自行略過）。
    const mixed = await app.inject({
      method: 'POST',
      url: '/api/pdfs/provider-guard-regen/regenerate',
      headers: HEADERS,
      payload: { scripts: {}, audio: {} },
    });
    assert.notEqual(mixed.statusCode, 400);
  } finally {
    await app.close();
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run('provider-guard-regen');
  }
});
