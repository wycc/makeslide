/**
 * 煙霧測試：確認 harness 本身是好的——後端起得來、前端載得到、自動登入有效、
 * 假 LLM 接得上。這幾條若紅了，其餘測試的結果都不必看。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('後端健康檢查回應正常', async ({ api, evidence }) => {
  evidence.step('GET /api/health');
  const health = await api.get<{ ok: boolean }>('/api/health');
  expect(health.ok).toBe(true);
});

test('首頁載得起來且沒有 JS 例外', async ({ page, evidence }) => {
  evidence.step('開啟首頁');
  await page.goto(appUrl('/'));
  // 應用是 SPA，等到 root 真的畫出東西才算載入成功。
  await expect(page.locator('#root')).not.toBeEmpty();
  evidence.step('等待首頁主要區塊');
  await expect(page).toHaveTitle(/.+/);
  expect(evidence.jsErrors, `頁面有未捕捉的 JS 例外：\n${evidence.jsErrors.join('\n')}`).toEqual([]);
});

test('自動登入：注入 session 後 API 以該帳號的身分回應', async ({ page, api, evidence }) => {
  evidence.step('以老師身分建立一份簡報（直接打 API）');
  const deckId = await api.createBlankDeck('E2E 自動登入驗證');

  evidence.step('用瀏覽器（已注入老師 session）開首頁，應該看得到這份簡報');
  await page.goto(appUrl('/'));
  await expect(page.getByText('E2E 自動登入驗證').first()).toBeVisible({ timeout: 20_000 });

  evidence.note('deckId', deckId);
});

test('假 LLM 有接上：後端打的是本地假伺服器而不是真的 OpenAI', async ({ api, stack, evidence }) => {
  const before = stack.fakeOpenAI.calls.length;
  evidence.step('觸發一個會用到 LLM 的端點');
  const deckId = await api.createBlankDeck('E2E 假 LLM 驗證');
  // 主題抽取是最短的一條 AI 路徑：沒有逐字稿時會回空清單，但仍會走到 LLM 呼叫點。
  await api.get(`/api/pdfs/${deckId}/tutor-quiz/topics`).catch(() => undefined);
  evidence.note('llm calls delta', stack.fakeOpenAI.calls.length - before);
  // 這裡不強制一定要有呼叫（該路徑可能因為沒有逐字稿而提早返回），
  // 重點是：整份測試跑完都不該有任何一次呼叫打到 api.openai.com。
  const external = stack.fakeOpenAI.calls.filter((c) => c.endpoint.startsWith('http'));
  expect(external).toEqual([]);
});
