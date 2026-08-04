/**
 * 探測用（不是斷言測試）：印出幾支 API 的實際回應形狀，供撰寫斷言時參考。
 * 用 `E2E_EXPLORE=1` 開啟。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, RUN_DIR } from '../harness/fixtures';

test.describe('探測', () => {
  test.skip(process.env.E2E_EXPLORE !== '1', '設定 E2E_EXPLORE=1 才執行');

  test('API 回應形狀', async ({ api }) => {
    const out: Record<string, unknown> = {};

    const settings = await api.get<Record<string, unknown>>('/api/system/ai-settings');
    out.aiSettingsKeys = Object.keys(settings);
    out.aiSettingsSample = Object.fromEntries(Object.entries(settings).slice(0, 12));

    const deckId = await api.createBlankDeck('探測用簡報');
    const poll = await api.request.post(`/api/pdfs/${deckId}/pages/1/polls`, {
      ...api.as('teacher'),
      data: { question: '探測題', options: ['甲', '乙'] },
    });
    out.pollCreate = { status: poll.status(), body: await poll.json().catch(() => null) };
    const pollId = ((out.pollCreate as { body?: { id?: unknown } }).body?.id) ?? null;

    if (pollId !== null) {
      const vote = await api.request.post(`/api/pdfs/${deckId}/polls/${pollId}/votes`, {
        ...api.as('teacher'),
        data: { voter_id: 'probe-voter', option_index: 0 },
      });
      out.voteAsOwner = { status: vote.status(), body: (await vote.text()).slice(0, 200) };

      const voters = await api.request.get(`/api/pdfs/${deckId}/polls/${pollId}/voters`, api.as('teacher'));
      out.voters = { status: voters.status(), body: await voters.json().catch(() => null) };

      const list = await api.request.get(`/api/pdfs/${deckId}/pages/1/polls`, api.as('teacher'));
      out.pollList = { status: list.status(), body: await list.json().catch(() => null) };
    }

    await api.request.put(`/api/pdfs/${deckId}/pages/1/script`, {
      ...api.as('teacher'),
      data: { script: '探測用逐字稿，內容夠長以便出題使用，說明電腦視覺與卷積神經網路的基本概念。' },
    });
    const session = await api.request.post(`/api/pdfs/${deckId}/tutor-quiz/session`, {
      ...api.as('teacher'),
      data: { client_id: 'probe-client', topics: [] },
    });
    out.tutorSession = { status: session.status(), body: await session.json().catch(() => null) };

    await fs.mkdir(RUN_DIR, { recursive: true });
    await fs.writeFile(path.join(RUN_DIR, 'api-shapes.json'), JSON.stringify(out, null, 2), 'utf8');
  });
});
