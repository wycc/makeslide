# Jupyter 整合：Kubeflow / Kubernetes 後台部署方案

本文件定義 MakeSlide notebook 功能在 **Kubeflow 環境**中的部署與整合方式，是
[jupyter-integration-plan.md](jupyter-integration-plan.md) 的部署層延伸。前端與 nbformat
資料模型完全沿用；改變的只有「kernel 在哪裡執行、如何連上它」。

## 1. 動機：單一共用 Jupyter server 的限制

現有兩種連線模式（同源 proxy `JUPYTER_PROXY_TARGET`、顯式 URL+token）都假設**一顆**
Jupyter server。多使用者部署時這個假設會破：

1. **檔案系統共用**：所有 kernel 以同一個 OS user 跑在同一個家目錄，使用者之間的檔案
   互相可讀可寫可刪——是安全問題，不只是衝突問題。
2. **kernel 命名空間共用**：backend proxy 只驗證「已登入」（jupyterProxy.ts），不做
   per-user 範圍限制；任何登入者可列出、甚至 DELETE 他人的 kernel。
3. **資源無隔離**：無 per-user 配額，一人跑 training 全站卡死。
4. **長時間任務無依託**：kernel 生命週期綁在瀏覽器的執行協調上（見原計畫 §1.3），
   關瀏覽器後 kernel 變孤兒、結果遺失、無法 reattach。

原計畫 §4 的安全模型本來就假設「kernel 在使用者自己的 Jupyter 情境執行（Hub
single-user server 天然如此）」；本方案把這個假設在 Kubeflow 上具體化。

## 2. 目標架構

**假設：整個 MakeSlide 部署在 Kubeflow 叢集內**，與 Kubeflow Notebooks 同在一個
Istio gateway 之後（同源）。

```
瀏覽器 ── (Kubeflow session cookie, 同源) ──▶ Istio Gateway
   │                                             │
   │  MakeSlide UI/API                           ├─▶ MakeSlide Service（後端）
   │  /api/jupyter/connection ◀──────────────────┘        │ 讀 Notebook CR（k8s API）
   │                                                      ▼
   └─ @jupyterlab/services ──▶ /notebook/<namespace>/<name>/ ──▶ 使用者的 Notebook Pod
                                                              （完整 JupyterLab server）
```

核心決策：**不自建 spawner，直接使用 Kubeflow Notebooks**。每個使用者在自己的
profile namespace 裡本來就有（或可自行建立）Notebook CR（`notebooks.kubeflow.org/v1`），
其 Pod 內就是一個完整的 jupyter-server（JupyterLab image），由 Istio 以
`/notebook/<namespace>/<name>/` 對外提供、以 Kubeflow 的 oidc/authservice 認證。
MakeSlide 只需要回答一個問題：「這個使用者要用哪一個 notebook 當 kernel 後端？」

隔離即免費取得：

- **檔案系統**：notebook Pod 掛使用者自己的 workspace PVC——檔案私有、跨重啟持久，
  訓練 log/checkpoint 有地方放。
- **資源**：Notebook CR 的 requests/limits（CPU/RAM/GPU）就是配額。
- **kernel 命名空間**：`/api/kernels` 只看得到自己 Pod 裡的 kernel。
- **長任務**：kernel 活在使用者 Pod 中，與瀏覽器解耦；配合 §5 的 session reattach
  可重連取回。

## 3. 後端變更

### 3.1 設定（config.ts）

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `JUPYTER_MODE` | `proxy` | `proxy`（現行）/ `url`（現行顯式 URL）/ `kubeflow`（本方案） |
| `KUBEFLOW_USERID_HEADER` | `kubeflow-userid` | Istio/authservice 注入的使用者身分 header |
| `KUBEFLOW_DEFAULT_NAMESPACE_TEMPLATE` | `{user}` | 由使用者 email/帳號推導 profile namespace 的樣板 |

`kubeflow` 模式下不需要 `JUPYTER_PROXY_TARGET`／`JUPYTER_TOKEN`：認證交給叢集的
authservice cookie，MakeSlide 不經手任何 Jupyter token。

### 3.2 `GET /api/jupyter/connection`（既有端點，新模式分支）

kubeflow 模式的行為：

1. 由 session 對應出 Kubeflow 使用者與其 namespace（MakeSlide 帳號 email ↔
   Kubeflow profile owner；部署於 Istio 之後時可直接信任 `kubeflow-userid` header）。
2. 讀取該使用者**指定的 notebook**（§3.4 的設定；未指定→回 428/明確錯誤碼，
   前端引導到選擇 UI）。
3. 檢查 Notebook CR 狀態：
   - Running → 回 `{ baseUrl: '', wsUrl: '', nbPrefix: '/notebook/<ns>/<name>', token: '' }`
     ——正是現行「同源 cookie 模式」的形狀，**前端一行都不用改**
     （`resolveJupyterUrls` 已支援 origin+nbPrefix 組合）。
   - Stopped（`kubeflow-resource-stopped` annotation）→ 移除 annotation 觸發啟動，
     回 `202 { starting: true }`；前端輪詢至 Running。
4. 永遠只回 session 使用者**自己 namespace** 的 notebook——伺服器端強制，不信前端參數。

### 3.3 K8s API 存取與 RBAC

MakeSlide 後端的 ServiceAccount 需要：

```yaml
rules:
  - apiGroups: ["kubeflow.org"]
    resources: ["notebooks"]
    verbs: ["get", "list", "patch"]   # patch 僅用於移除 stopped annotation（喚醒）
```

以 ClusterRole 綁定（或逐 profile namespace 綁 RoleBinding，更小權限面）。
不需要 pod/exec 等高風險權限；MakeSlide 從不直接碰 Pod。

### 3.4 使用者的 notebook 指定

新增 per-user 設定（`user_settings` 表或 accounts 欄位）：`jupyter_notebook`
（`<namespace>/<name>`）。配套端點：

- `GET /api/jupyter/notebooks`：列出 session 使用者 namespace 的 Notebook CR
  （名稱、映像、狀態、資源），供設定頁下拉選擇。
- `PUT /api/user/settings/jupyter-notebook`：儲存指定（伺服器端驗證該 CR 屬於本人
  namespace）。

## 4. 認證與安全

- **瀏覽器 → notebook Pod**：同源、走既有 Kubeflow session cookie；jupyter-server
  的 XSRF token 由 `@jupyterlab/services` 自動處理。MakeSlide 不簽發、不轉發、
  不儲存任何 Jupyter credential。
- **share-token 匿名觀看者**：無 Kubeflow session → 連不上任何 notebook，行為與現行
  一致（唯讀觀看，無 kernel）。
- **跨使用者存取**：由 Istio AuthorizationPolicy 保證（Kubeflow 原生行為：只有
  namespace owner/contributor 能到達 `/notebook/<ns>/<name>/`），MakeSlide 的
  connection 端點再加一層「只回自己的 notebook」。雙重防線。
- **執行寫回**：不變——寫回 `.ipynb` 走 MakeSlide 自己的 PUT 端點與 `canEditPdf`
  檢查，與 kernel 後端無關。

## 5. 長時間任務（training）的配套

Kubeflow 模式解鎖了原架構做不到的事，但需要兩個前端/連線層工作（獨立階段）：

1. **Session reattach**：`useJupyterKernel` 改用 `SessionManager`，以
   `makeslide/<pdfId>/<pageNumber>` 為 session path；連線時先 `findByPath` 接回
   既有 kernel，沒有才 `startNew`。瀏覽器重開後可回到執行中的 kernel；
   jupyter-server 的 `buffer_offline_messages`（預設開）會補送斷線期間的輸出。
2. **孤兒治理**：因為 kernel 都在使用者自己的 Pod，孤兒的影響半徑縮小為「自己的
   資源」；Notebook CR 的 culling（idle 停 Pod）是最終兜底。

訓練級任務的建議使用模式仍然是：訓練程式自行寫 log/checkpoint 到 workspace PVC，
notebook cell 作為啟動與監看介面——這在 per-user PVC 下才真正安全可行。

## 6. 與現行模式的關係

三種模式並存，`JUPYTER_MODE` 選擇；`proxy`／`url` 維持現狀不動：

| | proxy（現行） | url（現行） | kubeflow（本方案） |
| --- | --- | --- | --- |
| 適用 | 單人/桌面 | dev | 多使用者正式環境 |
| 隔離 | 無 | 無 | namespace/Pod/PVC |
| 認證 | MakeSlide session | token | Kubeflow cookie |
| 長任務 | 不適合 | 不適合 | 可（配合 §5） |

## 7. 分階段實作

1. **7a**：config `JUPYTER_MODE` ＋ kubeflow 模式的 connection 端點（含 CR 讀取、
   身分對應、只回本人 notebook 的測試）。
2. **7b**：notebook 列表/指定端點 ＋ 設定頁 UI（i18n）。
3. **7c**：stopped notebook 的喚醒流程（patch annotation、starting 輪詢、前端狀態）。
4. **7d**：session reattach（§5.1，對三種模式皆有益）。
5. **7e**：部署文件——RBAC manifest、Istio VirtualService 範例、`proxy` 模式
   「僅限單人部署」的明確警語。

每階段獨立分支、獨立驗證（7a/7b/7c 可用 fake k8s API 測；7d 沿用既有
jupyterConnection 純函式測試模式）。
