import test from 'node:test';
import assert from 'node:assert/strict';
import {
  outlineToNotebook,
  buildNotebookGenMessages,
  GeneratedNotebookSchema,
  MAX_GENERATED_CELLS,
} from '../src/services/notebookGeneration';
import { validateNotebook } from '../src/services/notebookAsset';

test('outlineToNotebook maps markdown and code cells to nbformat and validates', () => {
  const nb = outlineToNotebook({
    cells: [
      { type: 'markdown', source: '# Title' },
      { type: 'code', source: 'print(1)' },
    ],
  });
  assert.equal(nb.cells.length, 2);
  assert.equal(nb.cells[0].cell_type, 'markdown');
  assert.equal(nb.cells[1].cell_type, 'code');
  // code cells must be runnable: empty outputs + null execution_count
  assert.deepEqual((nb.cells[1] as { outputs: unknown[] }).outputs, []);
  assert.equal((nb.cells[1] as { execution_count: unknown }).execution_count, null);
  // markdown cells carry no outputs key
  assert.equal('outputs' in nb.cells[0], false);
  assert.equal(nb.nbformat, 4);
  // full result must pass the storage validator
  assert.equal(validateNotebook(nb).ok, true);
});

test('outlineToNotebook includes a python kernelspec so the page runs on the kernel', () => {
  const nb = outlineToNotebook({ cells: [{ type: 'code', source: 'x=1' }] });
  const kernelspec = (nb.metadata as { kernelspec?: { name?: string } }).kernelspec;
  assert.equal(kernelspec?.name, 'python3');
});

test('outlineToNotebook falls back to a single empty code cell for an empty outline', () => {
  // Schema forbids empty cells at the boundary, but the mapper is defensive on its own.
  const nb = outlineToNotebook({ cells: [] as never });
  assert.equal(nb.cells.length, 1);
  assert.equal(nb.cells[0].cell_type, 'code');
  assert.equal(validateNotebook(nb).ok, true);
});

test('buildNotebookGenMessages carries the topic and appends optional context', () => {
  const withoutCtx = buildNotebookGenMessages('梯度下降');
  assert.equal(withoutCtx[0].role, 'system');
  assert.match(String(withoutCtx[0].content), /JSON/);
  assert.match(String(withoutCtx[1].content), /梯度下降/);
  assert.equal(/參考內容/.test(String(withoutCtx[1].content)), false);

  const withCtx = buildNotebookGenMessages('梯度下降', '這是第 3 頁的逐字稿');
  assert.match(String(withCtx[1].content), /參考內容/);
  assert.match(String(withCtx[1].content), /逐字稿/);
});

test('GeneratedNotebookSchema rejects empty, oversized, and malformed outlines', () => {
  assert.equal(GeneratedNotebookSchema.safeParse({ cells: [] }).success, false);
  assert.equal(
    GeneratedNotebookSchema.safeParse({ cells: Array.from({ length: MAX_GENERATED_CELLS + 1 }, () => ({ type: 'code', source: 'x' })) }).success,
    false,
  );
  assert.equal(GeneratedNotebookSchema.safeParse({ cells: [{ type: 'sql', source: 'x' }] }).success, false);
  assert.equal(GeneratedNotebookSchema.safeParse({ cells: [{ type: 'code' }] }).success, false);
  assert.equal(GeneratedNotebookSchema.safeParse({ cells: [{ type: 'code', source: 'ok' }] }).success, true);
});
