import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  LLM_REQUEST_LOG_FILE,
  MODEL_PRICE_PER_1M_TOKENS,
  emptyLlmUsageSummary,
  appendLlmRequestLog,
  appendLlmResponseLog,
  summarizeLlmUsage,
  summarizeLlmUsageByRunIds,
} from '../src/services/llmUsage';

// Every test below used to read/write the one real shared LLM_REQUEST_LOG_FILE (backing it up
// and restoring it afterwards). That's unsafe when the full test suite runs many files
// concurrently in the same process: any other test that triggers a real appendLlmRequestLog/
// appendLlmResponseLog call (e.g. via a mocked OpenAI client) races with this file's
// backup/overwrite/restore dance, and the unfiltered `summarizeLlmUsage()` assertions here
// (which count *every* line in the file) break if extra entries land mid-test. Each test now
// gets its own throwaway file via the `logFilePath` override the service functions accept
// (added for exactly this purpose), so nothing here ever touches the real shared log again.
function tempLogPath(): string {
  return path.join(os.tmpdir(), `llm-usage-test-${crypto.randomUUID()}.jsonl`);
}

async function withLogFile(lines: unknown[], run: (logPath: string) => Promise<void>): Promise<void> {
  const logPath = tempLogPath();
  fs.writeFileSync(logPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  try {
    await run(logPath);
  } finally {
    fs.rmSync(logPath, { force: true });
  }
}

test('summarizeLlmUsage aggregates response entries and estimates cost for priced models', async () => {
  await withLogFile(
    [
      { kind: 'request', model: 'gpt-4o-mini', label: 'a' },
      {
        kind: 'response',
        model: 'gpt-4o-mini',
        latencyMs: 100,
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      },
      {
        kind: 'response',
        model: 'gpt-4o-mini',
        latencyMs: 200,
        usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
      },
      // 未知模型：仍計入用量/延遲，但不計入估計費用。
      {
        kind: 'response',
        model: 'unknown-model',
        latencyMs: 50,
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      },
      'not even json',
    ],
    async (logPath) => {
      const summary = await summarizeLlmUsage(undefined, logPath);
      assert.equal(summary.requests, 3);
      assert.equal(summary.prompt_tokens, 3100);
      assert.equal(summary.completion_tokens, 1600);
      assert.equal(summary.total_tokens, 4700);
      assert.equal(summary.total_latency_ms, 350);
      // gpt-4o-mini: (3000/1e6)*0.15 input + (1500/1e6)*0.6 output = 0.00045 + 0.0009 = 0.00135
      assert.equal(summary.estimated_cost_usd, 0.00135);
    },
  );
});

test('summarizeLlmUsage returns an empty summary when the log file is absent', async () => {
  const missingPath = tempLogPath(); // never written, so guaranteed not to exist
  assert.deepEqual(await summarizeLlmUsage(undefined, missingPath), emptyLlmUsageSummary());
});

test('summarizeLlmUsage filters by pdf_id and run_id', async () => {
  await withLogFile(
    [
      {
        kind: 'response',
        model: 'gpt-4o-mini',
        latencyMs: 10,
        pdf_id: 'pdf-a',
        run_id: 'run-a1',
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      },
      {
        kind: 'response',
        model: 'gpt-4o-mini',
        latencyMs: 20,
        pdf_id: 'pdf-a',
        run_id: 'run-a2',
        usage: { prompt_tokens: 30, completion_tokens: 30, total_tokens: 60 },
      },
      {
        kind: 'response',
        model: 'gpt-4o-mini',
        latencyMs: 30,
        pdf_id: 'pdf-b',
        run_id: 'run-b1',
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      },
      // 沒有 pdf_id/run_id 的舊資料：不應計入任何 filter 結果，但會計入全域總計。
      {
        kind: 'response',
        model: 'gpt-4o-mini',
        latencyMs: 5,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ],
    async (logPath) => {
      const all = await summarizeLlmUsage(undefined, logPath);
      assert.equal(all.requests, 4);

      const byPdf = await summarizeLlmUsage({ pdfId: 'pdf-a' }, logPath);
      assert.equal(byPdf.requests, 2);
      assert.equal(byPdf.total_tokens, 80);

      const byRun = await summarizeLlmUsage({ runId: 'run-a2' }, logPath);
      assert.equal(byRun.requests, 1);
      assert.equal(byRun.total_tokens, 60);

      const byPdfAndRun = await summarizeLlmUsage({ pdfId: 'pdf-a', runId: 'run-b1' }, logPath);
      assert.equal(byPdfAndRun.requests, 0);
    },
  );
});

test('summarizeLlmUsageByRunIds groups usage per run in a single pass', async () => {
  await withLogFile(
    [
      {
        kind: 'response',
        model: 'gpt-4o',
        latencyMs: 10,
        pdf_id: 'pdf-a',
        run_id: 'run-1',
        usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
      },
      {
        kind: 'response',
        model: 'gpt-4o',
        latencyMs: 20,
        pdf_id: 'pdf-a',
        run_id: 'run-2',
        usage: { prompt_tokens: 0, completion_tokens: 1_000_000, total_tokens: 1_000_000 },
      },
      // run-3 不在查詢的 runIds 中，不應出現在結果裡。
      {
        kind: 'response',
        model: 'gpt-4o',
        latencyMs: 30,
        pdf_id: 'pdf-a',
        run_id: 'run-3',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ],
    async (logPath) => {
      const byRun = await summarizeLlmUsageByRunIds(['run-1', 'run-2', 'run-missing'], logPath);
      assert.equal(byRun.size, 2);
      assert.equal(byRun.get('run-1')?.estimated_cost_usd, 2.5); // 1M prompt tokens * $2.5/1M
      assert.equal(byRun.get('run-2')?.estimated_cost_usd, 10); // 1M completion tokens * $10/1M
      assert.equal(byRun.has('run-missing'), false);
      assert.equal(byRun.has('run-3'), false);
    },
  );
});

test('summarizeLlmUsageByRunIds returns an empty map for an empty run id list', async () => {
  assert.equal((await summarizeLlmUsageByRunIds([])).size, 0);
});

test('MODEL_PRICE_PER_1M_TOKENS includes Gemini model pricing', () => {
  assert.ok('gemini-2.0-flash' in MODEL_PRICE_PER_1M_TOKENS, 'gemini-2.0-flash should have pricing');
  assert.ok('gemini-2.0-flash-lite' in MODEL_PRICE_PER_1M_TOKENS, 'gemini-2.0-flash-lite should have pricing');
  assert.equal(MODEL_PRICE_PER_1M_TOKENS['gemini-2.0-flash']!.input, 0.075);
  assert.equal(MODEL_PRICE_PER_1M_TOKENS['gemini-2.0-flash']!.output, 0.3);
});

test('appendLlmRequestLog and appendLlmResponseLog write entries picked up by summarizeLlmUsage', async () => {
  const logPath = tempLogPath();
  try {
    await appendLlmRequestLog({ ts: new Date().toISOString(), provider: 'gemini', model: 'gemini-2.0-flash', label: 'test' }, logPath);
    await appendLlmResponseLog({
      ts: new Date().toISOString(),
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      latencyMs: 500,
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    }, logPath);
    const summary = await summarizeLlmUsage(undefined, logPath);
    assert.equal(summary.requests, 1);
    assert.equal(summary.total_tokens, 2_000_000);
    assert.equal(summary.total_latency_ms, 500);
    // gemini-2.0-flash: 1M * 0.075 input + 1M * 0.3 output = 0.375
    assert.equal(summary.estimated_cost_usd, 0.375);
  } finally {
    fs.rmSync(logPath, { force: true });
  }
});

test('appendLlmRequestLog/appendLlmResponseLog default to the real shared LLM_REQUEST_LOG_FILE when no override is given', () => {
  // Guards the production call sites in openai.ts/gemini.ts, which never pass a path — only
  // tests do. If this constant or the default parameter ever drift apart, those call sites
  // would silently start writing/reading the wrong file.
  assert.ok(LLM_REQUEST_LOG_FILE.endsWith(path.join('backend', 'data', 'llm-requests.log.jsonl')));
});
