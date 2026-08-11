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
  可用 `AUDIOCPP_TTS_BACKEND` 指定。**CUDA toolkit 或驅動版本不夠時會事先降成 CPU 建置**（見下一
  節的門檻表），事先看不出來、真的建失敗時也會**再用 CPU 建一次**——與執行期 GPU 失敗退回 CPU 是
  同一個道理，至少會有一個能動的引擎。
- 建好的路徑會**寫回 `.env` 的 `AUDIOCPP_TTS_BIN`**（原本為空時才寫）。少了這步，後端仍會去 PATH
  找 `audiocpp_cli`，等於裝了跟沒裝一樣。
- **失敗一律只警告不中斷**（缺 git／cmake／編譯器、沒網路、建置失敗），MakeSlide 照常啟動。
- 原始碼放在 `.audiocpp/`（已 gitignore），建置輸出寫在 `audiocpp-build.log`。**不會自動 `git pull`**
  ——那會讓每次啟動都可能觸發一次十幾分鐘的重建；要更新請自行 `git -C .audiocpp pull` 後刪掉 `build/`。
- `AUDIOCPP_AUTO_INSTALL=false` 可停用自動建置（仍會檢查並回報狀態）。
- 也可以單獨執行：`./scripts/audiocpp-install.sh`（不看 `.env` 選了誰，一律檢查／安裝）。

**模型不會自動下載**：每個家族好幾 GB，而且要挑哪一個（語言、品質、記憶體）只有你能決定。建置完成
後若 `AUDIOCPP_TTS_MODEL` 仍是空的，會提示下載指令。

### 建置的三道門檻（「有裝」不等於「夠新」）

`git`／`cmake`／`c++` 存在還不夠，audio.cpp 對版本另有要求。安裝腳本會**在 clone 之前**先驗這三項，
因為不先問的代價不是失敗，是**編了十幾分鐘才失敗**：

| 門檻 | 出處 | 不足時 |
|---|---|---|
| CMake ≥ **3.20** | `CMakeLists.txt` 第一行 `cmake_minimum_required` | 不建置並提示 `pip install --user cmake` |
| GCC／libstdc++ ≥ **11** | `src/framework/debug/trace.cpp` 用了**浮點版** `std::to_chars`（libstdc++ 11 才有） | 不建置並提示怎麼裝一份新的 |
| CUDA Toolkit ≥ **12.0**＋NVIDIA 驅動 ≥ **525** | `find_package(CUDAToolkit 12.0 REQUIRED)`；驅動是 CUDA 12 runtime 的下限 | **降級成 CPU 建置**（有引擎比沒引擎好） |

編譯器那一項是**編一小段程式來問**，不是比對 `--version`：clang 用的是系統那份 libstdc++，版號對不上
它自己的版本。檢查也**優先看 `$CXX`**——系統編譯器太舊而你另外裝了一份時，cmake 認的是 `$CXX`。

**Ubuntu 20.04 實例**（這台開發機，RTX A5000）：系統是 cmake 3.16、GCC 9.4、CUDA 11.5、驅動 495，
**三項全部不合格**。第一次建置一路編到 258/704 才報 `std::chars_format has not been declared`。
補齊的方式如下，除了驅動以外都不需要 root、也不動系統：

```bash
# CMake（apt 的 3.16 太舊）
python3 -m pip install --user "cmake>=3.20" ninja

# GCC 12（apt 最高只有 g++-10，也還是不夠）
conda create -p ~/toolchain/gcc12 -c conda-forge gcc_linux-64=12 gxx_linux-64=12

# CUDA 12 toolkit 裝進家目錄（--toolkit 只裝 toolkit，不裝驅動、不需 root）
sh cuda_12.4.1_550.54.15_linux.run --silent --toolkit --toolkitpath=$HOME/cuda-12.4 --override

# 驅動只能用 root 升，而且要重開機。舊機器上 495 是從 NVIDIA local repo 裝的，
# cuda / cuda-drivers 這些 meta 套件會把它釘住，要一起移除 apt 才解得開依賴：
sudo apt-get install -y nvidia-driver-570 \
  cuda- cuda-11-5- cuda-runtime-11-5- cuda-demo-suite-11-5- cuda-drivers- cuda-drivers-495-

# 然後這樣建（CUDAARCHS 是 GPU 的 compute capability，A5000＝86）
export PATH="$HOME/.local/bin:$HOME/cuda-12.4/bin:$PATH"
export CUDACXX="$HOME/cuda-12.4/bin/nvcc" CUDAToolkit_ROOT="$HOME/cuda-12.4" CUDAARCHS=86
export CC=~/toolchain/gcc12/bin/x86_64-conda-linux-gnu-gcc
export CXX=~/toolchain/gcc12/bin/x86_64-conda-linux-gnu-g++
export LDFLAGS="-static-libstdc++"   # 免得執行期還要找 conda 那份 libstdc++
scripts/build_linux.sh --backend cuda --build-dir build --target audiocpp_cli
```

兩個容易踩到的細節：`--build-dir build` 是刻意的，腳本預設會放進 `build/linux-cuda-release/`，
而 `audiocpp-install.sh` 只認 `build/bin/audiocpp_cli` 這幾個位置，放錯地方下次啟動會再編一次；
`-static-libgcc` **不能**加，`libcublas.so` 需要 libgcc_s 裡的 `_Unwind_*`，靜態連進去會在連結階段失敗。

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

### qwen3_tts 有三個套件，別下錯

同一個 `--family qwen3_tts` 底下有三個**用法完全不同**的模型套件：

| 套件 | 聲音怎麼來 | 我們支援嗎 |
|---|---|---|
| `qwen3_tts_1_7b_customvoice_q8_0`（CustomVoice） | 內建講者 id（`Vivian`、`Ryan`…），走 **`--speaker`** | ✅ **建議用這個** |
| `qwen3_tts_1_7b_base_q8_0`（Base，家族預設） | **必須**給參考音檔 `--voice-ref` 做語音複製 | ✅ 但聲音欄位一定要填 .wav 路徑 |
| `qwen3_tts_1_7b_voicedesign_q8_0`（VoiceDesign） | 用 `--instruct` 描述聲音 | ❌ 它要 `--task vdes`，我們固定送 `--task tts` |

**注意 `install qwen3_tts` 抓的是 Base**（家族預設），而 Base 沒有內建音色——聲音欄位留空或填
`Vivian` 都不會動。要內建音色請明確指定套件 id：

```bash
python3 tools/model_manager_v2.py install qwen3_tts_1_7b_customvoice_q8_0 \
  --models-root <repo>/.audiocpp/models
```

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

- **人設在 qwen3_tts 上會生效，走的是它自己的 `--instruct`**（server 模式則是 body 的
  `instructions`）——那是模型專門用來收「怎麼唸」的欄位，內容不會被唸出來。實測：同一句話、同一個
  講者，`沒有人設` 產出 4.00 秒，`非常緩慢、低沉、嚴肅地說` 產出 5.84 秒。
  **其他家族收不到人設**（`audioCppSupportsInstruct` 只認 `qwen3_tts*`）：它們多半是純聲學模型，
  沒有這個欄位，硬塞未知旗標只會讓 CLI 報錯。它們仍可用 `AUDIOCPP_TTS_PROMPT_STEERING=true` 把指示
  前置到文字裡，但**很可能會被直接唸出來**，所以預設關閉。
  兩種情況下人設都仍然影響**逐字稿的用字**（那一步走的是 LLM，與 TTS 無關）。
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

## 8. 實測結果（2026-08-11，這台開發機）

以 `qwen3_tts` CustomVoice q8_0（2.8 GB）在 **CPU** backend 上實跑，中文：

| 項目 | 結果 |
|---|---|
| 直接下 `audiocpp_cli` | 19 字 → 4.96 秒音檔、24 kHz mono WAV |
| **走我們的 `synthesizeAudioCppSpeech()`** | 40 字 → 9.2 秒音檔，耗時 23.7 秒（**約 0.39× 即時**，CPU） |
| **走完整試聽路徑**（含 ffmpeg loudnorm + AAC） | speaker1=`vivian`／speaker2=`ryan`，各約 20 秒，輸出 7.60 秒的 24 kHz mono AAC |
| 語速 | `OPENAI_TTS_SPEED=1.5` → 7.60 秒縮為 5.44 秒 ✅ |

**CPU 上比即時慢約 2.5 倍**：一頁 30 秒的旁白大約要一分鐘合成。

### GPU（CUDA）實測（同日補測，RTX A5000 24 GB、驅動 570.133.07、CUDA 12.4 建置）

同一支執行檔、同一個模型，只換 `--backend`：

| 輸入 | 音檔長度 | 生成耗時 | 倍速 |
|---|---|---|---|
| 15 字 | 2.40 秒 | 0.90 秒 | **2.68× 即時** |
| 65 字 | 15.04 秒 | 3.17 秒 | **4.74× 即時** |
| 同機 CPU（12 執行緒）對照 | 3.28 秒 | 6.56 秒 | 0.50× 即時 |

**GPU 約比 CPU 快 9～12 倍**：一頁 30 秒旁白從一分鐘降到 6～11 秒。文字越長倍速越好——每次 CLI 呼叫
都要重載模型（約 2 秒），短句被這筆固定成本吃掉較多比例。整份簡報逐段合成時這筆會乘上段數，
在意的話改走 `audiocpp_server` 常駐模式可以省掉。

## 9. 聲音怎麼填

`AUDIOCPP_TTS_SPEAKER1_VOICE`／`SPEAKER2_VOICE`（設定頁上是文字輸入）：

- 填 **內建音色名** → 依家族走不同旗標（這點很重要，見下）。
- 填 **檔案路徑**（含 `/` 或副檔名是 `.wav`/`.mp3`/… ）→ 走 `--voice-ref`，也就是語音複製的參考音檔。
- **留空** → 不帶任何 voice 參數，由該模型家族用自己的預設聲音（Qwen3 Base 這種沒有預設音色的
  家族會直接失敗——它一定要 `--voice-ref`）。

**qwen3_tts CustomVoice 的內建講者**（從模型 `config.json` 的 `spk_id` 讀出，共 9 個；大小寫不拘）：

`serena`、`vivian`、`ryan`、`aiden`、`ono_anna`、`sohee`、`uncle_fu`，另有兩個方言講者
`eric`（四川話）與 `dylan`（北京話）。雙講者建議 `vivian` + `ryan`。
該模型支援的語言（`--inspect` 回報）：`Auto`、`chinese`、`english`、`japanese`、`korean`、`french`、
`german`、`italian`、`portuguese`、`russian`、`spanish`、`beijing_dialect`、`sichuan_dialect`。

**內建音色名不是每個家族都用同一個旗標**：PocketTTS 走 `--voice-id`，**Qwen3-TTS 走 `--speaker`**
（`Vivian`、`Ryan`…，模型內建一張講者表，`src/models/qwen3_tts/talker.cpp` 找不到就丟
「unsupported speaker」）。送錯旗標不是變成預設音色，而是**整份簡報每一段都失敗**。因此 `auto`
會依家族挑：`qwen3_tts*` → `--speaker`，其餘 → `--voice-id`；猜錯時用 `AUDIOCPP_TTS_VOICE_FLAG`
（`auto｜voice-id｜speaker｜voice-ref`）強制指定，不必改程式。

簡報層級殘留的 `alloy`／`Kore` 這類**別家供應商的音色名會被忽略**（它們對本機模型沒有意義，傳下去只會
出錯或隨機挑一個），回退鏈會繼續往下走，最後落到「用家族預設」。
