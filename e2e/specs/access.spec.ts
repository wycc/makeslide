/**
 * 存取控制：不同帳號之間的資料隔離。
 *
 * 這條線壞掉的後果是「甲老師在首頁看到乙老師的簡報」或「學生改得動教材」，
 * 屬於最不能容忍的一類 bug，所以放在第一個功能 spec。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('別人的簡報不會出現在我的首頁清單', async ({ page, api, login, evidence }) => {
  evidence.step('老師建立一份簡報');
  await api.createBlankDeck('老師的私人簡報', 'teacher');

  evidence.step('切換為另一個帳號後重新載入首頁');
  await login('stranger');
  await page.goto(appUrl('/'));
  // 等首頁清單真的抓過一次，否則可能在資料回來前就斷言成功。
  await page.waitForResponse((r) => r.url().includes('/api/pdfs') && r.status() === 200);

  await expect(page.getByText('老師的私人簡報')).toHaveCount(0);
});

test('別的帳號讀不到這份簡報的詳情', async ({ api, evidence }) => {
  evidence.step('老師建立簡報');
  const deckId = await api.createBlankDeck('權限測試簡報', 'teacher');

  evidence.step('以路人身分讀取詳情，應該被拒絕');
  const res = await api.request.get(`/api/pdfs/${deckId}`, api.as('stranger'));
  expect(res.status(), `路人不該讀得到別人的簡報（實際 ${res.status()}）`).toBeGreaterThanOrEqual(400);
});

test('擁有者本人讀得到自己的簡報', async ({ api, evidence }) => {
  evidence.step('建立並以同一帳號讀回');
  const deckId = await api.createBlankDeck('自己的簡報', 'teacher');
  const detail = await api.get<{ id: string; title: string }>(`/api/pdfs/${deckId}`, 'teacher');
  expect(detail.id).toBe(deckId);
  expect(detail.title).toBe('自己的簡報');
});

test('登出後首頁不顯示已登入帳號', async ({ page, logoutUser, evidence }) => {
  evidence.step('登出並重新載入首頁');
  await logoutUser();
  await page.goto(appUrl('/'));
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: /登出/ })).toHaveCount(0);
});
