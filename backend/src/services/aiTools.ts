/**
 * In-process, read-only "AI tools" that makeslide can hand to the LLM as
 * function-calling tools during its own generation / Q&A calls, so the model can
 * pull more presentation context (other pages' slide text / scripts, deck
 * metadata) before answering. See docs/mcp-tools-in-ai-design.md.
 *
 * These mirror the read-only subset of the external MCP tools (mcp-server.ts) but
 * execute directly against the DB/filesystem — no HTTP, no token. Every handler is
 * strictly read-only and scoped to the current account (a model must never reach
 * another account's presentations, and must never cause side effects). Deduplicating
 * this with mcp-server.ts is Phase 2.
 */
import * as fs from 'node:fs';
import sharp from 'sharp';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { db } from '../db';
import { safeJoinPdfPath } from './storage';
import { accountIdFromOwnerSub } from './accountContext';
import { proposePageImageEdit, proposeScriptEdit } from './pageEditProposals';

export interface AiToolContext {
  /** Current account (from currentAccountId()); tools may only see this account's decks. */
  accountId: string;
  /** The presentation currently being generated/answered, used as the default `id`. */
  pdfId?: string;
  /** The page the user is looking at, used when a tool's `page` argument is omitted. */
  currentPage?: number;
}

/**
 * Something the tutor is offering to change, for the user to accept or discard.
 *
 * Deliberately *not* a change. The page's JPG and script are untouched until the user applies it
 * through the paths that already exist for those edits — see docs/tutor-edit-tools.md §2.
 */
export type AiToolProposal =
  | {
      kind: 'image';
      page: number;
      /** Candidate produced by the same path as the "modify image" button; applied on demand. */
      candidateId: string;
      imageUrl: string;
      instruction: string;
    }
  | {
      kind: 'script';
      page: number;
      /**
       * The script as it was when the proposal was made. The diff has to be against this, not
       * against the file at apply time: the user may have edited it meanwhile, and diffing against
       * the current text would show changes the tutor never proposed.
       */
      original: string;
      proposed: string;
      instruction: string;
    };

/** A tool result: text, plus (optionally) image data URLs to attach to the model as vision input. */
export interface AiToolResult {
  text: string;
  /** data: URLs the model should see; the tool loop attaches them as a vision message. */
  images?: string[];
  /** Structured payload for the UI, separate from the `text` the model reads. */
  proposal?: AiToolProposal;
}

export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (OpenAI function `parameters`). */
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<string | AiToolResult>;
}

// Cap each tool result so a chatty tool can't blow up the context window.
const MAX_TOOL_RESULT_CHARS = 8000;
// Downscale page images before sending to the model to keep tokens/latency bounded.
const PAGE_IMAGE_MAX_WIDTH = 1024;

function truncate(text: string): string {
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n……（內容過長，後略）……`
    : text;
}

interface PdfRow {
  id: string;
  title: string | null;
  status: string | null;
  page_count: number | null;
  owner_sub: string | null;
}

/** Fetch a deck row only if it belongs to the current account; otherwise null. */
function ownedPdf(id: string, ctx: AiToolContext): PdfRow | null {
  const row = db
    .prepare(`SELECT id, title, status, page_count, owner_sub FROM pdfs WHERE id = ?`)
    .get(id) as PdfRow | undefined;
  if (!row) return null;
  if (accountIdFromOwnerSub(row.owner_sub) !== ctx.accountId) return null;
  return row;
}

function readPageFile(id: string, column: 'text_path' | 'script_path', page: number): string | null {
  const row = db
    .prepare(`SELECT ${column} AS p FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(id, page) as { p: string | null } | undefined;
  if (!row) return null; // page does not exist
  if (!row.p) return ''; // page exists but has no such artifact yet
  try {
    return fs.readFileSync(safeJoinPdfPath(id, row.p), 'utf8');
  } catch {
    return '';
  }
}

function resolveId(args: Record<string, unknown>, ctx: AiToolContext): string {
  const raw = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : ctx.pdfId;
  return raw ?? '';
}

const READONLY_TOOLS: AiTool[] = [
  {
    name: 'list_presentations',
    description: '列出目前帳號的所有簡報（回傳 ID、標題、狀態與頁數）。當你需要引用其他簡報時可先用此工具找出其 ID。',
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = db
        .prepare(`SELECT id, title, status, page_count, owner_sub FROM pdfs ORDER BY created_at DESC LIMIT 200`)
        .all() as PdfRow[];
      const mine = rows.filter((r) => accountIdFromOwnerSub(r.owner_sub) === ctx.accountId);
      if (!mine.length) return '（目前帳號沒有任何簡報。）';
      return truncate(
        mine
          .map((p) => `• ID: ${p.id} | 標題: ${p.title ?? '（無標題）'} | 狀態: ${p.status ?? '—'} | 頁數: ${p.page_count ?? '?'}`)
          .join('\n'),
      );
    },
  },
  {
    name: 'get_presentation',
    description: '取得指定簡報的中繼資料與逐頁摘要（每頁的頁碼、狀態與投影片文字前段）。用於掌握整份簡報結構。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '簡報 ID；省略則指目前正在處理的簡報。' } },
      required: [],
    },
    async handler(args, ctx) {
      const id = resolveId(args, ctx);
      if (!id) return '錯誤：未指定簡報 ID，且沒有預設簡報。';
      const pdf = ownedPdf(id, ctx);
      if (!pdf) return `錯誤：找不到簡報 ${id}，或無權存取。`;
      const pages = db
        .prepare(`SELECT page_number, status, text_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
        .all(id) as Array<{ page_number: number; status: string | null; text_path: string | null }>;
      const lines = pages.map((p) => {
        let preview = '';
        if (p.text_path) {
          try { preview = fs.readFileSync(safeJoinPdfPath(id, p.text_path), 'utf8').replace(/\s+/g, ' ').trim().slice(0, 120); } catch { /* ignore */ }
        }
        return `- 第 ${p.page_number} 頁（${p.status ?? '—'}）：${preview || '（無文字）'}`;
      });
      return truncate(
        [`簡報 ${id}`, `標題：${pdf.title ?? '（無標題）'}`, `狀態：${pdf.status ?? '—'}`, `頁數：${pages.length}`, '', '逐頁摘要：', ...lines].join('\n'),
      );
    },
  },
  {
    name: 'get_page_text',
    description: '讀取簡報某一頁的投影片文字（page text）。用於查看某頁畫面上實際呈現的內容。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID；省略則指目前正在處理的簡報。' },
        page: { type: 'number', description: '頁碼（從 1 開始）。' },
      },
      required: ['page'],
    },
    async handler(args, ctx) {
      const id = resolveId(args, ctx);
      if (!id) return '錯誤：未指定簡報 ID，且沒有預設簡報。';
      if (!ownedPdf(id, ctx)) return `錯誤：找不到簡報 ${id}，或無權存取。`;
      const page = Number(args.page);
      if (!Number.isInteger(page) || page < 1) return '錯誤：page 必須是正整數。';
      const text = readPageFile(id, 'text_path', page);
      if (text === null) return `錯誤：第 ${page} 頁不存在。`;
      return truncate(text.trim() || '（此頁沒有投影片文字。）');
    },
  },
  {
    name: 'get_page_script',
    description: '讀取簡報某一頁已生成的腳本（逐字稿）。用於參考鄰頁的敘述風格與術語以維持一致。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID；省略則指目前正在處理的簡報。' },
        page: { type: 'number', description: '頁碼（從 1 開始）。' },
      },
      required: ['page'],
    },
    async handler(args, ctx) {
      const id = resolveId(args, ctx);
      if (!id) return '錯誤：未指定簡報 ID，且沒有預設簡報。';
      if (!ownedPdf(id, ctx)) return `錯誤：找不到簡報 ${id}，或無權存取。`;
      const page = Number(args.page);
      if (!Number.isInteger(page) || page < 1) return '錯誤：page 必須是正整數。';
      const script = readPageFile(id, 'script_path', page);
      if (script === null) return `錯誤：第 ${page} 頁不存在。`;
      return truncate(script.trim() || '（此頁尚無腳本。）');
    },
  },
  {
    name: 'get_page_image',
    description: '取得簡報某一頁的畫面圖片（縮圖），讓你能直接看到該頁實際呈現的版面、圖表與視覺內容。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID；省略則指目前正在處理的簡報。' },
        page: { type: 'number', description: '頁碼（從 1 開始）。' },
      },
      required: ['page'],
    },
    async handler(args, ctx): Promise<AiToolResult> {
      const id = resolveId(args, ctx);
      if (!id) return { text: '錯誤：未指定簡報 ID，且沒有預設簡報。' };
      if (!ownedPdf(id, ctx)) return { text: `錯誤：找不到簡報 ${id}，或無權存取。` };
      const page = Number(args.page);
      if (!Number.isInteger(page) || page < 1) return { text: '錯誤：page 必須是正整數。' };
      const row = db
        .prepare(`SELECT image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
        .get(id, page) as { image_path: string | null } | undefined;
      if (!row) return { text: `錯誤：第 ${page} 頁不存在。` };
      if (!row.image_path) return { text: `第 ${page} 頁尚未有圖片。` };
      try {
        const buf = await fs.promises.readFile(safeJoinPdfPath(id, row.image_path));
        const jpeg = await sharp(buf).resize({ width: PAGE_IMAGE_MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
        return { text: `（已附上第 ${page} 頁的畫面圖片，請直接參考圖片內容。）`, images: [dataUrl] };
      } catch (err) {
        return { text: `錯誤：讀取第 ${page} 頁圖片失敗：${err instanceof Error ? err.message : String(err)}` };
      }
    },
  },
];

/** The read-only tool set makeslide may expose to the LLM during its own AI calls. */
export function getReadonlyAiTools(): AiTool[] {
  return READONLY_TOOLS;
}

/** Convert AiTool[] to the OpenAI Chat Completions `tools` array. */
export function toOpenAiTools(tools: AiTool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Execute one tool call by name, returning a normalized result (text + optional
 * images). Never throws: unknown tools and handler errors are returned as an error
 * string so the model can recover or answer without it.
 */
export async function executeAiTool(
  tools: AiTool[],
  name: string,
  args: Record<string, unknown>,
  ctx: AiToolContext,
): Promise<AiToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { text: `錯誤：未知工具「${name}」。` };
  try {
    const out = await tool.handler(args ?? {}, ctx);
    return typeof out === 'string' ? { text: out } : out;
  } catch (err) {
    return { text: `錯誤：工具「${name}」執行失敗：${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Tools that let the tutor *offer* an edit — see docs/tutor-edit-tools.md.
 *
 * They are separate from `getReadonlyAiTools()` and only handed to the page Q&A, and only when the
 * asker can edit the deck. Neither one changes anything the user can see: the image tool writes a
 * candidate file (exactly what the "modify image" button produces) and the script tool writes
 * nothing at all. The page's own JPG and script change only when the user applies the proposal.
 */
export function getProposalAiTools(): AiTool[] {
  // One image per answer. Each call is a real image generation that the *model* decided to spend,
  // so the ceiling is here rather than in the prompt, where it would be a suggestion.
  let imagesProposed = 0;
  return [
    {
      name: 'propose_page_image_edit',
      description:
        'Propose a modified version of a page\'s slide image. Use ONLY when the user explicitly asks for the '
        + 'image to be changed — this generates a new image and costs money, and at most one may be proposed '
        + 'per answer. The user reviews it and decides whether to apply it; nothing changes until they do. '
        + 'Describe the change concretely in `instruction`.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number; defaults to the page the user is on.' },
          instruction: { type: 'string', description: 'What to change about the image.' },
        },
        required: ['instruction'],
      },
      handler: async (args, ctx) => {
        if (!ctx.pdfId) return '錯誤：目前沒有可編輯的簡報。';
        if (imagesProposed >= 1) {
          return '已經提出過一張圖片修改建議了。請先讓使用者決定要不要採用，再提出新的。';
        }
        const page = Number(args.page ?? ctx.currentPage ?? 0);
        const instruction = String(args.instruction ?? '').trim();
        if (!instruction) return '錯誤：請說明要如何修改圖片。';
        if (!Number.isInteger(page) || page <= 0) return '錯誤：請指定有效的頁碼。';
        imagesProposed += 1;
        const proposal = await proposePageImageEdit(ctx.pdfId, page, instruction);
        return {
          text: `已為第 ${page} 頁產生一張修改後的候選圖片，等待使用者確認是否採用。請簡短說明你改了什麼。`,
          proposal: {
            kind: 'image' as const,
            page,
            candidateId: proposal.candidateId,
            imageUrl: proposal.imageUrl,
            instruction,
          },
        };
      },
    },
    {
      name: 'propose_script_edit',
      description:
        'Propose a rewritten narration script for a page. Use when the user asks for the script to be changed '
        + 'or improved. The user sees a diff and decides whether to apply it; nothing changes until they do.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number; defaults to the page the user is on.' },
          instruction: { type: 'string', description: 'How the script should change.' },
        },
        required: ['instruction'],
      },
      handler: async (args, ctx) => {
        if (!ctx.pdfId) return '錯誤：目前沒有可編輯的簡報。';
        const page = Number(args.page ?? ctx.currentPage ?? 0);
        const instruction = String(args.instruction ?? '').trim();
        if (!instruction) return '錯誤：請說明要如何修改逐字稿。';
        if (!Number.isInteger(page) || page <= 0) return '錯誤：請指定有效的頁碼。';
        const proposal = await proposeScriptEdit(ctx.pdfId, page, instruction);
        if (proposal.proposed === proposal.original) {
          return `第 ${page} 頁的逐字稿依這個要求改寫後與原本相同，沒有提出修改建議。`;
        }
        return {
          text: `已為第 ${page} 頁產生一份逐字稿修改建議，等待使用者確認是否採用。請簡短說明你改了什麼。`,
          proposal: {
            kind: 'script' as const,
            page,
            original: proposal.original,
            proposed: proposal.proposed,
            instruction,
          },
        };
      },
    },
  ];
}
