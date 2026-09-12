/**
 * The MCP surface for importing a PowerPoint (docs/pptx-animated-import-design.md §5).
 *
 * The tool definitions are checked here rather than through a spawned server — that part is
 * covered by the other MCP tests — and what these tests really guard is the pair of properties an
 * agent depends on: the long work answers immediately and is followed by polling, and the
 * endpoints behind the tools exist and refuse what they should.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { TOOLS } from '../src/mcp-server';
import { writePageSteps } from '../src/services/pageSteps';
import { pageStepAudioName } from '../src/services/storage';

setSystemAuthSettings({ googleAuthEnabled: false });

const NEW_TOOLS = ['upload_pptx', 'get_pptx_import_status', 'narrate_pptx_steps', 'get_page_steps'];

function seedImportedDeck(pdfId: string, pageUid: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?)`,
  ).run(pdfId, 'imported', 'deck.pptx', t, t);
  fs.mkdirSync(path.join(config.storageRoot, pdfId, 'pages'), { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,render_type,status,created_at,updated_at)
     VALUES (?,1,?,'react','audio_ready',?,?)`,
  ).run(pdfId, pageUid, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('the pptx tools are exposed, each with the arguments its handler requires', () => {
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
  for (const name of NEW_TOOLS) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} is missing`);
    assert.ok(tool!.description.length > 40, `${name} needs a description an agent can act on`);
  }
  assert.deepEqual(byName.get('upload_pptx')!.inputSchema.required, ['file_path']);
  assert.deepEqual(byName.get('get_pptx_import_status')!.inputSchema.required, ['id']);
  assert.deepEqual(byName.get('narrate_pptx_steps')!.inputSchema.required, ['id']);
  assert.deepEqual(byName.get('get_page_steps')!.inputSchema.required, ['id', 'page']);
});

test('the import and narration tools tell the agent they are asynchronous', () => {
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
  // An agent that does not know to poll will report a half-built deck as finished.
  assert.match(byName.get('upload_pptx')!.description, /get_pptx_import_status/);
  assert.match(byName.get('narrate_pptx_steps')!.description, /get_pptx_import_status/);
  // And that narration costs money, so it is not something to call speculatively.
  assert.match(byName.get('narrate_pptx_steps')!.description, /費用/);
});

test('the status endpoint answers for a deck whose job is no longer in memory', async () => {
  const pdfId = 'mcp-pptx-status-01';
  seedImportedDeck(pdfId, 'uid1');
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pptx-import/status` });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { status: string; narration: unknown; page_count: number };
    // A restart must not turn "this deck was imported" into "no such job".
    assert.equal(body.status, 'succeeded');
    assert.equal(body.narration, null);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('narration never quietly succeeds for a deck with no stored pptx', async () => {
  const pdfId = 'mcp-pptx-narrate-01';
  seedImportedDeck(pdfId, 'uid1');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pptx-narration`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text_only: true }),
    });
    if (resp.statusCode !== 202) {
      // No LLM configured on this host: refusing up front is the right answer, and the agent is
      // told why rather than being handed a job that can never finish.
      assert.ok(resp.statusCode >= 400, `expected a refusal, got ${resp.statusCode}`);
      assert.ok(String(resp.json().error?.message ?? '').length > 0);
      return;
    }
    // Otherwise the job starts and fails, which is what the agent's polling reports.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/pptx-import/status` });
    const narration = (status.json() as { narration: { status: string; error: string | null } | null }).narration;
    assert.equal(narration?.status, 'failed');
    assert.match(narration?.error ?? '', /pptx/);
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('the deck detail gives get_page_steps everything it reports', async () => {
  const pdfId = 'mcp-pptx-steps-01';
  seedImportedDeck(pdfId, 'uid1');
  const app = await buildApp();
  try {
    writePageSteps(pdfId, 'uid1', {
      version: 1,
      source: 'pptx',
      steps: [
        { index: 0, script: '先看整體', audio: pageStepAudioName('uid1', 0), audioDurationSeconds: 4.2 },
        { index: 1, script: '再看細節' },
      ],
    });
    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}` });
    const page = (detail.json() as { pages: Array<{ steps: Array<{ script: string; audio_url: string | null; audio_duration_seconds: number | null }> | null }> }).pages[0]!;
    assert.equal(page.steps?.length, 2);
    assert.equal(page.steps?.[0]?.script, '先看整體');
    assert.equal(page.steps?.[0]?.audio_duration_seconds, 4.2);
    assert.equal(page.steps?.[1]?.audio_url, null, 'a step with no voice reports none');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});
