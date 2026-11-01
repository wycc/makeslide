import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { applyQuestionEdit } from '../src/routes/pdfs/quizzes';

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

function fakeModel(replies: unknown[], calls: Msg[][]): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Msg[] }) => {
          calls.push(args.messages);
          return {
            choices: [{ message: { content: JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
}

const DRAFT = { id: 'q7', type: 'single', question: '原題目', options: [{ text: '甲' }, { text: '' }], answer_indices: [0], explanation: '原解析', score: 15, page_number: 3 };

test('editing one question sends only that question and keeps its id, score and page', async () => {
  seedPdf('qgp-edit-one');
  const calls: Msg[][] = [];
  fakeModel([{ question: { id: 'other', type: 'multiple', question: '新題目', options: ['甲', '乙', '丙'], answer_indices: [0, 2, 5], explanation: '', score: 99, page_number: 8 } }], calls);
  try {
    const app = await buildApp();
    try {
      const resp = await app.inject({ method: 'POST', url: '/api/pdfs/qgp-edit-one/quizzes/edit-question', headers: OWNER, payload: { prompt: '改成複選', question: DRAFT } });
      assert.equal(resp.statusCode, 200, resp.body);
      const { question } = resp.json() as { question: Record<string, unknown> };
      assert.equal(question.question, '新題目');
      assert.equal(question.type, 'multiple');
      assert.deepEqual(question.options, [{ text: '甲' }, { text: '乙' }, { text: '丙' }], 'options stay in the order given');
      assert.deepEqual(question.answer_indices, [0, 2], 'an answer past the options is dropped');
      assert.equal(question.id, 'q7');
      assert.equal(question.score, 15);
      assert.equal(question.page_number, 3);
      assert.equal(question.explanation, '原解析', 'a field the model dropped keeps its text');
    } finally {
      await app.close();
    }
    const user = calls[0]!.find((m) => m.role === 'user')!.content as string;
    assert.ok(user.includes('改成複選') && user.includes('原題目'));
    assert.ok(user.includes('第 3 頁'));
    assert.ok(systemPromptOf(calls[0]!).includes('"answer_indices"'));
    assert.match(systemPromptOf(calls[0]!), /除非老師的指示明確指定選項數量，否則選擇題一律剛好 5 個選項/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('a choice question left short of options is retried, and a failed edit is a clean 502', async () => {
  seedPdf('qgp-retry');
  const calls: Msg[][] = [];
  fakeModel([{ question: { type: 'single', question: '只有一個選項', options: ['甲'], answer_indices: [0], explanation: 'x' } }, { question: { type: 'single', question: '好了', options: ['甲', '乙'], answer_indices: [1], explanation: 'x' } }], calls);
  try {
    const app = await buildApp();
    try {
      const ok = await app.inject({ method: 'POST', url: '/api/pdfs/qgp-retry/quizzes/edit-question', headers: OWNER, payload: { prompt: '改', question: DRAFT } });
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(calls.length, 2);
      assert.equal((ok.json() as { question: { question: string } }).question.question, '好了');

      setOpenAIClientForTest({ chat: { completions: { create: async () => { throw new Error('credit_balance_exhausted'); } } } } as never);
      const failed = await app.inject({ method: 'POST', url: '/api/pdfs/qgp-retry/quizzes/edit-question', headers: OWNER, payload: { prompt: '改', question: DRAFT } });
      assert.equal(failed.statusCode, 502);
      const denied = await app.inject({ method: 'POST', url: '/api/pdfs/qgp-retry/quizzes/edit-question', payload: { prompt: '改', question: DRAFT } });
      assert.ok(denied.statusCode === 401 || denied.statusCode === 403, 'only an editor may spend the model on this deck');
    } finally {
      await app.close();
    }
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('an essay keeps its marking notes unless the rewrite supplies new ones, and a change to choice drops them', () => {
  const essay = { id: 'q1', type: 'essay' as const, question: '說明', options: [], answer_indices: [], explanation: '', reference_answer: '重點', score: 10, page_number: null };
  assert.equal(applyQuestionEdit(essay, { ...essay, question: '再說明', reference_answer: '' }).reference_answer, '重點');
  assert.equal(applyQuestionEdit(essay, { ...essay, reference_answer: '新重點' }).reference_answer, '新重點');
  const choice = applyQuestionEdit(essay, { ...essay, type: 'single', options: [{ text: '甲' }, { text: '乙' }], answer_indices: [1] });
  assert.equal(choice.reference_answer, '');
  assert.deepEqual(choice.answer_indices, [1]);
});
