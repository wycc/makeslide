/**
 * Playwright fixtures：把 stack、自動登入與證據收集接成測試可以直接用的形狀。
 */
import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStack, type Stack, REPO_ROOT } from './stack';
import { Evidence } from './evidence';
import { ACCOUNTS, authHeaderFor, loginAs, logout, type AccountName, type E2EAccount } from './session';

export { expect, ACCOUNTS };
export type { AccountName, E2EAccount };

export const RUN_DIR = path.join(REPO_ROOT, 'e2e', 'artifacts', process.env.E2E_RUN_ID ?? 'latest');

/**
 * 前端用的是 HashRouter（`main.tsx`），所以應用內的路由是 `/#/play/:id` 而不是
 * `/play/:id`——後者伺服器上根本沒有這條路由。包成函式免得每支 spec 各自寫錯一次。
 */
export function appUrl(route: string): string {
  const clean = route.startsWith('/') ? route : `/${route}`;
  return clean === '/' ? '/' : `/#${clean}`;
}

interface WorkerFixtures {
  stack: Stack;
}

interface TestFixtures {
  evidence: Evidence;
  /** 已登入為老師的頁面——絕大多數測試的起點。 */
  page: Page;
  /** 直接打 API（不經瀏覽器）：用來佈置前置資料，比點 UI 快且穩。 */
  api: ApiClient;
  login: (account: AccountName | E2EAccount) => Promise<E2EAccount>;
  logoutUser: () => Promise<void>;
}

export interface ApiClient {
  request: APIRequestContext;
  baseUrl: string;
  as(account: AccountName): { headers: Record<string, string> };
  /** 建立一份可立即操作的簡報（空白簡報不需要 AI，最快也最穩）。 */
  createBlankDeck(title: string, account?: AccountName): Promise<string>;
  get<T>(pathname: string, account?: AccountName): Promise<T>;
  post<T>(pathname: string, body: unknown, account?: AccountName): Promise<T>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  stack: [
    async ({}, use) => {
      await fs.mkdir(RUN_DIR, { recursive: true });
      const stack = await startStack({ runDir: RUN_DIR });
      await use(stack);
      await stack.stop();
    },
    { scope: 'worker', timeout: 180_000 },
  ],

  // baseURL 由 stack 決定（隨機埠），所以在這裡覆寫而不是寫死在 config。
  baseURL: async ({ stack }, use) => {
    await use(stack.baseUrl);
  },

  page: async ({ page, stack }, use) => {
    // 介面是雙語的，文字選擇器會隨語言改變。鎖定 zh-TW 讓測試不依賴環境預設。
    await page.context().addInitScript(() => {
      window.localStorage.setItem('makeslide.ui_language', 'zh-TW');
      window.localStorage.setItem('makeslide.content_language', 'zh-TW');
    });
    // 預設就以老師身分登入：多數功能都需要登入，個別測試可再切換或登出。
    await loginAs(page.context(), 'teacher', stack.baseUrl);
    await use(page);
  },

  evidence: async ({ page, stack }, use, testInfo) => {
    const evidence = new Evidence(page, stack, testInfo);
    await use(evidence);
    await evidence.flush();
  },

  login: async ({ page, stack }, use) => {
    await use(async (account) => loginAs(page.context(), account, stack.baseUrl));
  },

  logoutUser: async ({ page }, use) => {
    await use(async () => logout(page.context()));
  },

  api: async ({ playwright, stack }, use) => {
    const request = await playwright.request.newContext({ baseURL: stack.baseUrl });
    const client: ApiClient = {
      request,
      baseUrl: stack.baseUrl,
      as: (account) => ({ headers: authHeaderFor(account) }),
      async get(pathname, account = 'teacher') {
        const res = await request.get(pathname, { headers: authHeaderFor(account) });
        if (!res.ok()) throw new Error(`GET ${pathname} → ${res.status()}: ${await res.text()}`);
        return res.json();
      },
      async post(pathname, body, account = 'teacher') {
        const res = await request.post(pathname, { headers: authHeaderFor(account), data: body });
        if (!res.ok()) throw new Error(`POST ${pathname} → ${res.status()}: ${await res.text()}`);
        return res.json();
      },
      async createBlankDeck(title, account = 'teacher') {
        const created = await client.post<{ id?: string; pdf?: { id: string } }>(
          '/api/pdfs/blank',
          { title },
          account,
        );
        const id = created.id ?? created.pdf?.id;
        if (!id) throw new Error(`blank deck response had no id: ${JSON.stringify(created)}`);
        return id;
      },
    };
    await use(client);
    await request.dispose();
  },
});
