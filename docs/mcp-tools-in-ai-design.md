# 設計文件：在 makeslide 的 AI 呼叫中提供 MCP 工具

狀態：草案（2026-07-07）
分支：`feat/mcp-tools-in-ai`

## 1. 目標與動機

makeslide 目前已定義一組 MCP 工具（見 `backend/src/mcp-server.ts`），供 Claude Code 等**外部** agent 透過 stdio + HTTP 操作簡報。但 makeslide **自己**呼叫 LLM 產生內容時（腳本、標題、描述、測驗、AI 導師問答……），並沒有把這些工具交給模型。

本功能的目標：**在 makeslide 自身的 AI 呼叫中，選擇性地把（唯讀的）MCP 工具以 function-calling 形式傳給 LLM**，讓模型在生成前能主動查詢簡報的更多資訊（其他頁的投影片文字／逐字稿、整份簡報的中繼資料等），以產生更貼近脈絡、更一致的結果。

範例：替第 8 頁生成腳本時，模型可主動呼叫 `get_page_text(3)` 看第 3 頁定義了什麼名詞，或 `get_presentation()` 掌握整體結構，而不必把整份 corpus 都塞進 prompt。

## 2. 非目標（本期不做）

- **不**讓模型呼叫有副作用的工具（`upload_pdf`、`start_generation`、`set_page_script`）。生成過程中模型只能「讀」，不能觸發任何變更或連鎖生成。
- **不**改寫既有的 `mcp-server.ts`（它仍以獨立行程 + HTTP 對外服務）。本期新增的是**行程內**工具登錄表；兩者的去重列為後續工作。
- **不**在本期支援 Gemini 的 function-calling（v1 僅 OpenAI 相容 provider，含預設的 `cgu-air`）。provider 為 gemini 時自動略過工具、退化為原本行為。

## 3. 現況

- LLM 呼叫集中在 `backend/src/services/openai.ts` 的兩個函式：
  - `callChatJSON<T>()`：非串流，`response_format=json_object`，用於幾乎所有生成流程（腳本／標題／描述／測驗／品質檢查……約 24 個呼叫點）。
  - `streamChatText()`：串流純文字，用於 AI 導師 `/ask` 與動畫 custom-script。
- 兩者目前都**不支援** tools / tool_calls。
- provider 解析、client 建構在 `getOpenAIClient()`；帳號情境由 `accountContext.ts` 的 `currentAccountId()`（AsyncLocalStorage）提供。

## 4. 設計總覽

新增三塊：

1. **行程內 AI 工具登錄表**（`backend/src/services/aiTools.ts`）：定義唯讀工具、其 JSON schema 與**直接呼叫內部 DB/service** 的 handler（不走 HTTP、不需 token），並提供轉成 OpenAI `tools` 陣列與執行單一工具的函式。
2. **tool-calling 迴圈**：在 `callChatJSON` 與 `streamChatText` 加入選填的 `tools` 參數與多輪執行迴圈（模型回 `tool_calls` → 執行 → 回填結果 → 再問，直到模型給出最終答案；有輪數上限）。
3. **接線與開關**：呼叫點以新參數選擇性啟用；由設定旗標統一開關。

### 4.1 工具登錄表 `aiTools.ts`

```ts
export interface AiToolContext {
  accountId: string;          // 由 currentAccountId() 帶入，決定可見範圍
  pdfId?: string;             // 目前正在生成/問答的簡報（若有），供工具預設 scope
}

export interface AiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;                 // JSON Schema（OpenAI function parameters）
  handler: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<string>;
}

export function getReadonlyAiTools(): AiTool[];         // 唯讀工具清單
export function toOpenAiTools(tools: AiTool[]): ChatCompletionTool[];
export async function executeAiTool(
  tools: AiTool[], name: string, args: Record<string, unknown>, ctx: AiToolContext,
): Promise<string>;                                     // 找不到工具回結構化錯誤字串
```

**v1 唯讀工具集**（沿用 MCP 的語意，但 handler 走行程內）：

| 工具 | 參數 | 回傳 | 內部來源 |
|---|---|---|---|
| `list_presentations` | — | 該帳號可見的簡報清單（id/標題/狀態/頁數） | 查 `pdfs`（限 `currentAccountId` 可見） |
| `get_presentation` | `id` | 指定簡報的中繼資料與逐頁摘要 | 沿用 detail 組裝邏輯（唯讀） |
| `get_page_text` | `id?`, `page` | 該頁投影片文字（`id` 省略時用 ctx.pdfId） | 讀 `pages.text_path` |
| `get_page_script` | `id?`, `page` | 該頁逐字稿 | 讀 `pages.script_path` |

**安全**：所有 handler 一律唯讀；查詢限縮在 `ctx.accountId` 可見的簡報（比照 HTTP 層 `canReadPdf` 的帳號範圍），跨帳號一律拒絕。工具結果長度上限（每則截斷至約 8KB），避免灌爆 context。

### 4.2 tool-calling 迴圈

在 `openai.ts` 抽出共用 helper：

```ts
async function runToolLoop(client, model, baseParams, tools, ctx, opts): Promise<ChatCompletion>
```

流程（OpenAI 相容）：

1. 帶 `tools`（`tool_choice: 'auto'`）呼叫 `chat.completions.create`。
2. 若 `finish_reason === 'tool_calls'`：逐一 `executeAiTool`，把 assistant 的 tool_calls 訊息與每個 `role:'tool'` 結果 append 進 messages，回到步驟 1。
3. 否則回傳該 completion（最終答案）。
4. **輪數上限** `MAX_TOOL_ROUNDS = 5`；超過則強制 `tool_choice:'none'` 收尾，避免無限迴圈。

- `callChatJSON`：中間輪次**不**強制 `json_object`（讓模型能回 tool_calls）；最終收尾輪次才帶 `response_format=json_object` 並照原本 schema 驗證。
- `streamChatText`：採「**工具輪非串流、最終答案串流**」——先用非串流迴圈跑完所有 tool 輪，模型準備好回答時再對**最終一輪**開串流輸出給前端。這樣可重用同一迴圈，且不需處理串流中夾帶 tool_calls 的複雜狀態。

每次 tool 呼叫與結果都寫入既有的 LLM request/response log（新增 `tool` 標記），方便診斷。

### 4.3 接線與開關

- `ChatJSONParams` / `ChatTextStreamParams` 新增選填：
  - `tools?: AiTool[]`（要提供給模型的工具）
  - `toolContext?: AiToolContext`
- 設定旗標 `AI_MCP_TOOLS_ENABLED`（`config.ts`，預設 `true`）。關閉時所有呼叫點即使傳了 `tools` 也一律略過，等同現況。
- provider 為 `gemini` 時本期一律略過工具（記一則 debug log）。

**v1 啟用的呼叫點**（其餘call點不受影響、行為不變）：

1. **AI 導師 `/ask`**（`page-operations.ts`，`streamChatText`）——最直接的「取得更多簡報資訊」場景。
2. **逐頁腳本生成**（`worker/steps/generateScript.ts`，`callChatJSON`）——讓模型能查別頁維持術語一致。

（先接這兩處驗證價值；其餘生成流程之後再逐步開啟。）

## 5. 邊界與失敗處理

- 工具執行失敗（權限、找不到、例外）→ 回傳 `role:'tool'` 的錯誤字串，讓模型自行決定是否改用其他工具或直接作答；不讓整個生成失敗。
- 模型亂呼叫不存在的工具 → `executeAiTool` 回結構化錯誤字串。
- tool 迴圈輪數/時間上限，避免延遲與成本失控。
- 串流：只有最終答案輪串流；工具輪期間前端顯示「思考中…」（`/ask` 既有行為，不需改）。

## 6. 測試

- `aiTools.test.ts`：工具 schema 正確、handler 唯讀且遵守帳號範圍、跨帳號被拒、結果截斷。
- `openai` tool-loop：以 mock client 模擬「先回 tool_calls、再回最終答案」，驗證迴圈會執行工具、回填結果、於上限收斂；`callChatJSON` 最終輪帶 json_object、`streamChatText` 最終輪串流。
- `/ask` 整合：mock 一輪 tool_call（如 `get_page_text`）後串流最終答案，斷言前端收到的仍是正常 SSE。

## 7. 分階段

- **Phase 1（本期）**：`aiTools.ts` 唯讀工具集 + `callChatJSON`/`streamChatText` tool 迴圈（OpenAI 相容）+ 接 `/ask` 與 `generateScript` + 測試 + 開關。
- **Phase 2**：Gemini function-calling；`mcp-server.ts` 與 `aiTools.ts` 去重（共用同一份工具定義）；擴大到更多生成流程；每帳號開關與工具白名單設定 UI。

## 8. 風險

- **成本/延遲**：多輪 tool 呼叫會增加 token 與時間；以輪數上限與「預設只在少數呼叫點啟用」控制。
- **provider 相容性**：部分 OpenAI 相容 gateway 對 `tools` 支援不一；若回傳錯誤，迴圈需能退化為無工具重試一次（列入實作）。
- **權限外洩**：務必把工具查詢限縮在當前帳號可見範圍，測試涵蓋跨帳號拒絕。
