# audio.cpp 本機 TTS（CPU／GPU）

MakeSlide 的第四個 TTS 供應商：[audio.cpp](https://github.com/0xShug0/audio.cpp)，一個以 ggml 為基礎的
C++ 推論引擎，在**這台機器上**跑 TTS 模型。

它和另外三家（OpenAI／Gemini／OpenRouter）最大的差別是：

- **不需要 API key、不連外網**，因此也沒有每字費用，不佔用共用預設來源的每週額度。
- **速度取決於硬體**，而不是對方的伺服器。CPU 也能跑完，只是慢；GPU（CUDA／Metal／HIP／Vulkan）快得多。
- **音色由安裝的模型家族決定**，沒有固定的音色清單可以列給使用者選——設定頁因此是自由輸入的 voice id
  欄位，而不是下拉選單。

程式在 `backend/src/services/audiocpp.ts`，設定欄位見 `.env.example` 的 `AUDIOCPP_TTS_*` 區塊。

## 1. 裝好 audio.cpp

### 交給 start.sh 自動裝（預設）

`./start.sh` 會在啟動時檢查，缺少就自動 `git clone` + 建置（`scripts/audiocpp-install.sh`）：

- **只在你真的會用到它時才動作**：`.env` 的 `TTS_PROVIDER` 或 `SECONDARY_TTS_PROVIDER` 設為
  `audiocpp`，或執行 `./start.sh --install-audiocpp`。建置要十幾分鐘，不能讓每個走雲端供應商的人
  第一次啟動都被卡住。
- **建置用的 backend 與執行期同一套偵測**（macOS→Metal、NVIDIA→CUDA、AMD→HIP、其餘→CPU），
  可用 `AUDIOCPP_TTS_BACKEND` 指定。**GPU 建不起來（通常是缺 toolkit）會自動改用 CPU 再建一次**
  ——與執行期 GPU 失敗退回 CPU 是同一個道理，至少會有一個能動的引擎。
- 建好的路徑會**寫回 `.env` 的 `AUDIOCPP_TTS_BIN`**（原本為空時才寫）。少了這步，後端仍會去 PATH
  找 `audiocpp_cli`，等於裝了跟沒裝一樣。
- **失敗一律只警告不中斷**（缺 git／cmake／編譯器、沒網路、建置失敗），MakeSlide 照常啟動。
- 原始碼放在 `.audiocpp/`（已 gitignore），建置輸出寫在 `audiocpp-build.log`。**不會自動 `git pull`**
  ——那會讓每次啟動都可能觸發一次十幾分鐘的重建；要更新請自行 `git -C .audiocpp pull` 後刪掉 `build/`。
- `AUDIOCPP_AUTO_INSTALL=false` 可停用自動建置（仍會檢查並回報狀態）。
- 也可以單獨執行：`./scripts/audiocpp-install.sh`（不看 `.env` 選了誰，一律檢查／安裝）。

**模型不會自動下載**：每個家族好幾 GB，而且要挑哪一個（語言、品質、記憶體）只有你能決定。建置完成
後若 `AUDIOCPP_TTS_MODEL` 仍是空的，會提示下載指令。

### 自己裝

依照上游文件建置。要跑 GPU 就要用對應的 backend 建置：

```bash
# NVIDIA（CUDA）
scripts/build_linux.sh --backend cuda --target audiocpp_cli --target audiocpp_server
# macOS（Metal）
scripts/build_metal.sh --target audiocpp_cli
# 純 CPU
scripts/build_linux.sh --backend cpu --target audiocpp_cli
```

再用上游的 `tools/model_manager_v2.py` 下載模型（例如 `pocket_tts`）。

> **建置時選的 backend 決定了這個二進位檔「能」用什麼硬體**；MakeSlide 的設定只決定「要」用哪一個。
> 以 CPU-only 建置的執行檔選 `cuda` 會失敗——這種情況會自動退回 CPU（見下方第 4 節）。

## 2. 模型要下載哪個、「模型」欄位要填什麼

設定頁的「audio.cpp 模型」（`AUDIOCPP_TTS_MODEL`）**原封不動傳給 `audiocpp_cli --model`**，所以問題
等於「這個家族的 `--model` 該指到哪裡」。答案依家族而異：**多數是目錄，少數是 `.gguf` 檔本身。**

### 先看有哪些、再下載

```bash
cd <repo>/.audiocpp
python3 tools/model_manager_v2.py list                    # 列出所有可安裝的套件
python3 tools/model_manager_v2.py info qwen3_tts          # 看某個家族的預設套件
python3 tools/model_manager_v2.py install qwen3_tts \
  --models-root <repo>/.audiocpp/models --dry-run         # 先看會下載到哪、抓哪些檔
python3 tools/model_manager_v2.py install qwen3_tts \
  --models-root <repo>/.audiocpp/models                   # 真的下載
```

`--dry-run` 印出的 `target ...` 那一行就是**下載後的落點**，通常也就是要填進「模型」欄位的路徑。
`--models-root` 不給的話預設是相對路徑 `models`（相對於你當下的工作目錄），所以**建議明確給絕對
路徑**，欄位裡也填絕對路徑——後端不是從 `.audiocpp` 底下執行的，相對路徑會對不到。

### 語言：先確認這個家族講不講中文

**`pocket_tts` 沒有中文**（只有 en／de／it／pt／es），上游 README 的範例用它只是因為它最小。內容
語言是 `zh-TW` 的話請挑講中文的家族，例如 `qwen3_tts`（多語，另有 voice design）、`voxcpm2`、
`index_tts2`、`vibevoice`、`moss_tts_local`。完整清單見 `.audiocpp/docs/tts.md` 的表格，或
`grep -l '"zh"' .audiocpp/model_specs/*.json`。

### 幾個家族的實際填法

| 家族（`AUDIOCPP_TTS_FAMILY`） | 「模型」欄位（`--model`） | 備註 |
|---|---|---|
| `qwen3_tts` | `…/models/Qwen3-TTS-12Hz-1.7B-Base-GGUF`（目錄） | 多語含中文，支援 `--voice-ref` 複製 |
| `voxcpm2` | `…/models/VoxCPM2`（目錄） | 語音設計寫在 `--text` 開頭的括號裡 |
| `index_tts2` | `…/models/IndexTTS-2`（目錄） | |
| `vibevoice` | `…/models/VibeVoice-1.5B`（目錄） | 英／中對話 |
| `pocket_tts` | `…/models/PocketTTS-GGUF`（**根**目錄，不是底下的 `english/`） | 語言以 `--load-option language=…` 選，預設 `english`；**無中文** |
| `confucius4_tts` | `…/models/Confucius4-TTS-GGUF/confucius4-tts-orig.gguf`（**檔案**） | |
| `dramabox` | `…/models/DramaBox-GGUF/dramabox-q8_0.gguf`（**檔案**） | |

（上面的落點是在這台機器上以 `--dry-run` 實際查到的；其餘家族請照同樣方式查，或看
`.audiocpp/docs/tts.md` 各家族表格裡的 "Model directory" 欄。）

**目前不支援的情況**：`miotts` 這類需要 `--session-option`（例如 `miotts.codec_model_path=…`）才能
跑的家族，我們只轉發 `--load-option`（`AUDIOCPP_TTS_LOAD_OPTIONS`），還沒有對應的設定欄位。

## 3. 兩種執行方式

| | CLI（`audiocpp_cli`） | Server（`audiocpp_server`） |
|---|---|---|
| CPU／GPU 由誰決定 | **MakeSlide 的設定**（`--backend`） | 該 server 自己的 `server.json` |
| 模型載入 | 每一段都重載一次 | 常駐，快很多 |
| 需要另外啟動服務 | 否 | 是 |

`AUDIOCPP_TTS_MODE=auto`（預設）的規則很單純：**有填 `AUDIOCPP_TTS_BASE_URL` 就走 server，否則走 CLI**
——沒有人會為了一個自己沒在跑的 server 去填位址。

### CLI 模式

```bash
TTS_PROVIDER=audiocpp
AUDIOCPP_TTS_MODE=cli
# 見上一節：多數家族填目錄，少數填 .gguf 檔；建議絕對路徑
AUDIOCPP_TTS_MODEL=/home/me/makeslide/.audiocpp/models/Qwen3-TTS-12Hz-1.7B-Base-GGUF
AUDIOCPP_TTS_FAMILY=qwen3_tts
AUDIOCPP_TTS_BACKEND=cuda                 # 或 auto／cpu／metal／hip／vulkan／best
```

### Server 模式

先啟動 audio.cpp 的 server（backend 寫在它的 `server.json` 裡）：

```bash
audiocpp_server --config server.json
```

再設定：

```bash
TTS_PROVIDER=audiocpp
AUDIOCPP_TTS_MODE=server
AUDIOCPP_TTS_BASE_URL=http://127.0.0.1:8080/v1
AUDIOCPP_TTS_MODEL=pocket-tts             # server.json 裡的模型 id
```

## 4. CPU／GPU 怎麼選

`AUDIOCPP_TTS_BACKEND`（設定頁：「audio.cpp 運算裝置」）：

- `auto`（預設）：macOS → `metal`；有 NVIDIA 驅動（`/proc/driver/nvidia/version`、`/dev/nvidiactl` 或
  `CUDA_VISIBLE_DEVICES`）→ `cuda`；有 AMD（`/dev/kfd`）→ `hip`；其餘 → `cpu`。
  `CUDA_VISIBLE_DEVICES=''`／`-1` 會被尊重（那是刻意要隱藏 GPU 的寫法），偵測結果為 `cpu`。
- 明確指定 `cpu`／`cuda`／`metal`／`hip`／`vulkan` 則原樣傳給 `--backend`。
  `vulkan` 不會被自動選中——它可攜但比原廠 backend 慢，只有明確指定才有意義。

多 GPU 主機可用 `AUDIOCPP_TTS_DEVICE` 指定 GPU 序號，CPU 執行緒數用 `AUDIOCPP_TTS_THREADS`。

## 5. GPU 不可用時會發生什麼

GPU backend 失敗（沒驅動、容器裡看不到卡、二進位檔沒編進該 backend）**不會讓那一頁掛掉**：程式會
判斷 stderr 是否為硬體相關錯誤，是的話**同一段改用 `cpu` 再跑一次**，並在 log 留下 warning。
模型路徑打錯這類錯誤則不會重試——它在 CPU 上會用一模一樣的方式失敗，重試只是白白多花幾分鐘。

## 6. 人設與速度的限制

- **人設（persona）預設不會影響語音**。Gemini／OpenRouter 是靠把指示前置到文字裡達成的，但
  audio.cpp 的模型多半是純聲學模型，**會把那句指示直接唸出來**。若你用的家族確實看得懂指示（例如具
  voice design 能力的 Qwen3-TTS），可以打開 `AUDIOCPP_TTS_PROMPT_STEERING=true`。
  人設仍然會影響**逐字稿的用字**（那一步走的是 LLM，與 TTS 無關）。
- **速度不是靠引擎做的**。CLI 有 `--speaking-rate`、server 有 `speed`，但兩者都只有**實作它的家族**
  會理睬——不理睬的家族不會報錯，只會產出長度不對的音檔，而且兩種傳輸還會不一致。因此簡報設定的
  語速改由 ffmpeg 的 `atempo` 在合成後套用（`buildSegmentLoudnessConcatArgs`），一定有效且兩邊一致。
  其他供應商仍然是在請求裡帶 `speed`，不會被套兩次。
- **沒有雙人一次生成**。它比照 OpenAI 逐段合成：`Speaker N:` 標籤會先被拿掉，再依講者切換聲音。

## 7. 旗標對照（已對真實的 `audiocpp_cli` 驗證）

本文件與 `services/audiocpp.ts` 用到的旗標，都對照過 `audiocpp_cli --help` 的實際輸出：
`--task tts`、`--model`、`--family`、`--backend cpu|cuda|hip|rocm|vulkan|metal|best`（`rocm` 是 `hip`
的別名）、`--device`、`--threads`、`--load-option`、`--voice-id`、`--voice-ref`、`--text`、`--out`
全部存在且語意相符。

**還沒用到、但存在的原生管道**（值得之後改進）：

- **`--instruct <text>`**：voice-design 指令欄位（Qwen3-TTS 這類模型）。人設走這裡會比前置到朗讀
  文字裡安全得多——那正是 `AUDIOCPP_TTS_PROMPT_STEERING` 預設關閉的原因。
- **`--language <code>`**：原生語言選擇，目前是走 `--load-option language=…`。
- `--speaking-rate`、`--emotion`、`--pitch-shift`、`--seed`、`--temperature` 等生成參數。
- `--list-devices`（列出可用的運算裝置）、`--list-loaders`、`--metrics`（印出 RTF）。

## 8. 聲音怎麼填

`AUDIOCPP_TTS_SPEAKER1_VOICE`／`SPEAKER2_VOICE`（設定頁上是文字輸入）：

- 填 **voice id**（例如 `alba`）→ 走 `--voice-id`。
- 填 **檔案路徑**（含 `/` 或副檔名是 `.wav`/`.mp3`/… ）→ 走 `--voice-ref`，也就是語音複製的參考音檔。
- **留空** → 不帶任何 voice 參數，由該模型家族用自己的預設聲音。

簡報層級殘留的 `alloy`／`Kore` 這類**別家供應商的音色名會被忽略**（它們對本機模型沒有意義，傳下去只會
出錯或隨機挑一個），回退鏈會繼續往下走，最後落到「用家族預設」。
