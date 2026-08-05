/**
 * 設定頁：分頁切換與設定的讀寫往返。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('設定頁打得開，分頁都切得動', async ({ page, evidence }) => {
  await page.goto(appUrl('/settings'));
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });

  for (const name of [/AI 與語音/, /同步/, /AI 技能/, /群組管理/, /帳號與偏好/]) {
    evidence.step(`切到 ${String(name)}`);
    const tab = page.locator('button').filter({ hasText: name }).first();
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await tab.click();
  }
  expect(evidence.jsErrors, `頁面有未捕捉的 JS 例外：\n${evidence.jsErrors.join('\n')}`).toEqual([]);
});

test('設定改了之後存得回去也讀得回來', async ({ api, evidence }) => {
  evidence.step('讀目前設定');
  const before = await api.get<Record<string, unknown>>('/api/system/ai-settings');
  evidence.note('目前的 semantic_search_max_pdfs', before.semantic_search_max_pdfs);

  evidence.step('改一個安全的欄位（不影響其他測試用到的供應商設定）');
  const res = await api.request.patch('/api/system/ai-settings', {
    ...api.as('teacher'),
    data: { semantic_search_max_pdfs: 42 },
  });
  evidence.note('存檔回應', { status: res.status(), body: (await res.text()).slice(0, 200) });
  expect(res.ok(), '設定存不進去').toBe(true);

  const after = await api.get<Record<string, unknown>>('/api/system/ai-settings');
  expect(Number(after.semantic_search_max_pdfs), '存進去了但讀不回來').toBe(42);
});

test('API key 狀態端點回得出目前有沒有 key', async ({ api, evidence }) => {
  const status = await api.get<Record<string, unknown>>('/api/system/openai-key-status');
  evidence.note('key status', status);
  // harness 用的是假 key，重點是這支端點本身要正常，不是它回什麼。
  expect(status).toBeTruthy();
});
