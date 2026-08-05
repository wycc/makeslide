/**
 * 截圖用（不是斷言測試）：把要討論的畫面存成圖，供設計檢討使用。
 * 用 `E2E_EXPLORE=1 npm run e2e -- --grep 截圖` 執行。
 */
import path from 'node:path';
import { test, appUrl, RUN_DIR } from '../harness/fixtures';

test.describe('截圖', () => {
  test.skip(process.env.E2E_EXPLORE !== '1', '設定 E2E_EXPLORE=1 才執行');

  test('首頁工具列', async ({ page, api }) => {
    for (const title of ['量子力學導論', '文藝復興藝術史', '深度學習概論', '線性代數複習']) {
      await api.createBlankDeck(title);
    }
    await page.goto(appUrl('/'));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(RUN_DIR, 'home-full.png'), fullPage: true });
    // 只截頂部：這次要討論的就是清單上方那一區。
    await page.screenshot({ path: path.join(RUN_DIR, 'home-toolbar.png'), clip: { x: 0, y: 0, width: 1440, height: 420 } });
  });

  test('首頁工具列（選取狀態）', async ({ page, api }) => {
    for (const title of ['甲簡報', '乙簡報']) await api.createBlankDeck(title);
    await page.goto(appUrl('/'));
    await page.waitForTimeout(2000);
    const selectAll = page.getByRole('button', { name: /全選/ }).first();
    if (await selectAll.count()) {
      await selectAll.click();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: path.join(RUN_DIR, 'home-toolbar-selected.png'), clip: { x: 0, y: 0, width: 1440, height: 420 } });
  });

  test('上傳對話框（矮視窗）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(appUrl('/'));
    await page.getByRole('button', { name: /上傳/ }).click();
    await page.getByRole('menuitem', { name: /^PDF$/ }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(RUN_DIR, 'upload-dialog-short.png') });
  });

  test('上傳選單展開（窄視窗）', async ({ page, api }) => {
    await api.createBlankDeck('層級測試');
    await page.setViewportSize({ width: 620, height: 800 });
    await page.goto(appUrl('/'));
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /上傳/ }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(RUN_DIR, 'upload-menu-open.png'), clip: { x: 0, y: 0, width: 620, height: 500 } });
  });

  test('首頁工具列（手機） @mobile', async ({ page, api }) => {
    for (const title of ['手機甲', '手機乙']) await api.createBlankDeck(title);
    await page.goto(appUrl('/'));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(RUN_DIR, 'home-toolbar-mobile.png'), fullPage: false });
  });
});
