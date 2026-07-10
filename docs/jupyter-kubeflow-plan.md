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

答案由 **runtime 命名慣例**決定（§3.4）：使用者自行建立名為
`makeslide-jupyter-<runtime>` 的 notebook（如 `makeslide-jupyter-cpu`、
`makeslide-jupyter-gpu-a100`），MakeSlide 掃描這個前綴、把 `<runtime>` 尾碼當作
**runtime 型別**顯示在 UI 供使用者選擇；一個 runtime 都沒有時，系統自動生成一個
CPU 預設 notebook（§3.5）。GPU 與否、哪種 GPU、多少資源，完全由使用者在 Kubeflow
Notebook UI 建立 notebook 時決定——MakeSlide 不重造資源選擇介面，只負責挑選。

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
| `KUBEFLOW_NOTEBOOK_PREFIX` | `makeslide-jupyter-` | runtime 探索的 notebook 名稱前綴；尾碼即 runtime 型別（§3.4） |
| `KUBEFLOW_DEFAULT_RUNTIME_IMAGE` | （叢集預設 JupyterLab image） | 自動生成 `makeslide-jupyter-cpu` 時使用的 image（§3.5） |
| `KUBEFLOW_DEFAULT_RUNTIME_RESOURCES` | `cpu=1,memory=2Gi` | 自動生成的 CPU notebook 的 requests/limits（§3.5） |

`kubeflow` 模式下不需要 `JUPYTER_PROXY_TARGET`／`JUPYTER_TOKEN`：認證交給叢集的
authservice cookie，MakeSlide 不經手任何 Jupyter token。

### 3.2 `GET /api/jupyter/connection`（既有端點，新模式分支）

kubeflow 模式的行為（接受選用參數 `?runtime=<runtime>`）：

1. 由 session 對應出 Kubeflow 使用者與其 namespace（MakeSlide 帳號 email ↔
   Kubeflow profile owner；部署於 Istio 之後時可直接信任 `kubeflow-userid` header）。
2. 依 runtime 解析 notebook 名稱：`<KUBEFLOW_NOTEBOOK_PREFIX><runtime>`
   （如 `runtime=gpu-a100` → `makeslide-jupyter-gpu-a100`）。未帶 `runtime` 時用
   使用者上次選擇的 runtime（§3.4）；一個 `makeslide-jupyter-*` notebook 都不存在
   時走 §3.5 自動生成 CPU 預設。
3. 檢查 Notebook CR 狀態：
   - Running → 回 `{ baseUrl: '', wsUrl: '', nbPrefix: '/notebook/<ns>/<name>', token: '' }`
     ——正是現行「同源 cookie 模式」的形狀，**前端一行都不用改**
     （`resolveJupyterUrls` 已支援 origin+nbPrefix 組合）。
   - Stopped（`kubeflow-resource-stopped` annotation）→ 移除 annotation 觸發啟動，
     回 `202 { starting: true }`；前端輪詢至 Running。
4. 永遠只回 session 使用者**自己 namespace** 的 notebook——伺服器端強制，不信前端參數；
   `runtime` 只允許 DNS-label 安全字元（防止拼出跨 namespace/任意名稱）。

### 3.3 K8s API 存取與 RBAC

MakeSlide 後端的 ServiceAccount 需要：

```yaml
rules:
  - apiGroups: ["kubeflow.org"]
    resources: ["notebooks"]
    verbs: ["get", "list", "patch", "create"]
    # patch：移除 stopped annotation（喚醒）；create：僅用於 §3.5 自動生成 CPU 預設
```

以 ClusterRole 綁定（或逐 profile namespace 綁 RoleBinding，更小權限面）。
不需要 pod/exec 等高風險權限；MakeSlide 從不直接碰 Pod。

### 3.4 GPU runtime 型別：以 notebook 命名慣例探索與選擇

**一個 notebook＝一種 runtime。** 使用者在 Kubeflow Notebook UI 自行建立名為
`makeslide-jupyter-<runtime>` 的 notebook，並在建立時決定它的資源形態——CPU-only、
哪一種 GPU（`nvidia.com/gpu` limit、node selector/toleration）、多少記憶體。
MakeSlide 端：

- **探索**：`GET /api/jupyter/runtimes` 列出 session 使用者 namespace 中所有
  `makeslide-jupyter-*` 的 Notebook CR，回傳
  `[{ runtime, status, gpu, image }]`——`runtime` 即去掉前綴的尾碼
  （`makeslide-jupyter-gpu-a100` → `gpu-a100`），`gpu` 由 CR 的 resource limits
  萃取（有 `nvidia.com/gpu` 等 device plugin resource 即標示），供 UI 呈現。
- **選擇 UI**：notebook 頁工具列顯示 runtime 下拉選單（顯示 `<runtime>` 尾碼，
  如 `cpu`／`gpu-a100`），與既有 kernel 環境選單（kernelspec picker）並列——
  **runtime 選 Pod、kernelspec 選 Pod 內的 Conda 環境**，兩層各司其職。
  選擇以 per-user 設定持久化（`user_settings.jupyter_runtime`），connection 端點
  未帶 `runtime` 參數時以此為準。
- **切換語意**：換 runtime＝換 notebook Pod＝全新的 kernel（比照現行「切換 kernel
  環境會啟動新 kernel」的行為，`useJupyterKernel` 的 registry key 追加 runtime 維度）。
- 命名不符前綴的 notebook 一律忽略——使用者其他用途的 notebook 不會出現在選單、
  也不會被 MakeSlide 碰到。

### 3.5 零設定預設：自動生成 `makeslide-jupyter-cpu`

使用者從未建立任何 `makeslide-jupyter-*` notebook 時（首次使用、不需要 GPU 的
大多數人），連線流程不中斷：

1. connection 端點（或 runtimes 列表為空時的首次執行）在使用者 namespace
   `create` 一個名為 `makeslide-jupyter-cpu` 的 Notebook CR：image 取
   `KUBEFLOW_DEFAULT_RUNTIME_IMAGE`、資源取 `KUBEFLOW_DEFAULT_RUNTIME_RESOURCES`
   （CPU-only、不帶任何 GPU resource）、workspace volume 沿用 Kubeflow 該
   namespace 的預設 PVC 慣例。
2. 建立後即進入 §3.2 的 starting 流程（回 `202 { starting: true }`，前端輪詢）。
3. UI 上它就是 runtime 選單裡的 `cpu`；使用者之後想要 GPU，再自行建立
   `makeslide-jupyter-<runtime>` notebook 即可，無須任何 MakeSlide 設定。
4. 冪等與競態：create 前先 get；`AlreadyExists` 視為成功（兩個分頁同時首次連線）。
   自動生成**只會**發生在「一個 runtime 都沒有」時——已有任何 `makeslide-jupyter-*`
   notebook 就永遠不再自動建立，避免替使用者製造多餘資源。

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

1. **7a**（已完成）：config `JUPYTER_MODE`＋runtime 相關設定 ＋ kubeflow 模式的
   connection 端點（含 runtime→notebook 名稱解析、CR 讀取、身分對應、只回本人
   notebook、runtime 參數字元白名單的測試）。分支 `feat/kubeflow-connection-endpoint`。
2. **7b**（已完成）：`GET /api/jupyter/runtimes` 探索端點（前綴過濾、尾碼萃取、
   GPU 標示）＋ notebook 頁工具列 runtime 選單（與 kernelspec 選單並列）。
   實作時的一個刻意偏離：選擇改以前端 `localStorage` 持久化（每次連線請求直接帶
   `?runtime=`），未使用本節原提的 `user_settings.jupyter_runtime` DB 欄位——
   伺服器端不需要另外記一份，省了一個不必要的持久化層。分支
   `feat/kubeflow-runtimes-endpoint`。
3. **7c**（已完成）：stopped notebook 的喚醒流程（patch annotation、starting 輪詢、
   前端狀態）＋ §3.5 自動生成 `makeslide-jupyter-cpu`（含 AlreadyExists 冪等、
   「已有 runtime 即不自動建立」的測試）。過程中一併修正一個 7a 遺留的前端缺口：
   `202` 屬 2xx，前端原本沒有特判會把 `{starting:true}` 誤當連線資訊解析。分支
   `feat/kubeflow-notebook-wake-and-autocreate`。
4. **7d**（已完成）：session reattach（§5.1，對 `proxy`/`url`/`kubeflow` 三種模式皆
   有益，非 kubeflow 專屬）。分支 `feat/kubeflow-session-reattach`。
5. **7e**（已完成）：部署文件——見
   [jupyter-kubeflow-deployment.md](jupyter-kubeflow-deployment.md)：RBAC manifest
   （含 create）、與既有 Istio 路由的關係、`KUBEFLOW_DEFAULT_RUNTIME_IMAGE` 挑選
   指引、`proxy` 模式「僅限單人部署」的明確警語，以及 `KUBEFLOW_USERID_HEADER`
   尚未接線的已知限制。分支 `docs/jupyter-kubeflow-deployment-guide`。

每階段獨立分支、獨立驗證（7a/7b/7c 可用 fake k8s API 測；7d 沿用既有
jupyterConnection 純函式測試模式）。**至此 7a–7e 全部完成**；真實 Kubeflow 叢集上的
端到端連線／喚醒／自動建立／session reattach 體驗仍待部署環境驗證。
