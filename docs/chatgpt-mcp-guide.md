# 把 makeslide 接上 ChatGPT / Connecting makeslide to ChatGPT

makeslide 的 MCP 伺服器有兩種接法。Claude Code 那條走 stdio、在本機把伺服器當子行程啟動（見 [mcp-guide.md](mcp-guide.md)）；ChatGPT 走不了那條路，它只會對一個公開網址發 HTTP 請求。這份文件講的是第二條路：後端內建的遠端 MCP 端點 `/mcp`，以及它需要的 OAuth 授權。

makeslide's MCP server can be reached two ways. Claude Code uses stdio, launching the server as a local subprocess (see [mcp-guide.md](mcp-guide.md)). ChatGPT cannot do that — it only makes HTTP requests to a public URL. This document covers that second path: the backend's built-in remote MCP endpoint at `/mcp`, and the OAuth flow it requires.

## 為什麼不能像 Claude Code 那樣填一個 token / Why you can't just paste a token like in Claude Code

ChatGPT 新增自訂 connector 時，認證只有兩個選項：**OAuth** 或**不認證**。它沒有「填一個 API key 或 header」的欄位，所以設定頁產生的 MCP auth token 在這裡完全用不上。把 token 塞進網址（`/mcp/<token>`）也不行——ChatGPT 會對網址裡帶密鑰的伺服器判定為不安全而拒絕連線。

因此後端自己實作了一個最小的 OAuth 2.1 授權伺服器。你不需要註冊任何外部服務，也不需要額外設定 client id／secret：ChatGPT 會自己動態註冊，你只要在瀏覽器上按一次「允許連線」。

When you add a custom connector, ChatGPT offers exactly two authentication choices: **OAuth** or **none**. There is no field for an API key or a custom header, so the MCP auth token from the Settings page is unusable here. Putting the token in the URL (`/mcp/<token>`) doesn't work either — ChatGPT flags servers with secrets in the URL as unsafe and refuses to connect.

So the backend implements a minimal OAuth 2.1 authorization server itself. You don't register anything with an external service and there's no client id/secret to configure: ChatGPT registers itself dynamically, and you just click "allow" once in your browser.

## 前置需求 / Prerequisites

* **一個公開的 HTTPS 網址。** ChatGPT 的伺服器要連得到你的後端，所以 `localhost` 不行，自簽憑證也不行（ChatGPT 會驗憑證）。用反向代理（Caddy、nginx＋Let's Encrypt）或 Cloudflare Tunnel 之類的方式把後端露出去。
* **ChatGPT 的 Developer Mode。** 在 ChatGPT 的設定裡開啟，才能新增自訂 connector 並使用完整工具集（含寫入類工具）。需要 Pro／Team／Enterprise／Edu 方案。

* **A public HTTPS URL.** ChatGPT's servers must be able to reach your backend, so `localhost` won't work and neither will a self-signed certificate (ChatGPT validates it). Expose the backend through a reverse proxy (Caddy, nginx + Let's Encrypt) or something like Cloudflare Tunnel.
* **ChatGPT Developer Mode.** Enable it in ChatGPT's settings to add custom connectors and use the full tool set (including write tools). Requires a Pro/Team/Enterprise/Edu plan.

## 步驟一：讓後端知道自己的對外網址 / Step 1: Tell the backend its public URL

OAuth 的探索文件裡要寫出各端點的絕對網址。後端預設會從反向代理轉發的 `X-Forwarded-Proto`／`X-Forwarded-Host` 推，多數情況不必設定；但如果你的代理沒有轉發這些 header，就會推出錯的網址（ChatGPT 照著去打會連不上）。這時在 `.env` 明確指定：

The OAuth discovery documents must contain absolute URLs for each endpoint. By default the backend infers them from the `X-Forwarded-Proto`/`X-Forwarded-Host` headers your reverse proxy sends, which usually just works. If your proxy doesn't forward those headers, the inferred URL will be wrong and ChatGPT won't be able to reach it. Set it explicitly in `.env`:

```
MAKESLIDE_PUBLIC_URL=https://slides.example.com
```

如果後端**自己**終結 TLS 而且用的是自簽憑證，還要多設一項。工具呼叫會從後端內部再打一次迴圈請求回自己，自簽憑證會讓那個請求驗不過：

If the backend terminates TLS **itself** with a self-signed certificate, you need one more setting. Tool calls make a loopback request from the backend back to itself, and a self-signed certificate fails validation on that request:

```
MAKESLIDE_MCP_LOOPBACK_URL=http://127.0.0.1:3000
```

## 步驟二：在 ChatGPT 新增 connector / Step 2: Add the connector in ChatGPT

1. ChatGPT → 設定 → Connectors → Create（需先開啟 Developer Mode）。 / ChatGPT → Settings → Connectors → Create (Developer Mode must be on).
2. 名稱隨意填，例如 `makeslide`。 / Name it whatever you like, e.g. `makeslide`.
3. **MCP server URL** 填 `https://你的網址/mcp`。 / **MCP server URL**: `https://your-domain/mcp`.
4. **Authentication** 選 **OAuth**。不需要填 client id 或 secret——ChatGPT 會自己註冊。 / **Authentication**: choose **OAuth**. Leave client id/secret alone — ChatGPT registers itself.
5. 按下建立後，ChatGPT 會把你導到 makeslide 的授權頁。**如果後端啟用了 Google 登入，你必須先在同一個瀏覽器登入 makeslide**——授權頁要知道是哪個帳號在授權。頁面上會寫明將以哪個帳號的身分操作，確認無誤後按「允許連線」。 / ChatGPT then sends you to makeslide's consent page. **If Google login is enabled on the backend, sign in to makeslide in the same browser first** — the consent page needs to know which account is authorizing. It states which account will be used; confirm and click "allow".
6. 導回 ChatGPT 後 connector 就可以用了。 / You're returned to ChatGPT and the connector is ready.

## ChatGPT 能做什麼 / What ChatGPT can do

開啟 Developer Mode 後，stdio 那條路上的工具**一個不少**全部可用——上傳 PDF 或大綱、觸發生成、讀寫逐字稿、增刪頁面、設定動畫、產生 Jupyter notebook 頁面。

另外有兩個專為 ChatGPT 加的唯讀工具：

* **`search`**：用關鍵字或自然語言搜尋你讀得到的簡報內容，走後端既有的語意搜尋（失敗時自動退回關鍵字比對）。
* **`fetch`**：把 `search` 結果的某一筆取回全文，供 ChatGPT 引用。

這兩個是 ChatGPT 的硬性約定：**沒有開 Developer Mode 的情況下，少了它們 ChatGPT 會直接拒絕整個 connector**；深度研究（Deep Research）模式也只會用這兩個工具。它們對 Claude Code 一樣可用，只是多兩個搜尋入口。

With Developer Mode on, **every** tool from the stdio path is available — uploading PDFs or outlines, triggering generation, reading and writing scripts, adding and deleting pages, setting up animations, creating Jupyter notebook pages.

Two additional read-only tools exist specifically for ChatGPT:

* **`search`** — searches presentations you can read, by keyword or natural language, using the backend's existing semantic search (falling back to keyword matching).
* **`fetch`** — retrieves the full text of one `search` result so ChatGPT can cite it.

These two are a hard requirement on ChatGPT's side: **without Developer Mode, ChatGPT rejects any connector that lacks them**, and Deep Research mode uses only these two. They're available to Claude Code too, just as two extra search entry points.

## 安全性 / Security

* **權限範圍等同該帳號本人。** access token 綁定到按下「允許連線」的那個帳號，ChatGPT 透過它能做的事，跟那個帳號在瀏覽器裡能做的完全一樣，不多也不少。別人的私人簡報依然讀不到。
* **ChatGPT 會用到你的 API key 與額度。** 觸發生成類的工具走的是這個帳號設定的 AI provider 金鑰，費用算在這個帳號頭上。
* **access token 一天過期**，ChatGPT 會用 refresh token 自動續期；refresh token 每次使用都會輪替。
* **要撤銷授權**：在 ChatGPT 的設定裡刪掉這個 connector。若要從伺服器端強制切斷，清掉資料庫 `mcp_oauth_tokens` 表裡對應的列即可。
* 資料庫裡存的是 token 的 SHA-256 雜湊，不是明文。

* **Scope equals that account.** The access token is bound to whichever account clicked "allow". ChatGPT can do exactly what that account can do in a browser — no more, no less. Other people's private presentations remain unreadable.
* **ChatGPT spends your API keys and quota.** Generation tools use the AI provider keys configured for that account, and the cost lands on that account.
* **Access tokens expire after a day**; ChatGPT refreshes them automatically, and each refresh token is rotated on use.
* **To revoke**: delete the connector in ChatGPT's settings. To cut it off from the server side, delete the matching rows from the `mcp_oauth_tokens` table.
* Tokens are stored as SHA-256 hashes, never in plain text.

## 疑難排解 / Troubleshooting

* **ChatGPT 說連不上／connector 建立失敗**：先自己確認端點對外通得了。`curl https://你的網址/.well-known/oauth-authorization-server` 應該回一份 JSON，而且裡面的網址要是對外網址而不是 `localhost` 或內部 IP。是後者的話，設 `MAKESLIDE_PUBLIC_URL`。 / **ChatGPT can't connect or the connector fails to create**: verify the endpoint is reachable from outside. `curl https://your-domain/.well-known/oauth-authorization-server` should return JSON, and the URLs inside must be your public address rather than `localhost` or an internal IP. If they're wrong, set `MAKESLIDE_PUBLIC_URL`.
* **ChatGPT 判定 connector 不安全**：確認你填的是 `https://.../mcp` 而且沒有在網址裡帶任何 token 或密鑰。 / **ChatGPT flags the connector as unsafe**: make sure the URL is `https://.../mcp` with no token or secret in it.
* **授權頁說「請先登入 makeslide」**：後端啟用了 Google 登入，但這個瀏覽器沒有登入 session。開新分頁登入 makeslide，回到授權頁重新整理即可。 / **The consent page says you must sign in first**: Google login is enabled but this browser has no session. Sign in to makeslide in another tab, then reload the consent page.
* **工具呼叫全部失敗，訊息是連線被拒**：迴圈請求打不到後端自己。後端若自己跑 HTTPS 且用自簽憑證，設 `MAKESLIDE_MCP_LOOPBACK_URL` 指向一個連得上的位址。 / **Every tool call fails with a connection error**: the loopback request can't reach the backend itself. If the backend serves HTTPS with a self-signed certificate, point `MAKESLIDE_MCP_LOOPBACK_URL` at a reachable address.
* **深度研究模式看不到簡報內容**：深度研究只用 `search` 與 `fetch`。確認 `search` 找得到東西——簡報要屬於授權的那個帳號，或可見度設為公開。 / **Deep Research can't see your presentations**: it only uses `search` and `fetch`. Check that `search` returns hits — the presentations must belong to the authorizing account or be publicly visible.
* **某份簡報回 403**：與 stdio 那條路一樣的可見度限制，見 [mcp-guide.md](mcp-guide.md) 的「已知限制」。 / **A specific presentation returns 403**: same visibility rules as the stdio path; see "Known limitation" in [mcp-guide.md](mcp-guide.md).
