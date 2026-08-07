/**
 * MCP (Model Context Protocol) server for makeslide.
 *
 * Exposes makeslide's presentation-generation pipeline as MCP tools so that
 * Claude Code or any other MCP-compatible agent can upload PDFs, trigger
 * generation runs, and retrieve the resulting video URLs without a browser.
 *
 * Transport: newline-delimited JSON over stdio (standard for Claude Code MCP).
 *
 * Configuration (environment variables):
 *   MAKESLIDE_URL         Base URL of the running makeslide backend
 *                         (default: http://localhost:3000)
 *   MAKESLIDE_MCP_TOKEN   Bearer token that matches the MCP_AUTH_TOKEN setting
 *                         in the makeslide backend .env file.
 *
 * To use with Claude Code, add to ~/.claude/mcp_servers.json. Recommended: fetch this file
 * straight from GitHub on every launch and run it with tsx — this file has zero external
 * dependencies (only node:fs/node:readline/global fetch), so it never needs the rest of the
 * makeslide monorepo (and its native-module deps like better-sqlite3/canvas/sharp) installed
 * anywhere. Always pulls the latest master; nothing is cached, so a fresh copy is re-downloaded
 * on every MCP client start:
 *   {
 *     "makeslide": {
 *       "command": "sh",
 *       "args": [
 *         "-c",
 *         "curl -fsSL https://raw.githubusercontent.com/wycc/makeslide/master/backend/src/mcp-server.ts -o /tmp/makeslide-mcp-server.ts && exec npx -y tsx /tmp/makeslide-mcp-server.ts"
 *       ],
 *       "env": {
 *         "MAKESLIDE_URL": "http://localhost:3000",
 *         "MAKESLIDE_MCP_TOKEN": "<your-token>"
 *       }
 *     }
 *   }
 *
 * If you already have a local checkout (e.g. developing makeslide itself), running from it
 * directly is faster and works offline:
 *   {
 *     "makeslide": {
 *       "command": "node",
 *       "args": ["/path/to/makeslide/backend/dist/mcp-server.js"],
 *       "env": {
 *         "MAKESLIDE_URL": "http://localhost:3000",
 *         "MAKESLIDE_MCP_TOKEN": "<your-token>"
 *       }
 *     }
 *   }
 *
 * Or with tsx straight from source (no build step):
 *   {
 *     "makeslide": {
 *       "command": "npx",
 *       "args": ["--prefix", "/path/to/makeslide/backend", "tsx", "src/mcp-server.ts"],
 *       "env": { "MAKESLIDE_URL": "...", "MAKESLIDE_MCP_TOKEN": "..." }
 *     }
 *   }
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';

const BASE_URL = (process.env.MAKESLIDE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const AUTH_TOKEN = process.env.MAKESLIDE_MCP_TOKEN ?? '';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

/**
 * 對照每個後端錯誤碼，給 agent 一句「接下來該做什麼」。
 *
 * 沒有這一層的話，失敗會以 `409 {"error":{"code":"INVALID_STATE",...}}` 這種原始字串回去，
 * agent 讀不出下一步，往往就把同一個呼叫再送一次。頁面增刪特別容易撞上 INVALID_STATE
 * （簡報還在生成中就想改結構），所以提示要具體到「先確認什麼」而不只是「操作失敗」。
 */
const ERROR_HINTS: Record<string, string> = {
  INVALID_STATE:
    '簡報目前的狀態不允許這個操作。頁面的新增／刪除／搬移只有在 status 為 ready 時可用——請先用 get_generation_status 確認生成已結束。',
  FORBIDDEN:
    '目前的 MCP token 對應的帳號沒有編輯這份簡報的權限。MCP 能做的事等同該帳號在瀏覽器能做的事，不會更多。',
  PDF_NOT_FOUND: '找不到這份簡報，請用 list_presentations 確認 ID 是否正確。',
  PAGE_NOT_FOUND: '找不到這一頁，請用 get_presentation 或 get_deck_outline 確認目前的頁數。',
  ADD_PAGES_JOB_NOT_FOUND: '這份簡報目前沒有新增頁面的任務——可能從未啟動，或伺服器重啟後任務狀態已消失。',
  API_KEY_MISSING: '後端還沒設定對應的 AI API key，需要先在 makeslide 的設定頁補上才能使用 AI 功能。',
  INVALID_REQUEST: '參數不合法，請對照工具說明檢查各欄位的必填與範圍限制。',
};

/**
 * 後端一律以 `{ error: { code, message } }` 回報失敗；非 JSON 的回應（例如反向代理吐的
 * HTML 錯誤頁）就照原樣帶出去，至少不會把真正的線索吃掉。
 */
async function failure(
  method: string,
  path: string,
  res: { status: number; text(): Promise<string> },
): Promise<never> {
  const raw = await res.text();
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    // 非 JSON 錯誤回應，維持原文
  }
  const hint = code && ERROR_HINTS[code] ? `\n提示：${ERROR_HINTS[code]}` : '';
  const detail = message || raw || '（無錯誤訊息）';
  throw new Error(`${method} ${path} → HTTP ${res.status}${code ? ` [${code}]` : ''}：${detail}${hint}`);
}

/**
 * 逾時預算分兩級。多數呼叫是純資料讀寫，30 秒還沒回就是後端出事了；但重新生成圖片或合成
 * 語音是「同步」HTTP——請求會一路等到模型回應，數十秒到數分鐘都算正常。沒有逾時的話（本檔
 * 原本的狀態），後端一旦卡住，MCP client 就跟著無限期掛在那裡，agent 連「失敗了」都不知道。
 */
const READ_TIMEOUT_MS = 30_000;
const GENERATION_TIMEOUT_MS = 300_000;

/**
 * 逾時被 `fetch` 丟成 TimeoutError/AbortError，訊息是空泛的「This operation was aborted」。
 * 換成講清楚等了多久、以及該怎麼確認結果——生成類的呼叫逾時後，後端往往仍在跑，直接重試
 * 會白花一次模型費用。
 */
async function fetchWithTimeout(
  method: string,
  path: string,
  init: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      const seconds = Math.round(timeoutMs / 1000);
      throw new Error(
        `${method} ${path} → 等待 ${seconds} 秒後逾時。\n` +
          '提示：後端可能仍在處理這個請求。重試之前，請先用對應的讀取工具（例如 get_deck_outline 或 get_page_script）確認結果是不是其實已經完成了。',
      );
    }
    throw err;
  }
}

async function apiGet(path: string): Promise<unknown> {
  const res = await fetchWithTimeout('GET', path, { headers: authHeaders() }, READ_TIMEOUT_MS);
  if (!res.ok) await failure('GET', path, res);
  return res.json();
}

async function apiGetText(path: string): Promise<string> {
  const res = await fetchWithTimeout('GET', path, { headers: authHeaders() }, READ_TIMEOUT_MS);
  if (!res.ok) await failure('GET', path, res);
  return res.text();
}

/** 讀二進位資產（投影片圖片、候選圖）。 */
async function apiGetBytes(path: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout('GET', path, { headers: authHeaders() }, READ_TIMEOUT_MS);
  if (!res.ok) await failure('GET', path, res);
  return new Uint8Array(await res.arrayBuffer());
}

async function apiPut(path: string, body: unknown): Promise<unknown> {
  const res = await fetchWithTimeout(
    'PUT',
    path,
    { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) },
    READ_TIMEOUT_MS,
  );
  if (!res.ok) await failure('PUT', path, res);
  return res.json();
}

async function apiPost(path: string, body?: unknown, timeoutMs = READ_TIMEOUT_MS): Promise<unknown> {
  const res = await fetchWithTimeout(
    'POST',
    path,
    {
      method: 'POST',
      headers: authHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    timeoutMs,
  );
  if (!res.ok) await failure('POST', path, res);
  return res.json();
}

async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetchWithTimeout(
    'PATCH',
    path,
    { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) },
    READ_TIMEOUT_MS,
  );
  if (!res.ok) await failure('PATCH', path, res);
  return res.json();
}

async function apiDelete(path: string): Promise<unknown> {
  const res = await fetchWithTimeout('DELETE', path, { method: 'DELETE', headers: authHeaders() }, READ_TIMEOUT_MS);
  if (!res.ok) await failure('DELETE', path, res);
  return res.json();
}

/** 以 multipart 上傳一張圖片，沿用既有 PDF 上傳那條路徑的寫法。 */
async function apiUploadImage(path: string, bytes: Uint8Array, filename: string): Promise<unknown> {
  const form = new (globalThis.FormData)();
  form.append('file', new Blob([bytes]), filename);
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetchWithTimeout('POST', path, { method: 'POST', headers, body: form }, GENERATION_TIMEOUT_MS);
  if (!res.ok) await failure('POST', path, res);
  return res.json();
}

async function apiUploadPdf(filePath: string): Promise<unknown> {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  const form = new (globalThis.FormData)();
  form.append('file', blob, filePath.split('/').pop() ?? 'upload.pdf');
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(`${BASE_URL}/api/pdfs`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`POST /api/pdfs → ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Upload a plain-text presentation outline as a new presentation.
 * Mirrors the browser's TXT-import path: POST /api/pdfs as multipart/form-data
 * with a text/plain file. The backend stores the outline as the source text and
 * (later, during generation) lets the AI paginate + write per-page scripts.
 *
 * When `filename` is 'prompt-outline.txt' the backend defers the presentation
 * title to the AI; otherwise it derives the title from the filename.
 */
async function apiUploadText(text: string, filename: string): Promise<unknown> {
  const blob = new Blob([text], { type: 'text/plain' });
  const form = new (globalThis.FormData)();
  form.append('file', blob, filename);
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(`${BASE_URL}/api/pdfs`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`POST /api/pdfs → ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_presentations',
    description: '列出 makeslide 中所有的簡報（PDF）。回傳簡報 ID、標題與目前狀態。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_presentation',
    description: '取得指定簡報的詳細資訊，包括頁數、各頁內容摘要與影片 URL（若已生成）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID（從 list_presentations 取得）' },
      },
      required: ['id'],
    },
  },
  {
    name: 'upload_pdf',
    description: '上傳本機 PDF 檔案至 makeslide，建立新的簡報。回傳新簡報的 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '本機 PDF 檔案的完整路徑（絕對路徑）' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'upload_txt',
    description:
      '上傳純文字的簡報大綱，建立一份新的簡報（不需要 PDF）。回傳新簡報的 ID，狀態為 awaiting_prompt——' +
      '接著必須呼叫 define_prompt 指定風格並正式開始生成。\n\n' +
      '【大綱格式】建議使用以下逐頁結構（AI 會依此分頁並為每頁撰寫逐字稿）：\n' +
      '  Slide 1: 這一頁的標題\n' +
      '  - 重點一\n' +
      '  - 重點二\n' +
      '  這一頁還想補充說明的摘要文字，可以寫成一般段落，交代這幾個重點的背景、細節或想強調的地方。\n' +
      '\n' +
      '  Slide 2: 下一頁的標題\n' +
      '  - 重點一\n' +
      '  - 重點二\n' +
      '  - 重點三\n' +
      '\n' +
      '規則：每頁以「Slide N: 標題」開頭，其下用「- 」列出 2～6 個重點；' +
      '在重點之後，還可以再加上不以「- 」開頭的一般段落文字，補充這一頁想說明的摘要／背景／細節，' +
      'AI 會把它連同重點一起當作素材來撰寫這一頁的逐字稿（此段落選填，可長可短）。' +
      '頁與頁之間空一行分隔；建議 3～20 頁。' +
      '也接受自由格式的純文字（AI 會自動分頁），但上述結構化格式分頁結果最穩定。',
    inputSchema: {
      type: 'object',
      properties: {
        outline: {
          type: 'string',
          description:
            '簡報大綱純文字內容（UTF-8）。格式見工具說明：每頁「Slide N: 標題」＋「- 」重點，' +
            '重點後可再加一段摘要文字補充該頁要說明的內容（供產生逐字稿用）。',
        },
        title: {
          type: 'string',
          description: '選填：簡報標題。省略時由 AI 依大綱內容自動命名。',
        },
      },
      required: ['outline'],
    },
  },
  {
    name: 'define_prompt',
    description:
      '為一份 awaiting_prompt 狀態的簡報指定生成設定（簡報風格、圖片風格、逐字稿長度、單／雙人模式），' +
      '並正式啟動 AI 生成流程（腳本→語音→影像→影片）。這是讓 upload_txt／upload_pdf 建立的簡報真正開始生成的步驟。' +
      '呼叫後用 get_generation_status 輪詢進度。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID（從 upload_txt／upload_pdf／list_presentations 取得）' },
        style_prompt: {
          type: 'string',
          description:
            '選填：簡報整體風格／語氣提示詞（例如「專業商務、精簡有力」「輕鬆口語、面向國中生」）。最長 2000 字。',
        },
        image_style_prompt: {
          type: 'string',
          description:
            '選填：圖片／視覺風格提示詞（例如「扁平插畫、藍色系」「寫實照片風」「手繪塗鴉風」）。最長 8000 字。',
        },
        script_max_chars_per_page: {
          type: 'number',
          description:
            '選填：每頁逐字稿長度上限（字元數，80～2000）。用來控制口白長短——短講約 150、適中約 400、詳細約 800。省略則用系統預設。',
        },
        host_mode: {
          type: 'string',
          enum: ['solo', 'dual'],
          description: '選填：口白模式。solo＝單人主講（預設）；dual＝雙人對談。',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'start_generation',
    description:
      '啟動簡報的 AI 生成流程（腳本→語音→影像→影片）。可選擇只重新生成特定階段。' +
      '回傳任務狀態。生成通常需要數分鐘，請用 get_generation_status 輪詢進度。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        stages: {
          type: 'array',
          items: { type: 'string', enum: ['scripts', 'audio', 'images', 'animations'] },
          description: '選填：只重新生成這些階段（省略表示全部重新生成）',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_generation_status',
    description: '查詢簡報的最新生成任務狀態。回傳 status（pending/running/done/failed）、各階段進度與錯誤訊息。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_page_script',
    description: '讀取簡報某一頁的 AI 生成腳本（逐字稿）。在啟動生成前可用此工具確認或提取已有的腳本內容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
      },
      required: ['id', 'page'],
    },
  },
  {
    name: 'set_page_script',
    description: '覆寫簡報某一頁的腳本（逐字稿），最長 4096 字元。可在啟動 AI 生成前用此工具自訂各頁文案，之後再呼叫 start_generation 僅重新生成語音（stages: ["audio"]）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        script: { type: 'string', description: '腳本內容，最長 4096 字元' },
      },
      required: ['id', 'page', 'script'],
    },
  },

  // ── 頁面結構：建立簡報與增刪搬移頁面 ────────────────────────────────────────
  {
    name: 'create_blank_deck',
    description:
      '建立一份空白簡報（只有一頁空白投影片），狀態直接是 ready，不會進入 AI 生成流程。' +
      '這是「完全不開瀏覽器、從零逐頁把簡報搭起來」最短的起點：建立之後用 add_page／add_pages_from_outline 加頁，' +
      '再用 set_page_script、set_page_prompt 等工具逐頁填內容。\n\n' +
      '若你想要的是「給一段大綱、讓 AI 一次生成整份簡報」，請改用 upload_txt ＋ define_prompt。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '選填：簡報標題（最長 200 字）。省略時為「空白簡報」。' },
        category: { type: 'string', description: '選填：分類名稱。省略時歸入預設分類。' },
      },
      required: [],
    },
  },
  {
    name: 'add_page',
    description:
      '在簡報中插入一頁空白投影片。\n\n' +
      '【頁碼會位移】插入點之後的所有頁面，頁碼都會往後移一位。若你手上還有其他頁的頁碼要用，' +
      '請在這個呼叫之後重新讀取（get_deck_outline），不要沿用舊頁碼。\n\n' +
      '【前置條件】簡報的 status 必須是 ready；還在生成中會失敗（INVALID_STATE）。\n\n' +
      '新頁面是空白的——沒有圖片提示詞、逐字稿與語音，需要接著自行填入。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        after_page_number: {
          type: 'number',
          description:
            '插在第幾頁之後（0 表示插到最前面成為第 1 頁；等於目前總頁數表示附加到最後）。省略時為 0。',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_page',
    description:
      '刪除簡報中的某一頁，連同這一頁的圖片、逐字稿與語音檔一併移除。\n\n' +
      '【不可逆】刪除後無法復原，請先確認頁碼正確（可用 get_deck_outline 核對）。\n\n' +
      '【頁碼會位移】被刪那一頁之後的所有頁面，頁碼都會往前移一位。\n\n' +
      '【限制】簡報的 status 必須是 ready，且不能刪掉最後一頁——一份簡報至少要保留一頁。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '要刪除的頁碼（從 1 開始）' },
      },
      required: ['id', 'page'],
    },
  },
  {
    name: 'move_page',
    description:
      '把某一頁搬到簡報中的另一個位置，用來調整頁面順序。\n\n' +
      '【頁碼會位移】起點與終點之間的所有頁面，頁碼都會跟著移動。搬移後請重新讀取頁碼再繼續操作。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        from_page_number: { type: 'number', description: '要搬移的頁碼（從 1 開始）' },
        to_page_number: { type: 'number', description: '搬移後這一頁要位於第幾頁（從 1 開始）' },
      },
      required: ['id', 'from_page_number', 'to_page_number'],
    },
  },

  // ── 以大綱擴充既有簡報（非同步任務） ────────────────────────────────────────
  {
    name: 'add_pages_from_outline',
    description:
      '用一段大綱或一句需求，讓 AI 為既有簡報生成並插入數個新頁面（含圖片、逐字稿與語音）。\n\n' +
      '【非同步】這個呼叫只負責啟動任務並立刻回傳，實際生成需要數分鐘。啟動後請用 get_add_pages_status 輪詢，' +
      '直到 status 變成 done 或 failed；中途要放棄可用 cancel_add_pages。\n\n' +
      '【一次只能一個】同一份簡報同時只允許一個新增頁面的任務在跑。\n\n' +
      'outline_text 與 prompt 至少要給一個：outline_text 是逐頁結構化的大綱（格式同 upload_txt，' +
      '每頁「Slide N: 標題」＋「- 」重點），分頁結果最穩定；prompt 則是一句需求（至少 5 個字），' +
      '例如「補三頁說明實驗結果」，交由 AI 自行決定要生成幾頁與各頁內容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        outline_text: {
          type: 'string',
          description: '選填：逐頁結構化大綱（最長 10000 字）。與 prompt 至少擇一。',
        },
        prompt: {
          type: 'string',
          description: '選填：一句需求描述（至少 5 個字，最長 10000 字）。與 outline_text 至少擇一。',
        },
        insert_after_page: {
          type: 'number',
          description: '選填：新頁面插在第幾頁之後（0 表示插到最前面）。省略時附加到簡報最後。',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_add_pages_status',
    description:
      '查詢 add_pages_from_outline 任務的進度。回傳 status（pending／running／done／failed／cancelled）、' +
      '目前階段、進度、已新增的頁碼，以及失敗時的錯誤訊息。\n\n' +
      '注意：任務狀態存在伺服器記憶體中，後端重啟後就會消失（回 ADD_PAGES_JOB_NOT_FOUND）；' +
      '這時請直接用 get_deck_outline 確認實際結果。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'cancel_add_pages',
    description:
      '中止進行中的 add_pages_from_outline 任務。已經生成並插入的頁面會保留在簡報裡，不會回捲——' +
      '取消後請用 get_deck_outline 確認實際狀態。沒有任務在跑時會失敗。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
      },
      required: ['id'],
    },
  },

  // ── 整份簡報的概覽與標題 ──────────────────────────────────────────────────
  {
    name: 'get_deck_outline',
    description:
      '取得整份簡報的逐頁概覽：每一頁的頁碼、頁面型別（投影片／動畫／notebook）、狀態，' +
      '以及是否已經有圖片、逐字稿與語音。這是編輯前確認頁碼、或編輯後驗收結果最直接的工具。\n\n' +
      '預設會附上每頁逐字稿的開頭摘要；需要完整逐字稿時把 include_scripts 設為 true' +
      '（單頁的完整內容也可以用 get_page_script 取得）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        include_scripts: {
          type: 'boolean',
          description: '選填：true 表示附上每頁的完整逐字稿；省略或 false 只附開頭摘要。',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_deck_title',
    description: '修改簡報的標題（1～200 字）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        title: { type: 'string', description: '新標題（1～200 字）' },
      },
      required: ['id', 'title'],
    },
  },

  // ── 逐頁資產：圖片 ────────────────────────────────────────────────────────
  {
    name: 'get_page_prompt',
    description:
      '讀取某一頁的圖片提示詞——也就是這一頁投影片畫面的文字描述，AI 生成圖片時以它為依據。' +
      '與逐字稿（口白，用 get_page_script）是不同的東西。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
      },
      required: ['id', 'page'],
    },
  },
  {
    name: 'set_page_prompt',
    description:
      '覆寫某一頁的圖片提示詞（最長 2000 字）。\n\n' +
      '這只是改掉描述文字，**不會重新生成圖片**——畫面要跟著換，請接著呼叫 regenerate_page_image。\n\n' +
      '剛用 add_page 建立的空白頁還沒有存放提示詞的檔案，這時會失敗（INVALID_STATE）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        prompt: { type: 'string', description: '圖片提示詞，最長 2000 字' },
      },
      required: ['id', 'page', 'prompt'],
    },
  },
  {
    name: 'get_page_text',
    description: '讀取某一頁投影片的文字內容（從 PDF 抽取或生成時寫入的版面文字）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
      },
      required: ['id', 'page'],
    },
  },
  {
    name: 'regenerate_page_image',
    description:
      '用一段提示詞請 AI 重新生成某一頁的投影片圖片。\n\n' +
      '【很慢】這是同步呼叫，會一路等到圖片生成完成，通常數十秒、慢的時候數分鐘。\n\n' +
      '【預設會直接套用】後端其實是先產生一張「候選圖」，本工具預設會接著把它套用成這一頁的正式圖片。' +
      '若想先看過再決定，把 apply 設為 false——這時只會產生候選圖並回傳 candidate_id，' +
      '可用 save_page_image（帶 candidate_id）把它存到本機檢視，滿意後再用 apply_image_candidate 套用。\n\n' +
      '【看不到就先看】你無法直接看到目前的畫面長什麼樣。要基於現況調整時，請先用 save_page_image 把目前的圖存到本機看過再下提示詞。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        prompt: {
          type: 'string',
          description: '要怎麼畫／怎麼改的描述（最長 2000 字），例如「改成藍色系的扁平插畫，右下角加一個流程圖」。',
        },
        apply: {
          type: 'boolean',
          description: '選填：是否直接套用成正式圖片。省略時為 true；設為 false 只產生候選圖。',
        },
      },
      required: ['id', 'page', 'prompt'],
    },
  },
  {
    name: 'apply_image_candidate',
    description:
      '把 regenerate_page_image（apply: false）產生的候選圖，正式套用成這一頁的投影片圖片。' +
      '套用後原本的圖片就被取代了。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        candidate_id: { type: 'string', description: 'regenerate_page_image 回傳的 candidate_id' },
      },
      required: ['id', 'page', 'candidate_id'],
    },
  },
  {
    name: 'replace_page_image',
    description:
      '用本機的一張圖片檔直接取代某一頁的投影片圖片（不經過 AI）。' +
      '路徑必須是執行這個 MCP server 的機器上的絕對路徑。支援常見圖片格式，會被轉成 1920×1080 的 JPEG。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        file_path: { type: 'string', description: '本機圖片檔的絕對路徑' },
      },
      required: ['id', 'page', 'file_path'],
    },
  },
  {
    name: 'save_page_image',
    description:
      '把某一頁目前的投影片圖片存到本機檔案，讓你可以實際看到這一頁長什麼樣。' +
      '調整畫面之前先看一眼，下出來的提示詞會準得多。\n\n' +
      '帶入 candidate_id 時，存的是該候選圖而不是正式圖片。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        file_path: { type: 'string', description: '要存到哪裡（本機絕對路徑，建議副檔名 .jpg）' },
        candidate_id: {
          type: 'string',
          description: '選填：改存這個候選圖（regenerate_page_image 以 apply: false 產生的）。',
        },
      },
      required: ['id', 'page', 'file_path'],
    },
  },

  // ── 逐頁資產：逐字稿與語音 ────────────────────────────────────────────────
  {
    name: 'rewrite_page_script',
    description:
      '請 AI 依照指示改寫某一頁的逐字稿（例如「講得更口語一點」「縮短到 200 字以內」）。\n\n' +
      '【不會直接存檔】只回傳改寫後的稿子讓你過目。要採用的話，接著呼叫 set_page_script 寫入，' +
      '再用 regenerate_page_audio 重新合成語音——否則語音仍是舊稿的內容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        prompt: { type: 'string', description: '改寫的指示（最長 2000 字）' },
        script: {
          type: 'string',
          description: '選填：要被改寫的原稿（最長 4096 字）。省略時自動讀取這一頁目前的逐字稿。',
        },
      },
      required: ['id', 'page', 'prompt'],
    },
  },
  {
    name: 'regenerate_page_audio',
    description:
      '用指定的逐字稿重新合成某一頁的語音。這個呼叫**同時會把逐字稿寫入該頁**，所以不需要再另外呼叫 set_page_script。\n\n' +
      '【較慢】同步呼叫，會等到語音合成完成。\n\n' +
      '省略 script 時，會自動沿用這一頁目前的逐字稿——適合只想換聲音或語速（改完 set_tts_settings）後重新合成的情況。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        script: {
          type: 'string',
          description: '選填：要唸的逐字稿（最長 4096 字）。省略時沿用這一頁目前的逐字稿。',
        },
      },
      required: ['id', 'page'],
    },
  },
  {
    name: 'set_tts_settings',
    description:
      '設定整份簡報的語音（聲線與語速）。\n\n' +
      '【不會自動重配音】改完之後，既有的語音檔仍是舊設定產生的；要讓某一頁套用新設定，' +
      '請對該頁呼叫 regenerate_page_audio（可省略 script 沿用現稿）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        tts_voice: { type: 'string', description: '聲線名稱（例如 alloy、nova；可用的值視後端 TTS 供應商而定）' },
        tts_speed: { type: 'number', description: '語速，0.25～4（1 為正常速度）' },
      },
      required: ['id', 'tts_voice', 'tts_speed'],
    },
  },
];

// ── Shared argument parsing ────────────────────────────────────────────────────

function requireId(args: Record<string, unknown>): string {
  const id = String(args.id ?? '').trim();
  if (!id) throw new Error('缺少 id 參數');
  return id;
}

/** 頁碼一律從 1 開始；0 或負數是呼叫端搞錯了基準，早點講清楚比讓後端回 404 好。 */
function requirePageNumber(value: unknown, field: string): number {
  const n = Number(value ?? NaN);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${field} 必須是正整數（頁碼從 1 開始）`);
  return n;
}

/** 插入位置以 0 表示「最前面」，所以這裡允許 0，與頁碼的基準不同。 */
function optionalInsertPosition(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${field} 必須是 0 或正整數（0 表示插到最前面）`);
  return n;
}

// ── Deck outline formatting ────────────────────────────────────────────────────

interface DeckPage {
  page_number: number;
  render_type?: string | null;
  status?: string | null;
  image_url?: string | null;
  script_url?: string | null;
  audio_url?: string | null;
}

interface DeckDetail {
  title?: string | null;
  status?: string | null;
  pages?: DeckPage[];
}

const RENDER_TYPE_LABELS: Record<string, string> = {
  'static-image': '投影片',
  'gsap-image': '投影片（含動畫）',
  notebook: 'Jupyter notebook',
};

/**
 * 一次取回所有頁面的逐字稿。`scripts.txt` 以 `=== 第 N 頁 ===` 分隔各頁，打一次請求就能拿到
 * 全部；逐頁 GET 則要打 N 次。取不到時（例如這份簡報還沒有任何逐字稿）退回空表——概覽的
 * 頁面結構本身仍然有用，不該因為少了摘要就整個失敗。
 */
async function fetchScriptsByPage(id: string): Promise<Map<number, string>> {
  const byPage = new Map<number, string>();
  let raw: string;
  try {
    raw = await apiGetText(`/api/pdfs/${encodeURIComponent(id)}/scripts.txt`);
  } catch {
    return byPage;
  }
  // split 帶擷取群組時，結果為 [前言, 頁碼, 內容, 頁碼, 內容, ...]
  const parts = raw.split(/^=== 第 (\d+) 頁 ===$/m);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const page = Number(parts[i]);
    const text = (parts[i + 1] ?? '').trim();
    if (Number.isInteger(page) && text && text !== '（無逐字稿）') byPage.set(page, text);
  }
  return byPage;
}

function summarizeScript(script: string): string {
  const flat = script.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

// ── Per-page asset helpers ─────────────────────────────────────────────────────

/**
 * 把候選圖套用成正式的投影片圖片。
 *
 * 後端的 regenerate-image／inpaint-image 只把結果寫成一張「候選圖」，另外存成
 * `NNN.candidate.<id>.jpg`，正式圖片原封不動；沒有「接受候選」的端點。所以套用＝把候選圖
 * 讀回來，再用 replace-image 上傳一次。這一步藏在工具內部，是因為 agent 看不到圖，
 * 「產生了一張你看不見的候選圖」對它幾乎不是可行動的狀態——預設就該是「圖片換好了」。
 */
async function applyImageCandidate(id: string, page: number, candidateId: string): Promise<void> {
  const bytes = await apiGetBytes(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/image-candidates/${encodeURIComponent(candidateId)}`,
  );
  await apiUploadImage(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/replace-image`,
    bytes,
    `candidate-${candidateId}.jpg`,
  );
}

/**
 * 讀某一頁目前的逐字稿。改寫與重新配音都以現稿為預設輸入——強迫 agent 每次都自己先讀一次
 * 再原樣送回來，只是多一次往返，還多一個「送錯稿子」的機會。
 */
async function readPageScript(id: string, page: number): Promise<string> {
  return apiGetText(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/script`);
}

interface AddPagesState {
  status?: string;
  step?: string | null;
  progress?: { current: number; total: number } | null;
  addedPageNumbers?: number[];
  totalPagesAfter?: number | null;
  error?: string | null;
}

const ADD_PAGES_STEP_LABELS: Record<string, string> = {
  generating_outline: '產生大綱',
  rendering_images: '生成圖片',
  generating_scripts: '撰寫逐字稿',
  synthesizing_audio: '合成語音',
};

function formatAddPagesState(state: AddPagesState): string {
  const lines = [`狀態：${state.status ?? '—'}`];
  if (state.step) lines.push(`目前階段：${ADD_PAGES_STEP_LABELS[state.step] ?? state.step}`);
  if (state.progress) lines.push(`進度：${state.progress.current}/${state.progress.total}`);
  const added = state.addedPageNumbers ?? [];
  lines.push(`已新增頁碼：${added.length ? added.join('、') : '（尚無）'}`);
  if (typeof state.totalPagesAfter === 'number') lines.push(`完成後總頁數：${state.totalPagesAfter}`);
  if (state.error) lines.push(`錯誤：${state.error}`);
  if (state.status === 'pending' || state.status === 'running') {
    lines.push('\n任務仍在進行中，請稍候再輪詢一次。');
  }
  return lines.join('\n');
}

// ── Tool handlers ──────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'list_presentations') {
    const data = await apiGet('/api/pdfs') as { pdfs?: Array<{ id: string; title?: string; status?: string }> };
    const list = data.pdfs ?? (Array.isArray(data) ? data : []);
    if (!list.length) return '目前沒有任何簡報。';
    return list
      .map((p: { id: string; title?: string; status?: string }) =>
        `• ID: ${p.id}  標題: ${p.title ?? '（無標題）'}  狀態: ${p.status ?? '—'}`,
      )
      .join('\n');
  }

  if (name === 'get_presentation') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const data = await apiGet(`/api/pdfs/${encodeURIComponent(id)}`) as Record<string, unknown>;
    return JSON.stringify(data, null, 2);
  }

  if (name === 'upload_pdf') {
    const filePath = String(args.file_path ?? '');
    if (!filePath) throw new Error('缺少 file_path 參數');
    if (!fs.existsSync(filePath)) throw new Error(`找不到檔案：${filePath}`);
    const data = await apiUploadPdf(filePath) as { id?: string; title?: string };
    return `上傳成功！簡報 ID：${data.id ?? '（未知）'}，標題：${data.title ?? '（無標題）'}`;
  }

  if (name === 'upload_txt') {
    const outline = String(args.outline ?? '');
    if (!outline.trim()) throw new Error('缺少 outline 參數（大綱內容不可為空）');
    const rawTitle = String(args.title ?? '').trim();
    // 'prompt-outline.txt' 是後端「把標題交給 AI 產生」的約定檔名；
    // 有指定 title 時則用 <title>.txt 讓後端沿用該標題。
    const safeTitle = rawTitle.replace(/[/\\]/g, '_').slice(0, 120);
    const filename = safeTitle ? `${safeTitle}.txt` : 'prompt-outline.txt';
    const data = await apiUploadText(outline, filename) as { id?: string; title?: string; status?: string };
    return (
      `大綱上傳成功！簡報 ID：${data.id ?? '（未知）'}，標題：${data.title ?? '（將由 AI 命名）'}，` +
      `狀態：${data.status ?? '—'}。\n接著請呼叫 define_prompt（帶入此 ID）指定風格並開始生成。`
    );
  }

  if (name === 'define_prompt') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const stylePrompt = args.style_prompt !== undefined ? String(args.style_prompt) : undefined;
    const imageStylePrompt = args.image_style_prompt !== undefined ? String(args.image_style_prompt) : undefined;
    const hostMode = args.host_mode !== undefined ? String(args.host_mode) : undefined;
    let scriptMaxChars: number | undefined;
    if (args.script_max_chars_per_page !== undefined) {
      scriptMaxChars = Number(args.script_max_chars_per_page);
      if (!Number.isInteger(scriptMaxChars) || scriptMaxChars < 80 || scriptMaxChars > 2000) {
        throw new Error('script_max_chars_per_page 必須是 80～2000 的整數');
      }
    }
    if (hostMode !== undefined && hostMode !== 'solo' && hostMode !== 'dual') {
      throw new Error('host_mode 必須是 solo 或 dual');
    }

    // host_mode 不在 /start 的 body 中，需先透過 PATCH /script-settings 設定，
    // 且必須在啟動 pipeline 前完成（/start 會立即排入生成佇列）。
    if (hostMode !== undefined) {
      await apiPatch(`/api/pdfs/${encodeURIComponent(id)}/script-settings`, {
        script_max_chars_per_page: scriptMaxChars ?? null,
        host_mode: hostMode,
      });
    }

    const startBody: Record<string, unknown> = {};
    if (stylePrompt !== undefined) startBody.prompt = stylePrompt;
    if (imageStylePrompt !== undefined) startBody.image_style_prompt = imageStylePrompt;
    if (scriptMaxChars !== undefined) startBody.script_max_chars_per_page = scriptMaxChars;
    const data = await apiPost(`/api/pdfs/${encodeURIComponent(id)}/start`, startBody) as Record<string, unknown>;

    const settingLines = [
      `  簡報風格：${stylePrompt ? stylePrompt : '（預設）'}`,
      `  圖片風格：${imageStylePrompt ? imageStylePrompt : '（預設）'}`,
      `  逐字稿長度上限：${scriptMaxChars !== undefined ? `${scriptMaxChars} 字/頁` : '（預設）'}`,
      `  口白模式：${hostMode ?? '（維持原設定，預設 solo）'}`,
    ].join('\n');
    return (
      `設定已套用並啟動生成。\n${settingLines}\n狀態：${data.status ?? '—'}。\n` +
      `使用 get_generation_status（id: ${id}）查詢進度。`
    );
  }

  if (name === 'start_generation') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const stages = args.stages as string[] | undefined;
    const body: Record<string, unknown> = {};
    if (stages && stages.length > 0) {
      body.scripts  = stages.includes('scripts');
      body.audio     = stages.includes('audio');
      body.images    = stages.includes('images');
      body.animations = stages.includes('animations');
    }
    const data = await apiPost(`/api/pdfs/${encodeURIComponent(id)}/regenerate`, body) as Record<string, unknown>;
    return `生成任務已啟動。狀態：${data.status ?? '—'}。使用 get_generation_status 查詢進度。\n${JSON.stringify(data, null, 2)}`;
  }

  if (name === 'get_generation_status') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const data = await apiGet(`/api/pdfs/${encodeURIComponent(id)}/regenerate/status`) as Record<string, unknown>;
    const status = String(data.status ?? '—');
    const steps = (data.steps as Array<{ name: string; status: string }> | undefined) ?? [];
    const summary = steps.map((s) => `  ${s.name}: ${s.status}`).join('\n') || '  （無步驟資訊）';
    return `狀態：${status}\n階段進度：\n${summary}\n\n詳細資訊：\n${JSON.stringify(data, null, 2)}`;
  }

  if (name === 'get_page_script') {
    const id = String(args.id ?? '');
    const page = Number(args.page ?? 0);
    if (!id) throw new Error('缺少 id 參數');
    if (!Number.isInteger(page) || page < 1) throw new Error('page 必須是正整數');
    const text = await apiGetText(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/script`);
    return text || '（此頁腳本為空）';
  }

  if (name === 'set_page_script') {
    const id = String(args.id ?? '');
    const page = Number(args.page ?? 0);
    const script = String(args.script ?? '');
    if (!id) throw new Error('缺少 id 參數');
    if (!Number.isInteger(page) || page < 1) throw new Error('page 必須是正整數');
    if (script.length > 4096) throw new Error('script 不可超過 4096 字元');
    await apiPut(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/script`, { script });
    return `第 ${page} 頁腳本已更新（${script.length} 字元）。`;
  }

  // ── 頁面結構 ────────────────────────────────────────────────────────────────

  if (name === 'create_blank_deck') {
    const title = String(args.title ?? '').trim();
    const category = String(args.category ?? '').trim();
    const body: Record<string, unknown> = {};
    if (title) body.title = title;
    if (category) body.category = category;
    const data = (await apiPost('/api/pdfs/blank', body)) as {
      id?: string;
      title?: string;
      status?: string;
      page_count?: number;
    };
    return (
      `空白簡報已建立。\n` +
      `  ID：${data.id ?? '（未知）'}\n` +
      `  標題：${data.title ?? '（無標題）'}\n` +
      `  頁數：${data.page_count ?? 1}（一頁空白投影片）\n` +
      `  狀態：${data.status ?? '—'}\n\n` +
      `接著可以用 add_page 逐頁加，或用 add_pages_from_outline 讓 AI 依大綱一次生成多頁。`
    );
  }

  if (name === 'add_page') {
    const id = requireId(args);
    const after = optionalInsertPosition(args.after_page_number, 'after_page_number') ?? 0;
    const data = (await apiPost(`/api/pdfs/${encodeURIComponent(id)}/pages`, {
      after_page_number: after,
    })) as { page_number?: number; page_count?: number };
    const inserted = data.page_number ?? after + 1;
    const total = data.page_count ?? inserted;
    const shifted =
      total > inserted
        ? `原本的第 ${inserted}～${total - 1} 頁，頁碼各往後移了一位（現在是第 ${inserted + 1}～${total} 頁）。`
        : '插在最後面，其他頁面的頁碼沒有變動。';
    return (
      `已插入一頁空白投影片，新頁為第 ${inserted} 頁，簡報現在共 ${total} 頁。\n` +
      `${shifted}\n\n` +
      `這一頁還是空白的——沒有圖片提示詞、逐字稿與語音，需要接著填入。`
    );
  }

  if (name === 'delete_page') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const data = (await apiDelete(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}`)) as {
      page_count?: number;
    };
    const total = data.page_count ?? 0;
    const shifted =
      total >= page
        ? `原本的第 ${page + 1}～${total + 1} 頁，頁碼各往前移了一位（現在是第 ${page}～${total} 頁）。`
        : '刪除的是最後一頁，其他頁面的頁碼沒有變動。';
    return `第 ${page} 頁已刪除（含其圖片、逐字稿與語音），簡報現在共 ${total} 頁。\n${shifted}`;
  }

  if (name === 'move_page') {
    const id = requireId(args);
    const from = requirePageNumber(args.from_page_number, 'from_page_number');
    const to = requirePageNumber(args.to_page_number, 'to_page_number');
    const data = (await apiPost(`/api/pdfs/${encodeURIComponent(id)}/pages/move`, {
      from_page_number: from,
      to_page_number: to,
    })) as { page_count?: number };
    const total = data.page_count ?? 0;
    if (from === to) {
      return `from_page_number 與 to_page_number 都是第 ${from} 頁，頁面順序沒有改變（共 ${total} 頁）。`;
    }
    const between =
      from < to
        ? `原本的第 ${from + 1}～${to} 頁，頁碼各往前移了一位。`
        : `原本的第 ${to}～${from - 1} 頁，頁碼各往後移了一位。`;
    return `第 ${from} 頁已搬到第 ${to} 頁，簡報共 ${total} 頁。\n${between}`;
  }

  // ── 以大綱擴充既有簡報 ──────────────────────────────────────────────────────

  if (name === 'add_pages_from_outline') {
    const id = requireId(args);
    const outlineText = String(args.outline_text ?? '').trim();
    const prompt = String(args.prompt ?? '').trim();
    if (!outlineText && prompt.length < 5) {
      throw new Error('請提供 outline_text，或提供至少 5 個字的 prompt（兩者至少擇一）');
    }
    const body: Record<string, unknown> = {};
    if (prompt) body.prompt = prompt;
    if (outlineText) body.outline_text = outlineText;
    const insertAfter = optionalInsertPosition(args.insert_after_page, 'insert_after_page');
    if (insertAfter !== undefined) body.insert_after_page = insertAfter;
    const state = (await apiPost(
      `/api/pdfs/${encodeURIComponent(id)}/add-pages-from-prompt`,
      body,
    )) as AddPagesState;
    return (
      `新增頁面的任務已啟動（狀態：${state.status ?? '—'}）。\n\n` +
      `生成圖片、逐字稿與語音需要數分鐘。請用 get_add_pages_status（id: ${id}）輪詢，` +
      `直到狀態變成 done 或 failed；中途要放棄可用 cancel_add_pages。`
    );
  }

  if (name === 'get_add_pages_status') {
    const id = requireId(args);
    const state = (await apiGet(
      `/api/pdfs/${encodeURIComponent(id)}/add-pages-from-prompt/status`,
    )) as AddPagesState;
    return formatAddPagesState(state);
  }

  if (name === 'cancel_add_pages') {
    const id = requireId(args);
    await apiPost(`/api/pdfs/${encodeURIComponent(id)}/add-pages-from-prompt/cancel`);
    return (
      '新增頁面的任務已取消。\n' +
      '已經生成並插入的頁面會保留在簡報裡，不會回捲——請用 get_deck_outline 確認目前實際的頁數與內容。'
    );
  }

  // ── 整份簡報的概覽與標題 ────────────────────────────────────────────────────

  if (name === 'get_deck_outline') {
    const id = requireId(args);
    const includeScripts = args.include_scripts === true;
    const detail = (await apiGet(`/api/pdfs/${encodeURIComponent(id)}`)) as DeckDetail;
    const pages = detail.pages ?? [];
    const scripts = await fetchScriptsByPage(id);

    const header = [
      `簡報：${detail.title ?? '（無標題）'}`,
      `ID：${id}`,
      `狀態：${detail.status ?? '—'}　頁數：${pages.length}`,
    ].join('\n');

    if (!pages.length) return `${header}\n\n（這份簡報目前沒有任何頁面）`;

    const body = pages
      .map((p) => {
        const assets = [
          p.image_url ? '圖片' : null,
          p.script_url ? '逐字稿' : null,
          p.audio_url ? '語音' : null,
        ].filter(Boolean);
        const kind = RENDER_TYPE_LABELS[p.render_type ?? ''] ?? p.render_type ?? '投影片';
        const lines = [
          `第 ${p.page_number} 頁　[${kind}]　狀態：${p.status ?? '—'}　已有：${assets.length ? assets.join('／') : '（空白頁）'}`,
        ];
        const script = scripts.get(p.page_number);
        if (script) lines.push(includeScripts ? indentBlock(script) : `    ${summarizeScript(script)}`);
        return lines.join('\n');
      })
      .join('\n\n');

    const footer = includeScripts
      ? ''
      : '\n\n（以上為逐字稿開頭摘要；需要完整內容請把 include_scripts 設為 true，或用 get_page_script 取單頁）';
    return `${header}\n\n${body}${footer}`;
  }

  if (name === 'set_deck_title') {
    const id = requireId(args);
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('title 不可為空');
    if (title.length > 200) throw new Error('title 不可超過 200 字');
    await apiPatch(`/api/pdfs/${encodeURIComponent(id)}/title`, { title });
    return `簡報標題已更新為「${title}」。`;
  }

  // ── 逐頁資產：圖片 ──────────────────────────────────────────────────────────

  if (name === 'get_page_prompt') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const data = (await apiGet(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/prompt`)) as {
      page_prompt?: string | null;
    };
    return data.page_prompt?.trim()
      ? data.page_prompt
      : `（第 ${page} 頁還沒有圖片提示詞——用 add_page 建立的空白頁本來就是空的。）`;
  }

  if (name === 'set_page_prompt') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const prompt = String(args.prompt ?? '');
    if (prompt.length > 2000) throw new Error('prompt 不可超過 2000 字');
    await apiPatch(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/prompt`, { prompt });
    return (
      `第 ${page} 頁的圖片提示詞已更新（${prompt.length} 字）。\n` +
      `畫面還沒有跟著變——要重畫這一頁請呼叫 regenerate_page_image。`
    );
  }

  if (name === 'get_page_text') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const text = await apiGetText(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/text`);
    return text.trim() || `（第 ${page} 頁沒有文字內容）`;
  }

  if (name === 'regenerate_page_image') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) throw new Error('prompt 不可為空');
    if (prompt.length > 2000) throw new Error('prompt 不可超過 2000 字');
    const apply = args.apply !== false;

    const data = (await apiPost(
      `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/regenerate-image`,
      { prompt },
      GENERATION_TIMEOUT_MS,
    )) as { candidate_id?: string };
    const candidateId = data.candidate_id;
    if (!candidateId) throw new Error('後端沒有回傳 candidate_id，無法確認生成結果');

    if (!apply) {
      return (
        `第 ${page} 頁的候選圖已生成，candidate_id：${candidateId}\n\n` +
        `這還**不是**正式圖片。用 save_page_image（帶 candidate_id: "${candidateId}"）存到本機看過，` +
        `滿意後再用 apply_image_candidate 套用。`
      );
    }
    await applyImageCandidate(id, page, candidateId);
    return `第 ${page} 頁的圖片已重新生成並套用（原圖已被取代）。`;
  }

  if (name === 'apply_image_candidate') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const candidateId = String(args.candidate_id ?? '').trim();
    if (!candidateId) throw new Error('缺少 candidate_id 參數');
    await applyImageCandidate(id, page, candidateId);
    return `候選圖 ${candidateId} 已套用為第 ${page} 頁的投影片圖片（原圖已被取代）。`;
  }

  if (name === 'replace_page_image') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const filePath = String(args.file_path ?? '');
    if (!filePath) throw new Error('缺少 file_path 參數');
    if (!fs.existsSync(filePath)) throw new Error(`找不到檔案：${filePath}`);
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    await apiUploadImage(
      `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/replace-image`,
      bytes,
      filePath.split('/').pop() ?? 'image.jpg',
    );
    return `第 ${page} 頁的圖片已換成 ${filePath}（已轉為 1920×1080 JPEG）。`;
  }

  if (name === 'save_page_image') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const filePath = String(args.file_path ?? '');
    if (!filePath) throw new Error('缺少 file_path 參數');
    const candidateId = String(args.candidate_id ?? '').trim();
    const assetPath = candidateId
      ? `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/image-candidates/${encodeURIComponent(candidateId)}`
      : `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/image`;
    const bytes = await apiGetBytes(assetPath);
    fs.writeFileSync(filePath, bytes);
    const what = candidateId ? `候選圖 ${candidateId}` : `第 ${page} 頁目前的投影片圖片`;
    return `${what}已存到 ${filePath}（${bytes.length} bytes）。`;
  }

  // ── 逐頁資產：逐字稿與語音 ──────────────────────────────────────────────────

  if (name === 'rewrite_page_script') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) throw new Error('prompt 不可為空');
    if (prompt.length > 2000) throw new Error('prompt 不可超過 2000 字');
    const script = args.script !== undefined ? String(args.script) : await readPageScript(id, page);
    if (script.length > 4096) throw new Error('script 不可超過 4096 字');
    const data = (await apiPost(
      `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/rewrite-script`,
      { prompt, script },
      GENERATION_TIMEOUT_MS,
    )) as { script?: string };
    const rewritten = data.script ?? '';
    return (
      `改寫後的第 ${page} 頁逐字稿（${rewritten.length} 字）：\n\n${rewritten}\n\n` +
      `— 這份稿子**還沒有存檔**。要採用請呼叫 set_page_script 寫入，再用 regenerate_page_audio 重新合成語音。`
    );
  }

  if (name === 'regenerate_page_audio') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const script = args.script !== undefined ? String(args.script) : await readPageScript(id, page);
    if (!script.trim()) throw new Error(`第 ${page} 頁目前沒有逐字稿，請先用 set_page_script 寫入，或直接帶入 script 參數`);
    if (script.length > 4096) throw new Error('script 不可超過 4096 字');
    await apiPost(
      `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/regenerate-audio`,
      { script },
      GENERATION_TIMEOUT_MS,
    );
    return `第 ${page} 頁的語音已重新合成（逐字稿 ${script.length} 字，已一併寫入該頁）。`;
  }

  if (name === 'set_tts_settings') {
    const id = requireId(args);
    const voice = String(args.tts_voice ?? '').trim();
    if (!voice) throw new Error('tts_voice 不可為空');
    const speed = Number(args.tts_speed ?? NaN);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      throw new Error('tts_speed 必須是 0.25～4 之間的數值');
    }
    await apiPatch(`/api/pdfs/${encodeURIComponent(id)}/tts-settings`, {
      tts_voice: voice,
      tts_speed: speed,
    });
    return (
      `語音設定已更新（聲線：${voice}，語速：${speed}）。\n` +
      `既有的語音檔仍是舊設定產生的——要讓某一頁套用新設定，請對該頁呼叫 regenerate_page_audio。`
    );
  }

  throw new Error(`未知工具：${name}`);
}

// ── MCP stdio transport ────────────────────────────────────────────────────────

function sendMessage(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function respond(id: string | number, result: unknown): void {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function respondError(id: string | number, code: number, message: string): void {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: { jsonrpc: string; id?: string | number; method: string; params?: unknown };
  try {
    request = JSON.parse(trimmed);
  } catch {
    return; // ignore malformed JSON
  }

  const { id, method, params } = request;

  if (method === 'initialize') {
    respond(id!, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'makeslide', version: '1.0.0' },
    });
  } else if (method === 'initialized') {
    // notification — no response
  } else if (method === 'ping') {
    if (id !== undefined) respond(id, {});
  } else if (method === 'tools/list') {
    respond(id!, { tools: TOOLS });
  } else if (method === 'tools/call') {
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = p?.name ?? '';
    const toolArgs = p?.arguments ?? {};
    callTool(toolName, toolArgs)
      .then((text) => {
        respond(id!, { content: [{ type: 'text', text }] });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        respond(id!, { content: [{ type: 'text', text: `錯誤：${msg}` }], isError: true });
      });
  } else if (id !== undefined) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
});

rl.on('close', () => {
  process.exit(0);
});
