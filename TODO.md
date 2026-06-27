# MakeSlide TODO

> 本檔於 2026-06-27 由舊的大型 TODO.md 拆分重建。先前累積的所有掃描摘要、已完成項目（`[x]`）與歷史工作記錄已封存於 [`TODO_260627.md`](TODO_260627.md)（更早期的記錄另見 `TODO_old.md`、`TODO_260521.md`）。本檔僅保留尚未完成的項目與後續工作記錄，以維持可讀性。

## 計數狀態

- 自 2026-06-27「計數重設」起算，截至封存時（舊檔第一二八輪）已完成 **8/100** 個項目，未達上限。後續 loop 接續此計數。

## 未完成項目（待使用者決定）

以下兩項屬範圍大或涉 CI 行為變更，**不宜於自動 loop 中逕行**，需使用者裁示後再進行：

- [ ] 系統性採用 `mapApiErrorToHumanMessage`：目前約 55 處 catch 區塊直接 `setError(err.message)` 顯示後端原始 message、繞過既有的錯誤訊息映射（前端僅 2 處 `UploadButton`、`ImportTextPage` 使用 mapper）。全面改造屬較大工程，且各 catch 上下文不同、許多後端 message 已是中文（未必都是英文洩漏），逐點需產品判斷顯示風格，故列為待使用者決定。
- [ ] 把前端測試納入 root `npm test`：目前 root 測試腳本未涵蓋前端 `node:test` 測試。納入涉及 CI 行為變更與 `npm install`（sandbox 無法驗證），列為待使用者決定。

## addPagesFromPrompt 補 defer FK（第一六三輪，2026-06-27）

延續稽核：`addPagesFromPrompt`（AI 批次加頁）在中間插頁時也位移頁碼並呼叫 `shiftChildPageNumbers`，但**缺 `defer_foreign_keys = ON`**——與 page-operations 修前同樣的 FK-timing bug：先 `UPDATE pages` 即讓 polls 變孤兒 → 在後續頁有投票時 FK 500。

- [x] `addPagesFromPrompt` 中間插頁缺 defer FK → 後續頁有投票時 FK 失敗：在其 page-shift 交易開頭加 `db.pragma('defer_foreign_keys = ON')`（`shiftChildPageNumbers` 已涵蓋 polls/comments/drawings）。
  - 修改說明（2026-06-27）：於 `addPagesFromPrompt.ts` 的「中間插頁」交易加 defer pragma。worker 難以端到端單元測，以重現腳本驗證（在第 3 頁有 poll/comment、insertAfter=1/insertCount=2 → 交易成功、poll/comment 正確移到第 5 頁、無 FK error）；既有 `add-pages-permission`/`add-pages-orphan-recovery` 17 測試回歸通過。backend `tsc --noEmit` 通過。分支 `fix/addpages-defer-fk`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 42 個完成項目（42/100，未達上限）。

## 擴展頁面重排的子表對齊（第一六二輪，2026-06-27）

延續 round-161：盤點所有以 `page_number` 關聯 pages 的子表，發現除 polls 外，**comments 與 drawings 在增刪移頁時也會錯位**（無 FK 故不崩、但附到錯頁；drawings 刪頁時甚至不會被清掉而殘留）。embeddings 以 `page_uid` 為鍵不受影響；watch_progress/timings/events 屬歷史分析、刻意不重排。

- [x] 頁面增/刪/移時 comments 與 drawings 未隨頁碼對齊（錯位 / 殘留）：`shiftChildPageNumbers` 僅位移 page_polls；comments/drawings 的 FK 只到 pdfs（非 pages），故不會 cascade，重排後錯附到別頁、刪頁時殘留。
  - 修改說明（2026-06-27）：`shiftChildPageNumbers` 擴為位移三個「每頁使用者內容」子表（`page_polls`/`page_comments`/`page_drawings`，以常數 `PAGE_CONTENT_CHILD_TABLES` 表列、附註說明為何排除分析表與 uid 化的 embeddings）；move handler 的 per-page 迴圈一併移動三表；delete handler 顯式刪除被刪頁的 comments/drawings（polls 由 FK cascade）。新增測試涵蓋刪/插/移頁後三表對齊、以及刪頁移除該頁 comments/drawings 不殘留。backend `tsc --noEmit` 通過；相關 86 測試回歸；**完整後端套件 1203/1203 全綠**。分支 `fix/realign-page-content-children`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 41 個完成項目（41/100，未達上限）。

## 修正頁面增刪移的 FK/投票對齊真 bug（第一六一輪，2026-06-27）

延續 round-157 的 page renumber 稽核，發現並修復一個真實 production bug：

- [x] 頁面增/刪/移時 page_polls 未跟著重編號 → `foreign_keys=ON` 下 FK 失敗（500）且投票錯位：`page_polls` 以 FK `(pdf_id, page_number) REFERENCES pages` 關聯，但 delete handler **完全沒有**位移子表；insert/move 雖呼叫 `shiftChildPageNumbers`，卻在「先 `UPDATE pages +100000`、後 shift 子表」的順序下、於子表 shift 前就讓投票變孤兒 → FK 立即失敗。實測：在第 3 頁有投票時刪第 2 頁 → `FOREIGN KEY constraint failed`（刪頁 500）；insert/move 同類。
  - 修改說明（2026-06-27）：三個 renumber 交易（insert/move/delete）開頭加 `db.pragma('defer_foreign_keys = ON')`（FK 延到 commit 檢查、交易內可安全分步重排父子表，SQLite 於 commit 後自動關閉此 pragma）；delete handler 補上 `shiftChildPageNumbers` 兩步 lockstep 位移（與 pages 的 +100000/-100001 offset 同步），使後續頁的投票正確跟隨（刪第 2 頁後，原第 3 頁→第 2 頁、其投票也→第 2 頁）。新增 `page-poll-realign.test.ts`（2 測試：刪頁/插頁後投票對齊且無 FK error）。backend `tsc --noEmit` 通過；`pages-api`/`page-operations-permission` 50/50 回歸；**完整後端套件 1201/1201 全綠**。分支 `fix/page-renumber-fk-defer-and-poll-shift`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 40 個完成項目（40/100，未達上限）。

## 規畫輪：補充可執行項目（第一六〇輪，2026-06-27）

前後端測試套件皆全綠；後端權限/分享/身分去重、既有失敗修復、前端 lib 測試覆蓋皆完成。乾淨且低風險的「純函式抽出／補測試」自動 backlog 已實質見底。依 LOOP.md 第 2 條，分析後依 `docs/STATUS_REPORT_2026_06_27.md` §7–§8 與 `docs/FUTURE_ROADMAP.md` 補充以下優先項目。這些多為需 UI／後端整合的功能，**單輪可完成但較難在現有測試框架自動驗證 UI**，部分建議由使用者確認方向後再投入：

- [ ] （驗證確認）round-136 品質檢查狀態修正已驗證完整：頁面終態為 `audio_ready`（`addPagesFromPrompt.ts` 的 normalization 與 pipeline 註解均證實 ready PDF 全頁為 audio_ready/failed），`script_ready` 僅為 require_script_confirmation 流程的暫態。**無需再擴充狀態集合**。（本項為分析結論，非待辦。）
- [ ] （P0，§7.2）品質檢查自動化：生成完成後自動跑一次 quality-check，於播放頁以徽章顯示「N 頁有品質問題」摘要，點擊開啟既有 `QualityCheckPanel`。延伸 `quality-check` route 與前端面板，屬前端整合。
- [ ] （§8.1.4）首頁／播放頁搜尋結果加入「加入複習清單」動作：`GlobalSearchBox` 結果列加入按鈕，複用既有 `reviewList.addReviewItems`（已有測試）。純前端 UI 整合。
- [ ] （P0，§7.1）課後報告個人層級報表：後端 `computeStudentRecords` 已彙整每位學生作答；補前端「個人」分頁顯示每位學生完成率／提問／投票參與。前端為主、後端視需要補欄位。
- [ ] （§8.1.5／§4.1）播放頁 header 入口分組為「製作／授課／自學／報告／匯出」任務流：降低功能密度造成的新手阻力（資訊架構調整，純前端、需產品確認分組）。
- [ ] （§7.5）生成前成本估算覆蓋確認：確認 PDF／文字／YouTube 三個生成入口皆於 `PromptModal` 顯示 `costEstimate` 估算；補缺口並為 pageCount 傳遞補測試。

## 前端補測試 debugLog（第一五九輪，2026-06-27）

前後端套件皆全綠；盤點前端 lib 僅 `api.ts`（HTTP/re-export）與 `debugLog.ts` 無測試。補後者：

- [x] 為 `debugLog.ts` 補單元測試（覆蓋）：`debugLog`/`debugWarn` 依 `localStorage['makeslide.debug']==='1'` 開關、含 try/catch 防呆，原無測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/debugLog.test.ts`（3 測試：旗標='1' 才經 `console.info`/`warn` 輸出且帶原引數、旗標非 '1' 不輸出、localStorage 存取拋錯時靜默不拋）。以可還原的 console 與 globalThis.localStorage 注入測試、finally 清理避免污染。未動產品碼。前端 `tsc --noEmit` 通過、3/3；完整前端 532/532 全綠。至此前端 lib 中含邏輯的模組皆有測試（僅 api.ts 屬 HTTP/re-export 未測）。分支 `test/debug-log`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 39 個完成項目（39/100，未達上限）。

## 前端去重 hasLocalStorage（第一五八輪，2026-06-27）

確認後端 1199/1199、前端 551/551 全綠（全棧綠燈基線）。掃描前端後完成一個小去重：

- [x] 抽出共用 `hasLocalStorage`（去重）：`recentSearches.ts`、`commentAuthor.ts` 各有相同的 `typeof window !== 'undefined' && !!window.localStorage` 守衛。抽成 `lib/hasLocalStorage.ts` 並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/hasLocalStorage.ts`（window-based 穩健版）+ `hasLocalStorage.test.ts`（3 測試：無 window、有 window.localStorage、有 window 無 localStorage；每次清理 globalThis.window 避免污染）。`recentSearches`/`commentAuthor` 移除本地定義改 import。**`reviewList.ts` 刻意不動**——其守衛為 `typeof localStorage !== 'undefined'`（bare localStorage），且其測試注入 bare `localStorage`（非 window），改用 window-based 版會使測試 mutator no-op（已實測 4 失敗）；為零行為變更，保留 reviewList 自身守衛。前端 `tsc --noEmit` 通過；相關 lib 測試 23/23；完整前端 551/551 全綠。分支 `refactor/shared-has-local-storage`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 38 個完成項目（38/100，未達上限）。

## 完整後端測試套件基線 + 既有失敗盤點（第一五四輪，2026-06-27）

本輪以 `scripts/run-tests.sh backend` 跑完整後端套件：**1199 測試，18 失敗**。經抽查與在去重前 commit（`e0d9db8`）比對，**18 個全為既有失敗、與近期去重無關**。逐一分類並修復其一：

- [x] 修 `input-security.test.ts`（4 失敗）：4 個 upload/youtube 驗證測試全回 **401**（未授權）——測試未呼叫 `setSystemAuthSettings({ googleAuthEnabled: false })`，請求在到達驗證邏輯前就被 auth 擋下（驗證邏輯本身正常）。確認無任何測試把 `googleAuthEnabled` 設 true（無全域順序衝突），於檔頭加上該設定。`input-security.test.ts` 4/4 通過。純測試修正。分支 `fix/input-security-test-auth`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 34 個完成項目（34/100，未達上限）。
- [x] （既有失敗）`pages-api.test.ts`（7 失敗）：測試預期連號 `pages/002.png`，實際為 uid 化 `pages/<uid>.jpg`。
  - 修改說明（2026-06-27）：確認 uid 化為現行設計（page-operations.ts 註解明言「檔案以 page_uid 為鍵、不重命名」、前端/storage 皆 uid 化），測試過時。重寫 `seedReadyPdfFor`（uid 路徑 `pages/u<i>.jpg/.text.txt/.script.txt/.m4a` + 建檔 + 設 page_uid）與 `assertDeckAligned`（改為斷言 page_number 連續 1..N），並更新 670/672/673/675 的內聯路徑斷言為 uid 契約（既有頁保留 uid 路徑、僅 page_number 連續；刪除只移除被刪頁 uid 檔）。
  - **順帶修真實潛在 bug**：重寫後 test 676 暴露 delete handler 的 `UPDATE page_number = page_number - 1` 在多次增刪後（rowid 與 page_number 分歧）會暫態違反 `UNIQUE(pdf_id, page_number)` → 500。改用與 insert 一致的 +offset 兩步 renumber（+100000 再 -100001）。此為 production 也可能觸發的真 bug（增頁後刪頁）。
  - 驗證：backend `tsc --noEmit` 通過；`pages-api` 19/19；page-operations/delete 相關 51/51 回歸通過。**完整後端套件 1199/1199 全綠（exit 0）**。分支 `fix/pages-api-uid-tests-and-delete-renumber`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 37 個完成項目（37/100，未達上限）。
- [x] （既有失敗）`skills.test.ts`（1）：`updateUserSkill` 回傳物件與磁碟 round-trip 形狀不符。
  - 修改說明（2026-06-27）：根因為 `createUserSkill`（條件 spread、省略 undefined 模板鍵）與 `updateUserSkill`（**總是**寫入 4 個模板鍵，即使值 undefined）不一致——回傳物件帶 `imageStylePrompt:undefined` 等鍵，但 JSON.stringify 丟棄 undefined，讀回後缺鍵，`deepStrictEqual(回傳, 磁碟)` 失敗。修法：`updateUserSkill` 改為先解析各欄位值、再以條件 spread 僅在 truthy 時納入（行為不變、與 create 形狀一致）。順帶修掉這個 create/update 形狀不一致。`skills.test.ts` 5/5 通過。分支 `fix/update-skill-omit-undefined-template-fields`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 35 個完成項目（35/100，未達上限）。
- [x] （既有失敗）`timing.test.ts`(1) + `regenerate-matrix.test.ts`(4)：同 input-security 的 401 根因——兩檔皆缺 `setSystemAuthSettings({ googleAuthEnabled: false })`，HTTP 請求被 auth 擋下回 401。兩檔加上該設定後，timing 12/12、regenerate-matrix 4/4 通過（連跑 3 次穩定 16/16；首次觀察到的 regenerate test 2 一次性 flake 未再現）。純測試修正。分支 `fix/timing-regen-test-auth`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 36 個完成項目（36/100，未達上限）。
- [x] （既有失敗）`figure-reference-image-generation.test.ts`(1)：隔離下穩定通過、僅在完整套件中失敗，屬測試順序污染。第一五四–一五六輪新增多個 `setSystemAuthSettings` 改變全域順序後，重跑完整套件已自然通過，無需改動。

## 後端去重 canDestructivelyEditPdf（第一五三輪，2026-06-27）

- [x] 抽出共用 `canDestructivelyEditPdf`（去重 / 可測 / 安全一致）：破壞性動作（刪簡報/頁/測驗/投票/手寫）的嚴格編輯權限（`Boolean(sub) && public_editable`，禁止匿名）在 4 檔以 `canDestructivelyEditPdf` 重複、且 `delete.ts` 以同邏輯的 local `canEditPdf` 存在（同名不同 body 易混淆）。抽成共用並補測試。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `canDestructivelyEditPdf`（含註解說明與 canEditPdf 的差異）。4 檔（page-operations/detail/quizzes/drawings）移除本地定義並併入既有 `./permissions` import。`delete.ts` 移除其 local stricter `canEditPdf`、改 `import { canDestructivelyEditPdf }` 並把呼叫點改名（消除同名不同 body 的混淆）。`permissions.test.ts` 新增測試（匿名於 public_editable 不可破壞性編輯、與 canEditPdf 對比）。backend `tsc --noEmit` 通過；`delete-permission`/`delete-pdf-job-cleanup`/`permissions`/`quizzes`/`drawings`/`page-operations-permission`/`detail-permission` 共 177 測試回歸通過（嚴格匿名行為保留）。分支 `refactor/shared-can-destructively-edit`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 33 個完成項目（33/100，未達上限）。

## 後端去重 share 存取群（第一五〇輪，2026-06-27）

- [x] 抽出共用 share 存取工具（去重 / 可測）：`ShareTokenParamSchema`、`getShareToken`、`hasShareAccess` 在約 10 個路由檔成組逐字重複。抽成共用 `share.ts` 並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/share.ts` 匯出三者（含註解）。以腳本移除 10 個一致檔（add-pages/runs/drawings/watchProgress/quizzes/figures/slow-artifacts/page-operations/versioning/page-animation）的本地三定義並改 `import { ShareTokenParamSchema, getShareToken, hasShareAccess } from './share'`，清理因此未使用的 `FastifyRequest` import。過程中腳本一度誤把 share.ts 自身納入（grep 命中）導致毀損，已重寫修復。新增 `share.test.ts` 6 組測試（getShareToken header/query/優先序/trim/陣列、ShareTokenParamSchema 長度與字元）。backend `tsc --noEmit` 通過；share 相關路由回歸約 263 測試全通過（quizzes/drawings/page-animation/權限類 watch/runs/versioning/page-operations…）。分支 `refactor/shared-share-access`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 30 個完成項目（30/100，未達上限）。
- [x] 收斂 `getPdfPermissionRow`（10 標準）至 permissions.ts；`report.ts` 的 title 變體保留。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `getPdfPermissionRow(id)`（`SELECT owner_sub, visibility`，加 `db` import）。以腳本移除 10 個標準檔（watchProgress/regenerate/versioning/figures/add-pages/drawings/quizzes/page-animation/sync/page-operations）的本地定義並合併進其既有 `./permissions` import。`report.ts` 另含 `title` 的變體維持不動（註解標明）。backend `tsc --noEmit` 通過；migrated 路由回歸約 274 測試全通過（quizzes/drawings/page-animation/sync/regenerate/add-pages/figures/各權限測試）。分支 `refactor/shared-get-pdf-permission-row`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 31 個完成項目（31/100，未達上限）。
- [x] 收斂 share 群剩餘變體：`detail.ts`（getShareToken + object schema，無 hasShareAccess）、bare-string schema + `shareTokenFromRequest` 的 outlier 檔。評估改用共用版本。
  - 修改說明（2026-06-27）：`detail.ts` 的 `getShareToken` 與 object 版 `ShareTokenParamSchema` 與共用版完全相同，改 `import { getShareToken, ShareTokenParamSchema } from './share'` 並移除本地定義；其獨有的 `shareAccessForPdf`/`isShareTokenExpired`（含到期判斷、回傳 access level）保留並改用 imported 版本。經評估，`sync.ts`/`server.ts` 的 `shareTokenFromRequest` 為 **header-only 變體**（不讀 `?share=` query、用 bare-string schema），行為與 `getShareToken` 不同，若替換會改變行為，故**刻意不統一**。backend `tsc --noEmit` 通過；`detail-permission`(92)、`share-expiry`(3)、`share`(6) 共 101 測試回歸通過。分支 `refactor/detail-reuse-share`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 32 個完成項目（32/100，未達上限）。

## 後端去重 canEditPdf（第一四八輪，2026-06-27）

- [x] 抽出共用 `canEditPdf` 權限函式（去重 / 可測）：標準 `canEditPdf`（owner / public_editable）在 21 個路由檔逐字重複。抽成共用並補測試；**delete.ts 的版本刻意更嚴格**（`Boolean(sub) && public_editable`，禁止匿名刪除），不替換。
  - 修改說明（2026-06-27）：在 `permissions.ts` 新增 `canEditPdf`（標準版，含註解說明 delete.ts 例外）。以腳本移除 21 檔標準本地定義並合併 import（已有 `import { canReadPdf } from './permissions'` 的 12 檔改為 `{ canReadPdf, canEditPdf }`、其餘 9 檔新增 import）。delete.ts 的嚴格版維持不動。新增 `permissions.test.ts` 的 canEditPdf 測試（見下）。修正腳本誤把 permissions.ts 自身納入而加的自我 import。backend `tsc --noEmit` 通過；抽查約 12 個路由測試檔回歸全通過（quizzes 24、drawings、page-comments、detail-permission 92、figures-polls-permission、add-pages…）；標準本地定義 0。分支 `refactor/shared-can-edit-pdf`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 28 個完成項目（28/100，未達上限）。
- [x] （既有失敗，待修）`page-animation.test.ts` 1/123 失敗：`validateAnimationSpec rejects a shape effect with an invalid shape kind`。在 master 即失敗、與權限重構無關。待查 `validateAnimationSpec` 對 shape kind 的驗證。
  - 修改說明（2026-06-27）：又一個 mirror drift——測試用 `shape: 'triangle'` 當「不合法」案例，但 `ANIMATION_SHAPE_KINDS` 早已新增 `triangle`/`star`/`hexagon`（前端 `types.ts` 與 i18n 三角形/五角星/六角形齊備、為**已支援**形狀），故 triangle 實為合法、測試斷言過時。確認 enum 正確、測試過時後，將測試改用真正不在清單的 `'octagon'`。`page-animation.test.ts` 123/123 通過（先前 122/123）。純測試修正、未動產品碼。分支 `fix/animation-shape-kind-test`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 29 個完成項目（29/100，未達上限）。

## 後端大量去重 sessionSub（第一四六輪，2026-06-27）

- [x] 抽出共用 `sessionSub` 工具（大量去重 / 可測）：`sessionSub(request)`（解 session cookie 取 account sub）在 **40 個** PDF 路由檔逐字重複定義（38 同名 + 2 個 `sessionSubFromRequest` 同 body）。抽成共用並補測試。
  - 修改說明（2026-06-27）：在 `backend/src/routes/auth.ts` 新增 `export function sessionSub(request)`（與既有 `decodeSession`/`parseCookies` 同模組）。以腳本移除 38 個 `sessionSub` 同名定義並改 `import { sessionSub } from '../auth'`（其中 admin.ts 保留其 `SESSION_COOKIE, clearCookie` 匯入）；同時清理 26 個因移除而未使用的 `FastifyRequest` type import。2 個 `sessionSubFromRequest`（命名不同）暫不動。新增 `session-sub.test.ts` 4 組測試（無 cookie/竄改/有效/無關 cookie）。backend `tsc --noEmit` 通過；抽查約 14 個路由測試檔回歸全通過（detail-permission 92、quizzes 24、quality/h5p/report-summary…）；殘留本地定義 0。分支 `refactor/shared-session-sub`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 26 個完成項目（26/100，未達上限）。
- [x] 收斂 2 個 `sessionSubFromRequest` 同 body 函式：與共用 `sessionSub` 實作相同但命名不同，評估改用共用版本或統一命名。
  - 修改說明（2026-06-27）：`export.ts`、`subtitles.ts` 的 `sessionSubFromRequest`（與共用 `sessionSub` 實作完全相同）移除本地定義、4 處呼叫改用 `import { sessionSub } from '../auth'`，並清掉因此未使用的 `decodeSession`/`parseCookies`/`FastifyRequest` import。backend `tsc --noEmit` 通過；`subtitles`/`export-import-zip-sources`/`batch-export`/`export-zip-cjk-filename` 共 10/10 回歸通過；全 repo 已無 `sessionSubFromRequest`。分支 `refactor/collapse-session-sub-from-request`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 27 個完成項目（27/100，未達上限）。

## 後端去重 + 發現既有失敗（第一四三輪，2026-06-27）

- [x] 抽出共用 `canReadPdf` 權限函式（大量去重 / 可測）：`canReadPdf(sub, row)` 在 **27 個** PDF 路由檔案中**逐字重複**定義（grep 確認 27 份實作完全一致），維護風險高。抽成共用模組並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/permissions.ts` 匯出 `canReadPdf`（含註解說明規則：無 owner 公開、owner 可讀、其餘僅 public/public_editable）。以腳本機械式移除 27 檔的本地定義並改 `import { canReadPdf } from './permissions'`（移除後各檔 `PdfRow` 仍有其他用途、且未啟用 `noUnusedLocals`，無未使用 import 問題）。新增 `permissions.test.ts` 3 組測試（無 owner、owner、非 owner×可見度）。backend `tsc --noEmit` 通過；抽查 30 個路由測試檔回歸（detail-permission 92、quality/h5p/script/image/report-summary 等）全通過，殘留本地定義 0。分支 `refactor/shared-can-read-pdf`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 23 個完成項目（23/100，未達上限）。
- [x] （既有失敗，待修）`notes-txt.test.ts` 4/5 失敗：`NOT NULL constraint failed: pages.page_notes`——測試插入 pages 未給 `page_notes`，但該欄為 NOT NULL。在 master 即失敗、與權限重構無關。評估是測試 fixture 漏給欄位、或 schema 應給預設值。
  - 修改說明（2026-06-27）：根因為**測試 fixture 與 schema 不符**——`pages.page_notes` 是 `NOT NULL DEFAULT ''`（production 不會是 NULL），但測試 2 處明確塞 `NULL`（seedPdf 第 2 頁、fallback 測試的 `UPDATE ... SET page_notes = NULL`），違反 NOT NULL。路由本身用 `COALESCE(page_notes,'')` + `.trim()` 對 ''/NULL 行為相同，無需改。將兩處 `NULL` 改為 `''`（代表「無備註」、符合 schema）。`notes-txt.test.ts` 5/5 通過（先前 1/5）。純測試修正、未動產品碼。分支 `fix/notes-txt-test-page-notes-not-null`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 24 個完成項目（24/100，未達上限）。
- [x] （既有失敗，待修）`quizzes.test.ts` 1/24 失敗：`POST /quizzes/:quizId/copy-to/:targetId` 預期 201 卻得 **400**。
  - 修改說明（2026-06-27）：以隔離重現腳本確認——copy-to 端點本身**正常回 201**；400 並非來自 `safeParse`，而是 Fastify 的 JSON body parser。測試用共用 `OWNER_HEADERS`/`OTHER_HEADERS`（含 `content-type: application/json`）但此 POST **無 body**，Fastify 對「宣告 application/json 卻空 body」回 400（在 handler 之前）。前端 `copyQuizSetTo` 用 `fetch(url, { method: 'POST' })`（不帶 content-type），production 不會觸發。屬**測試 bug**：將 copy-to 測試的 3 個無 body 請求改為只帶 `cookie`（移除 content-type）。`quizzes.test.ts` 24/24 通過（先前 23/24）。未動產品碼。分支 `fix/quizzes-copyto-test-headers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 25 個完成項目（25/100，未達上限）。

## 後端分析新增可執行項目（第一四〇輪，2026-06-27）

前端小型純函式 backlog 接近見底，依 LOOP.md 第 2 條轉向後端（受重構關注較少）分析。新增以下項目並完成其一：

- [x] 抽出課後報告共用比例／四捨五入純函式（去重 / 防呆 / 可測）：`report.ts` 多處內聯 `denom > 0 ? num/denom : 0`（correct_rate、wrong_rate、participation_rate、completion_rate×2）、`round4` 重複定義兩次、投票分歧 `1 - max/total`，散落且無針對純邏輯的測試。抽成後端共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `backend/src/routes/pdfs/reportMetrics.ts`（`safeRatio(num, denom)` 分母非正回 0、`round4(n)`、`pollDivergence(maxVotes, totalVotes)` 無票回 0）。收斂 `report.ts`：correct_rate/wrong_rate/participation_rate/completion_rate(×2) 改用 `safeRatio`、兩處 local `round4` 改用共用、頁面 CSV 投票分歧改用 `pollDivergence`。新增 `report-metrics.test.ts` 4 組測試（safeRatio 正常/除以 0、round4、pollDivergence 共識/分裂/無票）。backend `tsc --noEmit` 通過；新測試 4/4 + 既有 `report-pages-csv`/`report-questions-csv`/`report-summary`/`report-question-stats` 共 16/16 回歸通過（行為等價）。分支 `refactor/report-metrics-helpers`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 20 個完成項目（20/100，未達上限）。
- [x] 抽出 `avg_listened_ratio` 的 SQL 聚合為共用片段或測試：`report.ts` 兩處（pages.csv 與 summary）重複同一段 `AVG(CASE WHEN w.duration_ms ... MIN(listened_ms/duration_ms, 1.0) ...)` SQL，易漂移。評估抽成共用常數字串或補一個針對該聚合的整合測試固化語意。
  - 修改說明（2026-06-27）：兩處 watch 聚合查詢實質相同（僅空白/別名差異），抽成模組層級函式 `queryWatchPages(pdfId): WatchPageRow[]`（含完整 SQL 與註解說明 avg_listened_ratio 語意），pages.csv 與 summary 兩處 `const watchPages = db.prepare(...).all(id)` 改為 `queryWatchPages(id)`，整段 SQL 收斂為單一來源。backend `tsc --noEmit` 通過；既有 `report-pages-csv`/`report-summary` 共 7/7 回歸通過（行為等價）；殘留 inline watch SQL 由 2 降為 1（即共用函式內）。分支 `refactor/query-watch-pages`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 22 個完成項目（22/100，未達上限）。
- [ ] 後端搜尋語意索引上限可設定：`search.ts` 的 `MAX_SEMANTIC_PDFS = 20`（STATUS_REPORT §4.4）為硬編，教材知識庫成長後需要更大或可調。評估改為可由系統設定調整並補測試。
- [x] 抽出學生平均分計算純函式：`report.ts` 的 `computeStudentRecords` 內聯 `scores.reduce((a,b)=>a+b,0)/scores.length`（平均分），與其他平均邏輯重複，抽成可測純函式（含空陣列回 null）。
  - 修改說明（2026-06-27）：於 `reportMetrics.ts` 新增 `average(values): number | null`（空陣列回 null），`report.ts` 的 `computeStudentRecords` 學生平均分改用之（行為等價）。`report-metrics.test.ts` 補 1 組測試（平均/單值/空陣列回 null/小數）。backend `tsc --noEmit` 通過；新測試 5/5 + 既有 `report-students`/`student-report` 共 15/15 回歸通過。分支 `refactor/report-average-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 21 個完成項目（21/100，未達上限）。

## 修正既有失敗測試（第一三七輪，2026-06-27）

- [x] 修正 `status-machine.test.ts` 的 PROGRESS_STEPS 鏡像 drift（上輪跑測試時發現的既有失敗）：測試期望的 `PROGRESS_STEPS` 只有 7 個，但 `statusMachine.ts` 已新增 3 個 YouTube 相關步驟（`downloading_captions`／`downloading_audio`／`transcribing_audio`，於 `youtubeCaptions.ts`／`pipeline.ts` 實際使用、前端 `types.ts` 亦已鏡像），導致 `deepEqual` 失敗。確認 source 正確、test 過時，更新測試期望陣列（依 backend 陣列順序）並補 `isProgressStep('transcribing_audio')` 斷言。後端 `tsc --noEmit` 通過、`status-machine.test.ts` 5/5 通過（以 `scripts/run-tests.sh` 執行）。分支 `fix/progress-steps-test-mirror`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 17 個完成項目（17/100，未達上限）。

## 依 STATUS_REPORT 新增可執行項目（第一三五輪，2026-06-27）

使用者提示產生新項目時應參考 `docs/STATUS_REPORT_2026_06_27.md`（該檔此前因檔名問題不存在、現已補上）。依其 §4.2／§7.2／§9 的優先建議，新增以下項目（P0 bug 列首，已初步以 grep 驗證）：

- [x] **（P0 bug）修正品質檢查／匯出漏頁**：`quality-check.ts`、`image-quality.ts`、`script-quality.ts`、`h5p.ts` 皆以 `pages WHERE status = 'ready'` 取頁，但主 pipeline 完成後**頁面層級**停在 `audio_ready`（[`pipeline.ts:1260`]）、`pipeline.ts:1299` 只把 **pdfs**.status 設為 `'ready'`，頁面從不設 `'ready'`（grep 全 backend 確認頁面無 `status:'ready'` 賦值）。結果這些功能對正常生成的簡報可能回傳空頁清單。修正方向：改以「完成狀態集合（`audio_ready`／`ready`）」過濾，並先寫一個重現測試再修，補後端測試涵蓋 audio_ready 頁面被納入。屬後端、需測試、跨 4 路由，建議單獨一輪謹慎處理。
  - 修改說明（2026-06-27）：根因確認——`'ready'` **根本不是合法 page 狀態**（`statusMachine.ts` 的 `PAGE_STATUSES` 無 `ready`，終態為 `audio_ready`；`'ready'` 僅為 PDF 狀態），故 4 路由的 `WHERE status = 'ready'` 對 `pages` 永遠匹配 0 列。將 4 路由的頁面查詢一律改為 `status = 'audio_ready'` 並加註解說明。修正既有 3 個測試（image-quality/script-quality/h5p）的 fixture——原本用**不存在的** `'ready'` page 狀態（所以測試過但 production 壞），改為 `'audio_ready'`，使其反映真實狀態並成為回歸測試（pdfs INSERT 的 `'ready'` 為正確 PDF 狀態，維持不動）。為原本無測試的 quality-check 新增 `quality-check.test.ts`（4 子測試：audio_ready 頁面被檢查〔回歸〕、非完成頁〔rendered〕不檢查、404、403）。backend `tsc --noEmit` 通過；4 個路由測試以 Node 22（`.nvmrc`）+ `--test-force-exit` 執行，子測試全通過（quality-check 4/4、image-quality 4/4、script-quality 5/5、h5p 4/4）。分支 `fix/quality-export-page-status`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 16 個完成項目（16/100，未達上限）。
- [ ] **（P0）課後報告補強**：依 §7.1，`registerReportRoutes()`／`PostClassReportPanel` 補上頁面困難度（完成率低／提問多／投票分歧高）、題目答錯率與 CSV 下載入口。可分拆為純函式（前端彙總）+ 後端聚合兩個子項。
- [ ] **（P1）生成前成本估算 modal 串接**：已有 `lib/costEstimate.ts` helper 與 `PromptModal` 估算，依 §7.5 確認是否已於所有來源（PDF／文字／YouTube）生成前顯示，補齊缺口並加測試。
- [ ] **（P1）教材知識庫：搜尋結果加入動作**：依 §7.4／§8.1，首頁搜尋結果加入「加入新簡報」或「收藏頁」入口（延伸 `search.ts`／`from-pages.ts`）。
- [ ] **（P1）AI 導師自學模式入口正式化**：依 §7.3，將既有 `PageAskPanel`／`usePageAsk` 包裝成學生端自學入口（測驗後個人化複習清單、答錯題回看）。

## 新增可執行項目（第一三四輪，2026-06-27）

第一二九輪新增的 4 個可執行項目已全部完成（計數 9–13），TODO 僅剩 2 個待使用者決定項目。依 LOOP.md 第 2 條再次分析前端程式，新增以下小顆粒、可單輪完成、可加測試、低風險項目（並參考 `docs/FUTURE_ROADMAP.md` 的「教學閉環」方向，惟其主要功能多需後端與產品判斷，故此批先聚焦純前端可測收斂）：

- [x] 模板字串內插（`{key}` 取代）收斂為共用純函式（去重 / 可測性）：`ImportTextPage`(`formatTemplate`)、`AddPagesFromPromptModal`、`PlayPageSidebar`、`SystemDataPage`、`QuizBuilderPage`、`PlayPageFullscreen` 六處各自內嵌 `Object.entries(values).reduce((acc,[k,v]) => acc.replaceAll('{k}', String(v)), template)`（或等價 `for...of`）的內插邏輯，重複且無測試。抽成共用純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/interpolateTemplate.ts`（`interpolateTemplate(template, values)`：以 `replaceAll` 取代所有 `{key}`、值以 `String()` 轉換、無對應 key 的佔位符原樣保留）。六處收斂：`ImportTextPage`／`AddPagesFromPromptModal` 以 `import { interpolateTemplate as formatTemplate/formatMessage }` 取代本地函式（呼叫點不變）；`PlayPageSidebar`／`SystemDataPage`／`QuizBuilderPage`／`PlayPageFullscreen` 的 `formatMessage` 改為 `interpolateTemplate(t(key), values)` 薄包裝（保留各自 `useCallback`/簽章）。新增 `interpolateTemplate.test.ts` 6 組測試。前端 `tsc --noEmit` 通過、測試 6/6 通過、全專案已無殘留內聯內插寫法。分支 `refactor/interpolate-template`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 14 個完成項目（14/100，未達上限）。
- [x] 抽出音訊時長加總純函式：`PlayPageSlidePanel`(`futurePages.reduce(...audio_duration_seconds??0)`)、`play/formatters.ts` 等多處重複「累加各頁 `audio_duration_seconds ?? 0`」。抽成 `sumAudioDurationSeconds(pages)` 純函式並補測試。純前端。
  - 修改說明（2026-06-27）：盤點後實際只剩 `PlayPageSlidePanel` 一處用到「未來頁音訊加總」，且它與目前頁剩餘、邊界（`duration>0` 守衛、`total>0?null`）合成一段未測的 `useMemo`。比起只抽加總，改抽出整段「剩餘播放秒數」計算更有價值：新增 `frontend/src/lib/remainingTime.ts` 的 `computeRemainingSeconds(pages, currentIdx, currentTime, duration)`（pages 為 null 回 null、目前頁剩餘 = `duration>0 ? max(0, duration-currentTime) : 0`、加上之後各頁 `audio_duration_seconds ?? 0`、總和 0 回 null），`PlayPageSlidePanel` 的 `useMemo` 改委派之（行為等價）。新增 `remainingTime.test.ts` 7 組測試（null、目前頁+後續加總、只計後續頁、duration<=0、currentTime 超界夾 0、缺值以 0 計、總和 0 回 null）。前端 `tsc --noEmit` 通過、7/7 通過。分支 `refactor/remaining-seconds`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 19 個完成項目（19/100，未達上限）。
- [x] 比例條百分比收斂為共用純函式：`HomePage` 用量比例條 `max > 0 ? Math.round((value / max) * 100) : 0` 與其他比例顯示重複。抽成 `ratioPercent(value, max)`（除以 0 回 0、clamp 0–100）純函式並補測試。純前端。
  - 修改說明（2026-06-27）：發現既有 `lib/progressPercent.ts` 的 `progressPercent(current, total)` 已正是此「比例→百分比（`total<=0`/非有限值回 0、clamp 0–100）」函式且有完整測試，故**重用之而非新增 `ratioPercent`**（避免重複工具）。收斂 2 處內聯：`HomePage` 用量比例條 `max > 0 ? Math.round((value/max)*100) : 0` → `progressPercent(value, max)`（行為等價）；`SettingsPage` 嵌入索引進度條 `Math.round((indexed_pages/total_pages)*100)` + `Math.min(pct,100)` → `progressPercent(indexed_pages, total_pages)`，順帶修掉 `total_pages` 為 0 時會渲染 `NaN%` 的潛在 bug（progressPercent 回 0）。前端 `tsc --noEmit` 通過、`progressPercent` 既有 4 測試續通過、pages/components 已無殘留通用比例百分比內聯寫法。分支 `refactor/reuse-progress-percent`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 15 個完成項目（15/100，未達上限）。
- [x] 抽出測驗計分加總純函式：`QuizBuilderPage` 多處 `reduce` 計算總分／滿分／平均分（含 `roundToTwoDecimals`），邏輯分散且無獨立測試。抽成可測純函式。純前端。
  - 修改說明（2026-06-27）：於既有 `lib/quizScoring.ts` 新增 `calcAttemptScore(questions, answersById)`（以 `normalizeQuestionScores` + `calcQuestionScore` 累加單次作答總分，回傳未四捨五入原始值）與 `maxAttemptScore(questions)`（normalized 分數加總＝滿分）。收斂 `QuizBuilderPage` 兩處重複的「`normalizeQuestionScores` + `reduce(calcQuestionScore)`」計分內聯（提交作答、同步顯示分數/滿分），呼叫端仍各自 `roundToTwoDecimals`；其餘 per-question 用途（答錯偵測等）不動。`quizScoring.test.ts` 新增 3 組測試（maxAttemptScore、calcAttemptScore 依 id 加總含缺答、回傳未四捨五入原始值），共 11/11 通過。前端 `tsc --noEmit` 通過（以 `scripts/run-tests.sh` 執行測試）。分支 `refactor/quiz-attempt-score`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 18 個完成項目（18/100，未達上限）。
- [ ] 報告面板個人層級延伸（方向，需使用者裁示）：依 `docs/FUTURE_ROADMAP.md` 2.1，目前課後報告為班級層級，roadmap 建議延伸到個人層級報表（每位學生答題完成率、提問次數、投票參與率）。涉後端聚合與隱私呈現，屬較大項目，列為待使用者決定方向。

## 新增可執行項目（第一二九輪，2026-06-27）

依 LOOP.md 第 2 條（剩餘兩項皆待使用者決定、不宜自動逕行），分析前端程式後新增以下小顆粒、可單輪完成、可加測試、低風險項目：

- [x] 逐字稿每頁字數上限正規化收斂為共用純函式（去重 / 可測性）：`PlayPageSidebar`、`RegenAllDialog`、`TtsDialog` 三處各自內嵌 `Math.max(80, Math.min(2000, Math.round(x)))`，magic number 80/2000 散落三檔、易漂移且無測試。抽成共用常數與純函式並補測試。純前端、不動後端、不需新 i18n。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/scriptMaxChars.ts`（`SCRIPT_MAX_CHARS_MIN=80`、`SCRIPT_MAX_CHARS_MAX=2000`、`normalizeScriptMaxChars(value)` = `clamp(Math.round(value), MIN, MAX)`，沿用既有 `clamp` helper，行為與原內聯完全一致：`NaN` 照樣傳遞，呼叫端維持各自的 `Number.isFinite` 防呆）。三處呼叫點改用此函式。新增 `scriptMaxChars.test.ts` 5 組測試（範圍內含上下界、超界拉回、四捨五入、與舊內聯輸出一致、NaN 傳遞）。前端 `tsc --noEmit` 通過、測試 5/5 通過、全專案已無殘留內聯寫法。分支 `feat/normalize-script-max-chars`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 9 個完成項目（9/100，未達上限）。
- [x] 逐字稿字數上限範圍說明 i18n：三處輸入框（TtsDialog / RegenAllDialog / PlayPageSidebar regen）未向使用者標示 80–2000 的允許範圍，輸入超界會被靜默正規化。可加上以 `SCRIPT_MAX_CHARS_MIN/MAX` 組出的 helper 文字與 `min/max` HTML 屬性，並補 i18n 鍵。
  - 修改說明（2026-06-27）：新增共用 i18n 鍵 `play.scriptMaxCharsRange`（zh-TW「允許範圍 {min}–{max} 字」／en「Allowed range: {min}–{max}」，內插 `SCRIPT_MAX_CHARS_MIN/MAX`）。`TtsDialog` 與 `RegenAllDialog`（即 PlayPageSidebar 開啟的批次重生輸入）的字數上限 `<input>` 下方新增範圍提示，並把原本硬編的 `min={80} max={2000}` HTML 屬性改用 `SCRIPT_MAX_CHARS_MIN/MAX` 常數，與正規化邏輯共用同一來源。前端 `tsc --noEmit` 通過、i18n parity + nonempty 等 27 測試全通過（新鍵兩語系 placeholder 集合一致）。分支 `feat/script-max-chars-range-hint`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 13 個完成項目（13/100，未達上限）。
- [x] 投影片縮放比例（slideImageScale）邊界收斂：`PlayPageHeader` 兩處 `Math.max(0.65, ...)`／`Math.min(1.35, ...)` 與 0.1 步進散落且 magic number 重複。抽成共用常數與 `stepSlideScale(scale, delta)` 純函式並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/slideImageScale.ts`（`SLIDE_IMAGE_SCALE_MIN=0.65`、`MAX=1.35`、`STEP=0.1`、`stepSlideImageScale(scale, delta)`：先 `toFixed(2)` 消浮點誤差再以共用 `clamp` 夾範圍，與原寫法行為一致）。`PlayPageHeader` 放大／縮小按鈕 onClick 改用 `stepSlideImageScale(scale, ±STEP)`，兩處 disabled 判斷改用 `MIN`/`MAX` 常數，header 內已無 magic number。新增 `slideImageScale.test.ts` 4 組測試（步進消浮點誤差、不低於下限、不高於上限、與舊內聯一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過。分支 `feat/slide-scale-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 12 個完成項目（12/100，未達上限）。
- [x] 抽出首頁音訊總時長彙總純函式：`HomePage` 內聯 `Math.round(items.reduce(...total_audio_duration_seconds...) / 60)` 計算總分鐘數，無測試且與單卡片 `/60` 換算重複。抽成可測純函式。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/homeStats.ts`（`summarizeHomeStats(items)` 回傳 `{totalPdfs, totalPages, totalPlays, totalAudioMin}`，單次遍歷取代原本 3 次 reduce、音訊總秒數 `/60` 後四捨五入，各欄位缺值以 0 計入與原 `?? 0` 一致）；輸入採 `Pick<PdfListItem, …>` 結構型別降低耦合。`HomePage` 的 `homeStats` useMemo 改為 `summarizeHomeStats(items)`（行為等價）。新增 `homeStats.test.ts` 4 組測試（空清單、正常彙總含四捨五入、缺值以 0 計入、與舊 reduce 寫法一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過。分支 `feat/home-stats-helper`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 11 個完成項目（11/100，未達上限）。
- [x] 抽出上傳進度百分比計算純函式：`UploadButton`、`ImportTextPage`、`HomePage`(zip)、`AddPagesFromPromptModal` 多處重複 `Math.round((loaded/total)*100)`（且 total 為 0 時行為不一）。收斂為帶除以 0 防呆的共用純函式並補測試。
  - 修改說明（2026-06-27）：新增 `frontend/src/lib/uploadProgress.ts`（`uploadProgressPercent(loaded, total)`：`total <= 0`／`NaN` 回 0 避免除以 0 產生 `NaN`/`Infinity`，其餘四捨五入後以既有 `clamp` 夾在 [0,100]）。收斂 5 處內聯（`UploadButton`、`ImportTextPage` 2 處、`HomePage` zip 匯入、`AddPagesFromPromptModal`），各呼叫端保留原本的外層 fallback 語意（位元組進度點維持 `if (total > 0)` 略過更新、`AddPagesFromPromptModal` 維持 `null` 顯示）。新增 `uploadProgress.test.ts` 4 組測試（一般換算、分母無效回 0、超界夾 100、與舊內聯一致）。前端 `tsc --noEmit` 通過、測試 4/4 通過、無殘留上傳進度內聯寫法。`HomePage` 第 1441 行的音訊用量比例條語意不同（非上傳進度），未納入。分支 `feat/upload-progress-percent`，已 merge 回 master。BLOG.md 新增對應 section。
  - 計數：自上次「---- 計數重設 ----」(2026-06-27) 起算，本項為第 10 個完成項目（10/100，未達上限）。

## 工作記錄

| 日期 | 工作內容 | 分支 |
|------|---------|------|
| 2026-06-27 | （FK 稽核收尾）`addPagesFromPrompt` 中間插頁補 `defer_foreign_keys`（避免後續頁有投票時 FK 500）；重現驗證 + 17 測試回歸（計數 42/100） | fix/addpages-defer-fk（已 merge） |
| 2026-06-27 | （資料對齊擴展）頁面增/刪/移時 comments/drawings 也對齊：`shiftChildPageNumbers` 擴為三表、move per-page 移三表、delete 顯式刪被刪頁 comments/drawings；補 4 測試；後端 1203/1203 全綠（計數 41/100） | fix/realign-page-content-children（已 merge） |
| 2026-06-27 | （真 bug 修復）頁面增/刪/移時投票（page_polls）未隨頁碼重編號致 FK 500+錯位：三 renumber 交易加 `defer_foreign_keys`、delete 補子表 lockstep 位移；補 2 回歸測試；後端 1201/1201 全綠（計數 40/100） | fix/page-renumber-fk-defer-and-poll-shift（已 merge） |
| 2026-06-27 | 規畫輪（第一六〇輪）：確認 backlog 見底、品質檢查修正完整無缺口；依 STATUS_REPORT §7–§8 補 5 個優先可執行項目（多需 UI/後端整合，部分待使用者確認方向）。本輪為規畫輪、不計入 100 完成計數（維持 39/100） | master（僅文件） |
| 2026-06-27 | （前端補測試）`debugLog.ts` 補 3 單元測試（開關/防呆分支）；前端 532/532 全綠（計數 39/100） | test/debug-log（已 merge） |
| 2026-06-27 | （前端去重）抽出共用 `hasLocalStorage`（recentSearches/commentAuthor）；reviewList 因測試耦合保留；補 3 測試；前端 551/551 全綠（計數 38/100） | refactor/shared-has-local-storage（已 merge） |
| 2026-06-27 | （修既有失敗）`timing.test.ts`+`regenerate-matrix.test.ts` 共 5 個 401：補 `setSystemAuthSettings({googleAuthEnabled:false})`；12/12 + 4/4 通過（連跑穩定）（計數 36/100） | fix/timing-regen-test-auth（已 merge） |
| 2026-06-27 | （修既有失敗）`skills.test.ts`：`updateUserSkill` 改條件 spread 省略 undefined 模板鍵（與 create 形狀一致、修磁碟 round-trip 不符）；5/5 通過（計數 35/100） | fix/update-skill-omit-undefined-template-fields（已 merge） |
| 2026-06-27 | 跑完整後端套件（1199 測試/18 既有失敗，與去重無關）並分類；修 `input-security.test.ts` 4 失敗（缺 googleAuthEnabled:false 致 401）；其餘 14 個分組記錄待判斷（計數 34/100） | fix/input-security-test-auth（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `canDestructivelyEditPdf`：4 檔 + delete.ts（消除同名不同 body）收斂至 permissions.ts；補測試；177 測試回歸通過、嚴格匿名行為保留（計數 33/100） | refactor/shared-can-destructively-edit（已 merge） |
| 2026-06-27 | （後端，去重收尾）detail.ts 改用共用 share `getShareToken`/`ShareTokenParamSchema`；`shareTokenFromRequest`(sync/server) 為 header-only 變體刻意保留；101 測試回歸通過（計數 32/100） | refactor/detail-reuse-share（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `getPdfPermissionRow` 至 permissions.ts：10 標準檔收斂、合併 import；report.ts title 變體保留；typecheck 通過、約 274 路由測試回歸通過（計數 31/100） | refactor/shared-get-pdf-permission-row（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 share 存取群 `share.ts`（ShareTokenParamSchema/getShareToken/hasShareAccess）：10 檔成組收斂、清理 FastifyRequest import；補 6 測試；typecheck 通過、約 263 share 路由測試回歸通過（計數 30/100） | refactor/shared-share-access（已 merge） |
| 2026-06-27 | （修既有失敗）`page-animation.test.ts`：shape kind mirror drift——`triangle` 早已成合法形狀，測試改用真正不合法的 `octagon`；123/123 通過（計數 29/100） | fix/animation-shape-kind-test（已 merge） |
| 2026-06-27 | （後端，去重）抽出共用 `canEditPdf` 至 permissions.ts：21 檔標準定義收斂、合併 import；delete.ts 嚴格版保留；補測試；typecheck 通過、12 路由測試回歸通過；另記 1 個既有失敗（page-animation shape kind）（計數 28/100） | refactor/shared-can-edit-pdf（已 merge） |
| 2026-06-27 | （後端）收斂 2 個 `sessionSubFromRequest`（export/subtitles）改用共用 `sessionSub`，清理未用 import；10 測試回歸通過；全 repo 無殘留（計數 27/100） | refactor/collapse-session-sub-from-request（已 merge） |
| 2026-06-27 | （後端，大量去重）抽出共用 `sessionSub` 至 auth.ts：移除 38 檔逐字重複定義 + 清理 26 檔未使用 FastifyRequest import；補 4 測試；typecheck 通過、14 路由測試回歸通過（計數 26/100） | refactor/shared-session-sub（已 merge） |
| 2026-06-27 | （修既有失敗）`quizzes.test.ts` copy-to：診斷確認端點正常回 201，400 是測試送 `content-type: application/json` 卻無 body 觸發 Fastify body parser；改 3 請求為只帶 cookie；24/24 通過（計數 25/100） | fix/quizzes-copyto-test-headers（已 merge） |
| 2026-06-27 | （修既有失敗）`notes-txt.test.ts`：fixture 兩處塞 `page_notes = NULL` 違反 NOT NULL，改為 `''`；5/5 通過（計數 24/100）。quizzes copy-to 400 仍待重現除錯 | fix/notes-txt-test-page-notes-not-null（已 merge） |
| 2026-06-27 | （後端，大量去重）抽出共用 `canReadPdf`：27 個路由檔逐字重複的權限函式收斂為 `permissions.ts`；補 3 測試；typecheck 通過、30 路由測試回歸通過；另記錄 2 個與本輪無關的既有失敗測試（notes-txt、quizzes）（計數 23/100） | refactor/shared-can-read-pdf（已 merge） |
| 2026-06-27 | （後端）抽出 watch 聚合查詢 `queryWatchPages`：收斂 `report.ts` pages.csv 與 summary 兩處重複的 avg_listened_ratio SQL 為單一函式；7 報告測試回歸通過（計數 22/100） | refactor/query-watch-pages（已 merge） |
| 2026-06-27 | （後端）抽出學生平均分純函式：`reportMetrics.ts` 新增 `average`（空回 null），`report.ts` computeStudentRecords 改用；補 1 測試，15 報告測試回歸通過（計數 21/100） | refactor/report-average-helper（已 merge） |
| 2026-06-27 | （後端，依 LOOP 第 2 條）抽出課後報告共用比例/四捨五入純函式：新增 `reportMetrics.ts`（`safeRatio`/`round4`/`pollDivergence`），收斂 `report.ts` 多處內聯比例與重複 `round4`；補 4 測試，既有 16 報告測試回歸通過（計數 20/100）；另新增 3 個後端可執行項目 | refactor/report-metrics-helpers（已 merge） |
| 2026-06-27 | 抽出剩餘播放秒數純函式：新增 `lib/remainingTime.ts` 的 `computeRemainingSeconds`，`PlayPageSlidePanel` 的 useMemo 改委派；補 7 測試；typecheck 通過（計數 19/100） | refactor/remaining-seconds（已 merge） |
| 2026-06-27 | 抽出測驗計分純函式：`quizScoring.ts` 新增 `calcAttemptScore`/`maxAttemptScore`，收斂 `QuizBuilderPage` 兩處計分內聯；補 3 測試（11/11）；typecheck 通過（計數 18/100） | refactor/quiz-attempt-score（已 merge） |
| 2026-06-27 | 修正既有失敗測試 `status-machine.test.ts`：PROGRESS_STEPS 期望陣列補上 3 個 YouTube 步驟（source 正確、test 過時），5/5 通過；新增 `scripts/run-tests.sh` 一次測試成功（依使用者要求）（計數 17/100） | fix/progress-steps-test-mirror（已 merge） |
| 2026-06-27 | （P0 bug，依 STATUS_REPORT §4.2）修正品質檢查／匯出漏頁：`quality-check`/`image-quality`/`script-quality`/`h5p` 4 路由的頁面查詢由不存在的 page 狀態 `'ready'` 改為終態 `'audio_ready'`；修正 3 測試 fixture、新增 quality-check.test.ts；以 Node 22 + `--test-force-exit` 驗證子測試全通過（計數 16/100） | fix/quality-export-page-status（已 merge） |
| 2026-06-27 | 比例條百分比收斂：發現既有 `progressPercent` 已是該通用函式，改為重用而非新增；收斂 `HomePage` 用量比例條與 `SettingsPage` 索引進度條 2 處，順帶修掉 `total_pages=0` 時 `NaN%` 潛在 bug；typecheck 通過、既有測試續通過（計數 15/100） | refactor/reuse-progress-percent（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式（第一三四輪）：TODO 僅剩 2 個待使用者決定項目，新增 5 個項目並完成其一——模板字串內插收斂為 `lib/interpolateTemplate.ts`，收斂 6 處內聯（ImportTextPage/AddPagesFromPromptModal/PlayPageSidebar/SystemDataPage/QuizBuilderPage/PlayPageFullscreen）；補 6 測試；typecheck 通過、無殘留（計數 14/100） | refactor/interpolate-template（已 merge） |
| 2026-06-27 | 逐字稿字數上限範圍說明 i18n：新增共用鍵 `play.scriptMaxCharsRange`（內插 MIN/MAX），`TtsDialog`/`RegenAllDialog` 輸入下方加範圍提示、`min/max` 屬性改用常數；i18n parity+nonempty 27 測試通過（計數 13/100）。至此第一二九輪新增的 4 個可執行項目已全部完成，TODO 僅剩 2 個待使用者決定項目 | feat/script-max-chars-range-hint（已 merge） |
| 2026-06-27 | 投影片縮放比例邊界收斂：新增 `lib/slideImageScale.ts`（`stepSlideImageScale` + MIN/MAX/STEP 常數，toFixed 消浮點誤差 + clamp）；`PlayPageHeader` 放大/縮小按鈕與 disabled 判斷改用之，header 無殘留 magic number；補 4 測試；typecheck 通過（計數 12/100） | feat/slide-scale-helper（已 merge） |
| 2026-06-27 | 首頁總覽統計彙總純函式：新增 `lib/homeStats.ts`（`summarizeHomeStats`，單次遍歷取代 3 次 reduce，音訊總秒數 /60 四捨五入）；`HomePage` homeStats 改用之；補 4 測試；typecheck 通過（計數 11/100） | feat/home-stats-helper（已 merge） |
| 2026-06-27 | 上傳進度百分比計算收斂：新增 `lib/uploadProgress.ts`（`uploadProgressPercent`，分母無效回 0 + clamp 0–100），收斂 `UploadButton`/`ImportTextPage`(2)/`HomePage`(zip)/`AddPagesFromPromptModal` 共 5 處內聯，各保留原 fallback 語意；補 4 測試；typecheck 通過、無殘留（計數 10/100） | feat/upload-progress-percent（已 merge） |
| 2026-06-27 | 逐字稿每頁字數上限正規化收斂：新增 `lib/scriptMaxChars.ts`（`normalizeScriptMaxChars` + MIN/MAX 常數，委派既有 `clamp`），收斂 `PlayPageSidebar`/`RegenAllDialog`/`TtsDialog` 三處內聯 `Math.max(80,Math.min(2000,round))`；補 5 測試；typecheck 通過、無殘留內聯（計數 9/100） | feat/normalize-script-max-chars（已 merge） |
| 2026-06-27 | 依 LOOP.md 第 2 條分析前端程式，新增 5 個小顆粒可執行項目（逐字稿字數上限正規化〔已完成〕、範圍說明 i18n、slideImageScale 邊界收斂、首頁音訊總時長彙總純函式、上傳進度百分比純函式） | feat/normalize-script-max-chars |
| 2026-06-27 | TODO.md 過大，依既有 `TODO_YYMMDD` 封存慣例將其改名為 `TODO_260627.md`，重建精簡新 TODO.md（保留計數狀態、兩個待使用者決定的未完成項目與工作記錄區） | master（僅文件） |
