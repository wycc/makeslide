import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runId = process.env.E2E_RUN_ID ?? 'latest';
const artifactsDir = path.join(here, 'artifacts', runId);

export default defineConfig({
  testDir: path.join(here, 'specs'),
  outputDir: path.join(artifactsDir, 'tests'),
  // 後端與假 LLM 都是本機的，慢通常代表卡住了——寧可快點失敗並留下時間軸。
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // 生成流程會寫同一個 storage/DB，平行執行會互相干擾；穩定優先。
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(artifactsDir, 'results.json') }],
    ['html', { outputFolder: path.join(artifactsDir, 'html'), open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    // baseURL 由 stack fixture 提供（隨機埠）。
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'off', // 由 evidence.ts 自行處理，才能與時間軸一起落盤
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
      // @mobile 的測試量的是行動版版面，在桌機視窗下跑等於量錯東西。
      grepInvert: /@mobile/,
    },
    {
      // V2_PLAN P0-2：學生端主要在手機上，但播放頁只有 2 處響應式 class。
      // 這個 project 專跑標了 @mobile 的測試，把行動版的實際狀況記錄下來。
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],
});
