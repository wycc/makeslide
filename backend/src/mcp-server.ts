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
 *   MAKESLIDE_ALLOW_SELF_SIGNED_CERT
 *                         Set to "true" only when MAKESLIDE_URL points to a
 *                         trusted private server using a self-signed TLS
 *                         certificate. This disables TLS certificate
 *                         verification for this MCP process.
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
 *         "MAKESLIDE_MCP_TOKEN": "<your-token>",
 *         "MAKESLIDE_ALLOW_SELF_SIGNED_CERT": "true"
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
const ALLOW_SELF_SIGNED_CERT = process.env.MAKESLIDE_ALLOW_SELF_SIGNED_CERT === 'true';

// `mcp-server.ts` deliberately has no external dependencies, including undici. Node's built-in
// fetch observes this process-level setting, so keep the insecure exception explicit and opt-in.
// The MCP process is short-lived and dedicated to MakeSlide, therefore this cannot weaken TLS for
// an unrelated application process.
if (ALLOW_SELF_SIGNED_CERT) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

/**
 * 沒有 body 的請求（GET、DELETE、以及不帶 payload 的 POST）**不能**宣告
 * `Content-Type: application/json`：Fastify 會據此去解析 body，發現是空的就直接回 400
 * `FST_ERR_CTP_EMPTY_JSON_BODY`，請求根本進不了路由。
 */
function authHeadersNoBody(): Record<string, string> {
  const h: Record<string, string> = {};
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
  const res = await fetchWithTimeout('GET', path, { headers: authHeadersNoBody() }, READ_TIMEOUT_MS);
  if (!res.ok) await failure('GET', path, res);
  return res.json();
}

async function apiGetText(path: string): Promise<string> {
  const res = await fetchWithTimeout('GET', path, { headers: authHeadersNoBody() }, READ_TIMEOUT_MS);
  if (!res.ok) await failure('GET', path, res);
  return res.text();
}

/** 讀二進位資產（投影片圖片、候選圖）。 */
async function apiGetBytes(path: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout('GET', path, { headers: authHeadersNoBody() }, READ_TIMEOUT_MS);
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
      headers: body !== undefined ? authHeaders() : authHeadersNoBody(),
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
  const res = await fetchWithTimeout('DELETE', path, { method: 'DELETE', headers: authHeadersNoBody() }, READ_TIMEOUT_MS);
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

  // ── Jupyter notebook 頁面 ──────────────────────────────────────────────────
  {
    name: 'get_page_notebook',
    description:
      '讀取某一頁的 Jupyter notebook（nbformat JSON）。\n\n' +
      '這一頁還不是 notebook 頁時，會回傳一份「只有一個空 code cell」的預設 notebook，' +
      '所以拿得到內容不代表這一頁已經是 notebook——頁面型別請看回應中的 render_type，或用 get_deck_outline。',
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
    name: 'set_page_notebook',
    description:
      '寫入某一頁的 Jupyter notebook（送出完整的 nbformat JSON），並**把這一頁轉成 notebook 頁**。\n\n' +
      '【notebook 頁不播語音】轉換後這一頁會被排除在簡報的語音總長之外；該頁既有的語音檔不會被刪除，' +
      '之後用 convert_page_to_slide 轉回投影片時就會恢復計入。\n\n' +
      '只想改幾個 cell 的話，用 edit_notebook_cells 比較省事——不必把整份文件重送一次。\n\n' +
      '格式：至少要有 `cells` 陣列，每個 cell 需有 `cell_type`（code／markdown／raw）與 `source`（字串或字串陣列）；' +
      '其餘欄位（outputs、execution_count、metadata……）會原封保留。上限 1000 個 cell、10 MB。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        notebook: {
          type: 'object',
          description: '完整的 nbformat JSON 文件（含 cells／metadata／nbformat／nbformat_minor）',
        },
      },
      required: ['id', 'page', 'notebook'],
    },
  },
  {
    name: 'edit_notebook_cells',
    description:
      '對某一頁的 notebook 做單一 cell 的增刪改，不必重送整份文件。工具會自己讀出現有 notebook、' +
      '套用這次的修改再寫回；與 set_page_notebook 一樣會把這一頁轉成 notebook 頁。\n\n' +
      '  • append：在最後面加一個 cell（需要 cell_type 與 source）\n' +
      '  • insert：插在第 index 個位置之前（需要 index、cell_type 與 source）\n' +
      '  • replace：取代第 index 個 cell（需要 index、cell_type 與 source）\n' +
      '  • delete：刪除第 index 個 cell（只需要 index）\n\n' +
      'index 從 0 開始。修改 cell 時該 cell 原本的 outputs 會被清掉——內容變了，舊的執行結果就不再對應。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        operation: {
          type: 'string',
          enum: ['append', 'insert', 'replace', 'delete'],
          description: '要做的動作',
        },
        index: { type: 'number', description: 'cell 位置（從 0 開始）。insert／replace／delete 必填。' },
        cell_type: {
          type: 'string',
          enum: ['code', 'markdown', 'raw'],
          description: 'cell 型別。append／insert／replace 必填。',
        },
        source: { type: 'string', description: 'cell 的內容。append／insert／replace 必填。' },
      },
      required: ['id', 'page', 'operation'],
    },
  },
  {
    name: 'generate_page_notebook',
    description:
      '請 AI 依一個主題，為某一頁生成一份可執行的 Jupyter notebook，並把這一頁轉成 notebook 頁。\n\n' +
      '【會覆蓋】這一頁原本的 notebook 內容會被整份取代。\n' +
      '【較慢】同步呼叫，會等到 AI 生成完成。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        topic: { type: 'string', description: 'notebook 的主題（1～500 字），例如「用 pandas 做基本的資料清理」' },
        context: { type: 'string', description: '選填：補充背景（最長 4000 字），例如聽眾程度、要用到的資料集。' },
      },
      required: ['id', 'page', 'topic'],
    },
  },
  {
    name: 'convert_page_to_slide',
    description:
      '把一頁 notebook 轉回一般投影片。\n\n' +
      '**notebook 內容不會被刪除**——`.ipynb` 檔案保留在原處，之後再呼叫 set_page_notebook 或 ' +
      'edit_notebook_cells 就會回到原本的內容，所以兩個方向都可逆。\n\n' +
      '這一頁若在變成 notebook 之前設過動畫，轉回來時會恢復成有動畫的投影片。\n\n' +
      '這一頁本來就不是 notebook 頁時會失敗（INVALID_STATE）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
      },
      required: ['id', 'page'],
    },
  },

  // ── 頁面動畫 ──────────────────────────────────────────────────────────────
  {
    name: 'describe_animation_spec',
    description:
      '查詢動畫 spec 的格式說明。**在第一次呼叫 set_page_animation 或 add_animation_effect 之前先查這個。**\n\n' +
      '不帶參數時回傳整體格式：spec 骨架、每個效果的必填欄位、緩動曲線可用值、' +
      '`startTrigger`（把時間錨在逐字稿句子上）的用法，以及所有效果型別的清單。\n\n' +
      '帶 effect_type 時回傳該型別的所有可用欄位與參數——欄位太多，刻意不塞進工具說明裡，用到哪種查哪種。',
    inputSchema: {
      type: 'object',
      properties: {
        effect_type: {
          type: 'string',
          description:
            '選填：要查的效果型別（例如 highlight-box、text-callout、shape）。省略時回傳整體格式說明。',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_page_animation',
    description: '讀取某一頁目前的動畫 spec，以及這一頁的頁面型別（static-image 表示沒有動畫、gsap-image 表示有）。',
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
    name: 'set_page_animation',
    description:
      '寫入某一頁完整的動畫 spec（會整份取代原本的設定）。\n\n' +
      '**先用 describe_animation_spec 查格式。** spec 的欄位很多，這裡不重複列出。\n\n' +
      '只是想加一個效果的話，用 add_animation_effect 比較安全——不必把既有的效果原樣重打一次。\n\n' +
      '`enabled` 設為 false 時動畫不會播放（可用來暫時關掉整頁動畫而不刪掉設定）。' +
      '後端會驗證這份 spec，不合法時回傳的訊息會指出是哪個欄位有問題。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        spec: {
          type: 'object',
          description: '完整的動畫 spec：{ version: 1, enabled: boolean, effects: [...] }。格式見 describe_animation_spec。',
          properties: {
            version: { type: 'number', description: '固定為 1' },
            enabled: { type: 'boolean', description: '是否啟用這一頁的動畫' },
            effects: {
              type: 'array',
              description: '效果陣列，最多 20 個。每個效果的欄位見 describe_animation_spec。',
              items: { type: 'object' },
            },
          },
          required: ['version', 'enabled', 'effects'],
        },
      },
      required: ['id', 'page', 'spec'],
    },
  },
  {
    name: 'add_animation_effect',
    description:
      '在某一頁的動畫中加入一個效果，保留原有的效果。工具會自己讀出現有 spec、附加後寫回，' +
      '所以不必把既有效果重打一次。\n\n' +
      '**會自動把這一頁的動畫設為啟用**——加了效果卻因為 enabled 是 false 而不會播，是最容易踩到又最難察覺的狀況。\n\n' +
      '**先用 describe_animation_spec（帶上你要用的 effect_type）查可用欄位。** ' +
      'effect 物件裡除了必填的 type／start／duration／ease 之外，其餘欄位依型別而定；' +
      '`id` 可以省略，會自動產生。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        effect: {
          type: 'object',
          description:
            '要加入的效果物件。必填 type、start、duration、ease；其餘欄位（params、text、items、exitDuration……）依效果型別而定，見 describe_animation_spec。',
          properties: {
            type: { type: 'string', description: '效果型別' },
            start: { type: 'number', description: '開始時間（秒）' },
            duration: { type: 'number', description: '進場動畫長度（秒，需大於 0）' },
            ease: { type: 'string', description: '緩動曲線，預設 power1.out' },
          },
          required: ['type', 'start', 'duration'],
        },
      },
      required: ['id', 'page', 'effect'],
    },
  },
  {
    name: 'generate_animation_script',
    description:
      '請 AI 依一段描述產生 custom-script 效果所需的 JavaScript 動畫程式碼。\n\n' +
      '【只回傳程式碼、不會寫入】拿到 code 之後，要自行用 add_animation_effect 加一個 ' +
      "type 為 custom-script 的效果、把 code 放進去，這段動畫才會生效。\n\n" +
      '【較慢】同步呼叫，後端會串流生成過程，本工具等到完成才回傳。\n\n' +
      '生成的程式碼會被後端檢查：太長、用到被禁的 API、或不符合約定介面時會失敗並說明原因。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        prompt: { type: 'string', description: '想要什麼樣的動畫（最長 300 字）' },
        previous_code: {
          type: 'string',
          description: '選填：上一版的程式碼，讓 AI 在其基礎上修改而不是重寫。',
        },
      },
      required: ['id', 'page', 'prompt'],
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

// ── Animation spec documentation ───────────────────────────────────────────────

/**
 * 動畫 spec 的欄位說明，由 describe_animation_spec 按需查詢。
 *
 * 為什麼不寫進 set_page_animation 的 inputSchema：後端的 effect 型別有 18 種、選填欄位數十個
 * （pointerColor、highlightBorderStyle、textCalloutMaxWidth……），全部展開會讓這一個工具的
 * 描述長過其他所有工具的總和，而且每次對話都要付這個 context。改成「骨架在 schema、細節按
 * 效果型別查」，agent 只為它真正要用的那一種付費。
 */
interface EffectDoc {
  summary: string;
  /** `params` 內可用的鍵；後端會把不在白名單內的鍵靜靜丟掉。 */
  params: string[];
  /** 這個型別專屬的頂層欄位。 */
  fields: string[];
}

/** 位置與大小的百分比參數，疊加類效果共用。 */
const BOX_PARAMS = ['xPct', 'yPct', 'widthPct', 'heightPct'];

const EFFECT_DOCS: Record<string, EffectDoc> = {
  'fade-in': { summary: '整張投影片淡入。', params: [], fields: [] },
  'zoom-in': {
    summary: '整張投影片放大。',
    params: ['fromScale（起始縮放，預設 1）', 'toScale（結束縮放）'],
    fields: [],
  },
  'zoom-out': {
    summary: '整張投影片縮小。',
    params: ['fromScale', 'toScale'],
    fields: [],
  },
  'pan-left': { summary: '整張投影片向左平移。', params: ['distancePct（移動距離，畫面寬度的百分比）'], fields: [] },
  'pan-right': { summary: '整張投影片向右平移。', params: ['distancePct'], fields: [] },
  'pan-up': { summary: '整張投影片向上平移。', params: ['distancePct'], fields: [] },
  'pan-down': { summary: '整張投影片向下平移。', params: ['distancePct'], fields: [] },
  'highlight-box': {
    summary: '在指定區域畫一個外框，用來圈出重點。',
    params: BOX_PARAMS,
    fields: [
      'highlightColor（外框顏色，CSS hex，預設 #ef4444）',
      'highlightBorderWidth（框線寬度 px，1～12，預設 4）',
      'highlightBorderRadius（圓角 px，0～50，預設 8）',
      'highlightOuterColor（外圈第二層顏色，讓框在任何底色上都看得清楚）',
      'highlightBorderStyle（solid／dashed／dotted，預設 solid）',
      'highlightFillColor（內部填色，預設透明）',
      'highlightPulse（true 時框線週期性發亮）',
      'highlightShadow（true 時加陰影）',
    ],
  },
  spotlight: {
    summary: '把指定區域以外的畫面壓暗，聚光燈效果。',
    params: BOX_PARAMS,
    fields: [
      'spotlightColor（遮罩顏色，預設 #000000）',
      'spotlightOpacity（遮罩不透明度，0～1，預設 0.6）',
      'spotlightSoftEdge（邊緣柔化 px，0～80，預設 0 為硬邊）',
      'spotlightShape（circle／rect，預設 circle）',
      'spotlightBorderRadius（rect 形狀的圓角 px，0～32）',
    ],
  },
  pointer: {
    summary: '在指定位置放一個指標（箭頭或圓點）。',
    params: ['xPct', 'yPct'],
    fields: [
      'angle（旋轉角度，度；0 為指向右下）',
      'pointerColor（顏色，預設 #f43f5e）',
      'pointerSize（大小 rem，1～6，預設 2.5）',
      'pointerShape（arrow／dot／cross，預設 arrow）',
      'pointerPulse（true 時脈動）',
      'pointerOpacity（0～1，預設 1）',
    ],
  },
  'text-callout': {
    summary: '在畫面上疊一段說明文字。',
    params: BOX_PARAMS,
    fields: [
      'text（要顯示的文字，最長 80 字）',
      'textCalloutFontSize（字級 rem，0.5～3，預設 1.25）',
      'textCalloutBgColor（背景色，預設 #0f172a）',
      'textCalloutTextColor（文字色，預設 #f8fafc）',
      'textCalloutAlign（left／center／right，預設 center）',
      'textCalloutBorderRadius（圓角 px，0～32）',
      'textCalloutBorderColor（外框色，設了才有框）',
      'textCalloutMaxWidth（最大寬度 vw，10～80；設了長文字才會換行而不是溢出）',
      'textCalloutPadding（sm／md／lg，預設 md）',
      'textCalloutShadow（true 時加陰影）',
    ],
  },
  shape: {
    summary: '畫一個 SVG 圖形（圓、方、箭頭、星形……）。',
    params: BOX_PARAMS,
    fields: [
      'shape（circle／rect／ellipse／arrow／line／triangle／star／hexagon，預設 circle）',
      'color（線條顏色，預設 #f43f5e）',
      'shapeFillColor（填色；省略時為空心）',
      'strokeWidth（線寬，1～20，預設 5）',
      'shapeOpacity（0～1，預設 1）',
      "shapeDashArray（虛線樣式，例如 '8 4'；預設實線）",
      'shapeRectRadius（rect 的圓角，0～24，預設 6）',
      'shapeGlow（true 時線條發光）',
    ],
  },
  'step-list': {
    summary: '逐項顯示的重點清單（依序淡入）。',
    params: BOX_PARAMS,
    fields: [
      'items（項目文字陣列，最多 6 項、每項最長 60 字）',
      'stepListBgColor（背景色，預設 #1e293b）',
      'stepListTextColor（文字色，預設 #f1f5f9）',
      'stepListFontSize（字級 rem，0.5～2.5，預設 1.1）',
      'stepListBulletStyle（disc／decimal／none，預設 disc）',
      'stepListHighlightIndex（要強調的項目索引，從 0 開始）',
      'stepListBorderRadius（圓角 px，0～32）',
      'stepListBorderColor（外框色）',
    ],
  },
  'overlay-image': {
    summary: '疊上一張從原始 PDF 抽出的插圖。',
    params: BOX_PARAMS,
    fields: [
      'figureId（插圖 id，來自 GET /api/pdfs/:id/pages/:n/figures）',
      'overlayImageOpacity（0～1，預設 1）',
      'overlayImageBorderRadius（圓角 px，0～48）',
      'overlayImageShadow（true 時加陰影）',
    ],
  },
  formula: {
    summary: '以 KaTeX 顯示一個數學公式。',
    params: BOX_PARAMS,
    fields: [
      'formula（LaTeX 原始碼，最長 200 字）',
      'formulaFontSize（字級 em，0.5～4，預設 1.5）',
      'formulaBgColor（背景色，預設 #0f172a）',
      'formulaTextColor（文字色，預設 #f8fafc）',
      'formulaBorderRadius（圓角 px，0～32）',
      'formulaBorderColor（外框色）',
      'formulaShadow（true 時加陰影）',
    ],
  },
  'pause-playback': {
    summary: '播放到這裡時暫停，等待講者操作。這是互動效果，不只是視覺效果。',
    params: BOX_PARAMS,
    fields: ['text（暫停時顯示的提示文字）'],
  },
  'realtime-poll': {
    summary: '播放到這裡時暫停並叫出即時投票。投票本身要先用 webui 或投票 API 建立好。',
    params: BOX_PARAMS,
    fields: [
      'pollId（要顯示哪一個投票，來自 GET /api/pdfs/:id/pages/:n/polls）',
      'text（預告文字，通常就是題目）',
    ],
  },
  'custom-script': {
    summary: '執行一段自訂 JavaScript（在沙箱 iframe 中）。通常用 generate_animation_script 產生程式碼。',
    params: BOX_PARAMS,
    fields: [
      'code（JavaScript 原始碼，最長 24000 字）',
      'prompt（產生這段程式碼的提示詞，存起來方便之後接續修改）',
    ],
  },
};

/**
 * 只描述我們真正會操作的三個欄位。效果本身刻意留成寬鬆的 record——每個型別各有數十個選填
 * 欄位，在這裡逐一列型別只會變成第二份必須跟著後端同步的定義，而真正的驗證本來就在後端。
 */
interface AnimationSpec {
  version: number;
  enabled: boolean;
  effects: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * 消費 custom-script 的 SSE 串流，取出最終結果。
 *
 * 後端把生成過程串流出來（plan-delta／delta 是逐段文字，plan-done 是中間產物），但 MCP 的
 * 工具回應是一次性的，中間過程對 agent 沒有用處——這裡只等 `done`（帶 code）或 `error`。
 * 邊界要自己切：SSE 以空行分隔事件，而網路封包不會剛好落在事件邊界上。
 */
async function streamCustomScript(id: string, page: number, body: Record<string, unknown>): Promise<string> {
  const path = `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/animation/custom-script`;
  const res = await fetchWithTimeout(
    'POST',
    path,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) },
    GENERATION_TIMEOUT_MS,
  );
  if (!res.ok) await failure('POST', path, res);
  if (!res.body) throw new Error(`POST ${path} → 後端沒有回傳串流內容`);

  const decoder = new TextDecoder();
  let buffer = '';
  let code: string | null = null;
  let failureMessage: string | null = null;

  const consume = (chunk: string): void => {
    buffer += chunk;
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (event === 'done' || event === 'error') {
        try {
          const parsed = JSON.parse(data) as { code?: string; message?: string };
          if (event === 'done') code = parsed.code ?? '';
          else failureMessage = `${parsed.message ?? '生成失敗'}${parsed.code ? ` [${parsed.code}]` : ''}`;
        } catch {
          failureMessage = '後端回傳的事件內容無法解析';
        }
      }
      sep = buffer.indexOf('\n\n');
    }
  };

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    consume(decoder.decode(chunk, { stream: true }));
  }
  consume(decoder.decode());

  if (failureMessage) throw new Error(`產生動畫程式碼失敗：${failureMessage}`);
  if (code === null) throw new Error('後端的串流結束了，但沒有回傳程式碼——請重試一次');
  return code;
}

/** 疊加類效果——會在投影片上加東西，因此支援 exitDuration（顯示多久後自動淡出）。 */
const OVERLAY_EFFECT_TYPES = [
  'highlight-box',
  'spotlight',
  'pointer',
  'text-callout',
  'shape',
  'step-list',
  'overlay-image',
  'formula',
  'pause-playback',
  'realtime-poll',
  'custom-script',
];

const ANIMATION_EASES = [
  'none',
  'power1.in',
  'power1.out',
  'power1.inOut',
  'power2.inOut',
  'elastic.out',
  'back.out',
];

function describeAnimationOverview(): string {
  const transform = Object.keys(EFFECT_DOCS).filter((t) => !OVERLAY_EFFECT_TYPES.includes(t));
  return [
    '# 動畫 spec 格式',
    '',
    '```json',
    '{',
    '  "version": 1,',
    '  "enabled": true,',
    '  "effects": [',
    '    {',
    '      "id": "e1",',
    '      "target": "slide",',
    '      "type": "highlight-box",',
    '      "start": 2.5,',
    '      "duration": 1,',
    '      "ease": "power1.out",',
    '      "params": { "xPct": 10, "yPct": 20, "widthPct": 30, "heightPct": 15 }',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '## 每個效果的必填欄位',
    '',
    '- `id`：這份 spec 內唯一的字串（1～64 字）',
    "- `target`：一律是 `\"slide\"`",
    '- `type`：效果型別（見下方清單）',
    '- `start`：開始時間（秒，從這一頁的語音起算）',
    '- `duration`：進場動畫長度（秒，必須大於 0）',
    `- \`ease\`：緩動曲線，可用值：${ANIMATION_EASES.join('、')}`,
    '',
    '## 選填的共通欄位',
    '',
    '- `params`：位置與大小等數值參數，可用的鍵**依效果型別而定**（不在白名單內的鍵會被靜靜丟掉，不會報錯）。',
    '- `exitDuration`：顯示多久之後自動淡出（秒）。**只有疊加類效果有意義**，變換類會忽略它。',
    '- `startTrigger`：把開始時間錨在逐字稿的某一句上，而不是固定秒數：',
    '  `{ "type": "transcript-line", "line": 0, "offsetSeconds": 0, "anchor": "start" }`',
    '  `line` 從 0 開始；`anchor` 為 `"start"`（那一句開始時，省略時的預設）或 `"end"`（那一句講完時）。',
    '  設了 `startTrigger` 時，`start` 會在播放時被重新計算。',
    '',
    '## 效果型別',
    '',
    `**變換類**（作用於整張投影片，不支援 exitDuration）：${transform.join('、')}`,
    '',
    `**疊加類**（在投影片上加東西，支援 exitDuration）：${OVERLAY_EFFECT_TYPES.join('、')}`,
    '',
    '用 `describe_animation_spec` 帶上 `effect_type` 可查該型別的所有可用欄位。',
    '',
    '## 限制',
    '',
    '- 一頁最多 20 個效果',
    '- `enabled` 為 false 時整份動畫不會播放（`add_animation_effect` 會自動把它設為 true）',
  ].join('\n');
}

function describeAnimationEffect(type: string): string {
  const doc = EFFECT_DOCS[type];
  if (!doc) {
    throw new Error(`未知的效果型別：${type}\n可用的型別：${Object.keys(EFFECT_DOCS).join('、')}`);
  }
  const lines = [`# ${type}`, '', doc.summary, ''];
  lines.push('## params 可用的鍵', '');
  lines.push(doc.params.length ? doc.params.map((p) => `- ${p}`).join('\n') : '（這個型別不使用 params）');
  lines.push('', '## 專屬欄位（皆為選填，直接放在效果物件的頂層）', '');
  lines.push(doc.fields.length ? doc.fields.map((f) => `- ${f}`).join('\n') : '（沒有專屬欄位）');
  if (OVERLAY_EFFECT_TYPES.includes(type)) {
    lines.push('', '這是疊加類效果，另外支援 `exitDuration`（顯示多久後自動淡出，單位秒）。');
  }
  return lines.join('\n');
}

// ── Notebook helpers ───────────────────────────────────────────────────────────

/**
 * 只描述我們真正會碰到的部分：`cells` 陣列。其餘欄位（metadata、nbformat、widget state……）
 * 一律原封轉送——後端刻意用 passthrough 保存它們，這裡跟著不動，讀出來再寫回去才不會掉東西。
 * 本檔維持零依賴，所以不從後端 import 型別。
 */
interface NotebookDocument {
  cells: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * 組一個 nbformat cell。code cell 必須帶 `outputs` 與 `execution_count`——這是 nbformat 的
 * 必填欄位，少了它們 Jupyter 開檔會抱怨。內容變了就給空的執行結果：舊的 outputs 對應的是舊
 * 程式碼，留著只會顯示與現在這段程式無關的結果。
 */
function makeNotebookCell(cellType: string, source: string): Record<string, unknown> {
  const cell: Record<string, unknown> = { cell_type: cellType, source, metadata: {} };
  if (cellType === 'code') {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return cell;
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

  // ── Jupyter notebook 頁面 ──────────────────────────────────────────────────

  if (name === 'get_page_notebook') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const data = (await apiGet(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/notebook`)) as {
      render_type?: string;
      notebook?: NotebookDocument;
    };
    const cells = data.notebook?.cells ?? [];
    const isNotebookPage = data.render_type === 'notebook';
    const header = isNotebookPage
      ? `第 ${page} 頁是 notebook 頁，共 ${cells.length} 個 cell。`
      : `第 ${page} 頁**還不是** notebook 頁（目前型別：${data.render_type ?? '—'}），以下是預設的空 notebook。`;
    return `${header}\n\n${JSON.stringify(data.notebook ?? {}, null, 2)}`;
  }

  if (name === 'set_page_notebook') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const notebook = args.notebook;
    if (typeof notebook !== 'object' || notebook === null || Array.isArray(notebook)) {
      throw new Error('notebook 必須是一個 nbformat JSON 物件');
    }
    await apiPut(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/notebook`, { notebook });
    const cells = (notebook as NotebookDocument).cells?.length ?? 0;
    return (
      `第 ${page} 頁的 notebook 已寫入（${cells} 個 cell），這一頁現在是 notebook 頁。\n` +
      `notebook 頁不播語音，已從簡報的語音總長中排除；用 convert_page_to_slide 轉回投影片即可恢復。`
    );
  }

  if (name === 'edit_notebook_cells') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const operation = String(args.operation ?? '');
    if (!['append', 'insert', 'replace', 'delete'].includes(operation)) {
      throw new Error('operation 必須是 append／insert／replace／delete 其中之一');
    }

    const current = (await apiGet(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/notebook`)) as {
      notebook?: NotebookDocument;
    };
    const notebook = current.notebook;
    if (!notebook || !Array.isArray(notebook.cells)) throw new Error('後端回傳的 notebook 格式不正確');
    const cells = notebook.cells;

    const needsIndex = operation !== 'append';
    let index = 0;
    if (needsIndex) {
      index = Number(args.index ?? NaN);
      if (!Number.isInteger(index) || index < 0) throw new Error('index 必須是 0 或正整數（cell 位置從 0 開始）');
      const limit = operation === 'insert' ? cells.length : cells.length - 1;
      if (index > limit) {
        throw new Error(`index 超出範圍：這一頁目前有 ${cells.length} 個 cell（${operation} 可用的最大 index 是 ${limit}）`);
      }
    }

    let summary: string;
    if (operation === 'delete') {
      if (cells.length <= 1) throw new Error('notebook 至少要保留一個 cell，無法刪除最後一個');
      cells.splice(index, 1);
      summary = `已刪除第 ${index} 個 cell`;
    } else {
      const cellType = String(args.cell_type ?? '');
      if (!['code', 'markdown', 'raw'].includes(cellType)) {
        throw new Error('cell_type 必須是 code／markdown／raw 其中之一');
      }
      if (args.source === undefined) throw new Error('缺少 source 參數');
      const cell = makeNotebookCell(cellType, String(args.source));
      if (operation === 'append') {
        cells.push(cell);
        summary = `已在最後面新增一個 ${cellType} cell（index ${cells.length - 1}）`;
      } else if (operation === 'insert') {
        cells.splice(index, 0, cell);
        summary = `已在 index ${index} 插入一個 ${cellType} cell`;
      } else {
        cells[index] = cell;
        summary = `已取代 index ${index} 的 cell（${cellType}），其原本的執行結果已清除`;
      }
    }

    await apiPut(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/notebook`, { notebook });
    return `第 ${page} 頁：${summary}。目前共 ${cells.length} 個 cell。`;
  }

  if (name === 'generate_page_notebook') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const topic = String(args.topic ?? '').trim();
    if (!topic) throw new Error('topic 不可為空');
    if (topic.length > 500) throw new Error('topic 不可超過 500 字');
    const body: Record<string, unknown> = { topic };
    if (args.context !== undefined) {
      const context = String(args.context);
      if (context.length > 4000) throw new Error('context 不可超過 4000 字');
      body.context = context;
    }
    const data = (await apiPost(
      `/api/pdfs/${encodeURIComponent(id)}/pages/${page}/notebook/generate`,
      body,
      GENERATION_TIMEOUT_MS,
    )) as { notebook?: NotebookDocument };
    const cells = data.notebook?.cells?.length ?? 0;
    return (
      `第 ${page} 頁的 notebook 已由 AI 生成（${cells} 個 cell），這一頁現在是 notebook 頁。\n` +
      `用 get_page_notebook 讀取內容，或用 edit_notebook_cells 逐格調整。`
    );
  }

  if (name === 'convert_page_to_slide') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const data = (await apiPost(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/convert-to-slide`)) as {
      render_type?: string;
    };
    const restored = data.render_type === 'gsap-image' ? '有動畫的投影片' : '一般投影片';
    return (
      `第 ${page} 頁已轉回${restored}。\n` +
      `notebook 內容並沒有被刪除——再呼叫一次 set_page_notebook 或 edit_notebook_cells 就會回到原本的內容。`
    );
  }

  // ── 頁面動畫 ────────────────────────────────────────────────────────────────

  if (name === 'describe_animation_spec') {
    const type = String(args.effect_type ?? '').trim();
    return type ? describeAnimationEffect(type) : describeAnimationOverview();
  }

  if (name === 'get_page_animation') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const data = (await apiGet(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/animation`)) as {
      render_type?: string;
      spec?: AnimationSpec;
    };
    const spec = data.spec;
    const effects = spec?.effects ?? [];
    const state = spec?.enabled ? '已啟用' : '未啟用（設定仍在，但不會播放）';
    const header = `第 ${page} 頁　頁面型別：${data.render_type ?? '—'}　動畫：${state}　效果數：${effects.length}`;
    return `${header}\n\n${JSON.stringify(spec ?? {}, null, 2)}`;
  }

  if (name === 'set_page_animation') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const spec = args.spec;
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
      throw new Error('spec 必須是一個物件（格式見 describe_animation_spec）');
    }
    const data = (await apiPut(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/animation`, { spec })) as {
      render_type?: string;
    };
    const typed = spec as AnimationSpec;
    const count = typed.effects?.length ?? 0;
    const note =
      data.render_type === 'gsap-image'
        ? ''
        : '\n注意：這一頁的型別是 static-image，表示動畫並未啟用——spec 的 enabled 為 false 時會是這樣。';
    return `第 ${page} 頁的動畫 spec 已寫入（${count} 個效果）。${note}`;
  }

  if (name === 'add_animation_effect') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const effect = args.effect;
    if (typeof effect !== 'object' || effect === null || Array.isArray(effect)) {
      throw new Error('effect 必須是一個物件（格式見 describe_animation_spec）');
    }
    const incoming = effect as Record<string, unknown>;
    if (!EFFECT_DOCS[String(incoming.type ?? '')]) {
      throw new Error(
        `未知的效果型別：${String(incoming.type ?? '（未指定）')}\n可用的型別：${Object.keys(EFFECT_DOCS).join('、')}`,
      );
    }

    const current = (await apiGet(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/animation`)) as {
      spec?: AnimationSpec;
    };
    const spec: AnimationSpec = current.spec ?? { version: 1, enabled: false, effects: [] };
    const effects = Array.isArray(spec.effects) ? spec.effects : [];
    if (effects.length >= 20) {
      throw new Error('這一頁已經有 20 個效果，達到上限；請先用 set_page_animation 移除不需要的效果');
    }

    // id 由這裡補，因為它只需要在這份 spec 內唯一——要求 agent 自己想一個不重複的 id，
    // 只是把一件工具能可靠做到的事推給它，而撞號的後果（覆蓋掉另一個效果）並不明顯。
    const used = new Set(effects.map((e) => String((e as Record<string, unknown>).id ?? '')));
    let generatedId = `e${effects.length + 1}`;
    let counter = effects.length + 1;
    while (used.has(generatedId)) generatedId = `e${++counter}`;

    const newEffect: Record<string, unknown> = {
      ...incoming,
      id: incoming.id !== undefined && !used.has(String(incoming.id)) ? incoming.id : generatedId,
      target: 'slide',
      ease: incoming.ease ?? 'power1.out',
    };
    effects.push(newEffect);

    // 加了效果卻沒啟用，等於什麼都沒發生，而且畫面上看不出差別——這種安靜的失敗不該讓
    // agent 自己想到要再開一次。
    const wasDisabled = spec.enabled !== true;
    const nextSpec: AnimationSpec = { ...spec, version: 1, enabled: true, effects };
    await apiPut(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/animation`, { spec: nextSpec });

    const enabledNote = wasDisabled ? '\n（這一頁的動畫原本是關閉的，已一併啟用。）' : '';
    return (
      `已在第 ${page} 頁加入一個 ${String(incoming.type)} 效果（id: ${newEffect.id}），` +
      `這一頁現在共 ${effects.length} 個效果。${enabledNote}`
    );
  }

  if (name === 'generate_animation_script') {
    const id = requireId(args);
    const page = requirePageNumber(args.page, 'page');
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) throw new Error('prompt 不可為空');
    if (prompt.length > 300) throw new Error('prompt 不可超過 300 字');
    const body: Record<string, unknown> = { prompt };
    if (args.previous_code !== undefined) {
      const previousCode = String(args.previous_code);
      if (previousCode.length > 24000) throw new Error('previous_code 不可超過 24000 字');
      body.previousCode = previousCode;
    }
    const code = await streamCustomScript(id, page, body);
    return (
      `已產生 custom-script 動畫程式碼（${code.length} 字）：\n\n${code}\n\n` +
      `— 這段程式碼**還沒有套用**。請用 add_animation_effect 加一個 type 為 custom-script 的效果，` +
      `把上面的程式碼放進 code 欄位，動畫才會生效。`
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
