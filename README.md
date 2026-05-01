# makeslide

PDF 語音簡報生成與播放系統。詳細設計請見 [`docs/design.md`](docs/design.md)。

目前實作進度：**M2 階段** — 背景處理管線：PDF → 每頁 PNG + 封面 + 逐頁文字。

## 目錄結構

```
makeslide/
├── backend/       # Fastify + TypeScript API server
├── frontend/      # React + Vite + Tailwind SPA
├── storage/       # 執行期產物（gitignored）
│   └── <pdf_id>/
│       ├── source.pdf
│       ├── metadata.json
│       ├── cover.png
│       └── pages/
│           ├── 001.png
│           ├── 001.text.txt
│           └── ...
├── data/          # SQLite DB 檔案（gitignored）
└── docs/
```

## 前置需求

- Node.js 20 LTS 以上
- npm 10+
- **poppler-utils**（提供 `pdftoppm` 與 `pdfinfo`，M2 PDF → PNG 轉圖使用）
  - Ubuntu / Debian：`sudo apt-get install poppler-utils`
  - macOS：`brew install poppler`
  - 驗證：`pdftoppm -v`、`pdfinfo -v`

若未安裝，backend 啟動時會於 log 警告，上傳 PDF 後會轉為 `failed` 狀態並於 `error_message` 說明。

## 快速啟動（推薦）

1. 建議使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node 版本（專案已附 [`.nvmrc`](.nvmrc:1)，鎖定 Node 20）：

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # 重新開一個 shell 後：
   nvm install 20 && nvm use 20
   ```

2. 複製環境變數並填入 `OPENAI_API_KEY`

   ```bash
   cp .env.example .env
   # 編輯 .env
   ```

3. 一鍵啟動（自動檢查 Node 版本、poppler、.env、建立目錄、必要時 npm install，再啟動前後端）：

   ```bash
   ./start.sh
   ```

可用選項：

```bash
./start.sh --help             # 列出所有選項
./start.sh --install          # 強制重新 npm install
./start.sh --clean            # 清除 node_modules 後重裝並啟動
./start.sh --backend-only     # 只啟動 backend (Fastify)
./start.sh --frontend-only    # 只啟動 frontend (Vite)
```

按 Ctrl+C 可優雅地終結前後端子程序。

## 手動啟動（備選）

若不使用 [`start.sh`](start.sh:1)，可手動進行：

```bash
cp .env.example .env
npm install
```

`npm install` 會同時安裝 backend 與 frontend 相依套件（npm workspaces）。

```bash
npm run dev
```

- Backend 監聽於 `http://localhost:3000`
- Frontend 監聽於 `http://localhost:5173`（Vite dev server 已設定 `/api` proxy 到 backend）

亦可分別啟動：

```bash
npm run dev:backend
npm run dev:frontend
```

## 已實作 API

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/health` | 健康檢查 |
| POST | `/api/pdfs` | 上傳 PDF（multipart/form-data，欄位 `file`）；完成後自動入列處理 |
| GET | `/api/pdfs` | 列出所有 PDF（含 `cover_url`、`progress_step`、`page_count`） |
| GET | `/api/pdfs/:id` | 取得單筆詳情（含每頁 `image_url` / `text_url`） |
| GET | `/api/pdfs/:id/cover` | 取得封面縮圖（`image/png`） |
| GET | `/api/pdfs/:id/pages/:n/image` | 取得第 `n` 頁影像 |
| GET | `/api/pdfs/:id/pages/:n/text` | 取得第 `n` 頁抽取文字（`text/plain; charset=utf-8`） |
| DELETE | `/api/pdfs/:id` | 刪除 PDF（同步清除 `pages` 與 `storage/<pdf_id>/`） |

## 處理管線（M2）

```
上傳 → uploaded
      ↓ enqueue
      processing + progress_step=rendering       (pdftoppm 產生每頁 PNG + sharp 產生 cover.png)
      ↓
      processing + progress_step=extracting_text (pdfjs-dist legacy 逐頁抽文字)
      ↓
      processing + progress_step=text_extracted  (M2 結束，status 保留 processing 等 M3)
```

- 背景執行緒：`p-queue`，並行數由 `PROCESS_CONCURRENCY` 控制。
- 崩潰復原：啟動時掃描 `status IN ('uploaded','processing')` 的 PDF 自動重新入列。
- 同一個 `pdf_id` 不會被重覆處理（in-memory guard + DB 終態判斷）。

## 環境變數

請見 [`.env.example`](.env.example)。核心變數：

| 變數 | 預設 | 說明 |
|------|------|------|
| `PORT` | `3000` | Fastify listening port |
| `STORAGE_ROOT` | `./storage` | PDF 與產物根目錄 |
| `DB_PATH` | `./data/app.db` | SQLite 路徑 |
| `MAX_UPLOAD_MB` | `50` | 上傳大小上限 |
| `LOG_LEVEL` | `info` | pino log level |
| `PROCESS_CONCURRENCY` | `2` | M2：同時處理中的 PDF 數 |
| `RENDER_DPI` | `150` | M2：pdftoppm 解析度 |
| `POPPLER_BIN_PATH` | `` | M2：poppler 二進位目錄（留空走 `PATH`） |
