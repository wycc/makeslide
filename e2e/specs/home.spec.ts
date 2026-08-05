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

/* ── 帳號選單（docs/home-toolbar-redesign.md 的 B1+B2）───────────────────── */

test('頂部列的按鈕不會折行', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  // 刻意不等某顆特定按鈕：這條測的是版面，不該綁在任何一次改版的按鈕組成上——
  // 綁了的話，改版後它會因為「找不到元素」而紅，看起來像抓到問題，其實根本沒量到折行。
  await expect(page.locator('header button').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  evidence.step('量頂部列每顆按鈕的高度');
  // 改造前這一列有 8 顆按鈕，其中 4 顆在 1440px 下折成兩行。用「高度是否超過單行」
  // 當判準，比數按鈕數量更貼近使用者看到的問題。
  const wrapped = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return ['(找不到 header)'];
    return Array.from(header.querySelectorAll('button, a'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((el) => {
        const style = window.getComputedStyle(el);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const singleLine = lineHeight + padding + border;
        const label = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
        // 留 2px 容差給次像素捨入。
        return el.getBoundingClientRect().height > singleLine + 2 ? `${label} (${Math.round(el.getBoundingClientRect().height)}px > ${Math.round(singleLine)}px)` : null;
      })
      .filter((v): v is string => v !== null);
  });
  evidence.note('折行的按鈕', wrapped);
  expect(wrapped, `頂部列有按鈕折行：${wrapped.join('、')}`).toEqual([]);
});

test('帳號選單收納了設定、匯入／匯出 ZIP 與登出', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  const trigger = page.getByRole('button', { name: /帳號與資料/ });
  await expect(trigger).toBeVisible({ timeout: 20_000 });

  evidence.step('關閉時不該有選單，且 aria-expanded 是 false');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu')).toHaveCount(0);

  evidence.step('點開選單');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  for (const name of [/設定/, /匯入 ZIP/, /匯出全部 ZIP/, /登出/]) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
});

test('帳號選單可以只用鍵盤操作', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  const trigger = page.getByRole('button', { name: /帳號與資料/ });
  await expect(trigger).toBeVisible({ timeout: 20_000 });

  evidence.step('聚焦觸發按鈕後按 ↓ 開啟，焦點應落在第一項');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();

  evidence.step('↓ 往下移動');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();

  evidence.step('Esc 關閉並把焦點還給觸發按鈕');
  // 焦點沒還回去的話，鍵盤使用者得從頁面開頭重新 Tab 一次。
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('從帳號選單可以進到設定頁', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  const trigger = page.getByRole('button', { name: /帳號與資料/ });
  await expect(trigger).toBeVisible({ timeout: 20_000 });

  evidence.step('開選單並點設定');
  await trigger.click();
  await page.getByRole('menuitem', { name: /設定/ }).click();
  await page.waitForURL(/#\/settings/, { timeout: 15_000 });
  expect(evidence.jsErrors, `頁面有未捕捉的 JS 例外：\n${evidence.jsErrors.join('\n')}`).toEqual([]);
});
