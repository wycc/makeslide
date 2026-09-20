import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

// Regression for the demo failures of 2026-09-08 … 09-18: the quiz prompts described every field
// except the stem, so the model returned questions with no `question` (and, when editing, no
// `type`). Both prompts must now spell out the full per-question object.

function sessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${signature}`)}`;
}
const OWNER = { cookie: sessionCookie('qgp-owner'), 'content-type': 'application/json' };
setSystemAuthSettings({ googleAuthEnabled: false });

function seedPdf(id: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'qgp-owner','private',?,?)`,
  ).run(id, 't', `${id}.pdf`, t, t);
}

type Msg = { role: string; content: string };

function systemPromptOf(messages: Msg[]): string {
  return messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
}

const VALID_QUESTION = { type: 'single', question: 'Q?', options: ['A', 'B'], answer_indices: [0], explanation: 'because' };

test('the generate prompt names every per-question field, including `question`', async () => {
  seedPdf('qgp-generate');
  const calls: Msg[][] = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Msg[] }) => {
          calls.push(args.messages);
          return {
            choices: [{ message: { content: JSON.stringify({ title: 'T', questions: [VALID_QUESTION] }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
  try {
    const app = await buildApp();
    try {
      const resp = await app.inject({ method: 'POST', url: '/api/pdfs/qgp-generate/quizzes/generate', headers: OWNER, payload: { prompt: '出五題' } });
      assert.equal(resp.statusCode, 200);
    } finally {
      await app.close();
    }
    const sys = systemPromptOf(calls[0]!);
    for (const field of ['"type"', '"question"', '"options"', '"answer_indices"', '"explanation"']) {
      assert.ok(sys.includes(field), `generate prompt must name ${field}`);
    }
    assert.match(sys, /必填/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('the edit prompt names every per-question field, including `type` and `id`', async () => {
  seedPdf('qgp-edit');
  const calls: Msg[][] = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Msg[] }) => {
          calls.push(args.messages);
          return {
            choices: [{ message: { content: JSON.stringify({ title: 'T', changed_questions: [{ id: 'q1', ...VALID_QUESTION }], removed_question_ids: [] }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
  try {
    const app = await buildApp();
    try {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/pdfs/qgp-edit/quizzes/generate',
        headers: OWNER,
        payload: { prompt: '改第一題', existing_questions: [{ id: 'q1', ...VALID_QUESTION, options: [{ text: 'A' }, { text: 'B' }] }] },
      });
      assert.equal(resp.statusCode, 200);
    } finally {
      await app.close();
    }
    const sys = systemPromptOf(calls[0]!);
    for (const field of ['"id"', '"type"', '"question"', '"options"', '"answer_indices"', '"explanation"']) {
      assert.ok(sys.includes(field), `edit prompt must name ${field}`);
    }
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('a first answer without `question` is corrected on the retry instead of failing the request', async () => {
  seedPdf('qgp-retry');
  const calls: Msg[][] = [];
  const { question: _dropped, ...stemless } = VALID_QUESTION;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Msg[] }) => {
          calls.push(args.messages);
          const questions = calls.length === 1 ? [stemless] : [VALID_QUESTION];
          return {
            choices: [{ message: { content: JSON.stringify({ title: 'T', questions }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
  try {
    const app = await buildApp();
    try {
      const resp = await app.inject({ method: 'POST', url: '/api/pdfs/qgp-retry/quizzes/generate', headers: OWNER, payload: { prompt: '出題' } });
      assert.equal(resp.statusCode, 200);
      assert.equal((resp.json() as { questions: Array<{ question: string }> }).questions[0]?.question, 'Q?');
    } finally {
      await app.close();
    }
    assert.equal(calls.length, 2);
    const last = calls[1]![calls[1]!.length - 1]!;
    assert.equal(last.role, 'user');
    assert.match(last.content, /questions[\s\S]*0[\s\S]*question/, 'retry must tell the model which field was missing');
  } finally {
    setOpenAIClientForTest(null);
  }
});
