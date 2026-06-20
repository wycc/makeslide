# MCP 整合使用手冊 / MCP Integration Guide

makeslide 內建一個 MCP（Model Context Protocol）伺服器，讓 Claude Code 或其他支援 MCP 的工具可以直接呼叫 makeslide 的簡報生成流程——上傳 PDF、啟動 AI 生成、查詢進度、讀取或覆寫逐字稿——完全不需要打開瀏覽器。

makeslide ships a built-in MCP (Model Context Protocol) server so Claude Code or any other MCP-compatible client can drive makeslide's presentation pipeline directly — uploading PDFs, starting AI generation, checking progress, or reading/overwriting page scripts — without opening a browser.

## 何時需要這個功能 / When you need this

* 如果你的 makeslide 後端**沒有**啟用 Google 登入（`GOOGLE_AUTH_ENABLED` 未開啟），所有 API 本來就是開放的，MCP client 不需要任何 token 就能連線；可以跳過下面「產生 auth token」這一步。
* 如果你的後端**已經**啟用 Google 登入，所有 `/api/` 路由都會要求登入 session，MCP client 沒有瀏覽器、也沒有 session cookie，這時就需要一個 bearer token 來通過驗證——這就是下面要設定的 MCP auth token。

* If your makeslide backend does **not** have Google login enabled (`GOOGLE_AUTH_ENABLED` is off), every API route is already open and an MCP client can connect with no token at all — skip the "generate an auth token" step below.
* If Google login **is** enabled, every `/api/` route requires a logged-in session. An MCP client has no browser and no session cookie, so it needs a bearer token to get past that check — that's what the MCP auth token below is for.

## 步驟一：產生 MCP auth token（僅在啟用 Google 登入時需要）/ Step 1: Generate an MCP auth token (only needed with Google login enabled)

1. 以系統管理員（admin）帳號登入 makeslide。 / Sign in to makeslide with an admin account.
2. 前往「設定」頁，找到「MCP auth token」區塊。 / Go to the Settings page and find the "MCP auth token" section.
3. 按下「產生 MCP auth token」。 / Click "Generate MCP auth token".
4. 新 token 只會在這次顯示**一次**，畫面上會出現一次性提示框與「複製 token」按鈕，請立即複製保存；離開頁面或重新整理之後就不會再顯示明文，只會看到「目前已設定 MCP auth token」的狀態文字。 / The new token is shown **once**, in a one-time notice box with a "Copy token" button — copy it immediately. After you leave or reload the page, the raw value is gone for good; you'll only see a status line saying a token is configured.
5. 如果之後需要輪替（例如懷疑外洩），重新按一次「產生 MCP auth token」即可：新 token 會立即取代舊的，舊 token 立刻失效，不需要重啟伺服器。 / To rotate the token later (e.g. if it may have leaked), just click "Generate MCP auth token" again — the new token replaces the old one immediately and the old one stops working right away, no server restart needed.

## 步驟二：設定 MCP client / Step 2: Configure your MCP client

以 Claude Code 為例，編輯 `~/.claude/mcp_servers.json`： / For Claude Code, edit `~/.claude/mcp_servers.json`:

```json
{
  "makeslide": {
    "command": "npx",
    "args": ["--prefix", "/path/to/makeslide/backend", "tsx", "src/mcp-server.ts"],
    "env": {
      "MAKESLIDE_URL": "http://localhost:3000",
      "MAKESLIDE_MCP_TOKEN": "<步驟一複製的 token / the token copied in Step 1>"
    }
  }
}
```

* `MAKESLIDE_URL`：makeslide 後端的網址，預設 `http://localhost:3000`。 / The makeslide backend's base URL, defaults to `http://localhost:3000`.
* `MAKESLIDE_MCP_TOKEN`：步驟一產生的 token；若後端沒有啟用 Google 登入，這個欄位可以省略。 / The token generated in Step 1; omit it if the backend doesn't have Google login enabled.

若已經用 `npm --workspace backend run build` 建置過，也可以改用建置後的版本，啟動更快： / If you've already built the backend with `npm --workspace backend run build`, you can point at the built output to start faster instead:

```json
{
  "makeslide": {
    "command": "node",
    "args": ["/path/to/makeslide/backend/dist/mcp-server.js"],
    "env": {
      "MAKESLIDE_URL": "http://localhost:3000",
      "MAKESLIDE_MCP_TOKEN": "<token>"
    }
  }
}
```

設定完成後重新啟動 Claude Code（或重新載入 MCP 設定），即可在對話中看到 makeslide 提供的工具。 / After saving, restart Claude Code (or reload its MCP config) and the makeslide tools will be available in the conversation.

## 可用工具 / Available tools

| 工具 / Tool | 說明 / Description |
| --- | --- |
| `list_presentations` | 列出所有簡報的 ID、標題與目前狀態。 / List all presentations' IDs, titles, and current status. |
| `get_presentation` | 取得指定簡報的詳細資訊（頁數、各頁摘要、影片 URL）。 / Get full details for one presentation (page count, per-page summary, video URL). |
| `upload_pdf` | 上傳本機 PDF 檔案（用絕對路徑），建立新簡報。 / Upload a local PDF file (by absolute path) to create a new presentation. |
| `start_generation` | 啟動 AI 生成流程；可選擇只重新生成特定階段（`scripts`/`audio`/`images`/`animations`）。 / Start the AI generation pipeline; optionally limit it to specific stages (`scripts`/`audio`/`images`/`animations`). |
| `get_generation_status` | 查詢生成任務目前狀態與各階段進度，生成是非同步的，請用這個工具輪詢。 / Poll the generation job's current status and per-stage progress — generation runs asynchronously. |
| `get_page_script` | 讀取某一頁目前的逐字稿內容。 / Read a page's current script (narration text). |
| `set_page_script` | 覆寫某一頁的逐字稿（最長 4096 字元），通常搭配只重新生成語音（`start_generation` 的 `stages: ["audio"]`）一起使用。 / Overwrite a page's script (max 4096 characters), typically paired with regenerating only the audio stage (`stages: ["audio"]` on `start_generation`). |

## 範例對話流程 / Example workflow

```
我：幫我上傳 /Users/me/Desktop/report.pdf 並開始生成
1. upload_pdf({ file_path: "/Users/me/Desktop/report.pdf" })
2. start_generation({ id: "<剛建立的簡報 id>" })
3. get_generation_status({ id: "..." })  ← 重複呼叫直到 status 變成 done

Me: Upload /Users/me/Desktop/report.pdf and start generation
1. upload_pdf({ file_path: "/Users/me/Desktop/report.pdf" })
2. start_generation({ id: "<the new presentation id>" })
3. get_generation_status({ id: "..." })  ← call repeatedly until status is "done"
```

## 疑難排解 / Troubleshooting

* **所有工具呼叫都回傳 401 / Unauthorized**：確認後端有沒有啟用 Google 登入；如果有，檢查 `MAKESLIDE_MCP_TOKEN` 是否與設定頁目前產生的 token 一致（注意 token 輪替後舊值會立即失效）。 / **Every tool call returns 401 / Unauthorized**: check whether Google login is enabled on the backend; if it is, verify `MAKESLIDE_MCP_TOKEN` matches the token currently configured in Settings (rotating the token immediately invalidates the old value).
* **連線不到後端 / Cannot reach the backend**：確認 `MAKESLIDE_URL` 指向的後端正在執行，且 MCP client 所在的機器能存取那個網址（同機器用 `localhost`，不同機器要換成對外可連的網址）。 / **Cannot reach the backend**: make sure the backend at `MAKESLIDE_URL` is actually running and reachable from the machine running the MCP client (use `localhost` on the same machine, or a reachable address otherwise).
* **`upload_pdf` 找不到檔案 / `upload_pdf` says the file is missing**：`file_path` 必須是 MCP client（執行 `mcp-server.ts` 那個行程）所在機器上的絕對路徑，不是你聊天視窗所在的機器路徑。 / `file_path` must be an absolute path on the machine running the MCP server process, not on whatever machine you're chatting from.
* **token 外洩了怎麼辦 / What if the token leaks**：回到設定頁重新按一次「產生 MCP auth token」，舊 token 會立刻失效，不需要重啟伺服器。 / Go back to Settings and click "Generate MCP auth token" again — the old token stops working immediately, no restart required.
