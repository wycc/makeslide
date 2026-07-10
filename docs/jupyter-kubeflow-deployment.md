# Jupyter Kubeflow 部署指南

本文件是 [jupyter-kubeflow-plan.md](jupyter-kubeflow-plan.md)（設計與分階段實作 7a–7e）的
**部署層落地指南**：把 `JUPYTER_MODE=kubeflow` 實際跑起來需要哪些 RBAC 權限、如何跟叢集既有的
Istio 路由共存、`KUBEFLOW_DEFAULT_RUNTIME_IMAGE` 怎麼選、以及 `proxy` 模式的適用邊界。7a–7d
（設定、connection 端點、runtime 探索、喚醒/自動建立、session reattach）的程式碼已完成並
merge 回 master；本文件是最後一塊（7e）。

## 1. 何時需要這份指南

只有 `JUPYTER_MODE=kubeflow` 需要以下設定。`proxy`／`url` 模式維持現狀，見下方
[§5 `proxy` 模式的適用邊界](#5-proxy-模式的適用邊界)。

## 2. RBAC：ServiceAccount 需要的權限

MakeSlide 後端只需要對 `notebooks.kubeflow.org` 這一種資源做 `get`／`list`／`patch`／`create`
（分別對應：讀狀態、7b 的 runtime 探索、7c 的喚醒、7c 的零設定自動建立）。**不需要**
`pods/exec`、`pods/log` 或任何直接操作 Pod 的權限——MakeSlide 從不直接碰 Pod，一切都經由
Notebook CR 這一層。

### 2a. 簡單版：ClusterRole + ClusterRoleBinding（權限面較大，設定最少）

適合單一 MakeSlide 部署要服務叢集內所有 profile namespace 的情況：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: makeslide-notebook-access
rules:
  - apiGroups: ["kubeflow.org"]
    resources: ["notebooks"]
    verbs: ["get", "list", "patch", "create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: makeslide-notebook-access
subjects:
  - kind: ServiceAccount
    name: makeslide             # 換成 MakeSlide 後端實際使用的 ServiceAccount 名稱
    namespace: makeslide        # 換成 MakeSlide 部署所在的 namespace
roleRef:
  kind: ClusterRole
  name: makeslide-notebook-access
  apiGroup: rbac.authorization.k8s.io
```

### 2b. 較嚴格版：逐 profile namespace 的 Role + RoleBinding

想要更小的權限面（MakeSlide 的 ServiceAccount 完全看不到它未被授權的 namespace）時，改成
每個 Kubeflow Profile 各自建立一份 `Role`／`RoleBinding`（規則內容同上，只是換成 namespace
scoped 的 `Role`，且 `RoleBinding` 逐 namespace 建立）。這通常需要在 Profile 建立流程中自動化
（例如接到 Kubeflow 的 Profile controller webhook，或用 GitOps 工具在每個新 profile namespace
落地時一併套用）；細節依各叢集的 Profile 自動化程度而異，本文件不假設特定實作。

### 2c. 不需要的權限

`pods/*`、`pods/exec`、`pods/log`、`services/*`、`persistentvolumeclaims/*` 都**不需要**——這些
是 notebook Pod 本身運作所需，跟 MakeSlide 後端無關。若審查 RBAC 時看到 MakeSlide 的
ServiceAccount 被要求任何上述權限，那不是本功能需要的，應該拒絕。

## 3. 與既有 Istio 路由的關係

**MakeSlide 不需要自己設定 `/notebook/<namespace>/<name>/` 這條路由**——這是 Kubeflow 平台
本身既有的路由（由 Kubeflow 的 Istio 設定與 `notebook-controller` 一起提供，每個 Notebook CR
建立時 controller 會自動產生對應的 VirtualService）。MakeSlide 的 connection 端點只是把這個
既有路徑（`nbPrefix`）告訴前端，前端的 `@jupyterlab/services` 才會用它連線；MakeSlide 後端不
建立、不管理任何 Notebook 專屬的路由物件。

MakeSlide 需要處理的，只有**它自己這個服務**要能被瀏覽器同源存取到（跟 Kubeflow Central
Dashboard、Notebook Pod 都在同一個 Istio gateway 底下），例如：

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: makeslide
  namespace: istio-system        # 或 Kubeflow gateway 定義所在的 namespace，依叢集而定
spec:
  gateways:
    - kubeflow-gateway            # 沿用 Kubeflow 既有的 gateway，不另外開一個
  hosts:
    - "*"
  http:
    - match:
        - uri:
            prefix: /makeslide/    # 對應 MakeSlide 的 NB_PREFIX 設定
      route:
        - destination:
            host: makeslide.makeslide.svc.cluster.local
            port:
              number: 3000
```

（實際的 gateway 名稱、host、port 依各叢集的 Kubeflow 安裝方式而異，上面只是示意；重點是
**MakeSlide 掛在同一個 Istio gateway 之後、與 Kubeflow Notebook 同源**，而不是自己開一個獨立的
ingress。）

## 4. `KUBEFLOW_DEFAULT_RUNTIME_IMAGE` 挑選指引

這個設定只在 §3.5 的「零設定自動建立 CPU 預設」流程用到——使用者從未自建任何
`makeslide-jupyter-*` notebook 時，MakeSlide 會用這個 image 自動生成一個
`makeslide-jupyter-cpu`。挑選原則：

1. **優先沿用 Kubeflow Notebook UI 本身提供的預設 image 之一**（例如
   `kubeflownotebookswg/jupyter-scipy:<tag>`、`kubeflownotebookswg/jupyter-pytorch:<tag>` 等，
   實際清單以叢集安裝的 Kubeflow 版本的 spawner 設定為準）——這些 image 已經跟叢集的
   node/driver（如 GPU driver、CUDA 版本，若適用）驗證過相容，不需要 MakeSlide 自己再驗證一輪。
2. **必須是 `jupyter_server >= 2`**（同現行 `proxy`／`url` 模式的既有硬性要求，見
   [jupyter-integration-plan.md](jupyter-integration-plan.md)）——`@jupyterlab/services` 7.x 用的
   kernel WebSocket 子協定需要這個版本，太舊的 image 會讓 cell 執行了但前端收不到輸出。
3. **釘住明確的 tag（避免 `latest`）**：自動建立的預設 notebook 是「零設定」路徑，使用者不會
   去手動檢查它用了哪個 image；`latest` 有一天悄悄變更可能讓所有新使用者的預設環境行為跑掉，
   應該固定成一個經測試過的具體版本 tag。
4. **只做 CPU-only**：這個 image 只給零設定的 `makeslide-jupyter-cpu` 用，不該帶任何 GPU
   相關的驅動/基底假設。想要 GPU 的使用者依 §3.4 自行在 Kubeflow Notebook UI 建立
   `makeslide-jupyter-gpu-<型號>`，那邊的 image 由使用者自己選、不受這個設定影響。

`KUBEFLOW_DEFAULT_RUNTIME_RESOURCES`（預設 `cpu=1,memory=2Gi`）搭配使用，格式是逗號分隔的
`key=value`（如 k8s resource 的 requests/limits 寫法），依叢集容量調整即可。

## 5. `proxy` 模式的適用邊界

> ⚠️ **`JUPYTER_MODE=proxy`（現行預設）只適合單人／桌面部署，絕不要用在多使用者的正式環境。**

原因見 [jupyter-kubeflow-plan.md §1](jupyter-kubeflow-plan.md#1-動機單一共用-jupyter-server-的限制)：
`proxy`／`url` 這兩種模式都假設「一顆共用的 Jupyter server」——

- 所有使用者的 kernel 跑在同一個 OS user、同一個家目錄下，彼此的檔案**互相可讀可寫可刪**，
  是安全問題，不只是衝突問題。
- `/api/kernels` 沒有 per-user 範圍限制，任何登入者可以列出、甚至刪除別人的 kernel。
- 沒有 per-user 資源配額，一人跑重的任務會拖慢全站。
- kernel 生命週期綁在瀏覽器的執行協調上，長任務容易變孤兒。

`proxy` 模式的隔離**只靠使用者自律**，沒有任何系統層面的邊界——這對「一個人在自己電腦上跑
MakeSlide」完全沒問題，但對「一群學生／同事共用同一個 MakeSlide 部署」是不能接受的風險。
**任何多使用者部署（教室、公司內部共用、對外 SaaS）都必須用 `JUPYTER_MODE=kubeflow`**，才能拿到
namespace／Pod／PVC 這三層真正的隔離。

## 6. 環境變數總覽（`JUPYTER_MODE=kubeflow`）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `JUPYTER_MODE` | `proxy` | 設成 `kubeflow` 啟用本文件描述的模式 |
| `KUBEFLOW_DEFAULT_NAMESPACE_TEMPLATE` | `{user}` | 由 MakeSlide 帳號 email 推導 Kubeflow profile namespace 的樣板；`{user}` 會替換成 email 的 local-part（`@` 前半段，經 DNS-label 清洗） |
| `KUBEFLOW_NOTEBOOK_PREFIX` | `makeslide-jupyter-` | runtime 探索用的 notebook 名稱前綴，見 §3.4 |
| `KUBEFLOW_DEFAULT_RUNTIME_IMAGE` | （空，即叢集/webhook 預設） | 見上方 §4 |
| `KUBEFLOW_DEFAULT_RUNTIME_RESOURCES` | `cpu=1,memory=2Gi` | 見上方 §4 |
| `KUBEFLOW_USERID_HEADER` | `kubeflow-userid` | **目前為保留設定，尚未被程式實際讀取**——見下方「已知限制」 |

### 已知限制：`KUBEFLOW_USERID_HEADER` 尚未接線

7a 當時加了這個設定，對應計畫 §3.2 步驟 1 提到的「部署於 Istio 之後時可直接信任
`kubeflow-userid` header」這條路徑；但目前 `namespaceForUser` 的實作只由 **MakeSlide 自己
session 裡的帳號 email** 推導 namespace，完全沒有讀取任何 request header。也就是說，現在的
namespace 對應完全仰賴「MakeSlide 帳號的 email」與「Kubeflow profile owner」剛好一致這個假設；
如果兩邊帳號體系本來就不同（例如 MakeSlide 走 Google 登入、Kubeflow 走另一套 SSO），現在的
實作沒有辦法用 Istio 注入的身分 header 來對齊兩邊。這個設定目前只是預留位置，若未來需要支援
兩邊身分系統不同源的部署，需要另外設計並在 connection／runtimes 端點接上這個 header 才會生效，
屬於後續工作，非本次部署指南範圍。
