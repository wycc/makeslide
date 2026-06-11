# PlayPage 模組架構說明

本文件說明 `frontend/src/pages/PlayPage.tsx` 與其拆分目錄 `frontend/src/pages/play/`
的整體架構、各檔職責、以及「為什麼某些程式碼留在 PlayPage 而無法抽出」的設計取捨。

> 緣起：PlayPage 原本是單一函式元件，最高曾達 **5727 行**，內含 100+ 個 useState、
> 80+ 個 useCallback/useEffect、約 2800 行 JSX。經階段 1–6 重構後，主檔降至約 **1981 行**。
> 本文件同時記錄「進一步縮小的可能性分析」，供後續維護者接手。

---

## 1. 整體架構：God Context + Composition Root

PlayPage 採用「**單一巨型 Context + 組合根（composition root）**」模式：

```
PlayPage.tsx  (composition root)
│
├── 自有 state（47 個 useState / 27 個 useRef）——播放、同步、繪圖、全螢幕
├── 呼叫 11 個 custom hooks，取得各領域的 state + handler
│      useVersionHistory / useRegeneration / useVideoGeneration / usePdfMetadata /
│      useSlideManagement / useImageStyle / useScriptEditor / usePromptAndSource /
│      useChatAndImageEdit / usePagePolls（+ utils）
│
├── 組裝 _ctxValue（約 250 個欄位）
│
└── <PlayPageCtx.Provider value={_ctxValue}>
       ├── <PlayPageFullscreen />   ← 全螢幕覆蓋層
       ├── <PlayPageHeader />        ← 頂部標題列
       ├── <PlayPageSlidePanel />    ← 左側投影片區
       ├── <PlayPageSidebar />       ← 右側縮圖＋聊天
       └── <PlayPageDialogs />       ← 五個對話框
```

### 為什麼用 God Context？

四大版面元件（Fullscreen/Header/SlidePanel/Sidebar）彼此共享大量可變 state
（例如 `currentIdx`、`isPlaying`、`drawingMode`、同步狀態）。若改用 props 傳遞，
單一元件就需要 50+ 個 props，且任一 state 變更都得逐層轉傳。因此選擇用一個
Context 把所有共享 state 集中於 PlayPage 層級，子元件透過 `usePlayPageContext()` 取用。

**代價**：所有 state 必須停留在 PlayPage（或它呼叫的 hooks）中，無法下放到子元件。
這也是 PlayPage 仍有約 2000 行的根本原因——它是整個播放頁的「狀態容器」。

---

## 2. 目錄檔案清單

### 主檔
| 檔案 | 行數 | 職責 |
|------|-----:|------|
| `PlayPage.tsx` | ~1981 | 組合根：自有 state、跨領域 effect、組裝 context、頂層 JSX |

### Context
| 檔案 | 行數 | 職責 |
|------|-----:|------|
| `PlayPageContext.tsx` | 403 | 定義 `PlayPageContextValue` 介面（~250 欄位）與 `usePlayPageContext()` |

### 版面元件（消費 context）
| 檔案 | 行數 | 職責 |
|------|-----:|------|
| `PlayPageSlidePanel.tsx` | 816 | 左側：投影片圖片、逐字稿編輯、提示詞、設定、來源 tab |
| `PlayPageSidebar.tsx` | 652 | 右側：縮圖清單、投票、AI 聊天問答 |
| `PlayPageFullscreen.tsx` | 594 | 全螢幕覆蓋層：繪圖工具列、字幕、投票互動、游標鏡射 |
| `PlayPageHeader.tsx` | 433 | 頂部標題列：影片/分享/重生狀態、同步開關 |
| `PlayPageDialogs.tsx` | 127 | 聚合五個對話框，從 context 取 state 後分派 props |

### 對話框（純展示，接收 props）
| 檔案 | 行數 | 職責 |
|------|-----:|------|
| `RegenAllDialog.tsx` | 185 | 選擇重生項目（圖片/逐字稿/語音、改寫提示詞模式） |
| `TtsDialog.tsx` | 148 | 生成設定（TTS 語音、語速、每頁字數、主持模式） |
| `VersionHistoryDialog.tsx` | 105 | 圖片/逐字稿版本歷史與還原 |
| `ImageStyleDialog.tsx` | 80 | 整份簡報圖片風格 prompt 設定 |
| `ShareDialog.tsx` | 47 | 分享連結建立與 QR Code |
| `ImagePreviewDialog.tsx` | 36 | inpaint/重生後候選圖片預覽與套用 |

### Custom Hooks（封裝單一領域的 state + handler + effect）
| 檔案 | 行數 | 封裝內容 |
|------|-----:|------|
| `useChatAndImageEdit.ts` | 361 | AI 聊天問答、inpaint、圖片預覽 |
| `useRegeneration.ts` | 347 | 批次重生任務（state、輪詢、啟動/停止/還原/確認） |
| `usePagePolls.ts` | 344 | 投票建立/開始/結束/投票/刪除/選取顯示 |
| `usePdfMetadata.ts` | 281 | 標題、TTS 設定、分享連結、GitHub 同步 |
| `usePromptAndSource.ts` | 183 | 頁面 prompt 輸入、來源文字/PDF、生成記錄 |
| `useSlideManagement.ts` | 149 | 投影片新增/刪除/移動/替換圖片/更新封面 |
| `useScriptEditor.ts` | 138 | 逐字稿編輯 state、改寫逐字稿、編輯版面切換 |
| `useImageStyle.ts` | 125 | 圖片風格 prompt/範本/對話框（透過 ref 解循環依賴） |
| `useVersionHistory.ts` | 115 | 版本歷史開啟/預覽/還原 |
| `useVideoGeneration.ts` | 110 | 影片產生 busy/url/progress 與輪詢 |

### 工具
| 檔案 | 行數 | 職責 |
|------|-----:|------|
| `formatters.ts` | 24 | 時間/數值格式化 |
| `PageTimingChips.tsx` | 56 | 頁面時間軸標籤 |
| `RegenerateProgress.tsx` | 84 | 重生進度條 |
| `utils.ts` | 16 | `resolveConfiguredUserCode()` |

---

## 3. PlayPage.tsx 內部結構地圖

依在檔案中出現的順序：

| 行段 | 區塊 | 說明 |
|------|------|------|
| 1–80 | imports、常數、型別 | 輪詢間隔、正規表示式、`SentenceTimelineItem` 等 |
| 83–141 | **純函式** `splitScriptIntoSentences` / `buildSentenceTimeline` | 字幕切句與時間軸估算 |
| 143–185 | **純函式** 全螢幕 API 包裝 | `getAnyFullscreenElement` / `requestAnyFullscreen` / `exitAnyFullscreen` |
| 192–316 | **state / ref 宣告** | 47 個 useState、27 個 useRef |
| 247–265 | 繪圖畫布 refs + `getActiveDrawingCanvas` | 三個 canvas 實例的 ref 選擇 |
| 273–379 | **音訊播放機制** | audioRef、retry timer、`scheduleAudioReload`、wake lock |
| 387–714 | **跨領域 effects** | 載入詳情輪詢、進度回復/儲存、字幕載入、換頁換音訊、預載 |
| 716–828 | **播放控制** | `playPause` / `goPrev` / `goNext` / `handleEnded` / `handleSeek` |
| 830–923 | **同步設定** | sync 啟用持久化、join、`handleSyncEnabledChange` |
| 925–1190 | **同步推送 + mega-polling** | 繪圖推送、游標推送、巨型輪詢 effect |
| 1191–1261 | follower 問題 handlers + `handleRetry` | |
| 1262–1331 | **鍵盤快捷鍵** | 空白/方向鍵/W/P/Escape |
| 1333–1408 | **全螢幕整合** | 進入/退出、fullscreenchange、字幕時間軸 |
| 1410–1530 | **custom hooks 呼叫區** | 11 個 hook 集中宣告 |
| 1531–1625 | `handleRegenerateAudio` | 直接操作 audioRef |
| 1627–1713 | 全域貼上圖片 handler | |
| 1715–1772 | 載入/錯誤早退、computed | `hasScriptChanges` / `activePoll` |
| 1775–1843 | **`_ctxValue` 組裝** | ~250 欄位 |
| 1848–1981 | **頂層 JSX** | Provider + 五個版面元件 + audio 元素 |

---

## 4. 為什麼這些程式碼「留在 PlayPage」？

重構過程中已對以下區塊加上行內備註，說明無法抽出的技術原因：

### `handleEnded`（跨領域協調）
播放結束時同時觸及 **投票（pollState）**、**播放狀態（isPlaying/currentIdx/finished）**
與 **classroomMode/interactiveMode 全域開關**。三個領域在同一回呼中依序決策，
任一領域都無法獨自持有完整 if/else 邏輯。

### `handleRetry` / `handleRegenerateAudio`（直接操作 audioRef）
兩者都直接讀寫 `audioRef.current`（pause/src/load/play）與 retry token，
屬於 `<audio>` DOM 的命令式控制，無法在不移走 audioRef 的前提下抽出。

### `flushLocalDrawingPush` / `pushLocalDrawingChange`（共用推送頻道）
手寫筆劃推送與游標推送共用同一個 `updatePlaybackSyncState` payload、相同節流間隔，
才能讓 follower 一次 tick 拿到所有最新狀態。

### Sync mega-polling effect（14+ 跨領域 setter）
單一 `setInterval` callback 同時寫入音訊 seek/play/pause、投票狀態、繪圖鏡射、
游標、導航、sync 元數據等 14+ 個跨領域 setter，且 master/follower 邏輯完全交織。
**這是 PlayPage 體積的真正瓶頸**——硬拆成 hook 只是把同樣的耦合搬家，不會降低複雜度。

---

## 5. 進一步縮小的可能性分析

PlayPage 目前約 1981 行。依「風險 / 效益」分層評估：

### 🟢 低風險，可直接抽（純函式，約 –140 行）
這些是檔案頂層的 pure function，無 closure 依賴，搬移零風險：

| 候選 | 內容 | 預估 |
|------|------|-----:|
| ~~`play/subtitles.ts`~~ | ~~`splitScriptIntoSentences` + `buildSentenceTimeline` + 兩個正規表示式~~ | **已完成**：抽至 `frontend/src/lib/subtitles.ts`（2026-06-12，逐字稿同步動畫功能一併重用此邏輯，詳見 `docs/animation-slide-v1-design.md` §6.5） |
| `play/fullscreenApi.ts` | `getAnyFullscreenElement` / `requestAnyFullscreen` / `exitAnyFullscreen` | ~45 行 |

> 注意：上述抽法只是把純函式移到獨立檔，**不改變** PlayPage 的 state 結構，
> 但能讓主檔聚焦於元件邏輯。`subtitles.ts` 已完成抽出，§3 行段對照表的行號略有偏移（PlayPage 現約 1962 行），未重新校正。

### 🟡 中等風險，可抽成內聚 hook（約 –280 行）
這些 effect/callback 群有清楚邊界，依賴的 state 少且單向：

| 候選 hook | 封裝內容 | 主要依賴 | 預估 |
|-----------|---------|---------|-----:|
| `useWakeLock` | acquire/release + 3 個 wake-lock effect | `isPlaying` | ~70 行 |
| `usePlaybackProgress` | localStorage 進度回復/儲存 | `pdfId`、`currentPage`、`currentTime`、`setCurrentIdx` | ~70 行 |
| `useAssetPrefetch` | 圖片/音訊預載 effect | `deckPages`、`currentIdx`、`withImageBust` | ~50 行 |
| `useSubtitleTimeline` | `pageSentences`/`activeSentenceIdx`/`currentSentence` + 捲動 | `currentScript`、`currentTime`、`duration` | ~45 行 |
| `useScriptsLoader` | 背景漸進載入所有頁逐字稿 | `deckPages`、`pdfId` → `setScripts` | ~45 行 |

> 這些抽出後 state 仍需回填 `_ctxValue`（god context 限制），
> 但 effect 邏輯離開主檔可讓 PlayPage 更易讀。預估可降到 ~1500 行。

### 🔴 高風險 / 需架構變更（不建議現在做）
| 區塊 | 為何困難 |
|------|---------|
| **整個 sync 領域**（setup/join/push/cursor/mega-poll/follower questions，~400 行） | mega-polling effect 寫入 20+ 個跨領域 setter，master/follower 邏輯交織。**正確解法是引入 reducer 或狀態機（XState）** 把同步狀態收斂成單一 transition，而非搬進 hook。這是獨立的大型重構，應另開計畫。 |
| **audioRef 命令式控制** | `<audio>` 的 play/pause/seek 散落在 handleEnded/handleRetry/handleRegenerateAudio/JSX onCanPlay。要抽成 `useAudioElement` 需設計事件回呼介面，且與同步 follower 的 audio 操作耦合。 |

### 結論
- **立即可做**：抽兩個純函式檔（🟢），約 –140 行，零風險。
- **下一步**：抽 5 個內聚 hook（🟡），約 –280 行，可降至 ~1500 行。
- **根本瓶頸**：sync mega-effect（🔴）。在不引入 reducer/狀態機前，PlayPage 難以低於 ~1400 行。
  這不是「程式碼壞掉」，而是「播放頁同步狀態本質上是一個複雜狀態機」的真實反映。

---

## 6. 維護提示

- **新增共享 state**：在 PlayPage 宣告 → 加入 `_ctxValue` → 在 `PlayPageContextValue` 補型別。
- **新增單一領域功能**：優先寫成 `play/useXxx.ts` hook，PlayPage 呼叫後 spread 進 `_ctxValue`。
- **hook 宣告順序**：若某 hook 的 deps array 引用另一 hook 的回傳值，被引用者必須先宣告（避免 TDZ）。
  目前 custom hooks 集中在 1410 行附近，刻意排在 effects 之後、`handleRegenerateAudio` 之前。
- **循環依賴**：`useRegeneration` 與 `useImageStyle` 互相需要對方的值，已用
  `MutableRefObject<string>`（`deckImageStylePromptRef`）打破，每次 render 同步 ref。
- **驗證**：改動後跑 `npx tsc --noEmit` 與 `npx vite build`。
