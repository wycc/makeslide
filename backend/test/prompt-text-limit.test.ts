import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { setOpenAIClientForTest } from '../src/services/openai';
import { MAX_PROMPT_TO_OUTLINE_CHARS } from '../src/routes/pdfs/upload';
import { setSystemAuthSettings } from '../src/services/aiSettings';

setSystemAuthSettings({ googleAuthEnabled: false });

function mockPromptTextResponse(): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: '長提示詞測試簡報',
                  slides: [
                    { title: '第一頁', bullets: ['重點一', '重點二'] },
                    { title: '第二頁', bullets: ['重點一', '重點二'] },
                    { title: '第三頁', bullets: ['重點一', '重點二'] },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  } as never);
}

function mockPromptChatResponse(): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assistant_message: '已收到長篇對話內容，以下先整理成初版大綱。',
                  outline_text: 'Slide 1: 長篇對話測試\n- 重點一\n- 重點二\n\nSlide 2: 後續規劃\n- 重點一\n- 重點二',
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  } as never);
}

test('POST /api/prompt-text accepts prompts longer than 4000 chars up to 128K', async () => {
  const app = await buildApp();
  mockPromptTextResponse();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/prompt-text',
      headers: { 'content-type': 'application/json' },
      payload: { prompt: '請根據以下長篇需求產生大綱：' + '甲'.repeat(5000) },
    });

    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { id?: string; title?: string; status?: string };
    assert.ok(body.id);
    assert.equal(body.title, '長提示詞測試簡報');
    assert.equal(body.status, 'awaiting_prompt');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST /api/prompt-text rejects prompts over 128K with a clear validation error', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/prompt-text',
      headers: { 'content-type': 'application/json' },
      payload: { prompt: '乙'.repeat(MAX_PROMPT_TO_OUTLINE_CHARS + 1) },
    });

    assert.equal(resp.statusCode, 400);
    const body = resp.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.match(body.error.message, /prompt 不可超過 131072 字/);
  } finally {
    await app.close();
  }
});

test('POST /api/prompt-chat accepts message content longer than 4000 chars up to 128K', async () => {
  const app = await buildApp();
  mockPromptChatResponse();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/prompt-chat',
      headers: { 'content-type': 'application/json' },
      payload: {
        messages: [
          {
            role: 'user',
            content: '請延續以下長篇課程需求整理大綱：' + '丙'.repeat(5000),
          },
        ],
      },
    });

    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { assistant_message?: string; outline_text?: string };
    assert.equal(body.assistant_message, '已收到長篇對話內容，以下先整理成初版大綱。');
    assert.match(body.outline_text ?? '', /Slide 1: 長篇對話測試/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST /api/prompt-chat rejects message content over 128K with a clear validation error', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/prompt-chat',
      headers: { 'content-type': 'application/json' },
      payload: {
        messages: [
          {
            role: 'user',
            content: '丁'.repeat(MAX_PROMPT_TO_OUTLINE_CHARS + 1),
          },
        ],
      },
    });

    assert.equal(resp.statusCode, 400);
    const body = resp.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.match(body.error.message, /message content 不可超過 131072 字/);
  } finally {
    await app.close();
  }
});
