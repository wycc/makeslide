/**
 * 課堂互動：投票與同步。這是「有人在現場」的功能，失敗的代價最高。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('老師建立投票後，學生投得下去且票數會累計', async ({ api, evidence }) => {
  const deckId = await api.createBlankDeck('投票測試');

  evidence.step('把簡報設為公開——課堂投票的前提是學生看得到這份簡報');
  const vis = await api.request.patch(`/api/pdfs/${deckId}/visibility`, {
    ...api.as('teacher'),
    data: { visibility: 'public' },
  });
  expect(vis.ok(), `設定可見性失敗：${vis.status()} ${await vis.text()}`).toBe(true);

  evidence.step('老師在第 1 頁建立投票');
  const create = await api.request.post(`/api/pdfs/${deckId}/pages/1/polls`, {
    ...api.as('teacher'),
    data: { question: '你覺得這堂課如何？', options: ['很好', '普通', '需要加強'], show_results: true },
  });
  expect(create.ok(), `建立投票失敗：${create.status()} ${await create.text()}`).toBe(true);
  const poll = (await create.json()) as { id: number | string };
  evidence.note('poll', poll);

  evidence.step('兩個不同的學生各投一票');
  for (const voter of ['student-a', 'student-b']) {
    const vote = await api.request.post(`/api/pdfs/${deckId}/polls/${poll.id}/votes`, {
      ...api.as('student'),
      data: { voter_id: voter, option_index: 0 },
    });
    expect(vote.ok(), `${voter} 投票失敗：${vote.status()} ${await vote.text()}`).toBe(true);
  }

  evidence.step('讀回投票結果');
  const { polls } = await api.get<{ polls: Array<{ id: number; total_votes: number; options: Array<{ text: string; votes: number }> }> }>(
    `/api/pdfs/${deckId}/pages/1/polls`,
  );
  evidence.note('polls 回應', polls);
  expect(polls.length).toBeGreaterThan(0);
  expect(polls[0]!.total_votes, '兩個學生各投一票').toBe(2);
  expect(polls[0]!.options[0]!.votes, '兩票都投在第一個選項').toBe(2);
});

test('同一個投票者重複投票不會被算成兩票', async ({ api, evidence }) => {
  const deckId = await api.createBlankDeck('重複投票測試');
  await api.request.patch(`/api/pdfs/${deckId}/visibility`, {
    ...api.as('teacher'),
    data: { visibility: 'public' },
  });
  const create = await api.request.post(`/api/pdfs/${deckId}/pages/1/polls`, {
    ...api.as('teacher'),
    data: { question: '重複投票會怎樣？', options: ['算一票', '算兩票'] },
  });
  const poll = (await create.json()) as { id: number | string };

  evidence.step('同一個 voter_id 連投兩次不同選項');
  await api.request.post(`/api/pdfs/${deckId}/polls/${poll.id}/votes`, {
    ...api.as('student'),
    data: { voter_id: 'same-student', option_index: 0 },
  });
  const second = await api.request.post(`/api/pdfs/${deckId}/polls/${poll.id}/votes`, {
    ...api.as('student'),
    data: { voter_id: 'same-student', option_index: 1 },
  });
  evidence.note('第二次投票的回應', { status: second.status(), body: (await second.text()).slice(0, 200) });

  const voters = await api.request.get(`/api/pdfs/${deckId}/polls/${poll.id}/voters`, api.as('teacher'));
  if (voters.ok()) {
    const body = (await voters.json()) as unknown[];
    const list = Array.isArray(body) ? body : (body as { voters?: unknown[] }).voters ?? [];
    evidence.note('投票者清單', list);
    expect(list.length, '同一個人重複投票不該變成兩筆').toBe(1);
  }
});

test('課堂互動分頁在播放頁打得開', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('課堂互動分頁測試');
  await page.goto(appUrl(`/play/${deckId}`));

  evidence.step('切到課堂互動');
  const tab = page.getByRole('tab', { name: /課堂互動/ });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  expect(evidence.jsErrors, `頁面有未捕捉的 JS 例外：\n${evidence.jsErrors.join('\n')}`).toEqual([]);
});

test('master 送出的「顯示結果」狀態，其他人讀得到', async ({ api, evidence }) => {
  const deckId = await api.createBlankDeck('同步顯示結果測試');
  // 學生要讀得到這份簡報才談得上跟隨。
  await api.request.patch(`/api/pdfs/${deckId}/visibility`, {
    ...api.as('teacher'),
    data: { visibility: 'public' },
  });
  const clientId = 'e2e-master-client';

  evidence.step('以 master 身分加入同步');
  const join = await api.request.post(`/api/pdfs/${deckId}/sync/join`, {
    ...api.as('teacher'),
    data: { client_id: clientId },
  });
  expect(join.ok(), `加入同步失敗：${join.status()} ${await join.text()}`).toBe(true);

  evidence.step('送出 quiz_show_answers = true');
  // master 端的修正是「不要把這個值從輪詢讀回來蓋掉自己」，前提是它真的有被廣播出去——
  // 否則 follower 永遠看不到結果，而畫面上只會表現成 master 那顆按鈕怪怪的。
  const push = await api.request.post(`/api/pdfs/${deckId}/sync/state`, {
    ...api.as('teacher'),
    data: { client_id: clientId, page_number: 1, is_playing: false, current_time: 0, quiz_show_answers: true },
  });
  expect(push.ok(), `送出同步狀態失敗：${push.status()} ${await push.text()}`).toBe(true);

  evidence.step('以學生身分讀狀態');
  // 用另一個帳號而不是同一個帳號的第二個 client_id：擁有者不論帶什麼 client_id 都會被
  // 判成 master，讀到的等於自己的狀態，那樣測不到「廣播出去了沒有」。
  const state = await api.request.get(
    `/api/pdfs/${deckId}/sync/state?client_id=e2e-follower-client`,
    api.as('student'),
  );
  expect(state.ok(), `讀同步狀態失敗：${state.status()} ${await state.text()}`).toBe(true);
  const body = (await state.json()) as { role: string; quiz_show_answers?: boolean };
  evidence.note('follower 讀到的狀態', body);
  expect(body.role, '學生應該是 follower').toBe('follower');
  expect(Boolean(body.quiz_show_answers), 'follower 沒有收到「顯示結果」').toBe(true);
});
