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
import { safeJoinPdfPath, sourceTextPath } from './storage';
import { searchSourceText } from './askSourceText';
import { accountIdFromOwnerSub } from './accountContext';
import {
  isUsableRegion,
  proposePageImageEdit,
  proposePageImageInpaint,
  proposeScriptEdit,
  type ImageEditRegion,
} from './pageEditProposals';
import { getRuntimeAiSettings } from './aiSettings';
import { SCRIPT_TARGET_CHARS_MAX, SCRIPT_TARGET_CHARS_MIN, scriptLengthFor, targetCharsFromLength } from './contentLanguage';

export interface AiToolContext {
  /** Current account (from currentAccountId()); tools may only see this account's decks. */
  accountId: string;
  /** The presentation currently being generated/answered, used as the default `id`. */
  pdfId?: string;
  /** The page the user is looking at, used when a tool's `page` argument is omitted. */
  currentPage?: number;
  /**
   * A box the user has dragged on the slide, as fractions of its size.
   *
   * When present, an image edit is masked to it rather than redrawing the whole slide — asked to
   * fix one bad line, a full regeneration returns every other part subtly changed too.
   */
  imageEditRegion?: ImageEditRegion;
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

/** 原始來源全文（source.txt，已 trim）；沒有這個檔案回 null。位置與 askSourceText 的標示一致。 */
function readSourceText(id: string): string | null {
  try {
    return fs.readFileSync(sourceTextPath(id), 'utf8').trim();
  } catch {
    return null;
  }
}

const SOURCE_READ_DEFAULT_CHARS = 4000;
const SOURCE_READ_MAX_CHARS = 6000;

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
  {
    name: 'search_source_text',
    description:
      '在這份教材的原始來源全文（上傳的原始文件／論文／貼上的文字）中搜尋關鍵字，回傳最相關的幾段原文與其字元位置。' +
      '原始來源全文很長時，提示中只附了部分段落；問題的答案可能在沒附上的地方，請用這個工具查。關鍵字可中英文混用、可多個。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID；省略則指目前正在處理的簡報。' },
        query: { type: 'string', description: '要搜尋的關鍵字（例如專有名詞、方法名稱、章節標題）。' },
      },
      required: ['query'],
    },
    async handler(args, ctx) {
      const id = resolveId(args, ctx);
      if (!id) return '錯誤：未指定簡報 ID，且沒有預設簡報。';
      if (!ownedPdf(id, ctx)) return `錯誤：找不到簡報 ${id}，或無權存取。`;
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) return '錯誤：query 不可為空。';
      const text = readSourceText(id);
      if (!text) return '這份簡報沒有原始來源全文。';
      const hits = searchSourceText(text, query);
      if (hits.length === 0) return `原始來源全文（共 ${text.length} 字）中找不到與「${query}」相關的段落，可換個關鍵字，或用 read_source_text 依位置閱讀。`;
      return truncate(
        [`原始來源全文共 ${text.length} 字，與「${query}」最相關的段落：`]
          .concat(hits.map((h) => `【原文第 ${h.start + 1}–${h.start + h.text.length} 字】\n${h.text.trim()}`))
          .join('\n\n'),
      );
    },
  },
  {
    name: 'read_source_text',
    description: '依字元位置閱讀這份教材原始來源全文的一段（例如接續提示中「略去第 X–Y 字」的部分，或搜尋結果的前後文）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID；省略則指目前正在處理的簡報。' },
        start: { type: 'number', description: '起始字元位置（從 1 開始，對應「原文第 N 字」）。' },
        length: { type: 'number', description: `要讀的字數，預設 ${SOURCE_READ_DEFAULT_CHARS}、最多 ${SOURCE_READ_MAX_CHARS}。` },
      },
      required: ['start'],
    },
    async handler(args, ctx) {
      const id = resolveId(args, ctx);
      if (!id) return '錯誤：未指定簡報 ID，且沒有預設簡報。';
      if (!ownedPdf(id, ctx)) return `錯誤：找不到簡報 ${id}，或無權存取。`;
      const text = readSourceText(id);
      if (!text) return '這份簡報沒有原始來源全文。';
      const start = Math.floor(Number(args.start));
      if (!Number.isFinite(start) || start < 1) return '錯誤：start 必須是正整數（從 1 開始）。';
      if (start > text.length) return `錯誤：原始來源全文只有 ${text.length} 字。`;
      const requested = Math.floor(Number(args.length ?? SOURCE_READ_DEFAULT_CHARS));
      const length = Math.min(SOURCE_READ_MAX_CHARS, Math.max(200, Number.isFinite(requested) ? requested : SOURCE_READ_DEFAULT_CHARS));
      const end = Math.min(text.length, start - 1 + length);
      return `【原文第 ${start}–${end} 字，全文共 ${text.length} 字】\n${text.slice(start - 1, end)}`;
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
        + 'Describe the change concretely in `instruction`. If the user has marked a region on the slide, '
        + 'the edit is automatically confined to it — do not ask them where.',
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
        // Masked when the user has marked a region, whole-image otherwise. The user's selection is
        // the instruction about *where*, and ignoring it redraws parts they did not ask to change.
        const masked = isUsableRegion(ctx.imageEditRegion);
        const proposal = masked
          ? await proposePageImageInpaint(ctx.pdfId, page, instruction, ctx.imageEditRegion!)
          : await proposePageImageEdit(ctx.pdfId, page, instruction);
        return {
          text: masked
            ? `已依使用者標示的區域，為第 ${page} 頁產生一張只改動該區域的候選圖片，等待使用者確認是否採用。請簡短說明你改了什麼。`
            : `已為第 ${page} 頁產生一張修改後的候選圖片，等待使用者確認是否採用。請簡短說明你改了什麼。`,
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
        + 'or improved. The user sees a diff and decides whether to apply it; nothing changes until they do. '
        + 'The rewrite is held to a length range; without `target_length` it is the deck\'s default length. '
        + 'Whenever the user asks for a different length (longer, shorter, "about 800 characters", "double it"), '
        + 'set `target_length` — saying so only in `instruction` is overridden by the length range.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number; defaults to the page the user is on.' },
          instruction: { type: 'string', description: 'How the script should change.' },
          target_length: {
            type: 'number',
            description:
              'Target length of the new script, in the unit the page context gives (Chinese characters, or '
              + 'words for an English deck). Work it out from the current length for relative requests '
              + '("longer" ≈ 1.5x, "much longer"/"double" ≈ 2x, "shorter" ≈ 0.7x). Omit to keep the deck default.',
          },
        },
        required: ['instruction'],
      },
      handler: async (args, ctx) => {
        if (!ctx.pdfId) return '錯誤：目前沒有可編輯的簡報。';
        const page = Number(args.page ?? ctx.currentPage ?? 0);
        const instruction = String(args.instruction ?? '').trim();
        if (!instruction) return '錯誤：請說明要如何修改逐字稿。';
        if (!Number.isInteger(page) || page <= 0) return '錯誤：請指定有效的頁碼。';
        let targetChars: number | undefined;
        if (args.target_length !== undefined && args.target_length !== null) {
          const length = Number(args.target_length);
          const language = getRuntimeAiSettings().contentLanguage;
          const chars = targetCharsFromLength(language, length);
          if (!Number.isFinite(length) || chars < SCRIPT_TARGET_CHARS_MIN || chars > SCRIPT_TARGET_CHARS_MAX) {
            const inUnit = (n: number) => scriptLengthFor(language, n, { min: n, max: n });
            const min = inUnit(SCRIPT_TARGET_CHARS_MIN);
            const max = inUnit(SCRIPT_TARGET_CHARS_MAX);
            return `錯誤：target_length 必須在 ${min.target}～${max.target} ${max.unit}之間。請告訴使用者可用的範圍，或改用範圍內的長度。`;
          }
          targetChars = chars;
        }
        const proposal = await proposeScriptEdit(ctx.pdfId, page, instruction, { targetChars });
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
