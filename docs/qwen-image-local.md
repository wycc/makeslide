# Qwen-Image-2.1 本機／遠端圖片服務

MakeSlide 的「圖片供應商」可以選 **Qwen**，走的是開源模型 [Qwen-Image-2.1](https://github.com/QwenLM/Qwen-Image-2.1)（7B，文生圖與圖生圖同一個模型，原生支援透明背景）。模型不跑在 MakeSlide 後端裡，而是一個**獨立的 HTTP 服務**（`scripts/qwen-image-server/server.py`）：

- 本機 GPU 夠就在同一台跑，預設 `http://127.0.0.1:8765`。
- 本機不夠時，把 `scripts/qwen-image-server/` 這個目錄丟到任何有 GPU 的機器，開 `--host 0.0.0.0 --token <密鑰>`，MakeSlide 的設定頁只要填那台的網址與密鑰。
- 後端對它的期待只有三個端點（見下），所以要換成 ComfyUI、vLLM-Omni 或自己包的服務也行，只要照這個 JSON 形狀回應。

## 硬體需求

| 模式 | 需求 | 備註 |
| --- | --- | --- |
| 全部放 GPU | 約 36 GB 以上可用 VRAM（bf16） | 生成模型 7B（14 GB）＋ Qwen3-VL 8B 文字編碼器（17 GB）＋ VAE，權重共約 30 GiB，再留約 6 GiB 給運算；第一次會從 Hugging Face 下載 |
| CPU offload（放不下時自動開） | 約 20 GB 以上 VRAM ＋ 32 GB 以上 RAM | 只把正在用的子模型放進 GPU，高峰是 17 GB 的文字編碼器。RTX A5000（24 GB）實測 1024×768 約 54 秒 |
| `--device cpu` | 64 GB 以上 RAM | 可以動，但一張 2K 圖要以十分鐘計 |
| `--stub` | 無 | 不載入模型，回傳寫著提示詞的佔位圖，用來測接線 |

**24 GB 的卡放不下整個 bf16 pipeline**，不開 offload 會在載入時 `CUDA out of memory`（約佔到 21.5 GB 時）。所以 server.py 預設是自動模式：權重讀進來後，拿權重實際大小加 6 GiB 餘裕和 GPU 目前**剩餘**的 VRAM 比，放不下就開 offload，啟動時會印出判斷依據。要強制可用 `--cpu-offload`／`--no-cpu-offload`（或 `QWEN_IMAGE_CPU_OFFLOAD`（`1`／`0`／`auto`，預設 auto）／`0`／`auto`）。

Pascal 世代（如 Quadro P4000）沒有 bf16，請用 `--dtype float16`；VRAM 太小仍然很慢，建議部署到別台機器。

## 安裝與啟動

```bash
# 0) 到另一台機器：只要複製這個目錄（run.sh、server.py、requirements.txt）
scp -r scripts/qwen-image-server gpu-box:~/qwen-image-server

# 1) 檢查並安裝環境，然後啟動（第一次會建 .venv、依 nvidia-smi 的 CUDA 版本選 torch、
#    裝 torch＋torchvision、transformers / diffusers(git) / accelerate / pillow，並驗證 QwenImage21Pipeline 可匯入）
~/qwen-image-server/run.sh --host 0.0.0.0 --port 8765 --token change-me

# 只做檢查、或先把 ~30 GB 權重下載好
~/qwen-image-server/run.sh --check
~/qwen-image-server/run.sh --download --check

# 2) 較小的卡或沒有 bf16 的卡（offload 會自動打開）
~/qwen-image-server/run.sh --dtype float16 --steps 20

# 3) 只測接線（不載模型，只需 pillow）
~/qwen-image-server/run.sh --stub
```

`run.sh` 會檢查：Python ≥ 3.10 與 venv 模組、git、NVIDIA 驅動（沒有就退回 CPU 版 torch 並警告）、VRAM 不足 20 GB 時警告（連 offload 後最大的單一元件都可能放不下）、`HF_HOME` 所在磁碟至少 40 GB、套件缺哪個裝哪個（重跑不會重裝）。torch 的 wheel 來源可用 `QWEN_IMAGE_TORCH_INDEX` 覆蓋。torchvision 是必要的（Qwen3-VL 文字編碼器的 processor 沒有它會在載入模型時 `ImportError`），必須和 torch 來自同一個 wheel 來源；torch 已存在時只補 torchvision，並固定在現有的 torch 版本。

用既有的 conda 環境：`QWEN_IMAGE_VENV=~/.conda/envs/qwen ./run.sh`。這時會直接用該環境的 Python 做檢查。注意環境裡 torch 的 CUDA 版本必須不高於驅動支援的版本（`nvidia-smi` 右上角），例如驅動只到 CUDA 12.8 卻裝了 cu130 的 torch，`torch.cuda.is_available()` 會是 False。

參數都可用環境變數給：`QWEN_IMAGE_MODEL`（HF id 或本機路徑）、`QWEN_IMAGE_HOST`、`QWEN_IMAGE_PORT`、`QWEN_IMAGE_DEVICE`、`QWEN_IMAGE_DTYPE`、`QWEN_IMAGE_CPU_OFFLOAD`（`1`／`0`／`auto`，預設 auto）、`QWEN_IMAGE_STEPS`、`QWEN_IMAGE_MAX_PIXELS`、`QWEN_IMAGE_SERVER_TOKEN`。對外開放埠時**一定要設 token**。

### 讓別台機器連進來

`--host 0.0.0.0`（IPv6 用 `--host ::`，Linux 上 IPv4 也連得到）會在所有網路介面上 listen。啟動時會列出實際可連的網址，把區網那一個填進 MakeSlide 設定頁即可：

```
[qwen-image] listening on http://0.0.0.0:8765 (token required)
[qwen-image]   reachable at http://192.168.1.234:8765
[qwen-image]   reachable at http://127.0.0.1:8765
```

綁定非本機位址卻沒設 `--token` 時會印出警告：任何連得到這個埠的人都能使用你的 GPU。防火牆（如 `ufw allow 8765/tcp`）要另外開。服務在載入模型**之前**就先綁定埠，埠被佔用時會立刻報錯，不必等權重讀完。

## MakeSlide 端設定

設定頁 → AI → 圖片供應商選「Qwen-Image 2.1」→ Qwen 執行方式選「本機／遠端服務」：

- `QWEN_BASE_URL`：服務網址，例如 `http://gpu-box:8765`（留空 = `http://127.0.0.1:8765`）。
- `QWEN_API_KEY`：服務啟動時的 `--token`（沒設 token 就留空）。
- Qwen 圖片模型：本機模式下由服務的 `--model` 決定，這裡留空即可。

環境變數等價：`IMAGE_PROVIDER=qwen`、`QWEN_IMAGE_BACKEND=local`、`QWEN_BASE_URL=…`、`QWEN_API_KEY=…`。

**逾時**：本機服務一次只畫一張，開 offload 時每張約 1–1.5 分鐘，兩頁同時送出時第二頁還要排隊。`OPENAI_IMAGE_TIMEOUT_MS`（低品質 60 秒）是照 OpenAI 的速度訂的，對它太短：後端會提早放棄，服務畫完回覆時才發現對方已斷線（`BrokenPipeError`）。所以本機模式另有下限 `QWEN_LOCAL_IMAGE_TIMEOUT_MS`（預設 600000，即 10 分鐘），各呼叫點給的較短逾時不會低於它。服務這邊，排隊中的請求輪到時若發現對方已斷線就直接跳過，不白白佔用 GPU；回覆時對方已斷線則只印一行提示。

執行方式選「DashScope 雲端」則改打阿里雲 Model Studio 的託管 API（`qwen-image-3.0` 等代號），不需要自己的 GPU。

## 服務的 API

```
GET  /health                 → {"ok":true,"ready":true,"model":"Qwen/Qwen-Image-2.1","device":"cuda"}
POST /v1/images/generations  {"prompt":"…","size":"1536x1024","n":1,"seed":42?,"negative_prompt":"…"?}
POST /v1/images/edits        {"prompt":"…","size":"…"?,"images":["data:image/png;base64,…"],"mask":"data:…"?}
                             → {"created":1790000000,"data":[{"b64_json":"<PNG base64>"}]}
```

- 圖片以 data URL（或裸 base64）傳遞，最多 10 張參考圖。
- 遮罩沿用 OpenAI 的慣例：**透明的像素代表可以改的區域**。模型本身不吃遮罩，服務會把模型輸出貼回原圖，只覆蓋遮罩透明處，其餘像素原封不動——所以局部修圖的邊界是精確的，只是模型看得到整張圖。
- 尺寸接受 `WxH`，會取 16 的倍數並以 `--max-pixels` 封頂；修圖沒給尺寸就沿用原圖大小。
- 一次只跑一張（GPU 是瓶頸），其餘請求排隊。
