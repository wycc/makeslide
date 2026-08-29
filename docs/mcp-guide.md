# MCP 整合使用手冊 / MCP Integration Guide

makeslide 內建一個 MCP（Model Context Protocol）伺服器，讓 Claude Code 或其他支援 MCP 的工具可以直接呼叫 makeslide 的簡報生成流程——上傳 PDF、啟動 AI 生成、查詢進度、讀取或覆寫逐字稿，新增／刪除／重排頁面，逐頁重新生成圖片與語音，乃至於設定頁面動畫與 Jupyter notebook——完全不需要打開瀏覽器。

makeslide ships a built-in MCP (Model Context Protocol) server so Claude Code or any other MCP-compatible client can drive makeslide's presentation pipeline directly — uploading PDFs, starting AI generation, checking progress, reading/overwriting page scripts, adding/deleting/reordering pages, regenerating per-page images and audio, and setting up page animations and Jupyter notebooks — without opening a browser.

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
| `upload_slide` | 用結構化 JSON（陣列，每個元素一頁）建立新簡報，取代 `upload_txt` 的自由文字大綱——陣列索引就是最終頁碼，**不會**被 AI 重新分頁／合併／排序。每頁可附最多 2 張本機圖片路徑，AI 生成該頁圖片時會參考它們（之後可用 `get_page_figures`／`set_page_figure_selection` 查看或排除）。同樣需要再呼叫 `define_prompt` 才會開始生成。 / Create a new presentation from structured JSON (an array, one element per slide) instead of `upload_txt`'s free-text outline — the array index *is* the final page number and is never re-paginated, merged, or reordered by the AI. Each slide may attach up to 2 local image paths that the AI reads as reference images when generating that page (inspect or exclude them afterwards with `get_page_figures`/`set_page_figure_selection`). Also requires a follow-up `define_prompt` call to start generation. |
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

### 逐頁資產：圖片、逐字稿、語音 / Per-page assets: image, script, audio

| 工具 / Tool | 說明 / Description |
| --- | --- |
| `get_page_prompt` / `set_page_prompt` | 讀寫某一頁的**圖片提示詞**（畫面的文字描述，最長 2000 字）。改了提示詞**不會**自動重畫，要接著呼叫 `regenerate_page_image`。 / Read/write a page's **image prompt** (the description the image is generated from, max 2000 chars). Changing it does **not** redraw anything — follow up with `regenerate_page_image`. |
| `get_page_text` | 讀取某一頁投影片的版面文字。 / Read a page's slide text. |
| `regenerate_page_image` | 用一段提示詞請 AI 重畫某一頁。**同步且很慢**（數十秒～數分鐘）。預設直接套用；`apply: false` 則只產生候選圖並回傳 `candidate_id`。 / Have the AI redraw a page from a prompt. **Synchronous and slow** (tens of seconds to minutes). Applies the result by default; `apply: false` only produces a candidate and returns its `candidate_id`. |
| `apply_image_candidate` | 把候選圖正式套用成該頁的投影片圖片。 / Promote a candidate image to be the page's real slide image. |
| `replace_page_image` | 用本機圖片檔直接取代某一頁的畫面（不經過 AI），會被轉成 1920×1080 JPEG。 / Replace a page's image with a local file (no AI); it is normalised to a 1920×1080 JPEG. |
| `save_page_image` | 把某一頁目前的畫面（或指定的候選圖）存到本機，讓 agent 能實際看到這一頁長什麼樣。 / Save a page's current image (or a given candidate) to a local file so the agent can actually look at it. |
| `get_page_figures` | 列出某一頁的圖表／插圖素材，包括來源 PDF 自動抽取及手動上傳的圖片。 / List a page's figure assets, including figures extracted from the source PDF and manually uploaded images. |
| `upload_page_figure` | 把本機圖片上傳並註冊成指定頁面的 page figure，可附圖說與背景資訊；圖片會正規化成 PNG，並成為 `regenerate_page_image` 的候選參考圖。 / Upload a local image and register it as a page figure, optionally with caption and context; it is normalized to PNG and becomes a candidate reference for `regenerate_page_image`. |
| `set_page_figure_selection` | 設定某一頁要排除哪些圖表素材，使其不被拿去當 `regenerate_page_image` 的參考圖。傳入的是完整排除清單，整批覆蓋。 / Set which figures a page excludes from being used as `regenerate_page_image` reference images. Takes the complete exclusion list and overwrites it wholesale. |
| `save_page_figure_image` | 把某張圖表素材存到本機，讓 agent 能實際看到內容。 / Save one figure asset to a local file so the agent can actually look at it. |
| `rewrite_page_script` | 請 AI 依指示改寫某一頁的逐字稿。**只回傳結果、不存檔**，要採用需再呼叫 `set_page_script`。 / Have the AI rewrite a page's script. **Returns the result without saving** — call `set_page_script` to accept it. |
| `regenerate_page_audio` | 重新合成某一頁的語音，並**一併把逐字稿寫入該頁**。省略 `script` 時沿用現稿。 / Re-synthesise a page's audio, **also writing the script to the page**. Omit `script` to reuse the current one. |
| `set_tts_settings` | 設定整份簡報的聲線與語速（0.25～4）。**不會自動重配音**。 / Set the deck's TTS voice and speed (0.25–4). **Does not re-synthesise existing audio.** |

> **看不到畫面就先存下來看。** agent 無法直接看到投影片長什麼樣，所以要基於現況調整時，先用 `save_page_image` 把圖存到本機看過再下提示詞，結果會準得多。
>
> **生成類工具是同步的。** `regenerate_page_image`、`rewrite_page_script`、`regenerate_page_audio` 都會一路等到模型回應（逾時上限 5 分鐘），其餘工具的逾時是 30 秒。逾時訊息會提醒先用讀取類工具確認結果是否其實已經完成——後端往往仍在跑，直接重試會白花一次模型費用。
>
> **Look at the slide before changing it.** An agent cannot see the slide, so save it locally with `save_page_image` first and write the prompt from what is actually there.
>
> **The generation tools are synchronous.** `regenerate_page_image`, `rewrite_page_script`, and `regenerate_page_audio` all block until the model responds (5-minute timeout); everything else times out after 30 seconds. The timeout message tells you to check with a read tool first — the backend is often still working, and retrying immediately just pays for the model call twice.

### Jupyter notebook 頁面 / Jupyter notebook pages

一頁投影片可以變成一份可執行的 Jupyter notebook，也可以再變回投影片。 / A slide can become an executable Jupyter notebook, and can be turned back into a slide again.

| 工具 / Tool | 說明 / Description |
| --- | --- |
| `get_page_notebook` | 讀取某一頁的 notebook（nbformat JSON）。**注意**：還不是 notebook 頁時也會回傳一份預設的空 notebook，所以請看回應開頭那句話或 `get_deck_outline` 判斷頁面型別。 / Read a page's notebook (nbformat JSON). **Note**: a page that is not a notebook still returns a default empty one, so check the response's first line or `get_deck_outline` for the page's actual type. |
| `set_page_notebook` | 寫入完整的 nbformat JSON，並把這一頁轉成 notebook 頁。 / Write a complete nbformat document, converting the page into a notebook page. |
| `edit_notebook_cells` | 單一 cell 的 `append`／`insert`／`replace`／`delete`，不必重送整份文件（工具會自己讀出→修改→寫回）。 / Append, insert, replace, or delete a single cell without resending the whole document (the tool reads, modifies, and writes back for you). |
| `generate_page_notebook` | 請 AI 依主題生成一份可執行的 notebook（會整份覆蓋該頁原有內容）。 / Have the AI generate an executable notebook from a topic (replaces the page's existing notebook entirely). |
| `convert_page_to_slide` | 把 notebook 頁轉回一般投影片。 / Convert a notebook page back into a regular slide. |

> **notebook 頁不播語音。** 轉成 notebook 後，這一頁會被排除在簡報的語音總長之外；語音檔不會被刪除，轉回投影片時就會恢復計入。
>
> **轉換是可逆的。** `convert_page_to_slide` 不會刪掉 `.ipynb`，所以之後再呼叫 `set_page_notebook` 或 `edit_notebook_cells`，看到的仍是原本的內容。這一頁若在變成 notebook 之前設過動畫，轉回來時也會恢復成有動畫的投影片。
>
> **Notebook pages play no audio.** Converting a page to a notebook removes it from the deck's audio total; its audio file is not deleted, and converting back restores it.
>
> **The conversion goes both ways.** `convert_page_to_slide` keeps the `.ipynb` on disk, so a later `set_page_notebook` or `edit_notebook_cells` finds the original content still there. A page that had an animation before becoming a notebook gets it back on the way out.

### 頁面動畫 / Page animations

| 工具 / Tool | 說明 / Description |
| --- | --- |
| `describe_animation_spec` | 查 spec 格式。**動手改動畫之前先查這個。** 不帶參數回傳整體格式（骨架、必填欄位、緩動曲線、`startTrigger`、效果型別清單）；帶 `effect_type` 回傳該型別的所有可用欄位。 / Look up the spec format. **Call this before touching an animation.** With no argument it returns the overall shape (skeleton, required fields, eases, `startTrigger`, the list of effect types); with `effect_type` it returns that type's full field list. |
| `get_page_animation` | 讀取某一頁目前的動畫 spec 與頁面型別。 / Read a page's current animation spec and render type. |
| `set_page_animation` | 寫入完整的 spec（整份取代）。 / Write a complete spec (replaces everything). |
| `add_animation_effect` | 加入一個效果並保留原有的；`id` 自動產生，並**自動把這一頁的動畫設為啟用**。 / Append one effect while keeping the rest; the `id` is generated and the page's animation is **enabled automatically**. |
| `generate_animation_script` | 請 AI 產生 `custom-script` 效果所需的 JavaScript。**只回傳程式碼、不會套用**——要自行用 `add_animation_effect` 加一個 `custom-script` 效果並把 code 放進去。 / Have the AI generate the JavaScript for a `custom-script` effect. **Returns the code without applying it** — add a `custom-script` effect with `add_animation_effect` and put the code in it. |

> **欄位刻意不寫在工具說明裡。** 動畫有 18 種效果型別、數十個選填欄位，全部展開會讓工具說明長到每次對話都要付一大筆 context。所以 `set_page_animation` 的 schema 只描述骨架，細節一律由 `describe_animation_spec` 按效果型別查詢。
>
> **`enabled` 為 false 時什麼都不會播。** spec 仍然存著，但畫面上完全看不出差別。`add_animation_effect` 會自動啟用；`set_page_animation` 若送出 `enabled: false`，回應會明講這一頁維持靜態。
>
> **The fields are deliberately not in the tool description.** With 18 effect types and dozens of optional fields, inlining them would make this one tool's description cost more context than all the others combined. `set_page_animation`'s schema describes only the skeleton; `describe_animation_spec` serves the details per effect type.
>
> **Nothing plays while `enabled` is false.** The spec is still stored, but the page looks exactly as it did. `add_animation_effect` enables it for you; `set_page_animation` says so explicitly when a submitted spec leaves the page static.

## 已知限制 / Known limitation

MCP 請求會被視為 token 所屬的那個帳號本人，因此 `upload_pdf` 建立的簡報直接屬於這個帳號，這個帳號的全部 42 個工具（讀取與寫入類）都能正常操作，跟用瀏覽器登入這個帳號的效果完全一樣。

但如果想用 MCP 管理**別人帳號擁有**的簡報，情況會依該簡報的可見度設定而不同：

* 私人（`private`）：讀取類與寫入類工具都會被擋下（403），因為這份簡報不屬於 token 所屬的帳號。
* 公開（`public`）：讀取類工具可以正常使用，但寫入類工具仍會被擋下。
* 任何人可編輯（`public_editable`）：全部 42 個工具都能正常操作。

實務上的解法：如果想用 MCP 完整讀寫某份簡報，最簡單的方式是用該簡報擁有者的帳號產生 MCP auth token；或者請擁有者在設定頁把該簡報的可見度改成「任何人可編輯」（`public_editable`）。 / The practical workaround: the simplest way to fully read/write a specific presentation via MCP is to generate the MCP auth token from that presentation's owning account; alternatively, ask the owner to change that presentation's visibility to "anyone can edit" (`public_editable`) in Settings.

MCP requests are treated as the specific account that owns the bearer token, so a presentation created via `upload_pdf` belongs to that account directly, and all 42 tools (read and write) work normally on it — exactly as if that account had logged in through a browser.

If you want to use MCP to manage a presentation **owned by a different account**, behavior depends on that presentation's visibility:

* Private: both read and write tools are rejected (403), since the presentation doesn't belong to the token's account.
* Public: read tools work, but write tools are still rejected.
* Public editable: all 42 tools work normally.

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
