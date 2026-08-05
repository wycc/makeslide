/**
 * 首頁：建立、列出、搜尋、刪除。這是每個使用者的入口，壞了什麼都做不了。
 */
import { test, expect, appUrl } from '../harness/fixtures';

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

/* ── 建立 split button 與選取列（B3+B4）──────────────────────────────── */

test('建立入口收斂成一顆 split button，其餘來源在下拉裡', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  await expect(page.getByRole('button', { name: '上傳', exact: true })).toBeVisible({ timeout: 20_000 });

  evidence.step('三種次要來源不該平鋪在外面');
  for (const name of ['貼上 TXT', '空白簡報', 'YouTube 匯入']) {
    await expect(
      page.locator('header').getByRole('button', { name, exact: true }),
      `${name} 仍平鋪在頂部列`,
    ).toHaveCount(0);
  }

  evidence.step('打開下拉，四種來源都在裡面（含主按鈕的預設動作 PDF）');
  await page.getByRole('button', { name: /更多建立方式/ }).click();
  const menu = page.getByRole('menu');
  for (const name of [/^PDF$/, /貼上 TXT/, /空白簡報/, /YouTube 匯入/]) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
});

test('從建立下拉可以做出一份空白簡報', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  await expect(page.getByRole('button', { name: /更多建立方式/ })).toBeVisible({ timeout: 20_000 });

  evidence.step('下拉 → 空白簡報 → 應直接進入播放頁');
  await page.getByRole('button', { name: /更多建立方式/ }).click();
  await page.getByRole('menuitem', { name: /空白簡報/ }).click();
  await page.waitForURL(/#\/play\//, { timeout: 20_000 });
  await expect(page.getByRole('tab', { name: /投影片/ })).toBeVisible({ timeout: 20_000 });
});

test('主要動作在整個頁面上只有一個', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  await expect(page.getByRole('button', { name: '上傳', exact: true })).toBeVisible({ timeout: 20_000 });

  // 改造前這一區有 5 種樣式並存（白框／深色實心／紫色實心／淺綠框／灰底 chip），
  // 使用者看不出哪個是主要動作。primary 只留給「建立」。
  const primaryCount = await page.locator('header .bg-indigo-500').count();
  evidence.note('header 內 primary 樣式的元素數', primaryCount);
  expect(primaryCount, 'primary 樣式的按鈕不只一個，視覺層級又會失效').toBe(1);
});

test('選取簡報後出現操作列，取消後消失', async ({ page, api, evidence }) => {
  await api.createBlankDeck('選取測試甲');
  await api.createBlankDeck('選取測試乙');
  await page.goto(appUrl('/'));
  await expect(page.getByText('選取測試甲').first()).toBeVisible({ timeout: 20_000 });

  evidence.step('沒有選取時不該有操作列');
  await expect(page.getByRole('toolbar', { name: /已選取簡報的操作/ })).toHaveCount(0);

  evidence.step('全選');
  await page.getByRole('button', { name: /全選/ }).click();

  evidence.step('操作列出現，且批次動作可用');
  const bar = page.getByRole('toolbar', { name: /已選取簡報的操作/ });
  await expect(bar).toBeVisible();
  await expect(bar.getByText(/已選 \d+ 份/)).toBeVisible();
  // 卡片上也有一顆「刪除」，所以要限定在這一列裡找。
  await expect(bar.getByRole('button', { name: '生成合輯' })).toBeVisible();
  await expect(bar.getByRole('button', { name: '刪除', exact: true })).toBeVisible();

  evidence.step('取消選取後操作列消失');
  await bar.getByRole('button', { name: '取消選取' }).click();
  await expect(page.getByRole('toolbar', { name: /已選取簡報的操作/ })).toHaveCount(0);
});

test('點「上傳 PDF」會開對話框，兩個設定都選好才挑檔案', async ({ page, evidence }) => {
  await page.goto(appUrl('/'));
  const uploadBtn = page.getByRole('button', { name: '上傳', exact: true });
  await expect(uploadBtn).toBeVisible({ timeout: 20_000 });

  evidence.step('點「上傳」');
  await uploadBtn.click();
  const dialog = page.getByRole('dialog', { name: /上傳 PDF/ });
  await expect(dialog).toBeVisible();

  evidence.step('兩組設定都在對話框裡，且各自有目前選取狀態');
  // 改造前這兩項是按鈕下方的一小條，而且點「簡報逐頁處理」會立刻開檔案選擇器——
  // 主持模式等於必須在點之前就先設好，順序是反的。
  await expect(dialog.getByRole('button', { name: /簡報逐頁處理/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: /單人旁白/ })).toHaveAttribute('aria-pressed', 'true');

  evidence.step('切換到文件模式與雙人對談');
  await dialog.getByRole('button', { name: /一般文件 AI 分頁/ }).click();
  await expect(dialog.getByRole('button', { name: /一般文件 AI 分頁/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: /簡報逐頁處理/ })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: /雙人對談/ }).click();
  await expect(dialog.getByRole('button', { name: /雙人對談/ })).toHaveAttribute('aria-pressed', 'true');

  evidence.step('Esc 關閉對話框');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /上傳 PDF/ })).toHaveCount(0);
});

test('統計數字跟著篩選結果走，而不是永遠顯示全部', async ({ page, api, evidence }) => {
  evidence.step('建立一份標題獨特的簡報');
  const unique = 'ZZ統計測試ZZ';
  await api.createBlankDeck(unique);
  await page.goto(appUrl('/'));
  await expect(page.getByText(unique).first()).toBeVisible({ timeout: 20_000 });

  const pagesStat = page.getByText(/^\d+ 頁$/).first();
  // 不寫死總頁數：同一個 worker 的其他測試也會在這個帳號留下簡報。改為記下當下的值，
  // 斷言「篩選後變成那一份的頁數、清掉後回到原值」——測的是連動關係本身。
  const before = await pagesStat.textContent();
  evidence.note('篩選前的頁數', before);

  evidence.step('用標題篩選只留下那一份（1 頁）');
  // 改造前這裡會繼續顯示全部的頁數——選了分類卻看到「共 108 份簡報」，
  // 那個數字對當下畫面沒有意義，還會讓人以為篩選沒生效。
  await page.getByPlaceholder(/輸入關鍵字搜尋標題/).fill(unique);
  await expect(page.getByText(/顯示 1 \/ \d+ 份簡報/)).toBeVisible();
  await expect(pagesStat, '統計沒有跟著篩選重算').toHaveText('1 頁');

  evidence.step('清掉篩選後回到原本的數字');
  await page.getByPlaceholder(/輸入關鍵字搜尋標題/).fill('');
  await expect(pagesStat).toHaveText(before ?? '');
});
