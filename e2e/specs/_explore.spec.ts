/**
 * 探索用（不是斷言測試）：把首頁與播放頁上可操作的元素列出來，作為撰寫其他 spec 的依據。
 * 全庫目前沒有 data-testid，靠讀 3000 行的 PlayPage 猜選擇器既慢又不準；讓瀏覽器自己說。
 *
 * 平時以 `test.skip` 關閉，需要時用 `E2E_EXPLORE=1` 開啟。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from '../harness/fixtures';
import { RUN_DIR } from '../harness/fixtures';

const enabled = process.env.E2E_EXPLORE === '1';

async function dump(page: import('@playwright/test').Page, name: string): Promise<void> {
  const inventory = await page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const describe = (el: Element): string => {
      const label = (el as HTMLElement).getAttribute('aria-label')
        ?? (el as HTMLElement).getAttribute('title')
        ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
      return label || '(no name)';
    };
    const collect = (selector: string): string[] =>
      Array.from(document.querySelectorAll(selector)).filter(visible).map(describe);
    return {
      buttons: collect('button'),
      links: collect('a'),
      headings: collect('h1,h2,h3'),
      inputs: Array.from(document.querySelectorAll('input,select,textarea'))
        .filter(visible)
        .map((el) => `${el.tagName.toLowerCase()}[${(el as HTMLInputElement).type ?? ''}] ${(el as HTMLElement).getAttribute('placeholder') ?? (el as HTMLElement).getAttribute('aria-label') ?? ''}`),
      tablist: collect('[role="tab"]'),
    };
  });
  await fs.mkdir(RUN_DIR, { recursive: true });
  await fs.writeFile(path.join(RUN_DIR, `inventory-${name}.json`), JSON.stringify(inventory, null, 2), 'utf8');
}

test.describe('探索', () => {
  test.skip(!enabled, '設定 E2E_EXPLORE=1 才執行');

  test('首頁元素盤點', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await dump(page, 'home');
  });

  test('播放頁元素盤點', async ({ page, api }) => {
    const deckId = await api.createBlankDeck('探索用簡報');
    await page.goto(`/#/play/${deckId}`);
    await page.waitForTimeout(3000);
    await dump(page, 'play');
  });

  test('設定頁元素盤點', async ({ page }) => {
    await page.goto('/#/settings');
    await page.waitForTimeout(2000);
    await dump(page, 'settings');
  });
});
