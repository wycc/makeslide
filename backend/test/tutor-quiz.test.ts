import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { pagesDir, pageScriptPath } from '../src/services/storage';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const OWNER = 'owner-tutorquiz';
const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie(OWNER))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('other-tutorquiz'))}` };
const CLIENT_ID = 'client-tq-1';

function nowIso() { return new Date().toISOString(); }

/** 建立一份有兩頁逐字稿的簡報——出題會讀整份逐字稿，沒有內容的簡報會被擋在 NO_CONTENT。 */
function seedPdf(id: string, opts: { ownerSub?: string; visibility?: string; withScripts?: boolean } = {}): void {
  const t = nowIso();
  cleanup(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',2,?,?,?,?)`,
  ).run(id, `PDF ${id}`, `${id}.pdf`, opts.ownerSub ?? OWNER, opts.visibility ?? 'private', t, t);
  for (const n of [1, 2]) {
    const uid = `uid-tq-${id}-${n}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,status,script_path,text_path,created_at,updated_at)
       VALUES (?,?,?,'audio_ready',NULL,NULL,?,?)`,
    ).run(id, n, uid, t, t);
    if (opts.withScripts !== false) {
      fs.mkdirSync(pagesDir(id), { recursive: true });
      fs.writeFileSync(pageScriptPath(id, uid), `第 ${n} 頁的逐字稿：遞迴函式一定要有終止條件，否則會無限展開。`, 'utf8');
    }
  }
}

function cleanup(id: string): void {
  db.prepare(`DELETE FROM tutor_quiz_topics WHERE pdf_id = ?`).run(id);
  const sessions = db.prepare(`SELECT id FROM tutor_quiz_sessions WHERE pdf_id = ?`).all(id) as Array<{ id: number }>;
  for (const s of sessions) {
    db.prepare(`DELETE FROM tutor_quiz_questions WHERE session_id = ?`).run(s.id);
    db.prepare(`DELETE FROM tutor_quiz_assessments WHERE session_id = ?`).run(s.id);
  }
  db.prepare(`DELETE FROM tutor_quiz_sessions WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  try { fs.rmSync(path.dirname(pagesDir(id)), { recursive: true, force: true }); } catch { /* best effort */ }
}

/** 每次呼叫依序回傳題目；評估請求（含 summary 欄位要求）另外回評語 JSON。 */
function mockLlm(): { questionCalls: string[] } {
  const questionCalls: string[] = [];
  let n = 0;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          const system = params.messages.find((m) => m.role === 'system')?.content ?? '';
          const user = params.messages.find((m) => m.role === 'user')?.content ?? '';
          const isAssessment = system.includes('weak_topics');
          const content = isAssessment
            ? JSON.stringify({ summary: '你對遞迴的基本觀念已經掌握，下一步練習終止條件的邊界情形。', weak_topics: ['終止條件'] })
            : (() => {
                n += 1;
                questionCalls.push(user);
                return JSON.stringify({
                  question: `第 ${n} 題：關於遞迴，下列何者正確？`,
                  options: ['選項A', '選項B', '選項C', '選項D'],
                  correct_index: 0,
                  explanation: '因為遞迴需要終止條件。',
                  page_number: 1,
                });
              })();
          return {
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 60, total_tokens: 80 },
          };
        },
      },
    },
  } as never);
  return { questionCalls };
}

interface QuestionResponse {
  question: { seq: number; level: number; question: string; options: string[]; page_number: number | null };
}

interface AnswerResponse {
  correct: boolean;
  correct_index: number;
  explanation: string;
  level: number;
  next_level: number;
  answered_count: number;
  until_assessment: number;
  assessment: { through_seq: number; level_estimate: number; correct_count: number; summary: string; weak_topics: string[]; trend: string } | null;
}

async function startSession(app: Awaited<ReturnType<typeof buildApp>>, id: string, topics: string[] = []): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/tutor-quiz/session`,
    headers: OWNER_HEADERS,
    payload: { client_id: CLIENT_ID, topics },
  });
  assert.equal(res.statusCode, 200, `start session failed: ${res.body.slice(0, 200)}`);
  return (res.json() as { session: { id: number } }).session.id;
}

/**
 * mock 出題一律以「選項A」為正解內容。後端會重排選項（修正模型偏好把正解放第一個的問題），
 * 所以測試不能寫死索引 0，要用內容去找它現在在哪一格。
 */
const CORRECT_OPTION_TEXT = '選項A';

/** 出一題並作答；`correct` 決定要不要選中正解。 */
async function answerOne(
  app: Awaited<ReturnType<typeof buildApp>>,
  id: string,
  sid: number,
  correct: boolean,
): Promise<{ asked: QuestionResponse['question']; result: AnswerResponse }> {
  const next = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`,
    headers: OWNER_HEADERS,
    payload: { client_id: CLIENT_ID },
  });
  assert.equal(next.statusCode, 200, `next failed: ${next.body.slice(0, 200)}`);
  const asked = (next.json() as QuestionResponse).question;

  const correctIdx = asked.options.indexOf(CORRECT_OPTION_TEXT);
  assert.ok(correctIdx >= 0, `mock 的正解內容應該還在選項裡：${asked.options.join('/')}`);
  const answerIndex = correct ? correctIdx : (correctIdx + 1) % asked.options.length;
  const answer = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/answer`,
    headers: OWNER_HEADERS,
    payload: { client_id: CLIENT_ID, seq: asked.seq, answer_index: answerIndex },
  });
  assert.equal(answer.statusCode, 200, `answer failed: ${answer.body.slice(0, 200)}`);
  return { asked, result: answer.json() as AnswerResponse };
}

/** 主題抽取用的 mock；回傳含重複與過長項目，順帶驗證後端有整理過才存。 */
function mockTopicsLlm(): { calls: number } {
  const state = { calls: 0 };
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => {
          state.calls += 1;
          return {
            choices: [{
              message: { content: JSON.stringify({ topics: ['遞迴的終止條件', '遞迴的終止條件 ', '尾遞迴最佳化', '  '] }) },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
          };
        },
      },
    },
  } as never);
  return state;
}

test('第一次取主題時就地產生並存下來，之後直接回快取不再打 LLM', async () => {
  const id = `tq-topics-${Date.now()}`;
  seedPdf(id);
  const llm = mockTopicsLlm();
  const app = await buildApp();
  try {
    const first = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/tutor-quiz/topics`, headers: OWNER_HEADERS });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json() as { topics: string[]; generated: boolean };
    assert.equal(firstBody.generated, true);
    assert.deepEqual(firstBody.topics, ['遞迴的終止條件', '尾遞迴最佳化'], '重複與空白項目應已整理掉');
    assert.equal(llm.calls, 1);

    const second = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/tutor-quiz/topics`, headers: OWNER_HEADERS });
    const secondBody = second.json() as { topics: string[]; generated: boolean };
    assert.deepEqual(secondBody.topics, firstBody.topics);
    assert.equal(secondBody.generated, false);
    assert.equal(llm.calls, 1, '第二次取主題不該再打 LLM');

    const stored = db.prepare(`SELECT COUNT(*) AS c FROM tutor_quiz_topics WHERE pdf_id = ?`).get(id) as { c: number };
    assert.equal(stored.c, 2);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('refresh=1 重新分析主題並覆寫舊清單（簡報改寫後用）', async () => {
  const id = `tq-topics-refresh-${Date.now()}`;
  seedPdf(id);
  const llm = mockTopicsLlm();
  const app = await buildApp();
  try {
    await app.inject({ method: 'GET', url: `/api/pdfs/${id}/tutor-quiz/topics`, headers: OWNER_HEADERS });
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/tutor-quiz/topics?refresh=1`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { generated: boolean }).generated, true);
    assert.equal(llm.calls, 2);
    // 覆寫而不是累加：重跑後仍是兩筆，不會變成四筆
    const stored = db.prepare(`SELECT COUNT(*) AS c FROM tutor_quiz_topics WHERE pdf_id = ?`).get(id) as { c: number };
    assert.equal(stored.c, 2);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('主題抽取失敗時回空清單而不是擋住練習', async () => {
  const id = `tq-topics-fail-${Date.now()}`;
  seedPdf(id);
  setOpenAIClientForTest({
    chat: { completions: { create: async () => { throw new Error('topics upstream is down'); } } },
  } as never);
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/tutor-quiz/topics`, headers: OWNER_HEADERS });
    assert.equal(res.statusCode, 200, '抽不出主題不該是錯誤——使用者仍可自己輸入主題');
    assert.deepEqual((res.json() as { topics: string[] }).topics, []);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('沒有讀取權限的人拿不到主題清單', async () => {
  const id = `tq-topics-403-${Date.now()}`;
  seedPdf(id, { visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/tutor-quiz/topics`, headers: OTHER_HEADERS });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('出題不外洩正解，作答後才回傳 correct_index 與解說', async () => {
  const id = `tq-secret-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const next = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID },
    });
    assert.equal(next.statusCode, 200);
    const raw = next.body;
    assert.ok(!raw.includes('correct_index'), '未作答的題目不得帶出 correct_index');
    assert.ok(!raw.includes('因為遞迴需要終止條件'), '未作答的題目不得帶出解說');

    const asked = (next.json() as QuestionResponse).question;
    const correctIdx = asked.options.indexOf(CORRECT_OPTION_TEXT);
    const answered = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/answer`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID, seq: asked.seq, answer_index: correctIdx },
    });
    const body = answered.json() as AnswerResponse;
    assert.equal(body.correct, true);
    assert.equal(body.correct_index, correctIdx);
    assert.equal(body.explanation, '因為遞迴需要終止條件。');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('選項重排後，判分仍以使用者看到的順序為準（選到正解內容就算對）', async () => {
  const id = `tq-shuffle-${Date.now()}`;
  seedPdf(id);
  // 模型一律把正解放在第一個（真實世界的偏差），重排後正解會落在別的位置
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                question: '哪一個是正解？',
                options: ['這是正解', '錯誤選項一', '錯誤選項二', '錯誤選項三'],
                correct_index: 0,
                explanation: '說明',
                page_number: 1,
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      },
    },
  } as never);
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const next = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID },
    });
    const asked = (next.json() as QuestionResponse).question;
    const shownIndex = asked.options.indexOf('這是正解');
    assert.ok(shownIndex >= 0, '正解的內容必須仍在選項中');

    const answer = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/answer`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID, seq: asked.seq, answer_index: shownIndex },
    });
    const body = answer.json() as AnswerResponse;
    assert.equal(body.correct, true, '選到「這是正解」就該判對——回傳的選項順序與後端存的正解必須一致');
    assert.equal(body.correct_index, shownIndex);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('連續出題時正解不會固定落在同一個位置', async () => {
  const id = `tq-shuffle-spread-${Date.now()}`;
  seedPdf(id);
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          const system = params.messages.find((m) => m.role === 'system')?.content ?? '';
          const content = system.includes('weak_topics')
            ? JSON.stringify({ summary: '評語', weak_topics: [] })
            : JSON.stringify({
                question: '題目',
                options: ['正解', '錯一', '錯二', '錯三'],
                correct_index: 0,
                explanation: '說明',
                page_number: 1,
              });
          return {
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };
        },
      },
    },
  } as never);
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const positions = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      const next = await app.inject({
        method: 'POST',
        url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`,
        headers: OWNER_HEADERS,
        payload: { client_id: CLIENT_ID },
      });
      const asked = (next.json() as QuestionResponse).question;
      positions.add(asked.options.indexOf('正解'));
      await app.inject({
        method: 'POST',
        url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/answer`,
        headers: OWNER_HEADERS,
        payload: { client_id: CLIENT_ID, seq: asked.seq, answer_index: 0 },
      });
    }
    // 模型每一題都把正解放在第一個；20 題後若仍只出現一個位置，就是重排沒有生效
    assert.ok(positions.size >= 3, `正解應散落在不同位置，實得 ${[...positions].join(',')}`);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('答對升一級、答錯降一級，並反映在下一題的難度上', async () => {
  const id = `tq-ladder-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const first = await answerOne(app, id, sid, true);
    assert.equal(first.asked.level, 2, '起始難度為 L2');
    assert.equal(first.result.next_level, 3);

    const second = await answerOne(app, id, sid, false);
    assert.equal(second.asked.level, 3, '答對後下一題應升到 L3');
    assert.equal(second.result.next_level, 2);

    const third = await answerOne(app, id, sid, true);
    assert.equal(third.asked.level, 2, '答錯後下一題應降回 L2');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('連續答錯會停在 L1 而不是掉到 L0', async () => {
  const id = `tq-floor-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    for (let i = 0; i < 4; i += 1) await answerOne(app, id, sid, false);
    const last = await answerOne(app, id, sid, false);
    assert.equal(last.asked.level, 1);
    assert.equal(last.result.next_level, 1);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('答滿十題產生難度評估，第十一題不再產生', async () => {
  const id = `tq-assess-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    let tenth: AnswerResponse | null = null;
    for (let i = 0; i < 10; i += 1) {
      // 對錯交錯，讓落點落在中間而不是貼著上下界
      const { result } = await answerOne(app, id, sid, i % 2 === 0);
      if (i < 9) assert.equal(result.assessment, null, `第 ${i + 1} 題不應產生評估`);
      tenth = result;
    }
    assert.ok(tenth?.assessment, '第 10 題應產生評估');
    assert.equal(tenth.assessment.through_seq, 10);
    assert.equal(tenth.assessment.correct_count, 5);
    assert.equal(tenth.assessment.trend, 'first');
    assert.ok(tenth.assessment.level_estimate >= 1 && tenth.assessment.level_estimate <= 5);
    assert.ok(tenth.assessment.summary.length > 0, '評語應由 AI 產生');
    assert.deepEqual(tenth.assessment.weak_topics, ['終止條件']);
    assert.equal(tenth.answered_count, 10);

    const eleventh = await answerOne(app, id, sid, true);
    assert.equal(eleventh.result.assessment, null);
    assert.equal(eleventh.result.until_assessment, 9, '應回報距離下次評估還有 9 題');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('未作答時重複呼叫 next 回同一題，不重複產生題目', async () => {
  const id = `tq-pending-${Date.now()}`;
  seedPdf(id);
  const { questionCalls } = mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const payload = { client_id: CLIENT_ID };
    const a = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`, headers: OWNER_HEADERS, payload });
    const b = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`, headers: OWNER_HEADERS, payload });
    assert.deepEqual((a.json() as QuestionResponse).question, (b.json() as QuestionResponse).question);
    assert.equal(questionCalls.length, 1, '第二次呼叫不應再打 LLM');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('同一題不能重複作答', async () => {
  const id = `tq-double-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const { asked } = await answerOne(app, id, sid, true);
    const again = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/answer`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID, seq: asked.seq, answer_index: 2 },
    });
    assert.equal(again.statusCode, 409);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('出題會把已出過的題目與主題帶進提示詞', async () => {
  const id = `tq-prompt-${Date.now()}`;
  seedPdf(id);
  const { questionCalls } = mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id, ['遞迴']);
    await answerOne(app, id, sid, false);
    await answerOne(app, id, sid, true);
    assert.equal(questionCalls.length, 2);
    assert.ok(questionCalls[0].includes('主題聚焦'), '第一題就該帶主題');
    assert.ok(questionCalls[1].includes('第 1 題：關於遞迴'), '第二題應列出第一題以避免重複');
    assert.ok(questionCalls[1].includes('最近答錯的題目'), '答錯的題目應餵回模型');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('複選主題：全部主題都進出題提示詞，session 也回傳整組', async () => {
  const id = `tq-multi-topic-${Date.now()}`;
  seedPdf(id);
  const { questionCalls } = mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id, ['遞迴的終止條件', '尾遞迴最佳化']);
    await answerOne(app, id, sid, true);
    assert.ok(questionCalls[0].includes('「遞迴的終止條件」'));
    assert.ok(questionCalls[0].includes('「尾遞迴最佳化」'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/tutor-quiz/session?client_id=${encodeURIComponent(CLIENT_ID)}`,
      headers: OWNER_HEADERS,
    });
    const body = res.json() as { session: { topics: string[] } };
    assert.deepEqual(body.session.topics, ['遞迴的終止條件', '尾遞迴最佳化']);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('送進來的主題會去重與去空白（使用者可自行輸入，不限選單內的）', async () => {
  const id = `tq-topic-normalize-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id, ['遞迴', ' 遞迴 ', '', '  ', '排序']);
    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/tutor-quiz/session?client_id=${encodeURIComponent(CLIENT_ID)}`,
      headers: OWNER_HEADERS,
    });
    const body = res.json() as { session: { id: number; topics: string[] } };
    assert.equal(body.session.id, sid);
    assert.deepEqual(body.session.topics, ['遞迴', '排序']);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('升級前建立的 session（只有單一 topic 欄位）仍讀得到主題', async () => {
  const id = `tq-legacy-topic-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    // 模擬 migration 之前寫入的資料列：topic 有值、topics_json 是空陣列
    const t = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO tutor_quiz_sessions (pdf_id, sub, client_id, topic, topics_json, current_level, asked_count, correct_count, status, created_at, updated_at)
         VALUES (?,?,?,?,'[]',2,0,0,'active',?,?)`,
      )
      .run(id, null, CLIENT_ID, '舊的單一主題', t, t);

    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/tutor-quiz/session?client_id=${encodeURIComponent(CLIENT_ID)}`,
      headers: OWNER_HEADERS,
    });
    const body = res.json() as { session: { id: number; topics: string[] } };
    assert.equal(body.session.id, Number(info.lastInsertRowid));
    assert.deepEqual(body.session.topics, ['舊的單一主題'], '舊資料不該在升級後變成「整份簡報」');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('唯讀（非擁有者）也能在公開簡報上練習', async () => {
  const id = `tq-public-${Date.now()}`;
  seedPdf(id, { visibility: 'public' });
  mockLlm();
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-other' },
    });
    assert.equal(res.statusCode, 200, '學生（唯讀）必須能開始練習');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('沒有讀取權限的人無法開始練習', async () => {
  const id = `tq-403-${Date.now()}`;
  seedPdf(id, { visibility: 'private' });
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'client-other' },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('別人的 session id 猜不到內容（client_id 不符回 404）', async () => {
  const id = `tq-owned-${Date.now()}`;
  seedPdf(id, { visibility: 'public' });
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`,
      headers: OTHER_HEADERS,
      payload: { client_id: 'someone-else' },
    });
    assert.equal(res.statusCode, 404, '不屬於自己的練習 session 不得存取');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('GET session 還原進行中的練習：已答題目含正解、未答題目不含', async () => {
  const id = `tq-resume-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id, ['遞迴']);
    await answerOne(app, id, sid, true);
    // 再出一題但不作答
    await app.inject({ method: 'POST', url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`, headers: OWNER_HEADERS, payload: { client_id: CLIENT_ID } });

    const res = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${id}/tutor-quiz/session?client_id=${encodeURIComponent(CLIENT_ID)}`,
      headers: OWNER_HEADERS,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      session: { id: number; topics: string[]; current_level: number; correct_count: number };
      questions: Array<{ seq: number; options: string[]; correct_index?: number; is_correct?: boolean }>;
    };
    assert.equal(body.session.id, sid);
    assert.deepEqual(body.session.topics, ['遞迴']);
    assert.equal(body.session.current_level, 3);
    assert.equal(body.session.correct_count, 1);
    assert.equal(body.questions.length, 2);
    assert.equal(body.questions[0].is_correct, true);
    assert.equal(
      body.questions[0].options[body.questions[0].correct_index ?? -1],
      CORRECT_OPTION_TEXT,
      '已作答的題目可帶正解（用於還原歷史），且索引要對得上重排後的選項',
    );
    assert.equal(body.questions[1].correct_index, undefined, '未作答的題目仍不得帶正解');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('開始新練習會把先前未結束的練習收掉，不會同時存在兩個進行中', async () => {
  const id = `tq-restart-${Date.now()}`;
  seedPdf(id);
  mockLlm();
  const app = await buildApp();
  try {
    const first = await startSession(app, id);
    const second = await startSession(app, id);
    assert.notEqual(first, second);
    const active = db
      .prepare(`SELECT COUNT(*) AS c FROM tutor_quiz_sessions WHERE pdf_id = ? AND status = 'active'`)
      .get(id) as { c: number };
    assert.equal(active.c, 1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${first}/next`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID },
    });
    assert.equal(res.statusCode, 409, '已結束的練習不能再出題');
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('沒有逐字稿的簡報回 409 而不是出一題瞎猜的題目', async () => {
  const id = `tq-empty-${Date.now()}`;
  seedPdf(id, { withScripts: false });
  mockLlm();
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/tutor-quiz/session/${sid}/next`,
      headers: OWNER_HEADERS,
      payload: { client_id: CLIENT_ID },
    });
    assert.equal(res.statusCode, 409);
    assert.ok(res.body.includes('NO_CONTENT'));
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('AI 評語失敗時仍寫入評估（只是沒有評語），不吃掉作答進度', async () => {
  const id = `tq-assess-fail-${Date.now()}`;
  seedPdf(id);
  let n = 0;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          const system = params.messages.find((m) => m.role === 'system')?.content ?? '';
          if (system.includes('weak_topics')) throw new Error('assessment upstream is down');
          n += 1;
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  question: `第 ${n} 題`,
                  options: ['選項A', '選項B', '選項C', '選項D'],
                  correct_index: 0,
                  explanation: '說明',
                  page_number: 2,
                }),
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };
        },
      },
    },
  } as never);
  const app = await buildApp();
  try {
    const sid = await startSession(app, id);
    let last: AnswerResponse | null = null;
    for (let i = 0; i < 10; i += 1) last = (await answerOne(app, id, sid, true)).result;
    assert.ok(last?.assessment, '評語失敗也要有評估');
    assert.equal(last.assessment.summary, '');
    assert.equal(last.assessment.correct_count, 10);
    // 難度序列 2,3,4,5,5,5,5,5,5,5：前三題還在往上爬，所以落點是 4.4 而不是 5。
    assert.equal(last.assessment.level_estimate, 4.4);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});
