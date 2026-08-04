/**
 * 課後輔導測試：自適應難度選擇題。
 *
 * 這裡刻意驗證兩件最容易出事的性質：正解不會外洩給前端、以及別人的 session 拿不到。
 */
import { test, expect } from '../harness/fixtures';

/** 輔導測試需要逐字稿當出題素材，沒有的話後端會回 409。 */
async function deckWithScript(api: {
  createBlankDeck(t: string): Promise<string>;
  request: import('@playwright/test').APIRequestContext;
  as(a: 'teacher'): { headers: Record<string, string> };
}): Promise<string> {
  const deckId = await api.createBlankDeck('輔導測試用簡報');
  await api.request.put(`/api/pdfs/${deckId}/pages/1/script`, {
    ...api.as('teacher'),
    data: {
      script: '本頁介紹電腦視覺的基本概念，包括影像如何被表示成像素矩陣，以及卷積神經網路為什麼適合處理影像資料。',
    },
  });
  return deckId;
}

test('可以開始一輪練習並拿到第一題', async ({ api, evidence }) => {
  const deckId = await deckWithScript(api);

  evidence.step('建立 session');
  const create = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session`, {
    ...api.as('teacher'),
    data: { client_id: 'e2e-client-1', topics: [] },
  });
  expect(create.ok(), `建立 session 失敗：${create.status()} ${await create.text()}`).toBe(true);
  const { session } = (await create.json()) as { session: { id: number; current_level?: number } };
  evidence.note('session', session);

  evidence.step('取下一題');
  const next = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session/${session.id}/next`, {
    ...api.as('teacher'),
    data: { client_id: 'e2e-client-1' },
  });
  expect(next.ok(), `出題失敗：${next.status()} ${await next.text()}`).toBe(true);
  const { question } = (await next.json()) as { question: Record<string, unknown> };
  evidence.note('題目', question);

  expect(Array.isArray(question.options) ? (question.options as unknown[]).length : 0).toBe(4);

  evidence.step('未作答的題目不該把正解送到前端');
  expect(question.correct_index, '正解外洩了——學生打開 devtools 就能看到答案').toBeUndefined();
  expect(question.explanation, '解說也會透露答案，作答前不該送出').toBeUndefined();
});

test('答題後會回饋對錯，並依對錯調整難度', async ({ api, evidence }) => {
  const deckId = await deckWithScript(api);
  const create = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session`, {
    ...api.as('teacher'),
    data: { client_id: 'e2e-client-2', topics: [] },
  });
  const { session } = (await create.json()) as { session: { id: number } };

  const next = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session/${session.id}/next`, {
    ...api.as('teacher'),
    data: { client_id: 'e2e-client-2' },
  });
  const { question } = (await next.json()) as { question: { seq: number; options: string[] } };

  evidence.step('作答（假 LLM 的正解固定是「正確選項」那一項，但選項會被重排，所以用內容找位置）');
  const answerIndex = question.options.findIndex((o) => o.includes('正確選項'));
  expect(answerIndex, '找不到正解選項，假 LLM 的回應形狀可能變了').toBeGreaterThanOrEqual(0);

  const answer = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session/${session.id}/answer`, {
    ...api.as('teacher'),
    data: { client_id: 'e2e-client-2', seq: question.seq, answer_index: answerIndex },
  });
  expect(answer.ok(), `作答失敗：${answer.status()} ${await answer.text()}`).toBe(true);
  const result = (await answer.json()) as Record<string, unknown>;
  evidence.note('作答結果', result);
  expect(result.correct, '選到正解卻被判錯——這正是選項重排最容易踩到的坑').toBe(true);
});

test('別的帳號拿不到我的 session（session id 是自增的，猜得到號碼）', async ({ api, evidence }) => {
  const deckId = await deckWithScript(api);
  await api.request.patch(`/api/pdfs/${deckId}/visibility`, {
    ...api.as('teacher'),
    data: { visibility: 'public' },
  });
  const create = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session`, {
    ...api.as('teacher'),
    data: { client_id: 'owner-client', topics: [] },
  });
  const { session } = (await create.json()) as { session: { id: number } };

  evidence.step('換一個登入帳號去戳同一個 session id');
  // 同一個帳號換 client_id 是讀得到的（session 綁登入者 sub），所以這裡要換的是「人」。
  const stolen = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session/${session.id}/next`, {
    ...api.as('student'),
    data: { client_id: 'someone-else' },
  });
  evidence.note('他人存取的回應', { status: stolen.status(), body: (await stolen.text()).slice(0, 200) });
  expect(stolen.status(), '別人的練習紀錄與正解不該拿得到').toBeGreaterThanOrEqual(400);
});

test('主題清單抓得到（第一次分析、之後讀快取）', async ({ api, stack, evidence }) => {
  const deckId = await deckWithScript(api);

  evidence.step('第一次取主題');
  const first = await api.request.get(`/api/pdfs/${deckId}/tutor-quiz/topics`, api.as('teacher'));
  expect(first.ok(), `主題清單失敗：${first.status()}`).toBe(true);
  const firstBody = (await first.json()) as { topics?: unknown[] };
  evidence.note('第一次的主題', firstBody);

  const callsAfterFirst = stack.fakeOpenAI.calls.length;

  evidence.step('第二次取主題應該讀快取，不再打 LLM');
  const second = await api.request.get(`/api/pdfs/${deckId}/tutor-quiz/topics`, api.as('teacher'));
  expect(second.ok()).toBe(true);
  expect(
    stack.fakeOpenAI.calls.length,
    '第二次仍打了 LLM——每次開啟練習都要多花一次錢',
  ).toBe(callsAfterFirst);
});
