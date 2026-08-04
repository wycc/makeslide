/**
 * 生成流程：文字大綱 → 切頁 → 逐字稿 → 配圖 → 語音 → ready。
 *
 * 這是整個產品的核心路徑，也是唯一會把假 OpenAI 的四種端點（chat / images /
 * audio / embeddings）全部走過一遍的測試。跑得動就代表 harness 對接是完整的。
 */
import { test, expect, appUrl } from '../harness/fixtures';

const OUTLINE = `## Slide 1
- 電腦視覺的基本概念
- 影像如何被表示成數字

## Slide 2
- 卷積神經網路的直覺
- 為什麼它適合處理影像
`;

test('文字大綱可以一路生成到 ready，並在播放頁看得到內容', async ({ page, api, stack, evidence }) => {
  test.setTimeout(180_000);

  evidence.step('上傳大綱 TXT');
  const upload = await api.request.post('/api/pdfs', {
    ...api.as('teacher'),
    multipart: {
      file: { name: 'outline.txt', mimeType: 'text/plain', buffer: Buffer.from(OUTLINE, 'utf8') },
    },
  });
  expect(upload.ok(), `上傳失敗：${upload.status()} ${await upload.text()}`).toBe(true);
  const created = (await upload.json()) as { id: string; status: string };
  evidence.note('建立結果', created);

  evidence.step('開始生成');
  const start = await api.request.post(`/api/pdfs/${created.id}/start`, {
    ...api.as('teacher'),
    data: {},
  });
  expect(start.ok(), `start 失敗：${start.status()} ${await start.text()}`).toBe(true);

  evidence.step('輪詢等待 ready');
  const finalStatus = await waitForStatus(api, created.id, ['ready', 'failed'], 150_000, evidence);
  evidence.note('最終狀態', finalStatus);
  expect(finalStatus.status, `生成沒有成功：${JSON.stringify(finalStatus)}`).toBe('ready');

  evidence.step('確認假 LLM 真的被用到（否則等於什麼都沒生成）');
  const endpoints = new Set(stack.fakeOpenAI.calls.map((c) => c.endpoint));
  evidence.note('用到的假 LLM 端點', [...endpoints]);
  expect(endpoints.has('chat.completions'), '逐字稿/切頁應該打過 chat').toBe(true);

  evidence.step('播放頁應該顯示生成出來的內容');
  await page.goto(appUrl(`/play/${created.id}`));
  await expect(page.getByRole('tab', { name: /投影片/ })).toBeVisible({ timeout: 30_000 });

  const detail = await api.get<{ pages: Array<{ page_number: number }> }>(`/api/pdfs/${created.id}`);
  expect(detail.pages.length, '大綱有兩頁，生成後也該是兩頁').toBeGreaterThanOrEqual(2);
});

test('每頁都拿得到圖片與語音檔', async ({ api, evidence }) => {
  test.setTimeout(180_000);

  const upload = await api.request.post('/api/pdfs', {
    ...api.as('teacher'),
    multipart: {
      file: { name: 'outline2.txt', mimeType: 'text/plain', buffer: Buffer.from(OUTLINE, 'utf8') },
    },
  });
  const created = (await upload.json()) as { id: string };
  await api.request.post(`/api/pdfs/${created.id}/start`, { ...api.as('teacher'), data: {} });
  const status = await waitForStatus(api, created.id, ['ready', 'failed'], 150_000, evidence);
  expect(status.status).toBe('ready');

  evidence.step('取第 1 頁的圖片與音檔——資料列說 ready 但檔案不在，是很常見的半套失敗');
  const image = await api.request.get(`/api/pdfs/${created.id}/pages/1/image`, api.as('teacher'));
  expect(image.ok(), `圖片取不到：${image.status()}`).toBe(true);
  expect((await image.body()).byteLength, '圖片是空的').toBeGreaterThan(0);

  const audio = await api.request.get(`/api/pdfs/${created.id}/pages/1/audio`, api.as('teacher'));
  expect(audio.ok(), `語音取不到：${audio.status()}`).toBe(true);
  expect((await audio.body()).byteLength, '語音是空的').toBeGreaterThan(0);
});

async function waitForStatus(
  api: { get<T>(p: string, a?: 'teacher'): Promise<T> },
  deckId: string,
  wanted: string[],
  timeoutMs: number,
  evidence: { note(t: string, d?: unknown): void },
): Promise<{ status: string; error_message?: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; error_message?: string | null } = { status: 'unknown' };
  while (Date.now() < deadline) {
    last = await api.get<{ status: string; error_message?: string | null }>(`/api/pdfs/${deckId}`);
    if (wanted.includes(last.status)) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  evidence.note('輪詢逾時前的最後狀態', last);
  return last;
}
