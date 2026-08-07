# 規劃：讓 coding agent 完全以 MCP 建立與編輯簡報

狀態：規劃（2026-08-08）
目標分支：`feat/mcp-page-crud` → `feat/mcp-page-assets` → `feat/mcp-notebook` → `feat/mcp-animation`

## 1. 目標

讓 coding agent **完全不開 webui**，從零建立一份簡報並持續編輯：新增／刪除／搬移頁面、設定大綱、重新生成單頁的圖片／逐字稿／語音、把頁面轉成 Jupyter notebook 並更新其內容、設定頁面動畫。

## 2. 現況盤點：後端幾乎不缺東西

這是規劃最重要的結論——**上述能力後端全部已經存在，只是 `mcp-server.ts` 沒有暴露**。目前 MCP 只有 9 個工具（列出／查詢／上傳 PDF／上傳大綱／設定 prompt／啟動生成／查進度／讀寫逐字稿），停在「建立 + 整份重生」的粒度，沒有任何逐頁編輯能力。

權限面同樣不缺：MCP 的 bearer token 會在 [`server.ts`](../backend/src/server.ts) 的第一個 `onRequest` hook 被比對成帳號，並合成等效的 session cookie 接到請求上，因此所有既有的 `canReadPdf()`／`canEditPdf()`／`canDestructivelyEditPdf()` 檢查對 MCP 請求自動生效。**本規劃不新增任何繞過權限的路徑。**

| 需求 | 既有端點 | 缺口 |
|---|---|---|
| 建立空白簡報 | `POST /api/pdfs/blank` | — |
| 新增／刪除／搬移頁面 | `POST /api/pdfs/:id/pages`、`DELETE /api/pdfs/:id/pages/:n`、`POST /api/pdfs/:id/pages/move` | — |
| 以大綱補頁 | `POST /api/pdfs/:id/add-pages-from-prompt`（202 非同步）＋ `/status`、`/cancel` | — |
| 逐頁圖片提示詞 | `GET`／`PATCH /api/pdfs/:id/pages/:n/prompt` | — |
| 重生圖片 | `POST /api/pdfs/:id/pages/:n/regenerate-image`（同步）、`replace-image`（multipart）、`inpaint-image` | — |
| 重寫逐字稿 | `PUT /api/pdfs/:id/pages/:n/script`、`POST /api/pdfs/:id/pages/:n/rewrite-script` | — |
| 重生語音 | `POST /api/pdfs/:id/pages/:n/regenerate-audio`、`PATCH /api/pdfs/:id/tts-settings` | — |
| Notebook | `GET`／`PUT /api/pdfs/:id/pages/:n/notebook`、`POST .../notebook/generate` | **缺反向：無法轉回投影片** |
| 動畫 | `GET`／`PUT /api/pdfs/:id/pages/:n/animation`、`GET .../animation/spec`、`POST .../animation/custom-script`（SSE） | — |

**唯一確定的後端缺口**：`render_type` 只有單向。[`notebook.ts:71`](../backend/src/routes/pdfs/notebook.ts#L71) 的 `writeNotebookForPage()` 硬寫 `render_type = 'notebook'`，而全 repo 沒有任何路徑把它設回 `'static-image'`（`grep "SET render_type"` 只命中 animation／notebook／import／worker 四處，animation 走 `renderTypeForSpec()` 可回到 `static-image`，notebook 不行）。一頁一旦轉成 notebook 就回不去了。Phase 3 補一個端點。

## 3. 已裁示的設計決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 工具粒度 | **一動作一工具**（9 → 約 28 個） | 語意單純、描述精準，agent 不易誤用；代價是工具清單變長 |
| 檔案結構 | **維持單檔零依賴** | 不動 2026-07-25 確立的 `curl` 抓單檔部署方式；`mcp-server.ts` 會從 510 行漲到約 2000 行，以區塊註解分領域 |
| 交付方式 | **分 4 期、4 個分支** | 每期可獨立驗證與 merge |

## 4. 工具規劃（約 28 個）

命名一律 `動詞_名詞`，與既有 9 個工具的風格一致（`get_page_script`／`set_page_script`）。

### Phase 1 — 頁面 CRUD 與從零建簡報（`feat/mcp-page-crud`）

| 工具 | 端點 | 備註 |
|---|---|---|
| `create_blank_deck` | `POST /api/pdfs/blank` | 一頁空白、狀態直接 `ready`，不進 pipeline。這是「從零開始」最短的起點 |
| `add_page` | `POST /api/pdfs/:id/pages` | body 只有 `after_page_number`（0 = 插在最前面）。**要求 `status === 'ready'`**，否則 409 |
| `delete_page` | `DELETE /api/pdfs/:id/pages/:n` | 不可逆，且最後一頁不能刪（409）。需 `canDestructivelyEditPdf` |
| `move_page` | `POST /api/pdfs/:id/pages/move` | `from_page_number` / `to_page_number` |
| `add_pages_from_outline` | `POST /api/pdfs/:id/add-pages-from-prompt` | **202 非同步**。`prompt`（≥5 字）或 `outline_text` 擇一，選填 `insert_after_page`。同一份簡報同時只能有一個 job |
| `get_add_pages_status` | `GET .../add-pages-from-prompt/status` | 輪詢用 |
| `cancel_add_pages` | `POST .../add-pages-from-prompt/cancel` | |
| `get_deck_outline` | 組合 `GET /api/pdfs/:id` + 逐頁 script | **純 MCP 端組合，不需新端點**。注意 `GET /api/pdfs/:id/outline` 是 YouTube 匯入的產物，不是這個用途 |
| `set_deck_title` | `PATCH /api/pdfs/:id/title` | |

**這一期要處理的核心風險：頁碼位移。** `add_page`／`delete_page`／`move_page` 都會重排後續頁碼，agent 若拿舊頁碼繼續操作就會改到錯的頁。因應：每個工具的回應**明確回報異動後的 `page_count` 與受影響的頁碼範圍**，並在工具描述寫明「此操作後其他頁的頁碼可能改變，請重新讀取」。

### Phase 2 — 逐頁資產重生（`feat/mcp-page-assets`）

| 工具 | 端點 | 備註 |
|---|---|---|
| `get_page_prompt` | `GET /api/pdfs/:id/pages/:n/prompt` | 這頁的圖片提示詞（存在 `text_path`） |
| `set_page_prompt` | `PATCH /api/pdfs/:id/pages/:n/prompt` | 空白頁 `text_path` 未就緒時會 409 |
| `get_page_text` | `GET /api/pdfs/:id/pages/:n/text` | 投影片文字 |
| `regenerate_page_image` | `POST /api/pdfs/:id/pages/:n/regenerate-image` | **同步**，`prompt` 必填（≤2000 字），選填 `history`。可能耗時數十秒 |
| `replace_page_image` | `POST /api/pdfs/:id/pages/:n/replace-image` | **multipart**，沿用既有的 `apiUploadPdf` 上傳寫法，改送圖片檔 |
| `save_page_image` | `GET /api/pdfs/:id/pages/:n/image` | 存到 agent 指定的本機路徑，讓 agent 能實際看到目前這頁長什麼樣 |
| `rewrite_page_script` | `POST /api/pdfs/:id/pages/:n/rewrite-script` | AI 改寫，**回傳建議稿但不落地**；agent 滿意後再呼叫既有的 `set_page_script` |
| `regenerate_page_audio` | `POST /api/pdfs/:id/pages/:n/regenerate-audio` | body 帶 `script`（≤4096 字），會一併寫回 script 檔再合成 |
| `set_tts_settings` | `PATCH /api/pdfs/:id/tts-settings` | `tts_voice`、`tts_speed`（0.25–4） |

**這一期要處理的核心風險：同步長工作。** `regenerate-image` 與 `regenerate-audio` 是同步 HTTP，可能跑數十秒；目前 `mcp-server.ts` 的 `fetch` 完全沒有 timeout 設定。因應：helper 統一加 `AbortSignal.timeout()`（讀取類 30s、生成類 180s），逾時回明確訊息而不是讓 MCP client 卡住。

### Phase 3 — Jupyter Notebook（`feat/mcp-notebook`）

| 工具 | 端點 | 備註 |
|---|---|---|
| `get_page_notebook` | `GET /api/pdfs/:id/pages/:n/notebook` | 未建立時回預設空 notebook |
| `set_page_notebook` | `PUT /api/pdfs/:id/pages/:n/notebook` | 送整份 nbformat JSON；**會把這頁轉成 notebook 頁**並重算全片音訊總長（notebook 頁不播語音） |
| `generate_page_notebook` | `POST /api/pdfs/:id/pages/:n/notebook/generate` | `topic`（≤500 字）＋選填 `context`（≤4000 字），AI 產生可執行 notebook |
| `edit_notebook_cells` | 讀 → 改 → 寫（MCP 端組合） | 便利工具：`append` / `replace_at` / `delete_at` 單一 cell，免得 agent 每次都要重送整份 ipynb |
| `convert_page_to_slide` | **新端點** `POST /api/pdfs/:id/pages/:n/convert-to-slide` | 補上缺的反向轉換：`render_type` 設回 `static-image`、清 `notebook_path`、重算音訊總長、同步 `metadata.json` |

新端點的實作可直接鏡射 `writeNotebookForPage()` 的結構（DB 為真實來源、`metadata.json` best-effort 重同步、重算 `total_audio_duration_seconds`），權限要求與 `PUT notebook` 一致（`canEditPdf`）。`.ipynb` 檔案**保留不刪**，讓轉換可逆。

### Phase 4 — 動畫（`feat/mcp-animation`）

| 工具 | 端點 | 備註 |
|---|---|---|
| `get_page_animation` | `GET /api/pdfs/:id/pages/:n/animation` | 回目前 spec 與 `render_type` |
| `set_page_animation` | `PUT /api/pdfs/:id/pages/:n/animation` | 送完整 spec；後端 `validateAnimationSpec()` 會回明確錯誤訊息，直接轉給 agent |
| `add_animation_effect` | 讀 → 附加 → 寫（MCP 端組合） | 便利工具，免得 agent 為了加一個效果重組整份 spec |
| `describe_animation_spec` | **純本地，不打 API** | 輸出 spec 的欄位說明 |
| `generate_animation_script` | `POST .../animation/custom-script` | **SSE 串流**，MCP 端需消費 `text/event-stream` 累積成完整結果 |

**這一期要處理的核心問題：spec schema 太大塞不進工具描述。** [`pageAnimation.ts`](../backend/src/services/pageAnimation.ts) 定義了 18 種效果型別與數十個選填欄位（`pointerColor`、`highlightBorderStyle`、`textCalloutFontSize`……），全部寫進 `set_page_animation` 的 `inputSchema` 會讓工具描述爆炸。因應：`inputSchema` 只描述**骨架**（`version`/`enabled`/`effects[]`，effect 只列 `id`/`target`/`type`/`start`/`duration`/`ease`/`startTrigger`），其餘欄位交給 `describe_animation_spec` 按效果型別**按需查詢**。這也讓 spec 演進時只要改一個地方。

需要傳達給 agent 的關鍵語意（寫在 `describe_animation_spec` 輸出裡）：

- 效果上限 20 個（`MAX_SLIDE_ANIMATION_EFFECTS`）
- `startTrigger` 可把起始時間錨在逐字稿句子上：`{ type: 'transcript-line', line, offsetSeconds?, anchor?: 'start'|'end' }`，省略 `anchor` 等同 `'start'`
- `pause-playback` 與 `realtime-poll` 會暫停播放，屬互動效果不是視覺效果
- `custom-script` 效果承載 GSAP 程式碼，由 `generate_animation_script` 產生

## 5. 跨期共通工作

1. **錯誤轉譯**：後端統一回 `{ error: { code, message } }`，但目前 MCP 把 HTTP 錯誤原封當字串丟出（`GET /path → 409 {"error":...}`）。改為解析出 `code` 並附上可行動的說明，例如 `INVALID_STATE` → 「只有 `ready` 狀態的簡報可以增刪頁面，請先用 `get_generation_status` 確認生成已完成」。
2. **`docs/mcp-guide.md` 同步**：每期結束更新工具表與工具數。
3. **端到端範例流程**寫進 guide：

   ```
   create_blank_deck(title)
     → add_pages_from_outline(id, outline_text)  →  輪詢 get_add_pages_status
     → 逐頁：set_page_prompt → regenerate_page_image
             set_page_script  → regenerate_page_audio
     → 需要的頁：generate_page_notebook 或 set_page_animation
     → get_deck_outline 驗收
   ```

4. **驗證方式**：每期 `tsc` 全綠、後端測試、以及 stdio `tools/list` 冒煙測試確認新工具都有註冊（沿用 `feat/mcp-upload-txt-define-prompt` 那次的做法）。破壞性工具（`delete_page`、`convert_page_to_slide`）另補實際往返測試。

## 6. 明確不做的事

- **不**為 MCP 開任何繞過 `canEditPdf` 的路徑；agent 能做的事恰好等於該帳號在瀏覽器能做的事。
- **不**拆分 `mcp-server.ts`（會破壞 `curl` 單檔部署）。
- **不**支援 quiz／poll／同步上課等課堂互動的建立——那是另一組獨立的 API，不在「從零生成簡報」的範圍內，若要做應另行規劃。
- **不**改動既有 9 個工具的介面，避免既有 agent 腳本失效。
