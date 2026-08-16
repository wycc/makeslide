# 本頁問答的「改圖」與「改逐字稿」工具

- 文件版本：V1.0
- 狀態：Draft → 依本文件實作中
- 分支：`feat/tutor-edit-tools`
- 前置文件：[`mcp-tools-in-ai-design.md`](mcp-tools-in-ai-design.md)（AI 工具登錄表）
- 日期：2026-08-17

---

## 1. 要解決的事

使用者在本頁問答裡看出一頁哪裡不對——圖畫錯了、逐字稿講得不清楚——現在得自己關掉問答、找到對應的按鈕、把剛剛講過的話再打一次。

讓 AI 導師直接動手。但**它不直接改**：它提出一個**待確認的提案**，使用者檢視之後才決定要不要採用。圖片沿用現在「修改圖片」按鈕的流程（產生候選圖 → 預覽 → 套用），逐字稿則產生一份 **patch**，用 diff 檢視器看過再決定。

---

## 2. 核心決策：工具產生「提案」，不產生「變更」

既有的 AI 工具全部是唯讀的（[`aiTools.ts`](../backend/src/services/aiTools.ts) 的檔頭：「Every handler is strictly read-only… must never cause side effects」）。這兩個新工具看起來破壞了那條規則，實際上沒有：

**它們不動任何使用者看得到的東西。** 改圖工具產生的是一張**候選圖**（`pages/NNN.candidate.<id>.jpg`），與「修改圖片」按鈕產生的完全是同一種東西；改逐字稿工具產生的只是一段**回傳的文字**，連檔案都不寫。頁面的 JPG 與 `.script.txt` 在使用者按下「套用」之前一個位元都不會變。

這條界線是刻意的，理由不是潔癖：

- 模型會誤解、會過度熱心。「這一頁的圖好像少了箭頭」是一句觀察，不是一道指令，而讓模型自行判斷哪一句是指令，錯的那次代價是使用者的內容被改掉。
- 套用的路徑**已經存在且被信任**（`replace-image` 與逐字稿儲存），提案只是餵給它們的輸入。不需要為 AI 另開一條寫入路徑。

因此工具登錄表分成兩組：`getReadonlyAiTools()` 照舊，新增 `getProposalAiTools()`，只有本頁問答會拿到後者。

---

## 3. 兩個工具

### 3.1 `propose_page_image_edit`

參數：`{ page?: number, instruction: string }`（`page` 省略時是使用者當前所在頁）。

做的事與「修改圖片」按鈕的 `/regenerate-image` 完全相同：以該頁現有的圖為來源，依 `instruction` 產生一張候選圖，回傳 `candidate_id`。

**成本要擋在前面**。這個工具每呼叫一次就是一次圖片生成——真的花錢，而且是**模型自己決定要花的**。因此：

- **一次問答最多一張**。第二次呼叫直接回一段說明，不再生成。
- 工具的 `description` 明講它會產生費用、只在使用者明確要求修改圖片時使用，不要為了「順便改進一下」而呼叫。

### 3.2 `propose_script_edit`

參數：`{ page?: number, instruction: string }`。

讀該頁現在的逐字稿，依 `instruction` 改寫，回傳**改寫後的全文**。沿用 `/rewrite-script` 的提示詞與長度規則，所以它產出的東西與使用者自己按「重寫逐字稿」得到的是同一種。

不寫檔案，也不做 diff——diff 是前端的事（§5）。

---

## 4. 提案怎麼到前端

工具的結果目前只進 `workingMessages` 給模型看；前端只收得到 `tool` 事件（`{ name, args }`，在執行**之前**送出）。所以要多一條通道。

- `AiToolResult` 新增 `proposal?: AiToolProposal`——給 UI 的結構化資料，與給模型看的 `text` 分開。
- `streamChatText` 新增 `onToolResult`，在工具執行後、帶著 proposal 時觸發。
- `/ask` 的 SSE 新增 `event: proposal`。

```ts
type AiToolProposal =
  | { kind: 'image'; page: number; candidateId: string; imageUrl: string; instruction: string }
  | { kind: 'script'; page: number; original: string; proposed: string; instruction: string };
```

逐字稿的 `original` 一併送出，因為 diff 要對照的是**產生提案當下**的內容；使用者可能在等待期間自己改過，那時 diff 若對照現況會顯示成別的東西。

---

## 5. 前端

提案掛在該則回答的訊息上（與 `toolNotes` 同一個位置），顯示成一張卡片：

- **圖片提案**：縮圖 ＋「檢視並套用」→ 開啟**既有的**圖片預覽對話框（`handleApplyPreviewImage` 那一條），套用走既有的 `replace-image`／React 頁的背景端點。不新增套用路徑。
- **逐字稿提案**：「檢視變更」→ **patch viewer**：逐行 diff（新增綠、刪除紅），底下「採用」與「取消」。採用即寫入逐字稿（與編輯器的儲存同一條路徑）。

Patch viewer 是這一版唯一的新 UI。逐行 diff 用最小的 LCS 實作，不引入 diff 套件：逐字稿是短文（數百字），而多一個相依只為了畫兩個顏色不划算。

---

## 6. 安全性與界線

| 項目 | 對策 |
| --- | --- |
| 模型改到別份簡報 | 工具只接受頁碼，`pdfId` 來自 `AiToolContext`（與唯讀工具相同）；跨帳號由既有的 `accountId` scope 擋 |
| 模型自行花錢 | 每次問答最多一張候選圖；工具描述明講成本 |
| 提案被誤當成已套用 | 提案卡片明講「尚未套用」，且頁面內容在按下套用前不變 |
| 唯讀觀看者 | 兩個工具只在使用者有編輯權時提供；沒有編輯權時工具集不含它們，模型看不到也就不會提 |
| 逐字稿被悄悄換掉 | 一律經 patch viewer；沒有「直接採用」的捷徑 |

---

## 7. 測試計畫

後端：

- 工具集：沒有編輯權時不含這兩個工具；有編輯權時含。
- `propose_script_edit`：回傳 proposal，且**不寫檔案**（斷言磁碟上的逐字稿沒變）。
- `propose_page_image_edit`：第二次呼叫不再生成（回說明字串），且第一次的 proposal 帶得到 `candidate_id`。
- `/ask` 的 SSE：帶 proposal 的工具會送出 `event: proposal`。

前端：

- diff：新增／刪除／未變三種行都標對，且空字串與整段替換不會漏行。
- 提案卡片在收到 `proposal` 事件後出現；套用前不呼叫任何寫入 API。
