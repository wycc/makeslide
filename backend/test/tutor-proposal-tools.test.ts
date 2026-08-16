import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAiTool, getProposalAiTools, getReadonlyAiTools, toOpenAiTools } from '../src/services/aiTools';

/** The tutor's "offer an edit" tools — docs/tutor-edit-tools.md. */

test('the proposal tools are separate from the read-only set', () => {
  // Read-only callers (script generation, and Q&A from someone without edit rights) must not be
  // handed a tool that spends money or offers a change they cannot take.
  const readonly = getReadonlyAiTools().map((t) => t.name);
  assert.ok(!readonly.includes('propose_page_image_edit'));
  assert.ok(!readonly.includes('propose_script_edit'));
  const proposal = getProposalAiTools().map((t) => t.name);
  assert.deepEqual(proposal.sort(), ['propose_page_image_edit', 'propose_script_edit']);
});

test('the image tool warns the model that it costs money and is capped', () => {
  const tool = getProposalAiTools().find((t) => t.name === 'propose_page_image_edit')!;
  assert.match(tool.description, /costs money/i);
  assert.match(tool.description, /at most one/i);
  // Nothing changes until the user says so; the model should say that rather than imply it applied.
  assert.match(tool.description, /decides whether to apply/i);
});

test('the image tool refuses a second proposal in the same answer', async () => {
  // The counter is spent before generation is attempted, so a first call that fails still counts —
  // which is what stops a model from retrying its way through the cap. Here the deck does not
  // exist, so the first call throws inside the handler and executeAiTool turns it into text.
  const tools = getProposalAiTools();
  const ctx = { accountId: 'a', pdfId: 'no-such-deck', currentPage: 1 };
  const first = await executeAiTool(tools, 'propose_page_image_edit', { instruction: '把背景改成深色' }, ctx);
  assert.match(first.text, /錯誤/);
  const second = await executeAiTool(tools, 'propose_page_image_edit', { instruction: '再改一次' }, ctx);
  assert.match(second.text, /已經提出過/);
  assert.equal(second.proposal, undefined);

  // A fresh answer gets a fresh allowance.
  const later = await executeAiTool(getProposalAiTools(), 'propose_page_image_edit', { instruction: 'x' }, ctx);
  assert.ok(!/已經提出過/.test(later.text));
});

test('both tools need an instruction and a valid page', async () => {
  const ctx = { accountId: 'a', pdfId: 'deck', currentPage: 0 };
  for (const tool of getProposalAiTools()) {
    assert.match(String(await tool.handler({ instruction: '' }, ctx)), /錯誤/);
    assert.match(String(await tool.handler({ instruction: 'do something', page: 0 }, ctx)), /錯誤/);
  }
});

test('a tool with no deck in context refuses rather than guessing one', async () => {
  for (const tool of getProposalAiTools()) {
    assert.match(String(await tool.handler({ instruction: 'x' }, { accountId: 'a' })), /沒有可編輯的簡報/);
  }
});

test('both tools serialise into the OpenAI function shape', () => {
  const fns = toOpenAiTools(getProposalAiTools());
  for (const fn of fns) {
    assert.equal(fn.type, 'function');
    assert.ok(fn.function.parameters);
    assert.deepEqual((fn.function.parameters as { required: string[] }).required, ['instruction']);
  }
});
