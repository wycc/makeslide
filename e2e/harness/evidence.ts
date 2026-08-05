/**
 * 證據收集：把「前端發生什麼」與「後端發生什麼」對齊成一條可讀的時間軸。
 *
 * 這是整套 E2E 的重點。一般的測試只回答「過了沒」；這裡要讓 LLM 只靠產出的檔案
 * 就能診斷失敗原因，不必再問人、也不必重跑。
 *
 * 一個前端症狀（按鈕沒反應、清單是空的、卡在載入中）在後端可能是 401、500、
 * schema 驗證失敗、或根本沒送出請求。只給截圖或只給 log，診斷都會停在猜測；
 * 依時間戳並排之後，因果關係通常一眼可見。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import type { Stack } from './stack';

type EventKind = 'action' | 'console' | 'network' | 'assert' | 'note' | 'backend' | 'llm';

interface TimelineEvent {
  ts: number;
  kind: EventKind;
  text: string;
  detail?: unknown;
}

export class Evidence {
  private readonly events: TimelineEvent[] = [];
  private readonly startedAt = Date.now();
  private readonly consoleErrors: string[] = [];
  private readonly pageErrors: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly stack: Stack,
    private readonly testInfo: TestInfo,
  ) {
    this.attach();
  }

  private attach(): void {
    this.page.on('console', (msg) => {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = msg.text();
      // Vite 在 dev 以外仍可能有無害的資源警告，不當成錯誤但仍記錄。
      if (type === 'error') this.consoleErrors.push(text);
      this.events.push({
        ts: Date.now(),
        kind: 'console',
        text: `${type}: ${truncate(text, 300)}`,
        detail: { location: msg.location() },
      });
    });

    this.page.on('pageerror', (err) => {
      this.consoleErrors.push(err.message);
      this.pageErrors.push(err.message);
      this.events.push({
        ts: Date.now(),
        kind: 'console',
        text: `pageerror: ${err.message}`,
        detail: { stack: err.stack },
      });
    });

    this.page.on('request', (req) => {
      if (!req.url().includes('/api/')) return;
      this.events.push({
        ts: Date.now(),
        kind: 'network',
        text: `→ ${req.method()} ${pathOf(req.url())}`,
      });
    });

    this.page.on('response', (res) => {
      const url = res.url();
      if (!url.includes('/api/')) return;
      const status = res.status();
      const record = async (): Promise<void> => {
        let bodyHead: string | undefined;
        if (status >= 400) {
          // 只在失敗時讀 body：成功回應可能很大（詳情 API 帶整份頁面資料）。
          try {
            bodyHead = truncate(await res.text(), 500);
          } catch {
            bodyHead = '(body unavailable)';
          }
        }
        this.events.push({
          ts: Date.now(),
          kind: 'network',
          text: `← ${status} ${pathOf(url)}`,
          detail: bodyHead ? { body: bodyHead } : undefined,
        });
      };
      void record();
    });
  }

  /** 標記一個測試動作，讓時間軸讀起來像敘事而不是一堆請求。 */
  step(text: string): void {
    this.events.push({ ts: Date.now(), kind: 'action', text });
  }

  note(text: string, detail?: unknown): void {
    this.events.push({ ts: Date.now(), kind: 'note', text, detail });
  }

  /** 這個測試期間瀏覽器 console 的所有錯誤，含資源載入失敗（404 之類）。 */
  get browserErrors(): string[] {
    return [...this.consoleErrors];
  }

  /**
   * 只有未捕捉的 JS 例外。
   *
   * 這與 `browserErrors` 分開，是因為「載某個資源 404」與「React 元件炸了」在
   * console 裡長得一樣，但嚴重度差很多：前者可能只是某個功能沒啟用時的正常探測，
   * 後者是白畫面的前兆。斷言用這個，才不會被無害的 404 淹沒而讓人習慣性忽略紅字。
   */
  get jsErrors(): string[] {
    return [...this.pageErrors];
  }

  /**
   * 落盤。無論成敗都寫，因為「成功但後端一路在噴 warning」也是值得看的資訊。
   */
  async flush(): Promise<void> {
    const finishedAt = Date.now();
    const dir = this.testInfo.outputDir;
    await fs.mkdir(dir, { recursive: true });

    // 後端 log 與假 LLM 呼叫都依這個測試的時間窗裁切後併入時間軸。
    const backendLogs = this.stack.logsBetween(this.startedAt, finishedAt);
    for (const line of backendLogs) {
      if (line.level === 'error' || line.level === 'fatal' || line.level === 'warn') {
        this.events.push({ ts: line.ts, kind: 'backend', text: `${line.level.toUpperCase()} ${truncate(line.msg, 300)}`, detail: { raw: truncate(line.raw, 1500) } });
      }
    }
    const llmCalls = this.stack.fakeOpenAI.calls.filter((c) => {
      const t = Date.parse(c.ts);
      return t >= this.startedAt && t <= finishedAt;
    });
    for (const call of llmCalls) {
      this.events.push({
        ts: Date.parse(call.ts),
        kind: 'llm',
        text: `${call.endpoint} (${call.promptChars} chars${call.matchedRule ? `, rule=${call.matchedRule}` : ''})`,
      });
    }

    const failed = this.testInfo.status !== this.testInfo.expectedStatus;
    if (failed) {
      this.events.push({
        ts: finishedAt,
        kind: 'assert',
        text: `FAILED ${truncate(this.testInfo.error?.message ?? 'unknown error', 600)}`,
      });
      try {
        await this.page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true });
        await fs.writeFile(path.join(dir, 'dom.html'), await this.page.content(), 'utf8');
      } catch {
        // 頁面可能已關閉或崩潰——沒有截圖也要留下其餘證據。
      }
    }

    this.events.sort((a, b) => a.ts - b.ts);

    await fs.writeFile(
      path.join(dir, 'timeline.md'),
      this.renderTimeline(failed, finishedAt),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'console.json'),
      JSON.stringify(this.events.filter((e) => e.kind === 'console'), null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'network.json'),
      JSON.stringify(this.events.filter((e) => e.kind === 'network'), null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'backend.log'),
      backendLogs.map((l) => l.raw).join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'llm-calls.json'),
      JSON.stringify(llmCalls, null, 2),
      'utf8',
    );

    if (failed) {
      // 讓失敗時的 Playwright 報告直接帶上時間軸，不必去翻目錄。
      await this.testInfo.attach('timeline.md', { path: path.join(dir, 'timeline.md'), contentType: 'text/markdown' });
    }
  }

  private renderTimeline(failed: boolean, finishedAt: number): string {
    const icon = failed ? '❌' : '✅';
    const lines: string[] = [
      `## ${icon} ${this.testInfo.titlePath.join(' › ')}`,
      '',
      `- 耗時：${((finishedAt - this.startedAt) / 1000).toFixed(2)}s`,
      `- 瀏覽器 console 錯誤：${this.consoleErrors.length}（其中未捕捉的 JS 例外：${this.pageErrors.length}）`,
      `- 後端 warn/error：${this.events.filter((e) => e.kind === 'backend').length}`,
      `- 假 LLM 呼叫：${this.events.filter((e) => e.kind === 'llm').length}`,
      '',
      '| 時間 | 來源 | 內容 |',
      '|---:|---|---|',
    ];
    for (const e of this.events) {
      const offset = ((e.ts - this.startedAt) / 1000).toFixed(3);
      lines.push(`| ${offset}s | ${e.kind} | ${escapeCell(e.text)} |`);
    }
    const details = this.events.filter((e) => e.detail !== undefined);
    if (details.length > 0) {
      lines.push('', '### 細節', '');
      for (const e of details) {
        lines.push(`- **${e.kind}** \`${truncate(e.text, 120)}\``);
        lines.push('  ```json');
        lines.push(`  ${truncate(JSON.stringify(e.detail), 1200)}`);
        lines.push('  ```');
      }
    }
    return lines.join('\n');
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname + (new URL(url).search || '');
  } catch {
    return url;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
