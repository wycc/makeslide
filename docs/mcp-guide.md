# MCP 整合使用手冊 / MCP Integration Guide

makeslide 內建一個 MCP（Model Context Protocol）伺服器，讓 Claude Code 或其他支援 MCP 的工具可以直接呼叫 makeslide 的簡報生成流程——上傳 PDF、啟動 AI 生成、查詢進度、讀取或覆寫逐字稿，以及新增／刪除／重排頁面——完全不需要打開瀏覽器。

makeslide ships a built-in MCP (Model Context Protocol) server so Claude Code or any other MCP-compatible client can drive makeslide's presentation pipeline directly — uploading PDFs, starting AI generation, checking progress, reading/overwriting page scripts, and adding/deleting/reordering pages — without opening a browser.

## 何時需要這個功能 / When you need this

* 如果你的 makeslide 後端**沒有**啟用 Google 登入（`GOOGLE_AUTH_ENABLED` 未開啟），所有 API 本來就是開放的，MCP client 不需要任何 token 就能連線；可以跳過下面「產生 auth token」這一步。
* 如果你的後端**已經**啟用 Google 登入，所有 `/api/` 路由都會要求登入 session，MCP client 沒有瀏覽器、也沒有 session cookie，這時就需要一個 bearer token 來通過驗證，並讓 MCP 請求被視為「你自己」這個帳號——這就是下面要設定的 MCP auth token。

* If your makeslide backend does **not** have Google login enabled (`GOOGLE_AUTH_ENABLED` is off), every API route is already open and an MCP client can connect with no token at all — skip the "generate an auth token" step below.
* If Google login **is** enabled, every `/api/` route requires a logged-in session. An MCP client has no browser and no session cookie, so it needs a bearer token to get past that check and be recognized as you specifically — that's what the MCP auth token below is for.

## 步驟一：產生 MCP auth token（僅在啟用 Google 登入時需要）/ Step 1: Generate an MCP auth token (only needed with Google login enabled)

每個帳號各自擁有一份自己的 MCP auth token；不需要管理員（admin）權限，任何登入的帳號都可以產生自己的 token。用這個 token 連線的 MCP client，會被視為「這個帳號本人」在操作——可以完整讀寫這個帳號自己擁有的所有簡報，就跟用瀏覽器登入這個帳號的效果一樣；但對於別人擁有的簡報，仍然依照那份簡報的可見度設定決定能不能讀寫（見下方「已知限制」）。

Each account has its own MCP auth token; no admin permission is needed — any logged-in account can generate its own. An MCP client connecting with this token is treated as that specific account — it gets full read/write access to every presentation that account owns, exactly as if that account had logged in through a browser. For presentations owned by someone else, access still depends on that presentation's visibility setting (see "Known limitation" below).

1. 用你自己的帳號登入 makeslide（不需要是 admin）。 / Sign in to makeslide with your own account (admin is not required).
2. 前往「設定」頁的「帳號」分類，找到「MCP auth token」區塊。 / Go to the Settings page, "Account" category, and find the "MCP auth token" section.
3. 按下「產生 MCP auth token」。 / Click "Generate MCP auth token".
4. 新 token 只會在這次顯示**一次**，畫面上會出現一次性提示框與「複製 token」按鈕，請立即複製保存；離開頁面或重新整理之後就不會再顯示明文，只會看到「目前已設定 MCP auth token」的狀態文字。 / The new token is shown **once**, in a one-time notice box with a "Copy token" button — copy it immediately. After you leave or reload the page, the raw value is gone for good; you'll only see a status line saying a token is configured.
5. 如果之後需要輪替（例如懷疑外洩），重新按一次「產生 MCP auth token」即可：新 token 會立即取代你這個帳號的舊 token，舊 token 立刻失效，不需要重啟伺服器。 / To rotate the token later (e.g. if it may have leaked), just click "Generate MCP auth token" again — the new token replaces your account's old one immediately and the old one stops working right away, no server restart needed.

## 步驟二：設定 MCP client / Step 2: Configure your MCP client

以 Claude Code 為例，編輯 `~/.claude/mcp_servers.json`： / For Claude Code, edit `~/.claude/mcp_servers.json`:

**建議做法：直接從 GitHub 抓最新版執行，不依賴本機固定目錄。** `mcp-server.ts` 沒有任何外部套件依賴（只用 `node:fs`／`node:readline`／全域 `fetch`），完全不需要 makeslide 這個 monorepo 的其他相依套件（包括 `better-sqlite3`／`canvas`／`sharp` 這些需要原生編譯的套件）。下面的設定每次啟動 MCP client 都會重新從 `master` 分支下載最新的 `mcp-server.ts` 到 `/tmp`，再用 `tsx` 執行——不做任何快取，永遠拿到最新版本：

**Recommended: fetch the latest version straight from GitHub instead of depending on a fixed local directory.** `mcp-server.ts` has zero external package dependencies (only `node:fs`/`node:readline`/global `fetch`), so it never needs any of makeslide's other dependencies installed (including native-compiled ones like `better-sqlite3`/`canvas`/`sharp`). The config below re-downloads the latest `mcp-server.ts` from the `master` branch to `/tmp` on every MCP client launch and runs it with `tsx` — nothing is cached, so it's always the newest version:

```json
{
  "makeslide": {
    "command": "sh",
    "args": [
      "-c",
      "curl -fsSL https://raw.githubusercontent.com/wycc/makeslide/master/backend/src/mcp-server.ts -o /tmp/makeslide-mcp-server.ts && exec npx -y tsx /tmp/makeslide-mcp-server.ts"
    ],
    "env": {
      "MAKESLIDE_URL": "http://localhost:3000",
      "MAKESLIDE_MCP_TOKEN": "<步驟一複製的 token / the token copied in Step 1>"
    }
  }
}
```

* `MAKESLIDE_URL`：makeslide 後端的網址，預設 `http://localhost:3000`。 / The makeslide backend's base URL, defaults to `http://localhost:3000`.
* `MAKESLIDE_MCP_TOKEN`：步驟一產生的 token；若後端沒有啟用 Google 登入，這個欄位可以省略。 / The token generated in Step 1; omit it if the backend doesn't have Google login enabled.
* 需要機器上有 `curl` 與 `npx`（`tsx` 由 `npx -y` 自動安裝，不需要預先安裝）。 / Requires `curl` and `npx` on the machine (`tsx` is auto-installed by `npx -y`, no need to install it beforehand).
* 每次啟動都會重新下載，所以永遠是 `master` 分支當下最新的版本；如果 repo 更新後某次改動導致行為不如預期，可以暫時改用下面「本機固定目錄」的方式釘住某個版本。 / Every launch re-downloads, so it always tracks whatever is currently on `master`; if an update to the repo ever causes unexpected behavior, temporarily switch to the "fixed local directory" method below to pin a specific version.

**若你本機已經 clone 這個 repo（例如正在開發 makeslide 本身），改用本機固定目錄啟動更快、也不需要網路：** / **If you already have a local checkout (e.g. developing makeslide itself), running from the fixed local directory is faster and works offline:**

```json
{
  "makeslide": {
    "command": "npx",
    "args": ["--prefix", "/path/to/makeslide/backend", "tsx", "src/mcp-server.ts"],
    "env": {
      "MAKESLIDE_URL": "http://localhost:3000",
      "MAKESLIDE_MCP_TOKEN": "<token>"
    }
  }
}
```

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
| `upload_txt` | 上傳純文字的簡報大綱（不需要 PDF），建立新簡報；工具說明中附有大綱格式（`Slide N:` 標題＋`- ` 重點，重點後還可加一段摘要文字補充該頁內容，供產生逐字稿用）。建立後需再呼叫 `define_prompt` 才會開始生成。 / Upload a plain-text presentation outline (no PDF needed) to create a new presentation; the tool description documents the outline format (`Slide N:` title + `- ` bullets, optionally followed by a paragraph of summary text per slide to feed the narration script). Call `define_prompt` afterwards to actually start generation. |
| `define_prompt` | 為 `awaiting_prompt` 狀態的簡報指定生成設定（簡報風格 `style_prompt`、圖片風格 `image_style_prompt`、逐字稿長度 `script_max_chars_per_page`、單／雙人模式 `host_mode`）並正式啟動生成。 / Set generation options for an `awaiting_prompt` presentation (presentation style `style_prompt`, image style `image_style_prompt`, narration length `script_max_chars_per_page`, solo/dual mode `host_mode`) and kick off generation. |
| `start_generation` | 啟動 AI 生成流程；可選擇只重新生成特定階段（`scripts`/`audio`/`images`/`animations`）。 / Start the AI generation pipeline; optionally limit it to specific stages (`scripts`/`audio`/`images`/`animations`). |
| `get_generation_status` | 查詢生成任務目前狀態與各階段進度，生成是非同步的，請用這個工具輪詢。 / Poll the generation job's current status and per-stage progress — generation runs asynchronously. |
| `get_page_script` | 讀取某一頁目前的逐字稿內容。 / Read a page's current script (narration text). |
| `set_page_script` | 覆寫某一頁的逐字稿（最長 4096 字元），通常搭配只重新生成語音（`start_generation` 的 `stages: ["audio"]`）一起使用。 / Overwrite a page's script (max 4096 characters), typically paired with regenerating only the audio stage (`stages: ["audio"]` on `start_generation`). |

### 頁面結構 / Page structure

以下工具讓 agent 直接編輯簡報的頁面組成，不必重跑整份生成流程。 / These tools let an agent edit a deck's page structure directly, without re-running the whole generation pipeline.

| 工具 / Tool | 說明 / Description |
| --- | --- |
| `create_blank_deck` | 建立一份空白簡報（一頁空白投影片，狀態直接是 `ready`，不進 AI 生成流程）。這是「完全不開瀏覽器、從零逐頁搭建」的起點。 / Create an empty deck (one blank slide, already `ready`, never enters the pipeline) — the starting point for building a presentation page by page with no browser. |
| `add_page` | 插入一頁空白投影片，用 `after_page_number` 指定位置（`0` 表示插到最前面）。 / Insert a blank slide at `after_page_number` (`0` puts it first). |
| `delete_page` | 刪除某一頁，連同其圖片、逐字稿與語音。**不可逆**，且不能刪掉最後一頁。 / Delete a page along with its image, script, and audio. **Irreversible**, and the last remaining page cannot be deleted. |
| `move_page` | 調整頁面順序，把某一頁搬到另一個位置。 / Reorder pages by moving one page to another position. |
| `add_pages_from_outline` | 用一段大綱或一句需求，讓 AI 生成並插入數個新頁面（含圖片、逐字稿與語音）。**非同步**，需搭配下面兩個工具。 / Have the AI generate and insert several new pages (with images, scripts, and audio) from an outline or a one-line request. **Asynchronous** — pair it with the two tools below. |
| `get_add_pages_status` | 輪詢 `add_pages_from_outline` 的進度，直到 `done` 或 `failed`。 / Poll the `add_pages_from_outline` job until it reports `done` or `failed`. |
| `cancel_add_pages` | 中止進行中的新增頁面任務（已插入的頁面會保留，不會回捲）。 / Abort a running add-pages job (pages already inserted are kept, not rolled back). |
| `get_deck_outline` | 取得整份簡報的逐頁概覽：頁碼、頁面型別、狀態、已有哪些資產，以及逐字稿摘要（`include_scripts: true` 可取完整內容）。編輯前確認頁碼、編輯後驗收都用它。 / Get a per-page overview of the whole deck: page number, page type, status, which assets exist, and a script preview (`include_scripts: true` for full text). Use it to confirm page numbers before editing and to verify results after. |
| `set_deck_title` | 修改簡報標題。 / Change the deck title. |

> **頁碼會位移。** `add_page`、`delete_page`、`move_page` 都會讓其他頁面重新編號。這三個工具的回應都會明講哪一段頁碼移動到哪裡；連續操作時，請以最新一次的回應或 `get_deck_outline` 為準，不要沿用舊頁碼。
>
> **Page numbers shift.** `add_page`, `delete_page`, and `move_page` all renumber the pages around them. Each of these tools states exactly which range moved where; when chaining operations, rely on the latest response or on `get_deck_outline` rather than reusing older page numbers.

## 已知限制 / Known limitation

MCP 請求會被視為 token 所屬的那個帳號本人，因此 `upload_pdf` 建立的簡報直接屬於這個帳號，這個帳號的全部 18 個工具（讀取與寫入類）都能正常操作，跟用瀏覽器登入這個帳號的效果完全一樣。

但如果想用 MCP 管理**別人帳號擁有**的簡報，情況會依該簡報的可見度設定而不同：

* 私人（`private`）：讀取類與寫入類工具都會被擋下（403），因為這份簡報不屬於 token 所屬的帳號。
* 公開（`public`）：讀取類工具可以正常使用，但寫入類工具仍會被擋下。
* 任何人可編輯（`public_editable`）：全部 18 個工具都能正常操作。

實務上的解法：如果想用 MCP 完整讀寫某份簡報，最簡單的方式是用該簡報擁有者的帳號產生 MCP auth token；或者請擁有者在設定頁把該簡報的可見度改成「任何人可編輯」（`public_editable`）。 / The practical workaround: the simplest way to fully read/write a specific presentation via MCP is to generate the MCP auth token from that presentation's owning account; alternatively, ask the owner to change that presentation's visibility to "anyone can edit" (`public_editable`) in Settings.

MCP requests are treated as the specific account that owns the bearer token, so a presentation created via `upload_pdf` belongs to that account directly, and all 18 tools (read and write) work normally on it — exactly as if that account had logged in through a browser.

If you want to use MCP to manage a presentation **owned by a different account**, behavior depends on that presentation's visibility:

* Private: both read and write tools are rejected (403), since the presentation doesn't belong to the token's account.
* Public: read tools work, but write tools are still rejected.
* Public editable: all 18 tools work normally.

## 範例對話流程 / Example workflow

```
我：幫我上傳 /Users/me/Desktop/report.pdf 並開始生成
1. upload_pdf({ file_path: "/Users/me/Desktop/report.pdf" })
2. start_generation({ id: "<剛建立的簡報 id>" })
3. get_generation_status({ id: "..." })  ← 重複呼叫直到 status 變成 done
4. list_presentations() / get_presentation({ id: "..." })  ← 確認生成結果，這份簡報
   屬於 MCP token 所屬的帳號，全部工具都能正常操作

Me: Upload /Users/me/Desktop/report.pdf and start generation
1. upload_pdf({ file_path: "/Users/me/Desktop/report.pdf" })
2. start_generation({ id: "<the new presentation id>" })
3. get_generation_status({ id: "..." })  ← call repeatedly until status is "done"
4. list_presentations() / get_presentation({ id: "..." })  ← check the result; this
   presentation belongs to the MCP token's account, so every tool works normally on it
```

用純文字大綱從零建立一份簡報（不需要 PDF）／Create a presentation from a plain-text outline (no PDF)：

```
我：幫我用這份大綱做一份輕鬆口語、扁平插畫風的雙人對談簡報
1. upload_txt({
     outline: "Slide 1: 什麼是光合作用\n- 定義\n- 為什麼重要\n這一頁先用一句話點出光合作用是植物把光能轉成養分的過程，並帶到它對生態的重要性。\n\nSlide 2: 三個步驟\n- 吸收光\n- 分解水\n- 產生養分",
     title: "光合作用入門"
   })
2. define_prompt({
     id: "<upload_txt 回傳的 id>",
     style_prompt: "輕鬆口語、面向國中生",
     image_style_prompt: "扁平插畫、綠色系",
     script_max_chars_per_page: 400,
     host_mode: "dual"
   })   ← 這一步才會真正開始生成
3. get_generation_status({ id: "..." })  ← 重複呼叫直到 status 變成 done

Me: Turn this outline into a casual, flat-illustration, two-host presentation
1. upload_txt({ outline: "Slide 1: ...\n- ...\n\nSlide 2: ...\n- ...", title: "..." })
2. define_prompt({ id: "<id from upload_txt>", style_prompt: "...",
     image_style_prompt: "...", script_max_chars_per_page: 400, host_mode: "dual" })
   ← generation actually starts here
3. get_generation_status({ id: "..." })  ← call repeatedly until status is "done"
```

逐頁編輯既有的簡報（調整頁面組成，不重跑整份生成）／Edit an existing deck page by page (restructure without re-running the whole pipeline)：

```
我：幫我在第 3 頁後面補兩頁講實驗結果，再把結論那頁移到最後
1. get_deck_outline({ id: "..." })          ← 先確認目前的頁碼與內容
2. add_pages_from_outline({ id: "...", insert_after_page: 3,
     outline_text: "Slide 1: 實驗結果\n- 數據摘要\n\nSlide 2: 結果討論\n- 意義" })
3. get_add_pages_status({ id: "..." })      ← 重複呼叫直到 status 變成 done
4. get_deck_outline({ id: "..." })          ← 新頁插入後，後面的頁碼都往後移了，
                                               結論那頁的頁碼要重新確認
5. move_page({ id: "...", from_page_number: <剛確認的頁碼>, to_page_number: <總頁數> })

Me: Add two pages about the experiment results after page 3, then move the
    conclusion page to the end
1. get_deck_outline({ id: "..." })          ← confirm current page numbers first
2. add_pages_from_outline({ id: "...", insert_after_page: 3, outline_text: "..." })
3. get_add_pages_status({ id: "..." })      ← call repeatedly until status is "done"
4. get_deck_outline({ id: "..." })          ← the insert shifted every later page,
                                               so re-check the conclusion's number
5. move_page({ id: "...", from_page_number: <the number just confirmed>,
     to_page_number: <total pages> })
```

完全不開瀏覽器、從一份空白簡報逐頁搭建／Build a deck from scratch, page by page, with no browser at all：

```
我：幫我開一份新簡報，用大綱生成內容
1. create_blank_deck({ title: "專題報告" })   ← 一頁空白投影片，狀態直接是 ready
2. add_pages_from_outline({ id: "<剛建立的 id>", outline_text: "Slide 1: ...\n- ..." })
3. get_add_pages_status({ id: "..." })        ← 重複呼叫直到 status 變成 done
4. delete_page({ id: "...", page: 1 })        ← 移除一開始那頁空白投影片
5. get_deck_outline({ id: "..." })            ← 驗收結果

Me: Start a new deck and fill it in from an outline
1. create_blank_deck({ title: "Project report" })  ← one blank slide, already ready
2. add_pages_from_outline({ id: "<the new id>", outline_text: "Slide 1: ...\n- ..." })
3. get_add_pages_status({ id: "..." })             ← repeat until status is "done"
4. delete_page({ id: "...", page: 1 })             ← drop the initial blank slide
5. get_deck_outline({ id: "..." })                 ← verify the result
```

## 疑難排解 / Troubleshooting

* **所有工具呼叫都回傳 401 / Unauthorized**：確認後端有沒有啟用 Google 登入；如果有，檢查 `MAKESLIDE_MCP_TOKEN` 是否與設定頁目前產生的 token 一致（注意 token 輪替後舊值會立即失效）。 / **Every tool call returns 401 / Unauthorized**: check whether Google login is enabled on the backend; if it is, verify `MAKESLIDE_MCP_TOKEN` matches the token currently configured in Settings (rotating the token immediately invalidates the old value).
* **連線不到後端 / Cannot reach the backend**：確認 `MAKESLIDE_URL` 指向的後端正在執行，且 MCP client 所在的機器能存取那個網址（同機器用 `localhost`，不同機器要換成對外可連的網址）。 / **Cannot reach the backend**: make sure the backend at `MAKESLIDE_URL` is actually running and reachable from the machine running the MCP client (use `localhost` on the same machine, or a reachable address otherwise).
* **`upload_pdf` 找不到檔案 / `upload_pdf` says the file is missing**：`file_path` 必須是 MCP client（執行 `mcp-server.ts` 那個行程）所在機器上的絕對路徑，不是你聊天視窗所在的機器路徑。 / `file_path` must be an absolute path on the machine running the MCP server process, not on whatever machine you're chatting from.
* **token 外洩了怎麼辦 / What if the token leaks**：回到設定頁重新按一次「產生 MCP auth token」，舊 token 會立刻失效，不需要重啟伺服器。 / Go back to Settings and click "Generate MCP auth token" again — the old token stops working immediately, no restart required.
* **工具呼叫對某份既有簡報回傳 403，但對其他簡報正常 / A tool call returns 403 for one existing presentation but works fine on others**：這是上方「已知限制」的情況，不是設定錯誤——那份簡報屬於別的帳號，且目前的可見度不允許 token 所屬的帳號讀取或寫入；換成該簡報擁有者的 token，或請擁有者把該簡報設成 `public_editable` 即可解決。 / This is the "Known limitation" above, not a misconfiguration — that presentation belongs to a different account, and its current visibility doesn't allow the token's account to read or write it; use that presentation owner's token instead, or ask them to set it to `public_editable`.
* **用 GitHub 抓取的方式啟動失敗（`command not found`、`curl` 錯誤等）/ The GitHub-fetch config fails to start (`command not found`, `curl` errors, etc.)**：確認機器上有安裝 `curl` 與 `npx`；如果機器沒有對外網路（例如離線環境），改用「本機固定目錄」的設定方式。若下載到的檔案內容是 GitHub 的錯誤頁面而非程式碼，通常是分支名稱或路徑打錯，確認網址是 `https://raw.githubusercontent.com/wycc/makeslide/master/backend/src/mcp-server.ts`。 / Make sure `curl` and `npx` are installed on the machine; if the machine has no outbound network access (e.g. an offline environment), switch to the "fixed local directory" config instead. If the downloaded file contains a GitHub error page instead of code, the branch name or path is likely wrong — double-check the URL is `https://raw.githubusercontent.com/wycc/makeslide/master/backend/src/mcp-server.ts`.
