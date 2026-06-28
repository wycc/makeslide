import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-2'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedQuizPdf(pdfId: string, visibility: 'private' | 'public' | 'public_editable' = 'public'): void {
  const t = nowIso();
  db.prepare(`DELETE FROM quiz_sets WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdf_shares WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,'account-1',?,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, visibility, t, t);
}

function seedShareToken(pdfId: string, token: string, access: 'read_only' | 'editable' = 'read_only'): void {
  const t = nowIso();
  db.prepare(`INSERT INTO pdf_shares (pdf_id, token, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(pdfId, token, access, t, t);
}

function validQuizPayload() {
  return {
    title: '測驗一',
    prompt: '',
    questions: [
      {
        id: 'q1',
        type: 'single',
        question: '1+1=?',
        options: [{ text: '1' }, { text: '2' }],
        answer_indices: [1],
        explanation: '',
      },
    ],
  };
}

test('POST /quizzes/generate rejects a non-owner request on a read-only shared presentation', async () => {
  seedQuizPdf('quiz-generate-readonly-01', 'public');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-generate-readonly-01/quizzes/generate',
    headers: OTHER_HEADERS,
    payload: { prompt: 'make a quiz' },
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('POST /quizzes/generate allows the owner past the permission check', async () => {
  seedQuizPdf('quiz-generate-owner-01', 'private');
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: { content: JSON.stringify({ title: '測驗', questions: [{ type: 'single', question: 'Q?', options: ['A', 'B'], answer_indices: [0] }] }) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    },
  } as never);
  try {
    const app = await buildApp();
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-generate-owner-01/quizzes/generate',
      headers: OWNER_HEADERS,
      payload: { prompt: 'make a quiz' },
    });
    assert.equal(resp.statusCode, 200);
    await app.close();
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('POST /quizzes rejects a non-owner request and returns 404 for an unknown presentation', async () => {
  seedQuizPdf('quiz-create-readonly-01', 'public');
  const app = await buildApp();
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-readonly-01/quizzes',
    headers: OTHER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal((forbidden.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const count = db.prepare(`SELECT COUNT(*) as c FROM quiz_sets WHERE pdf_id = ?`).get('quiz-create-readonly-01') as { c: number };
  assert.equal(count.c, 0);

  const missing = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-missing-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(missing.statusCode, 404);

  await app.close();
});

test('POST /quizzes allows the owner and a read-write collaborator to create a quiz', async () => {
  seedQuizPdf('quiz-create-owner-01', 'private');
  const app = await buildApp();
  const ownerResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-owner-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(ownerResp.statusCode, 201);

  seedQuizPdf('quiz-create-editable-01', 'public_editable');
  const editableResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-create-editable-01/quizzes',
    headers: OTHER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(editableResp.statusCode, 201);

  await app.close();
});

test('PUT /quizzes/:quizId rejects a non-owner request and allows the owner', async () => {
  seedQuizPdf('quiz-update-01', 'public');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-update-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(createResp.statusCode, 201);
  const quizId = (createResp.json() as { id: number }).id;

  const forbidden = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/quiz-update-01/quizzes/${quizId}`,
    headers: OTHER_HEADERS,
    payload: { ...validQuizPayload(), title: '改過的標題' },
  });
  assert.equal(forbidden.statusCode, 403);
  const unchanged = db.prepare(`SELECT title FROM quiz_sets WHERE id = ?`).get(quizId) as { title: string };
  assert.equal(unchanged.title, '測驗一');

  const allowed = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/quiz-update-01/quizzes/${quizId}`,
    headers: OWNER_HEADERS,
    payload: { ...validQuizPayload(), title: '改過的標題' },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal((allowed.json() as { title: string }).title, '改過的標題');

  await app.close();
});

test('DELETE /quizzes/:quizId rejects a non-owner request, then allows the owner to delete it (cascading attempts)', async () => {
  seedQuizPdf('quiz-delete-01', 'public');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-delete-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  assert.equal(createResp.statusCode, 201);
  const quizId = (createResp.json() as { id: number }).id;

  const attemptResp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/quiz-delete-01/quizzes/${quizId}/attempts`,
    headers: OTHER_HEADERS,
    payload: { client_id: 'client-1', session_id: 'session-1', answers: { q1: [1] } },
  });
  assert.equal(attemptResp.statusCode, 201);

  const forbidden = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/quiz-delete-01/quizzes/${quizId}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal((forbidden.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const stillThere = db.prepare(`SELECT id FROM quiz_sets WHERE id = ?`).get(quizId);
  assert.ok(stillThere);

  const allowed = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/quiz-delete-01/quizzes/${quizId}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(allowed.statusCode, 204);
  const gone = db.prepare(`SELECT id FROM quiz_sets WHERE id = ?`).get(quizId);
  assert.equal(gone, undefined);
  const attemptsGone = db.prepare(`SELECT COUNT(*) as c FROM quiz_attempts WHERE quiz_id = ?`).get(quizId) as { c: number };
  assert.equal(attemptsGone.c, 0);

  await app.close();
});

test('DELETE /quizzes/:quizId rejects a fully anonymous request (no session cookie) on a public_editable presentation', async () => {
  seedQuizPdf('quiz-delete-editable-anon-01', 'public_editable');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-delete-editable-anon-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  const quizId = (createResp.json() as { id: number }).id;

  // No `headers` at all: a visitor who never logged in and holds no share token, just knows the
  // pdf id and a quiz id. public_editable is meant to let signed-in collaborators edit content,
  // not let anonymous requests delete a whole quiz (and cascade-delete every student's attempts).
  const resp = await app.inject({ method: 'DELETE', url: `/api/pdfs/quiz-delete-editable-anon-01/quizzes/${quizId}` });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  const stillThere = db.prepare(`SELECT id FROM quiz_sets WHERE id = ?`).get(quizId);
  assert.ok(stillThere);

  await app.close();
});

test('DELETE /quizzes/:quizId allows a read-write collaborator on a public_editable presentation', async () => {
  seedQuizPdf('quiz-delete-editable-collab-01', 'public_editable');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-delete-editable-collab-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  const quizId = (createResp.json() as { id: number }).id;

  const resp = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/quiz-delete-editable-collab-01/quizzes/${quizId}`,
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 204);

  await app.close();
});

test('DELETE /quizzes/:quizId returns 404 for an unknown quiz id or a mismatched pdf id', async () => {
  seedQuizPdf('quiz-delete-missing-01', 'public');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-delete-missing-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  const quizId = (createResp.json() as { id: number }).id;

  const wrongQuizId = await app.inject({
    method: 'DELETE',
    url: '/api/pdfs/quiz-delete-missing-01/quizzes/999999',
    headers: OWNER_HEADERS,
  });
  assert.equal(wrongQuizId.statusCode, 404);
  assert.equal((wrongQuizId.json() as { error: { code: string } }).error.code, 'QUIZ_NOT_FOUND');

  seedQuizPdf('quiz-delete-other-pdf-01', 'public');
  const crossPdf = await app.inject({
    method: 'DELETE',
    url: `/api/pdfs/quiz-delete-other-pdf-01/quizzes/${quizId}`,
    headers: OWNER_HEADERS,
  });
  assert.equal(crossPdf.statusCode, 404);

  await app.close();
});

test('POST /quizzes/:quizId/attempts is not gated by edit permission so followers can submit answers', async () => {
  seedQuizPdf('quiz-attempt-01', 'public');
  const app = await buildApp();
  const createResp = await app.inject({
    method: 'POST',
    url: '/api/pdfs/quiz-attempt-01/quizzes',
    headers: OWNER_HEADERS,
    payload: validQuizPayload(),
  });
  const quizId = (createResp.json() as { id: number }).id;

  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/quiz-attempt-01/quizzes/${quizId}/attempts`,
    headers: OTHER_HEADERS,
    payload: { client_id: 'client-1', session_id: 'session-1', answers: { q1: [1] } },
  });
  assert.equal(resp.statusCode, 201);

  await app.close();
});

test('POST /quizzes/:quizId/attempts still requires at least read access to a private presentation', async () => {
  seedQuizPdf('quiz-attempt-readperm-01', 'private');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-attempt-readperm-01/quizzes',
      headers: OWNER_HEADERS,
      payload: validQuizPayload(),
    });
    const quizId = (createResp.json() as { id: number }).id;

    const noAccess = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-attempt-readperm-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-1', session_id: 'session-1', answers: { q1: [1] } },
    });
    assert.equal(noAccess.statusCode, 403);
    assert.equal((noAccess.json() as { error: { code: string } }).error.code, 'FORBIDDEN');

    const ownerSubmit = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-attempt-readperm-01/quizzes/${quizId}/attempts`,
      headers: OWNER_HEADERS,
      payload: { client_id: 'client-2', session_id: 'session-2', answers: { q1: [1] } },
    });
    assert.equal(ownerSubmit.statusCode, 201);
  } finally {
    await app.close();
  }
});

test('GET /quizzes rejects a non-owner request on a private presentation', async () => {
  seedQuizPdf('quiz-read-priv-01', 'private');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/quiz-read-priv-01/quizzes',
    headers: OTHER_HEADERS,
  });
  assert.equal(resp.statusCode, 403);
  assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  await app.close();
});

test('GET /quizzes returns 404 for an unknown pdf id', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/quiz-read-missing-01/quizzes',
    headers: OWNER_HEADERS,
  });
  assert.equal(resp.statusCode, 404);
  await app.close();
});

test('GET /quizzes allows the owner, a reader on a public presentation, and a share-token holder', async () => {
  seedQuizPdf('quiz-read-owner-01', 'private');
  const app = await buildApp();
  try {
    const ownerResp = await app.inject({
      method: 'GET',
      url: '/api/pdfs/quiz-read-owner-01/quizzes',
      headers: OWNER_HEADERS,
    });
    assert.equal(ownerResp.statusCode, 200);

    seedQuizPdf('quiz-read-public-01', 'public');
    const publicResp = await app.inject({
      method: 'GET',
      url: '/api/pdfs/quiz-read-public-01/quizzes',
      headers: OTHER_HEADERS,
    });
    assert.equal(publicResp.statusCode, 200);

    seedQuizPdf('quiz-read-shared-01', 'private');
    seedShareToken('quiz-read-shared-01', 'share-token-quiz-read-01');
    const sharedResp = await app.inject({
      method: 'GET',
      url: '/api/pdfs/quiz-read-shared-01/quizzes?share=share-token-quiz-read-01',
      headers: OTHER_HEADERS,
    });
    assert.equal(sharedResp.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('GET /quizzes/:quizId/attempts rejects a non-owner request on a private presentation', async () => {
  seedQuizPdf('quiz-attempts-read-priv-01', 'private');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-attempts-read-priv-01/quizzes',
      headers: OWNER_HEADERS,
      payload: validQuizPayload(),
    });
    const quizId = (createResp.json() as { id: number }).id;

    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/quiz-attempts-read-priv-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
    });
    assert.equal(resp.statusCode, 403);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'FORBIDDEN');
  } finally {
    await app.close();
  }
});

test('GET /quizzes/:quizId/attempts allows the owner to read student attempt records', async () => {
  // public (not private): the attempt below is submitted by OTHER_HEADERS, which now requires
  // at least read access to the presentation, matching real classroom usage where students
  // access a publicly shared quiz rather than the owner's own private session.
  seedQuizPdf('quiz-attempts-read-owner-01', 'public');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-attempts-read-owner-01/quizzes',
      headers: OWNER_HEADERS,
      payload: validQuizPayload(),
    });
    const quizId = (createResp.json() as { id: number }).id;

    await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-attempts-read-owner-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-attempts-read-owner-01', session_id: 'session-attempts-read-owner-01', answers: { q1: [1] } },
    });

    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/quiz-attempts-read-owner-01/quizzes/${quizId}/attempts`,
      headers: OWNER_HEADERS,
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { sessions: Array<{ session_id: string }> };
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0]?.session_id, 'session-attempts-read-owner-01');
  } finally {
    await app.close();
  }
});

test('GET /quizzes/:quizId/attempts returns 404 for an unknown pdf id', async () => {
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: '/api/pdfs/quiz-attempts-missing-pdf-01/quizzes/1/attempts',
    headers: OWNER_HEADERS,
  });
  assert.equal(resp.statusCode, 404);
  await app.close();
});

test('POST /quizzes/:quizId/attempts ignores a client-claimed score and recomputes it from the answer key', async () => {
  seedQuizPdf('quiz-score-trust-01', 'public');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-score-trust-01/quizzes',
      headers: OWNER_HEADERS,
      payload: validQuizPayload(), // single question, correct answer is index 1, no custom score => worth 100
    });
    const quizId = (createResp.json() as { id: number }).id;

    const correctButClaimsZero = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-score-trust-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-correct', session_id: 'session-correct', answers: { q1: [1] }, score: 0 },
    });
    assert.equal(correctButClaimsZero.statusCode, 201);
    assert.equal((correctButClaimsZero.json() as { score: number }).score, 100);

    const wrongButClaimsFull = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-score-trust-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-wrong', session_id: 'session-wrong', answers: { q1: [0] }, score: 1000 },
    });
    assert.equal(wrongButClaimsFull.statusCode, 201);
    assert.equal((wrongButClaimsFull.json() as { score: number }).score, 0);

    const dbRow = db.prepare(`SELECT score FROM quiz_attempts WHERE client_id = ?`).get('client-wrong') as { score: number };
    assert.equal(dbRow.score, 0);
  } finally {
    await app.close();
  }
});

test('POST /quizzes/:quizId/attempts computes per-option partial credit for a multiple-choice question server-side', async () => {
  seedQuizPdf('quiz-score-partial-01', 'public');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-score-partial-01/quizzes',
      headers: OWNER_HEADERS,
      payload: {
        title: '測驗',
        prompt: '',
        questions: [
          {
            id: 'm1',
            type: 'multiple',
            question: '選出偶數',
            options: [{ text: '1' }, { text: '2' }, { text: '3' }, { text: '4' }],
            answer_indices: [1, 3],
            explanation: '',
            score: 100,
          },
        ],
      },
    });
    const quizId = (createResp.json() as { id: number }).id;

    // Selects only option 1 (correct) but misses option 3 and doesn't over-select: idx0 match, idx1 match, idx2 match, idx3 mismatch => 3/4 * 100 = 75
    const partial = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-score-partial-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-partial', session_id: 'session-partial', answers: { m1: [1] }, score: 100 },
    });
    assert.equal(partial.statusCode, 201);
    assert.equal((partial.json() as { score: number }).score, 75);
  } finally {
    await app.close();
  }
});

test('PUT /quizzes/:quizId persists a custom per-question score that GET /quizzes returns unchanged', async () => {
  seedQuizPdf('quiz-score-persist-01', 'public');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-score-persist-01/quizzes',
      headers: OWNER_HEADERS,
      payload: {
        title: '測驗',
        prompt: '',
        questions: [
          { id: 'q1', type: 'single', question: 'Q1', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 30 },
          { id: 'q2', type: 'single', question: 'Q2', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '' },
        ],
      },
    });
    assert.equal(createResp.statusCode, 201);
    const created = createResp.json() as { id: number; questions: Array<{ id: string; score: number | null }> };
    assert.equal(created.questions.find((q) => q.id === 'q1')?.score, 30);

    const getResp = await app.inject({
      method: 'GET',
      url: '/api/pdfs/quiz-score-persist-01/quizzes',
      headers: OWNER_HEADERS,
    });
    const body = getResp.json() as { quizzes: Array<{ id: number; questions: Array<{ id: string; score: number | null }> }> };
    const quiz = body.quizzes.find((q) => q.id === created.id);
    assert.equal(quiz?.questions.find((q) => q.id === 'q1')?.score, 30);
    assert.equal(quiz?.questions.find((q) => q.id === 'q2')?.score ?? null, null);
  } finally {
    await app.close();
  }
});

test('POST /quizzes rejects explicit per-question scores that sum to more than 100', async () => {
  seedQuizPdf('quiz-score-cap-create-01', 'public');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-score-cap-create-01/quizzes',
      headers: OWNER_HEADERS,
      payload: {
        title: '測驗',
        prompt: '',
        questions: [
          { id: 'q1', type: 'single', question: 'Q1', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 80 },
          { id: 'q2', type: 'single', question: 'Q2', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 80 },
        ],
      },
    });
    assert.equal(resp.statusCode, 400);
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST');
    const count = db.prepare(`SELECT COUNT(*) AS n FROM quiz_sets WHERE pdf_id = ?`).get('quiz-score-cap-create-01') as { n: number };
    assert.equal(count.n, 0, 'rejected quiz must not be persisted');
  } finally {
    await app.close();
  }
});

test('PUT /quizzes/:quizId rejects explicit per-question scores that sum to more than 100 and leaves the stored quiz unchanged', async () => {
  seedQuizPdf('quiz-score-cap-update-01', 'public');
  const app = await buildApp();
  try {
    const createResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/quiz-score-cap-update-01/quizzes',
      headers: OWNER_HEADERS,
      payload: validQuizPayload(),
    });
    const quizId = (createResp.json() as { id: number }).id;

    const updateResp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/quiz-score-cap-update-01/quizzes/${quizId}`,
      headers: OWNER_HEADERS,
      payload: {
        title: '測驗',
        prompt: '',
        questions: [
          { id: 'q1', type: 'single', question: 'Q1', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 60 },
          { id: 'q2', type: 'single', question: 'Q2', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 60 },
        ],
      },
    });
    assert.equal(updateResp.statusCode, 400);

    const row = db.prepare(`SELECT questions_json FROM quiz_sets WHERE id = ?`).get(quizId) as { questions_json: string };
    const storedQuestions = JSON.parse(row.questions_json) as Array<{ id: string }>;
    assert.equal(storedQuestions.length, 1, 'original single-question quiz must remain untouched');
    assert.equal(storedQuestions[0]?.id, 'q1');
  } finally {
    await app.close();
  }
});

test('POST /quizzes/:quizId/copy-to/:targetId copies quiz to target PDF (201), 403 without target edit rights, 404 for unknown quiz', async () => {
  seedQuizPdf('quiz-copy-src-01', 'public');
  seedQuizPdf('quiz-copy-dst-01', 'public');
  const t = nowIso();
  const insertResult = db
    .prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, time_limit_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`)
    .run('quiz-copy-src-01', '複製測驗', '', JSON.stringify([{ id: 'q1', type: 'single', question: 'Q?', options: [{ text: 'A' }], answer_indices: [0], explanation: '', score: 100 }]), t, t);
  const quizId = insertResult.lastInsertRowid as number;

  const app = await buildApp();
  try {
    // copy-to takes no request body; send cookie only. The shared *_HEADERS set
    // content-type: application/json, which makes Fastify reject the empty body
    // with 400 — the frontend's copyQuizSetTo() sends no content-type either.
    const ok = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-copy-src-01/quizzes/${quizId}/copy-to/quiz-copy-dst-01`,
      headers: { cookie: OWNER_HEADERS.cookie },
    });
    assert.equal(ok.statusCode, 201);
    const body = ok.json() as { pdf_id: string; title: string };
    assert.equal(body.pdf_id, 'quiz-copy-dst-01');
    assert.equal(body.title, '複製測驗');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-copy-src-01/quizzes/${quizId}/copy-to/quiz-copy-dst-01`,
      headers: { cookie: OTHER_HEADERS.cookie },
    });
    assert.equal(forbidden.statusCode, 403);

    const notFound = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-copy-src-01/quizzes/99999/copy-to/quiz-copy-dst-01`,
      headers: { cookie: OWNER_HEADERS.cookie },
    });
    assert.equal(notFound.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /quizzes/:quizId/attempts never awards more than 100 points even if a stored quiz predates the score-sum cap', async () => {
  // A quiz_sets row can carry per-question scores summing above 100 if it was written before the
  // SaveQuizBodySchema sum validation existed (or edited directly in the database). Bypass the
  // (now-enforced) POST/PUT validation by inserting the row directly to simulate that legacy state,
  // then confirm computeAttemptScore() still clamps the awarded total to 100.
  seedQuizPdf('quiz-score-cap-legacy-01', 'public');
  const t = nowIso();
  const legacyQuestions = [
    { id: 'q1', type: 'single', question: 'Q1', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 80 },
    { id: 'q2', type: 'single', question: 'Q2', options: [{ text: 'A' }, { text: 'B' }], answer_indices: [0], explanation: '', score: 80 },
  ];
  const insertResult = db
    .prepare(`INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('quiz-score-cap-legacy-01', '測驗', '', JSON.stringify(legacyQuestions), t, t);
  const quizId = insertResult.lastInsertRowid as number;

  const app = await buildApp();
  try {
    const attemptResp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/quiz-score-cap-legacy-01/quizzes/${quizId}/attempts`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-legacy-allcorrect', session_id: 'session-legacy', answers: { q1: [0], q2: [0] } },
    });
    assert.equal(attemptResp.statusCode, 201);
    assert.equal((attemptResp.json() as { score: number }).score, 100, 'awarded score must be clamped to the 100-point total');
  } finally {
    await app.close();
  }
});

test('GET /quizzes hides non-public quizzes from read-only users but shows them to the owner', async () => {
  seedQuizPdf('quiz-public-vis-01', 'public');
  const app = await buildApp();
  try {
    const pubResp = await app.inject({ method: 'POST', url: '/api/pdfs/quiz-public-vis-01/quizzes', headers: OWNER_HEADERS, payload: { ...validQuizPayload(), title: '公開測驗', is_public: true } });
    assert.equal(pubResp.statusCode, 201);
    const publicId = (pubResp.json() as { id: number }).id;
    const privResp = await app.inject({ method: 'POST', url: '/api/pdfs/quiz-public-vis-01/quizzes', headers: OWNER_HEADERS, payload: { ...validQuizPayload(), title: '備課測驗' } });
    assert.equal(privResp.statusCode, 201);
    const privateId = (privResp.json() as { id: number }).id;

    // 唯讀使用者只看得到 public 的那一份。
    const readOnly = await app.inject({ method: 'GET', url: '/api/pdfs/quiz-public-vis-01/quizzes', headers: OTHER_HEADERS });
    const roIds = (readOnly.json() as { quizzes: Array<{ id: number }> }).quizzes.map((q) => q.id);
    assert.deepEqual(roIds, [publicId], 'read-only user should only see the public quiz');

    // 老師看得到全部。
    const owner = await app.inject({ method: 'GET', url: '/api/pdfs/quiz-public-vis-01/quizzes', headers: OWNER_HEADERS });
    const ownerIds = (owner.json() as { quizzes: Array<{ id: number }> }).quizzes.map((q) => q.id).sort((a, b) => a - b);
    assert.deepEqual(ownerIds, [publicId, privateId].sort((a, b) => a - b), 'owner should see both quizzes');
  } finally {
    db.prepare('DELETE FROM quiz_sets WHERE pdf_id = ?').run('quiz-public-vis-01');
    db.prepare('DELETE FROM pdfs WHERE id = ?').run('quiz-public-vis-01');
    await app.close();
  }
});
