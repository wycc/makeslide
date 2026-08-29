/**
 * 播放頁：這是唯一「有人在現場等」的畫面，也是全庫最複雜的元件
 * （PlayPage.tsx 3014 行 / 173 個 hook 呼叫）。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('播放頁載得起來，四個側欄分頁都切得動', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('播放頁測試');
  evidence.step('開啟播放頁');
  await page.goto(appUrl(`/play/${deckId}`));

  const slideTab = page.getByRole('tab', { name: /投影片/ });
  await expect(slideTab).toBeVisible({ timeout: 20_000 });

  for (const name of [/AI 助手/, /課堂互動/, /筆記留言/, /投影片/]) {
    evidence.step(`切換到分頁 ${String(name)}`);
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  }

  expect(evidence.jsErrors, `頁面有未捕捉的 JS 例外：\n${evidence.jsErrors.join('\n')}`).toEqual([]);
});

test('新增一頁後頁數增加，且可在頁面之間切換', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('多頁測試');

  evidence.step('用 API 加一張空白頁');
  const res = await api.request.post(`/api/pdfs/${deckId}/pages`, {
    ...api.as('teacher'),
    data: { after_page_number: 1 },
  });
  evidence.note('加頁回應', { status: res.status(), body: (await res.text()).slice(0, 300) });
  expect(res.ok(), '加空白頁應該成功').toBe(true);

  evidence.step('開啟播放頁，應該看得到兩頁');
  await page.goto(appUrl(`/play/${deckId}`));
  await expect(page.getByRole('tab', { name: /投影片/ })).toBeVisible({ timeout: 20_000 });

  const detail = await api.get<{ pages: unknown[] }>(`/api/pdfs/${deckId}`);
  expect(detail.pages.length, '後端應該有兩頁').toBe(2);

  evidence.step('用「下一頁」切換');
  await page.getByRole('button', { name: '下一頁' }).click();
  await expect(page.getByRole('button', { name: '上一頁' })).toBeEnabled();
});

test('逐字稿可以編輯並存回後端', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('逐字稿編輯測試');
  await page.goto(appUrl(`/play/${deckId}`));
  await expect(page.getByRole('tab', { name: /投影片/ })).toBeVisible({ timeout: 20_000 });

  evidence.step('存檔（逐字稿編輯區在側欄，UI 路徑另外測；這裡驗證存取往返）');
  const text = 'E2E 寫入的逐字稿內容';


  const save = await api.request.put(`/api/pdfs/${deckId}/pages/1/script`, {
    ...api.as('teacher'),
    data: { script: text },
  });
  expect(save.ok(), `存逐字稿失敗：${save.status()} ${await save.text()}`).toBe(true);

  evidence.step('讀回來應該是剛剛存的內容——存得進去但讀不回來是常見的半套 bug');
  const stored = await api.request.get(`/api/pdfs/${deckId}/pages/1/script`, api.as('teacher'));
  expect(stored.ok()).toBe(true);
  expect(await stored.text()).toContain(text);
});

test('開啟不存在的簡報時給出可理解的畫面，而不是白畫面', async ({ page, evidence }) => {
  evidence.step('開一個不存在的 id');
  await page.goto(appUrl('/play/this-id-does-not-exist'));
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });
  // 白畫面（root 空）才是真正的失敗；顯示錯誤訊息是正確行為。
});

test('動畫可以設定成「逐字稿句子結束時」開始，且存得回來', async ({ api, evidence }) => {
  const deckId = await api.createBlankDeck('動畫起始錨點測試');

  evidence.step('存一個錨在句尾的動畫效果');
  const spec = {
    version: 1,
    enabled: true,
    effects: [{
      id: 'e1',
      target: 'slide',
      type: 'fade-in',
      start: 0,
      duration: 1,
      ease: 'power1.out',
      startTrigger: { type: 'transcript-line', line: 0, anchor: 'end' },
    }],
  };
  const saved = await api.request.put(`/api/pdfs/${deckId}/pages/1/animation`, {
    ...api.as('teacher'),
    data: { spec },
  });
  expect(saved.ok(), `存動畫失敗：${saved.status()} ${await saved.text()}`).toBe(true);

  evidence.step('讀回來 anchor 必須還在');
  // 這一段最容易默默壞掉：作者設定完看起來正常，重新整理後靜靜變回「句子開始時」。
  const read = await api.request.get(`/api/pdfs/${deckId}/pages/1/animation`, api.as('teacher'));
  expect(read.ok()).toBe(true);
  const body = (await read.json()) as { spec?: { effects?: Array<{ startTrigger?: { anchor?: string } }> } };
  evidence.note('讀回的 startTrigger', body.spec?.effects?.[0]?.startTrigger);
  expect(body.spec?.effects?.[0]?.startTrigger?.anchor).toBe('end');
});

/**
 * 分離出去的浮動編輯視窗與 header 的層級：視窗原本是 z-[135]、header 是 z-[1000]，
 * 把視窗拖到畫面上緣時整段標題列（含「靠回原位」按鈕）會沉到 header 底下不見。
 */
test('浮動編輯視窗拖到畫面上緣時不會被 header 蓋住', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('浮動視窗層級測試');
  await page.goto(appUrl(`/play/${deckId}`));
  await expect(page.getByRole('tab', { name: /投影片/ })).toBeVisible({ timeout: 20_000 });

  evidence.step('把編輯區分離成浮動視窗');
  await page.getByTitle('把編輯區變成可移動的浮動視窗').click();
  const titleBar = page.getByText('✥ 編輯區（浮動視窗）');
  await expect(titleBar).toBeVisible();

  evidence.step('把視窗拖到畫面最上緣（header 所在的位置）');
  const box = await titleBar.boundingBox();
  if (!box) throw new Error('量不到標題列位置');
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(300, 30, { steps: 10 });
  await page.mouse.up();

  const probe = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('span')].find((s) => s.textContent?.includes('編輯區（浮動視窗）'));
    if (!bar) return { found: false } as const;
    const r = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      found: true,
      top: r.y,
      hitIsTitleBar: hit === bar || bar.contains(hit) || Boolean(hit?.closest('section')?.contains(bar)),
      hitInHeader: Boolean(hit?.closest('header')),
      hitTag: hit?.tagName ?? null,
    } as const;
  });
  evidence.note('拖到上緣後的命中結果', probe);

  expect(probe.found, '拖曳後標題列應該還在').toBe(true);
  expect(probe.top, '標題列應該真的被拖到畫面上緣（header 的地盤）').toBeLessThan(120);
  expect(probe.hitInHeader, '標題列的位置不應該命中 header——那表示 header 蓋在視窗上面').toBe(false);
  expect(probe.hitIsTitleBar, '標題列該處最上層的元素應該就是浮動視窗自己').toBe(true);
});
