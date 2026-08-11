# audio.cpp 本機 TTS（CPU／GPU）

MakeSlide 的第四個 TTS 供應商：[audio.cpp](https://github.com/0xShug0/audio.cpp)，一個以 ggml 為基礎的
C++ 推論引擎，在**這台機器上**跑 TTS 模型。

它和另外三家（OpenAI／Gemini／OpenRouter）最大的差別是：

- **不需要 API key、不連外網**，因此也沒有每字費用，不佔用共用預設來源的每週額度。
- **速度取決於硬體**，而不是對方的伺服器。CPU 也能跑完，只是慢；GPU（CUDA／Metal／HIP／Vulkan）快得多。
- **音色由安裝的模型家族決定**，沒有固定的音色清單可以列給使用者選——設定頁因此是自由輸入的 voice id
  欄位，而不是下拉選單。

程式在 `backend/src/services/audiocpp.ts`，設定欄位見 `.env.example` 的 `AUDIOCPP_TTS_*` 區塊。

## 1. 先裝好 audio.cpp

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

## 2. 兩種執行方式

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
AUDIOCPP_TTS_MODEL=/models/pocket-tts     # 模型目錄
AUDIOCPP_TTS_FAMILY=pocket_tts
AUDIOCPP_TTS_BACKEND=cuda                 # 或 auto／cpu／metal／hip／vulkan
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

## 3. CPU／GPU 怎麼選

`AUDIOCPP_TTS_BACKEND`（設定頁：「audio.cpp 運算裝置」）：

- `auto`（預設）：macOS → `metal`；有 NVIDIA 驅動（`/proc/driver/nvidia/version`、`/dev/nvidiactl` 或
  `CUDA_VISIBLE_DEVICES`）→ `cuda`；有 AMD（`/dev/kfd`）→ `hip`；其餘 → `cpu`。
  `CUDA_VISIBLE_DEVICES=''`／`-1` 會被尊重（那是刻意要隱藏 GPU 的寫法），偵測結果為 `cpu`。
- 明確指定 `cpu`／`cuda`／`metal`／`hip`／`vulkan` 則原樣傳給 `--backend`。
  `vulkan` 不會被自動選中——它可攜但比原廠 backend 慢，只有明確指定才有意義。

多 GPU 主機可用 `AUDIOCPP_TTS_DEVICE` 指定 GPU 序號，CPU 執行緒數用 `AUDIOCPP_TTS_THREADS`。

## 4. GPU 不可用時會發生什麼

GPU backend 失敗（沒驅動、容器裡看不到卡、二進位檔沒編進該 backend）**不會讓那一頁掛掉**：程式會
判斷 stderr 是否為硬體相關錯誤，是的話**同一段改用 `cpu` 再跑一次**，並在 log 留下 warning。
模型路徑打錯這類錯誤則不會重試——它在 CPU 上會用一模一樣的方式失敗，重試只是白白多花幾分鐘。

## 5. 人設與速度的限制

- **人設（persona）預設不會影響語音**。Gemini／OpenRouter 是靠把指示前置到文字裡達成的，但
  audio.cpp 的模型多半是純聲學模型，**會把那句指示直接唸出來**。若你用的家族確實看得懂指示（例如具
  voice design 能力的 Qwen3-TTS），可以打開 `AUDIOCPP_TTS_PROMPT_STEERING=true`。
  人設仍然會影響**逐字稿的用字**（那一步走的是 LLM，與 TTS 無關）。
- **速度不是靠引擎做的**。audio.cpp 的速度控制隨家族而異、CLI 甚至沒有這個旗標，因此簡報設定的語速
  改由 ffmpeg 的 `atempo` 在合成後套用（`buildSegmentLoudnessConcatArgs`）。其他供應商仍然是在請求裡
  帶 `speed`，不會被套兩次。
- **沒有雙人一次生成**。它比照 OpenAI 逐段合成：`Speaker N:` 標籤會先被拿掉，再依講者切換聲音。

## 6. 聲音怎麼填

`AUDIOCPP_TTS_SPEAKER1_VOICE`／`SPEAKER2_VOICE`（設定頁上是文字輸入）：

- 填 **voice id**（例如 `alba`）→ 走 `--voice-id`。
- 填 **檔案路徑**（含 `/` 或副檔名是 `.wav`/`.mp3`/… ）→ 走 `--voice-ref`，也就是語音複製的參考音檔。
- **留空** → 不帶任何 voice 參數，由該模型家族用自己的預設聲音。

簡報層級殘留的 `alloy`／`Kore` 這類**別家供應商的音色名會被忽略**（它們對本機模型沒有意義，傳下去只會
出錯或隨機挑一個），回退鏈會繼續往下走，最後落到「用家族預設」。
