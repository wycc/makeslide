# 往頁面加入額外的文字與圖片 ＋ 融合回圖片頁（fusion）

- 文件版本：V1.0
- 狀態：Draft → 依本文件實作中
- 分支：`feat/page-overlay-and-fusion`
- 前置文件：[`react-slide-design.md`](react-slide-design.md)（React 頁、主題、烘焙）、[`react-slide-image-to-text.md`](react-slide-image-to-text.md)（背景圖、文字抽取）
- 日期：2026-08-16

---

## 1. 要解決的事

使用者要在任何一頁上**加一段文字或一張圖片**——一個註記、一個 logo、一句補充、一張示意圖。

問題不在「怎麼把東西畫上去」，而在**畫上去的東西要活在哪裡**。這個系統目前有兩個真相來源，加上去的東西必須落在其中一個上：

| 真相來源 | 誰在讀它 |
| --- | --- |
| `<page_uid>.jpg` | **所有匯出**：PPTX（[`pptx.ts:67`](../backend/src/routes/pdfs/pptx.ts#L67)）、影片（[`generateVideo.ts:102`](../backend/src/worker/steps/generateVideo.ts#L102)）、講義 PDF、縮圖列、封面 |
| `<page_uid>.slide.jsx` | React 頁的畫面、元素編輯面板、版本歷史 |

落在第三個地方會產生第三個真相來源，而 2026-08-15 那兩輪工作剛好是在**消滅**第三個真相來源（`textLayers` 全部搬進 JSX）。本設計因此不新增圖層。

### 1.1 一個已經存在、但不是答案的東西

GSAP 的 `text-callout` 與 `overlay-image` 效果（[`animationSpec.ts:38`](../frontend/src/lib/animationSpec.ts#L38)）已經能在頁面上疊文字與圖片。它們不是這個需求的答案，因為：

1. 它們綁在時間軸上（有 `start` / `duration`），語意是「講到這句時淡入」，不是「這一頁上有這個東西」；
2. **它們一個都進不了匯出檔**——匯出只讀 JPG。

第 2 點是一個獨立於本設計的既有缺陷，本文件不修它，但把它記在 §8。

---

## 2. 決策：顯式轉成 React 頁，轉回來時融合進圖片

### 2.1 加東西 ＝ 這一頁成為 React 頁（顯式）

在圖片頁上按「加入文字／圖片」時，這一頁**轉成 React 頁**，加的東西以一個帶 `data-ms-id` 的絕對定位元素進入 `.slide.jsx`——與抽取背景文字產生的元素完全相同的形狀（[`reactSlideEdit.ts:53`](../backend/src/services/reactSlideEdit.ts#L53) 的 `insertText`）。從它存在的第一刻起，它就能用元素面板編輯、能刪除、進得了版本歷史，而且**烘焙會把它寫回 JPG**，所以匯出看得到。

轉換**不是自動的**。使用者會看到一個確認對話框，因為轉換有三個他必須知道的後果（§3）。這是本設計與「自動轉換」唯一但決定性的差別：自動轉換的三個後果都是**畫面上看起來正常、實際結果錯了**。

### 2.2 轉回圖片頁 ＝ fusion

轉回一般投影片時，加上去的文字與圖片**直接成為圖片的一部分**——這正是把東西燒進 JPG 的做法，只是它不需要另一條程式路徑：[`react-slide.ts:501`](../backend/src/routes/pdfs/react-slide.ts#L501) 的 `DELETE` 已經是「先烘焙、再還原型別」。

於是同一組機制給出兩種產物，由使用者選擇：

| 使用者要的 | 停在哪個型別 | 結果 |
| --- | --- | --- |
| 加的東西之後還要改 | 留在 React 頁 | 每個元素可編輯、有版本歷史；匯出靠烘焙 |
| 加的東西定稿了 | 轉回圖片頁（fusion） | 文字/圖形成為像素；恢復原本的圖片頁能力（局部重繪、GSAP 動畫） |

fusion 之後 `.slide.jsx` 仍留在磁碟上，所以再轉回 React 頁還原得回可編輯狀態——只是那時背景會是已經含有這些文字的烘焙結果（見 §3.3 的取捨）。

---

## 3. 轉換必須誠實的三件事

自動轉換之所以被否決，是因為這三件事在轉換當下**沒有任何地方會說**。做成顯式轉換的意義就在於把它們說出來。

### 3.1 這一頁的 GSAP 動畫會停止播放

React 與 `gsap-image` 互斥。動畫規格檔不會被刪——[`revertReactPageToSlide()`](../backend/src/routes/pdfs/react-slide.ts#L186) 是從 `animation_spec_path` 還原型別的，所以轉回來動畫就回來了——但在 React 頁期間它就是不播。

對話框因此要說：**這一頁有 N 個動畫效果，轉成 React 頁後不會播放；轉回圖片頁即可恢復。**

### 3.2 烘焙不可用時，**不允許進入 React 模式**

烘焙需要系統 Chrome（[`reactSlideBake.ts:280`](../backend/src/services/reactSlideBake.ts#L280)）。沒有時它擲 `BakeUnavailableError`，而存檔路徑**刻意**只記 log 不失敗——那對存檔是對的取捨（不該讓一次存檔因為截圖失敗而失敗）。

但一旦頁面的畫面來自程式碼，烘焙就不是加分項而是**正確性的前提**：沒有它，這一頁匯出到 PDF／PPTX／影片／縮圖的永遠是轉換前的舊圖，而畫面上一切正常。這種錯誤不該用一行警告交給使用者承擔。

**因此在烘焙不可用的環境，轉換成 React 頁一律被拒（424 `BAKE_UNAVAILABLE`）**，訊息說明修法是操作者的（安裝 Chrome 或設定 `CHROME_PATH`）而不是使用者的。前端的頁面類別對話框也把 React 選項停用並顯示同一個理由。

**只擋「進入」，不擋既有的 React 頁**：已經是 React 頁的存檔、編輯與 fusion 照舊可用。把它們一起鎖死只會讓一個環境問題變成「使用者既有的頁面全部不能編輯」，而那些頁面本來就已經在那裡了。

判斷這件事需要一個**不啟動瀏覽器**的可用性檢查（§5.1）——為了畫一個對話框而每次去 launch 一個 Chrome 是不成比例的。

### 3.3 fusion 失敗時不能默默把東西丟掉

這是**本設計修的最嚴重的一個既有缺陷**。目前的 `DELETE` 在烘焙失敗時只記一行 warn，然後照樣把頁面轉回圖片頁：

```ts
try { await bakeReactSlidePage(id, n); } catch (err) { request.log.warn(…); }
const { renderType, now } = await revertReactPageToSlide(id, n, row);
```

在「fusion」這個語意下這是錯的。使用者按的是「把我加的東西融進圖片」，而失敗的結果是**頁面顯示轉換前的舊圖，加的東西全部從畫面上消失**（程式碼還在磁碟上，但沒有任何地方會這樣告訴他）。

改為：**烘焙失敗就不轉換**。頁面維持 React 頁——東西還在畫面上——並回 424 / 502 讓前端問使用者要哪一種：

| 選項 | 行為 |
| --- | --- |
| **重試** | 再跑一次 `DELETE`。烘焙失敗常常是一次性的（瀏覽器啟動逾時、暫時的資源不足） |
| **放棄這些更改，仍轉回圖片頁** | `DELETE` 帶 `force: true`：照舊轉換，頁面顯示轉換前的舊圖。`.slide.jsx` 仍留在磁碟上，所以這是「畫面上放棄」而不是「刪掉」 |
| **留在 React 模式** | 取消，什麼都不做 |

三個選項都要在對話框上明說後果，尤其第二個——它是唯一會讓畫面上的東西消失的那個，而使用者必須是主動選它，不是被動遇到它。

轉換順序不變：烘焙必須在還原之前，因為烘焙需要該頁仍是 React 頁。

### 3.4 順帶：轉成 React 頁不該把整頁壓暗

現行轉換會把原 JPG 複製成背景並疊一層 `overlayOpacity: 0.35` 的遮罩（[`react-slide-design.md`](react-slide-design.md) §10.1）。那個預設是為「要在上面寫整頁新文字」設計的；只想加一行註記的人得到的是一頁被壓暗的投影片。

**由這條路徑進來的轉換，遮罩預設為 0。** 需要壓暗的人在 React 分頁調得到；而「加一個註記卻讓整頁變色」是使用者不會預期、也不會知道怎麼還原的。

---

## 4. 加上去的東西長什麼樣

### 4.1 文字：沿用既有的 `insertText`

已存在（[`reactSlideEdit.ts:539`](../backend/src/services/reactSlideEdit.ts#L539) 的 `textElementJsx()`），產生：

```jsx
<div data-ms-id="a1b2c3d4" style={{ position: "absolute", left: "10%", top: "80%", … }}>註記文字</div>
```

本設計只是讓它多一個入口：不再只由「從背景圖抽出文字」觸發，使用者可以直接加一段。

### 4.2 圖片：新增 `insertImage` ＋ 頁面素材

圖片不能像文字一樣直接寫進程式碼——程式碼上限 60000 字元，一張圖 base64 之後就爆了。因此圖片是**檔案**，程式碼裡放的是引用。

**檔案佈局**（沿用以 `page_uid` 命名的既有慣例）：

```text
storage/<pdfId>/pages/
└── <page_uid>.asset-<id>.<ext>     # id = nanoid(8)；ext 限 png/jpg/webp/gif，其餘（含 svg）一律拒絕
```

**程式碼裡的引用形式**：

```jsx
<img data-ms-id="e5f6g7h8" src={MS_ASSET("asset-a1b2c3d4.png")} style={{ position: "absolute", … }} />
```

`MS_ASSET` 是沙箱與烘焙各自提供的全域函式，這是本節唯一需要解釋的設計決策：

| 做法 | 評估 |
| --- | --- |
| 寫死絕對 URL | 換部署位址、換 host、匯出後匯入到另一台機器，程式碼裡的網址就全數失效 |
| 寫 `data:` URL | 超過程式碼長度上限，且每次編輯程式碼都要搬運整張圖 |
| 自訂 scheme（`src="ms-asset:xxx"`）| 瀏覽器會先嘗試載入這個無效 URL 再被 runtime 改寫，中間有一幀破圖 |
| **全域函式 `MS_ASSET(name)`（採用）** | 程式碼裡存的是穩定的檔名、與部署位址無關；沙箱與烘焙各自把它解析成自己能渲染的東西，沒有字串替換也沒有破圖 |

生成的程式碼已經倚賴全域 `React`（設計文件 §7.1），再加一個全域函式是同一個模式，不是新的例外。

**兩邊都是內嵌的 `data:` URL**，`MS_ASSET(name)` 就是在一張 `{ 檔名: data-url }` 的表上查。

- **沙箱**：`GET …/react-slide/assets` 由**父視窗**（帶著 session）取回整張表，寫進沙箱文件。不能讓沙箱自己去載那個端點——它是 opaque origin，發出的請求是 cross-site、不帶 session cookie，圖片會 403。這正是背景圖當初被移到沙箱外由父視窗繪製的原因（[`reactSlide.test.ts`](../frontend/src/lib/reactSlide.test.ts) 的 "the background lives outside the sandbox" 把它記了下來），本設計差點又踩一次。
- **烘焙**：同樣內嵌，理由不同——`setContent` 沒有 origin 可以解析相對網址，烘焙也沒有 session 去打一個需要驗證的端點（[`reactSlideBake.ts:89`](../backend/src/services/reactSlideBake.ts#L89)）。

代價是素材的位元組會隨頁面資料傳兩次以上（表一次、烘焙一次），因此才有 8 MB 上限——投影片上的圖是 logo 或示意圖，不是相簿。

**烘焙必須等圖片載入完成才截圖**。現行的 `settle()` 等的是「元件產出了 DOM」，而 `<img>` 產出 DOM 與畫出像素是兩件事——即使是 `data:` URL 也要解碼。少了這一步，加上去的圖片會**時有時無地**從匯出檔裡消失，而那正是本設計最想避免的失效形態。因此在 `__msSlideReady` 之前多等一個條件：所有 `<img>` 的 `complete` 為真（`load` 或 `error` 都算數，並有逾時上限——一張載不出來的圖不該讓整份簡報匯不出來）。

### 4.3 連結：讓文字與圖片可以點擊

任何元素（不只新加的）都能被指定一個連結，點擊時在新分頁開啟。

**技術限制先講**：沙箱是 `sandbox="allow-scripts"` 的 opaque origin，**沒有** `allow-popups` 也沒有 `allow-top-navigation`。因此 iframe 裡的 `<a href>` 點下去會被瀏覽器**直接擋掉**，什麼都不會發生。這排除了「包一層 `<a>` 就好」的做法。

| 做法 | 評估 |
| --- | --- |
| 包成 `<a href="…">` | 被沙箱擋住，完全不會動作 |
| 放寬沙箱（加 `allow-popups` ＋ `allow-popups-to-escape-sandbox`） | 為了一個連結去放寬整個隔離邊界，而那個邊界是這個功能唯一的安全依據（設計文件 §8） |
| **元素標 `data-ms-href`，點擊時 postMessage 給父視窗開啟（採用）** | 沙箱不動；父視窗拿到的是一個字串，能在開啟前自己驗證一次，而不是信任沙箱裡的東西 |

**在程式碼裡的形式**——一個屬性，不是包一層標籤：

```jsx
<div data-ms-id="a1b2c3d4" data-ms-href="https://example.com" style={{ … }}>看說明</div>
```

包一層 `<a>` 會改變元素的結構（既有元素的 `data-ms-id` 位置、版面流、`<a>` 自帶的顏色與底線），而加一個屬性不會動到任何已經排好的東西。

**執行時**：沙箱 runtime 對帶 `data-ms-href` 的元素加上 `cursor: pointer` 與一個焦點外框，點擊時送 `{ type: 'ms-slide-link', href }`；父視窗（`ReactSlideFrame`）驗證只有 `http:` / `https:` 才 `window.open(href, '_blank', 'noopener,noreferrer')`。**父視窗一定要自己驗一次**——沙箱裡的檢查防的是意外，父視窗的檢查防的才是惡意，因為程式碼是可以手改的。

**點選模式開啟時連結不觸發**：編輯的時候點元素是為了選它，不是為了離開這一頁。

**烘焙不受影響**：`data-ms-href` 不參與渲染。圖片裡的連結本來就不可點，這是圖片頁的固有限制，不是這裡的缺陷。

#### 連結要能被點到，得先拿回點擊

沙箱的 iframe 平常是 `pointer-events: none`（[`ReactSlideFrame.tsx`](../frontend/src/components/slide/ReactSlideFrame.tsx)），而手寫畫布那一層覆蓋整個舞台——**兩者都會讓連結永遠收不到點擊**。因此新增 `interactive`：由呼叫端在「沒有別人要這個點擊」時開啟（非點選模式、非手寫、非區域選取），且**該頁的程式碼真的含 `data-ms-href`** 才開，否則一般 React 頁會白白把點擊從手寫畫布手上搶走。

### 4.4 移動元素

在點選模式下，直接在投影片上**拖曳**元素即可移動；方向鍵微調 1px、Shift＋方向鍵 10px。

**座標不需要換算**：iframe 本身固定 1920×1080，縮放是套在元素上的 `transform`，所以沙箱內的指標座標**就是**畫布座標，一個指標位移就是一個畫布位移。

**只有絕對定位的元素能拖**。其餘元素的位置由版面排列決定，寫 `left`/`top` 上去要嘛沒有效果（`static`）、要嘛相對於版面給的位置偏移（`relative`）——兩種結果都會讀成「拖曳壞了」。這些元素改為在面板上說明原因，並提供一顆**「改成可自由擺放」**：把它的當前矩形寫成 `position: absolute` 加 `left`/`top`，所以按下去的瞬間畫面不會跳——使用者要的是「能移動它」，不是「移動它」。

**單位跟著元素走**。拖曳前先讀該元素 inline 的 `left`/`top` 用的是 `px` 還是 `%`，算完再換算回同一種。否則一份用百分比寫的投影片，只要有人微調過一次就會變成像素——那是使用者沒有要求、也不會預期的改寫。

**位移超過 3px 才算拖曳**，否則仍是點選。少了這個門檻，每一次「點一下選取它」都會順手把元素挪動一兩個像素。

移動的結果和面板上的其他調整走同一條路：先進未儲存的 `overrides` 讓畫面即時反映，按「儲存畫面調整」才寫進 JSX。所以拖過頭直接再拖回來就好，不會每動一次就重編譯一次程式碼。

> **踩到的坑**：前端的可編輯 CSS 白名單少了後端 2026-08-15 補上的 `position`／`left`／`top`／`right`／`bottom`／`white-space`／`overflow`。兩份清單漂移的後果是**無聲的**——前端 `normalizeStyleOverrides` 會在送出前把 `left`/`top` 丟掉，於是拖曳看起來完全沒有作用。已補齊，並加了一個直接讀前端原始碼比對兩份清單的測試，因為這種漂移兩個方向都不會有任何東西壞掉。

---

## 5. API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/pdfs/:id/pages/:n/overlay-preflight` | 轉換前的事實：`{ render_type, animation_effect_count, bake_available }`（§5.1） |
| `POST` | `/api/pdfs/:id/pages/:n/react-slide/assets` | multipart `file`：存成頁面素材，回 `{ name, bytes }` |
| `GET` | `/api/pdfs/:id/pages/:n/react-slide/assets` | 這一頁的素材，`{ 檔名: data-url }`（父視窗取回後寫進沙箱） |
| `PATCH` | `/api/pdfs/:id/pages/:n/react-slide/edits` | 既有端點，`edits` 新增 `{ kind: 'insertImage', asset, style }` 與 `{ kind: 'link', id, href }`（空 `href` 移除連結） |
| `DELETE` | `/api/pdfs/:id/pages/:n/react-slide` | 既有端點，新增 body `{ force?: boolean }`（§3.3） |

轉成 React 頁本身沿用既有的 `PUT …/react-slide`，不新增端點——這條路徑要的不是新的轉換方式，是轉換前後的誠實。該端點在**頁面尚未是 React 頁**時新增一道 `bake_available` 檢查，不可用就回 424（§3.2）；已經是 React 頁的存檔不受影響。

### 5.1 `bake_available`：不啟動瀏覽器的可用性檢查

`renderSlideToJpeg()` 目前把「有沒有 playwright-core」與「有沒有 Chrome」都做在 launch 當下。Preflight 不能為了一行警告去 launch 一個瀏覽器，因此抽出一個純檢查：

1. 測試環境（`MAKESLIDE_TEST=1` 且未設 `MAKESLIDE_TEST_ALLOW_BROWSER`）→ 不可用；
2. `import('playwright-core')` 失敗 → 不可用；
3. `CHROME_PATH` 有設 → 檢查該檔案存在；否則查 `chromium.executablePath({ channel: 'chrome' })` 能否解析出一個存在的檔案。

結果快取（模組層級，含結果與時間戳），因為它在一次工作階段裡不會變，而每次開對話框都去摸檔案系統是沒有意義的。這個檢查是**盡力而為**：它說「可用」而實際 launch 仍可能失敗（§3.3 的 fusion 保護正是為此存在），但它說「不可用」時一定是對的——這個方向的錯誤才會害到人。

---

## 6. 前端

- **入口**：投影片工具列新增「➕ 加入文字／圖片」。圖片頁上按下去先開確認對話框（§3 的警告），確認後轉換並插入；已經是 React 頁時直接插入，不問。烘焙不可用時這個入口停用並說明原因（§3.2）。
- **對話框**：`AddOverlayDialog`——文字/圖片二選一、內容輸入（文字或選檔）、可選的連結網址、位置預設放在畫面下方偏左的空白處，以及 §3 的警告區塊。
- **元素面板**：新增「連結」欄位（網址輸入 ＋ 清除），對任何選到的元素都有效，不限於新加的；以及移動的說明——可拖曳的元素顯示操作提示，由版面排列的顯示原因與「改成可自由擺放」。
- **fusion**：`PageTypeDialog` 選「圖片投影片」時的說明改寫成 fusion 的語意（加上去的文字與圖形會成為圖片的一部分）；烘焙失敗時彈出 §3.3 的三選一，而不是靜默完成。
- Notebook 頁不提供這個入口（它的畫面不是圖片也不是程式碼）。

---

## 7. 安全性

加上去的東西與既有的元素編輯走**同一組**檢查，沒有新的例外：

| 項目 | 對策 |
| --- | --- |
| 文字 | JSX 文字轉義（既有 `escapeJsxText`），永不當 HTML 解析 |
| 樣式 | CSS 屬性白名單 ＋ `isSafeCssValue()` ＋ JS 字串字面量轉義（既有 `textElementJsx` 就是這樣做的） |
| 素材檔名 | `asset-[A-Za-z0-9_-]{1,32}\.(png\|jpe?g\|webp\|gif)`，不符一律 404；一律經 `safeJoinPdfPath` |
| 上傳的檔案 | 副檔名白名單 ＋ 以 `sharp` 實際解碼驗證是圖片（副檔名不是證據）＋ 大小上限 8 MB；**不接受 SVG**——SVG 是可以帶腳本的文件，而它會被沙箱以 `<img>` 載入 |
| `MS_ASSET` 的參數 | 寫進程式碼時同樣經檔名白名單與字串字面量轉義；沙箱/烘焙端解析不到的名稱回傳空字串而不是拼出一個任意 URL |
| 素材的存取 | `canReadPdf` / share token，與背景圖相同 |
| 連結的網址 | 只接受 `http:` / `https:`（因此 `javascript:`、`data:`、`file:` 都進不來），長度上限 2000，寫進 JSX 屬性時轉義；**父視窗在開啟前再驗一次**，因為程式碼可以手改，沙箱裡的檢查擋不住有意為之的東西 |
| 連結開新分頁 | `window.open(…, '_blank', 'noopener,noreferrer')`——`noopener` 讓目標頁面拿不到 `window.opener`，否則它能導航開啟它的那個分頁 |

`findUnsafeReactSlideCode()` 的 deny list 不含 `MS_ASSET`，因此不需要為它開例外。

---

## 8. 不在這一版

1. **`text-callout` / `overlay-image` 進不了匯出**——既有缺陷，與本設計獨立，應另案處理（它影響的是已經在用動畫的頁面）。
2. 一次對多頁加同一個東西（浮水印／logo 批次套用）。這是 fusion 的自然延伸，但批次的正確做法是直接對 JPG 合成，不必經過 React 頁。
3. 素材的跨頁共用與素材庫管理（目前每頁各自持有）。
4. 匯出/匯入 `.mslide` 時素材檔的搬運——素材落在 `pages/` 底下，隨 `pdfDir()` 一起打包，因此可用；但沒有為它寫專屬測試。

---

## 9. 測試計畫

後端：

- `applySlideEdits()` 的 `insertImage`：產生的 JSX 帶 `data-ms-id`、`MS_ASSET("…")`、白名單過的樣式，且能重新編譯；
- 非法素材名、非白名單樣式屬性、危險樣式值一律進 `skipped` 而不是靜默丟掉；
- 素材上傳：非圖片內容（副檔名對但內容不是圖）被拒、超過大小上限被拒、SVG 被拒；
- 素材讀取：路徑穿越（`../`）、不符命名規則的名稱回 404；
- `bakeAvailability()`：三種不可用情況各自回報，且結果被快取；
- **進入 React 頁的守門**：烘焙不可用時 `PUT …/react-slide` 對圖片頁回 424 且不改 `render_type`；對**已經是** React 頁的存檔照舊成功（否則環境問題會變成既有頁面全部不能編輯）；
- **fusion 保護**：烘焙失敗時 `DELETE` 不改 `render_type`、回錯誤碼；帶 `force: true` 時照舊轉換（用可控的烘焙失敗注入來測，不啟動真的瀏覽器）；
- preflight：有動畫的頁面回報效果數量、React 頁與圖片頁各自的 `render_type`；
- `link` 編輯：`https://` 寫成屬性、空字串移除屬性、`javascript:` 與 `data:` 進 `skipped`。

前端：

- 沙箱文件注入的 `MS_ASSET` 對已知素材回傳該頁的素材 URL、對未知名稱回傳空字串；
- 烘焙文件的 `MS_ASSET` 回傳 `data:` URL（與沙箱用同一組斷言，避免兩邊漂移）；
- 沙箱對 `data-ms-href` 元素送出 `ms-slide-link`，且點選模式開啟時不送；
- 父視窗只對 `http`/`https` 開新分頁，其他 scheme 一律忽略；
- 拖曳：只有 absolute/fixed 會動、單位維持原本的 `px`/`%`、3px 門檻、方向鍵 1px 與 Shift 10px；
- **前後端的可編輯 CSS 白名單一致**（直接讀前端原始碼比對）——這兩份清單漂移時兩個方向都不會有東西壞掉，只是調整會安靜地消失；
- i18n 平衡（既有 `i18n.test.ts` 自動涵蓋）。
