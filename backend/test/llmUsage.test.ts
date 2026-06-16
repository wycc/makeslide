import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LLM_REQUEST_LOG_FILE,
  MODEL_PRICE_PER_1M_TOKENS,
  emptyLlmUsageSummary,
  appendLlmRequestLog,
  appendLlmResponseLog,
  summarizeLlmUsage,
  summarizeLlmUsageByRunIds,
} from '../src/services/llmUsage';

function writeLogLines(lines: unknown[]): void {
  fs.mkdirSync(path.dirname(LLM_REQUEST_LOG_FILE), { recursive: true });
  fs.writeFileSync(LLM_REQUEST_LOG_FILE, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

function withTemporaryLogFile(lines: unknown[], run: () => Promise<void>): Promise<void> {
  const existed = fs.existsSync(LLM_REQUEST_LOG_FILE);
  const backup = existed ? fs.readFileSync(LLM_REQUEST_LOG_FILE, 'utf8') : null;
  writeLogLines(lines);
  return run().finally(() => {
    if (backup !== null) {
      fs.writeFileSync(LLM_REQUEST_LOG_FILE, backup, 'utf8');
    } else {
      fs.rmSync(LLM_REQUEST_LOG_FILE, { force: true });
    }
  });
}

test('summarizeLlmUsage aggregates response entries and estimates cost for priced models', async () => {
  await withTemporaryLogFile(
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
    async () => {
      const summary = await summarizeLlmUsage();
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
  const existed = fs.existsSync(LLM_REQUEST_LOG_FILE);
  const backup = existed ? fs.readFileSync(LLM_REQUEST_LOG_FILE, 'utf8') : null;
  fs.rmSync(LLM_REQUEST_LOG_FILE, { force: true });
  try {
    assert.deepEqual(await summarizeLlmUsage(), emptyLlmUsageSummary());
  } finally {
    if (backup !== null) fs.writeFileSync(LLM_REQUEST_LOG_FILE, backup, 'utf8');
  }
});

test('summarizeLlmUsage filters by pdf_id and run_id', async () => {
  await withTemporaryLogFile(
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
    async () => {
      const all = await summarizeLlmUsage();
      assert.equal(all.requests, 4);

      const byPdf = await summarizeLlmUsage({ pdfId: 'pdf-a' });
      assert.equal(byPdf.requests, 2);
      assert.equal(byPdf.total_tokens, 80);

      const byRun = await summarizeLlmUsage({ runId: 'run-a2' });
      assert.equal(byRun.requests, 1);
      assert.equal(byRun.total_tokens, 60);

      const byPdfAndRun = await summarizeLlmUsage({ pdfId: 'pdf-a', runId: 'run-b1' });
      assert.equal(byPdfAndRun.requests, 0);
    },
  );
});

test('summarizeLlmUsageByRunIds groups usage per run in a single pass', async () => {
  await withTemporaryLogFile(
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
    async () => {
      const byRun = await summarizeLlmUsageByRunIds(['run-1', 'run-2', 'run-missing']);
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
  const existed = fs.existsSync(LLM_REQUEST_LOG_FILE);
  const backup = existed ? fs.readFileSync(LLM_REQUEST_LOG_FILE, 'utf8') : null;
  fs.rmSync(LLM_REQUEST_LOG_FILE, { force: true });
  try {
    await appendLlmRequestLog({ ts: new Date().toISOString(), provider: 'gemini', model: 'gemini-2.0-flash', label: 'test' });
    await appendLlmResponseLog({
      ts: new Date().toISOString(),
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      latencyMs: 500,
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    });
    const summary = await summarizeLlmUsage();
    assert.equal(summary.requests, 1);
    assert.equal(summary.total_tokens, 2_000_000);
    assert.equal(summary.total_latency_ms, 500);
    // gemini-2.0-flash: 1M * 0.075 input + 1M * 0.3 output = 0.375
    assert.equal(summary.estimated_cost_usd, 0.375);
  } finally {
    if (backup !== null) fs.writeFileSync(LLM_REQUEST_LOG_FILE, backup, 'utf8');
    else fs.rmSync(LLM_REQUEST_LOG_FILE, { force: true });
  }
});
