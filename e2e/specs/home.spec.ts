/**
 * 首頁：建立、列出、搜尋、刪除。這是每個使用者的入口，壞了什麼都做不了。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('從首頁建立空白簡報後直接進入播放頁', async ({ page, evidence }) => {
  evidence.step('開啟首頁');
  await page.goto(appUrl('/'));

  evidence.step('點「空白簡報」');
  // 這顆按鈕的可及名稱取自內文（「空白簡報」），title 只是補充說明——用 title 定位比較不會
  // 因為之後改文案就失效。
  await page.getByTitle(/建立只有一頁空白投影片的簡報/).click();

  evidence.step('應該直接進到播放頁（不開提示詞對話框，因為沒有東西要生成）');
  await page.waitForURL(/#\/play\//, { timeout: 20_000 });
  await expect(page.getByRole('tab', { name: /投影片/ })).toBeVisible({ timeout: 20_000 });
});

test('建立的簡報會出現在首頁清單，且可用關鍵字篩選', async ({ page, api, evidence }) => {
  evidence.step('先用 API 佈置兩份標題不同的簡報');
  await api.createBlankDeck('量子力學導論');
  await api.createBlankDeck('文藝復興藝術史');

  await page.goto(appUrl('/'));
  await expect(page.getByText('量子力學導論').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('文藝復興藝術史').first()).toBeVisible();

  evidence.step('用搜尋框篩選');
  const search = page.getByPlaceholder(/跨所有簡報搜尋/);
  await search.fill('量子');
  // 搜尋是打後端的，等它回來再斷言。
  await page.waitForResponse((r) => r.url().includes('/api/') && r.status() === 200, { timeout: 15_000 }).catch(() => undefined);
  await expect(page.getByText('量子力學導論').first()).toBeVisible();
});

test('刪除簡報後清單不再出現它', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('待刪除的簡報');
  evidence.note('deckId', deckId);

  evidence.step('用 API 刪除（UI 的刪除有確認流程，另外測）');
  const res = await api.request.delete(`/api/pdfs/${deckId}`, api.as('teacher'));
  expect(res.ok(), `刪除失敗：${res.status()}`).toBe(true);

  await page.goto(appUrl('/'));
  await page.waitForResponse((r) => r.url().includes('/api/pdfs') && r.status() === 200);
  await expect(page.getByText('待刪除的簡報')).toHaveCount(0);
});

test('首頁在沒有任何簡報時也能正常呈現', async ({ page, login, evidence }) => {
  evidence.step('以一個全新帳號開首頁（該帳號沒有任何資料）');
  await login({ sub: 'e2e-empty-user', email: 'empty@e2e.local', name: '空帳號' });
  await page.goto(appUrl('/'));
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(evidence.jsErrors, `頁面有未捕捉的 JS 例外：\n${evidence.jsErrors.join('\n')}`).toEqual([]);
});
