/**
 * 行動裝置上的學生端 @mobile
 *
 * V2_PLAN 的 P0-2：產品發 QR code 讓學生用手機加入，但 `PlayPage.tsx` 全檔只有
 * 2 處響應式 class。這幾條測試的用途是把「實際上有多不能用」量出來，成為改善
 * 前後的對照，而不是假設它一定壞或一定好。
 */
import { test, expect, appUrl } from '../harness/fixtures';

test('學生在手機上打得開播放頁 @mobile', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('手機測試簡報');
  await page.goto(appUrl(`/play/${deckId}`));
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 25_000 });
  evidence.note('viewport', page.viewportSize());
});

test('播放頁在手機寬度下不應該需要橫向捲動 @mobile', async ({ page, api, evidence }) => {
  const deckId = await api.createBlankDeck('手機橫捲測試');
  await page.goto(appUrl(`/play/${deckId}`));
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 25_000 });
  // 等版面穩定，否則量到的是還在排版中的中間狀態。
  await page.waitForTimeout(1500);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  evidence.note('版面寬度', overflow);
  expect(
    overflow.scrollWidth,
    `頁面比視窗寬 ${overflow.scrollWidth - overflow.clientWidth}px，手機上要左右拖才看得完`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('首頁在手機上不需要橫向捲動 @mobile', async ({ page, api, evidence }) => {
  await api.createBlankDeck('手機首頁測試');
  await page.goto(appUrl('/'));
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 25_000 });
  await page.waitForTimeout(1000);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  evidence.note('版面寬度', overflow);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('頂部列的按鈕文字不會溢出按鈕邊界 @mobile', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  await expect(page.locator('header button').first()).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(800);

  // 改造前「YouTube 匯入」的文字會超出自己的邊框（見 docs/home-toolbar-redesign.md 的 D7）。
  // 這與「頁面有沒有橫向捲動」是兩回事——後者當時是通過的，所以只量頁面寬度會漏掉這種破版。
  const overflowing = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return ['(找不到 header)'];
    return Array.from(header.querySelectorAll('button, a'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 20)} (${el.scrollWidth} > ${el.clientWidth})`);
  });
  evidence.note('文字溢出的按鈕', overflowing);
  expect(overflowing, `按鈕文字溢出邊界：${overflowing.join('、')}`).toEqual([]);
});
