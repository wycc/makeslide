import { z } from 'zod';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { callChatJSON } from './openai';
import { validateNotebook, MAX_NOTEBOOK_CELLS, type NotebookDocument } from './notebookAsset';

/**
 * AI generation of an executable notebook page from a topic (Jupyter phase 4b).
 *
 * The model returns a simple, easy-to-validate outline — an ordered list of `markdown` / `code`
 * cells with plain source text — and `outlineToNotebook` turns that into a real nbformat document
 * (code cells get empty `outputs`/`execution_count: null` so they run cleanly in the kernel). The
 * outline shape is deliberately narrow so the LLM can't emit malformed nbformat; the final result
 * still passes through `validateNotebook` before it is persisted. The core is split into pure,
 * unit-testable pieces (`outlineToNotebook`, `buildNotebookGenMessages`) with the network call
 * isolated in `generateNotebookFromTopic`.
 */

/** Upper bound on cells the model may return (well under the storage cap MAX_NOTEBOOK_CELLS). */
export const MAX_GENERATED_CELLS = 40;

export const GeneratedCellSchema = z.object({
  type: z.enum(['markdown', 'code']),
  source: z.string(),
});
export type GeneratedCell = z.infer<typeof GeneratedCellSchema>;

export const GeneratedNotebookSchema = z.object({
  cells: z.array(GeneratedCellSchema).min(1).max(MAX_GENERATED_CELLS),
});
export type GeneratedNotebookOutline = z.infer<typeof GeneratedNotebookSchema>;

/**
 * Convert a generated outline into a valid nbformat notebook. Markdown cells carry only metadata;
 * code cells additionally get `outputs: []` and `execution_count: null` so the kernel treats them
 * as unexecuted. Empty outlines fall back to a single empty code cell so the result is always a
 * runnable notebook.
 */
export function outlineToNotebook(outline: GeneratedNotebookOutline): NotebookDocument {
  const cells = outline.cells.map((cell) =>
    cell.type === 'markdown'
      ? { cell_type: 'markdown' as const, source: cell.source, metadata: {} }
      : { cell_type: 'code' as const, source: cell.source, metadata: {}, outputs: [], execution_count: null },
  );
  return {
    cells: cells.length > 0 ? cells : [{ cell_type: 'code', source: '', metadata: {}, outputs: [], execution_count: null }],
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/** Build the chat messages that ask the model for a notebook outline on `topic`. */
export function buildNotebookGenMessages(topic: string, context?: string): ChatCompletionMessageParam[] {
  const trimmedContext = (context ?? '').trim().slice(0, 2000);
  return [
    {
      role: 'system',
      content:
        '你是 Python 教學助教，負責產生一頁可執行的 Jupyter notebook 教材。' +
        '只回傳 JSON：{"cells":[{"type":"markdown"|"code","source":"..."}]}。' +
        '請交錯使用 markdown 說明與可實際執行的 Python code cell：markdown 用來解說概念（可用標題與清單），' +
        'code 必須是自成一體、可直接執行的 Python（優先使用標準函式庫，需要時才用常見套件如 numpy/pandas/matplotlib）。' +
        '第一個 cell 用 markdown 標題點出主題。source 用 \\n 表示換行，不要加 markdown code fence。' +
        `cell 數量請控制在 ${MAX_GENERATED_CELLS} 個以內。`,
    },
    {
      role: 'user',
      content: trimmedContext ? `主題：${topic}\n\n參考內容：\n${trimmedContext}` : `主題：${topic}`,
    },
  ];
}

/**
 * Ask the LLM to produce a notebook page on `topic`, returning a validated nbformat document.
 * Throws when the generated outline cannot be turned into a valid notebook.
 */
export async function generateNotebookFromTopic(topic: string, context?: string): Promise<NotebookDocument> {
  const result = await callChatJSON({
    label: 'generate_notebook_page',
    schema: GeneratedNotebookSchema,
    maxTokens: 4000,
    temperature: 0.4,
    messages: buildNotebookGenMessages(topic, context),
  });
  const notebook = outlineToNotebook(result.data);
  const validated = validateNotebook(notebook);
  if (!validated.ok) {
    throw new Error(`Generated notebook failed validation: ${validated.message}`);
  }
  return validated.notebook;
}

// Re-exported so the storage-cap constant is discoverable next to the generation cap.
export { MAX_NOTEBOOK_CELLS };
