# 測試用的 AI 帳號

讓單元測試可以**真的**呼叫 LLM／TTS，而不必手動起 dev server 去點。

## 為什麼需要它

AI 設定是**每個帳號各一份**（`accounts/<id>/settings.env`，見 [aiSettings.ts](../backend/src/services/aiSettings.ts)）。
測試跑在沒有登入的情境下，`currentAccountId()` 會回 `default`，那份設定通常是空的——於是
「這條路徑接上真的模型還會不會動」這種問題，過去只能靠手動驗證。

## 設定

```bash
cp -r accounts.example/test accounts/test
$EDITOR accounts/test/settings.env      # 填入要用的 provider 與 key
echo 'TEST_AI_ACCOUNT_ID=test' >> .env  # 或直接編輯 .env
```

`accounts/` 整個在 `.gitignore` 裡，金鑰不會進版控。

建議**另外開一個測試專用帳號**，而不要指向自己平常在用的那個：測試會真的花錢，也會寫進該
帳號的用量統計。範本裡預設了 `MONTHLY_BUDGET_USD=1`，跑壞的測試不至於把帳單燒光。

## 在測試裡怎麼用

```ts
import { llmTestAccount, runWithTestAiAccount } from '../src/services/testAiAccount';

const llm = llmTestAccount();

test('真的呼叫一次 LLM', { skip: llm.available ? false : llm.reason }, async () => {
  const result = await runWithTestAiAccount(() => callChatJSON({ /* ... */ }));
  assert.equal(result.data.ok, true);
});
```

`runWithTestAiAccount()` 用 `runWithAccountId()` 進入該帳號的情境，底下所有既有的
`getRuntimeAiSettings()`／`getOpenAIClient()`／`synthesizeTtsPreview()` 呼叫都會自動拿到
那個帳號的 key、模型與語音——**被測程式碼一行都不用改**。

`llmTestAccount()`／`ttsTestAccount()` 回報這件事現在能不能做：

| 欄位 | 意義 |
| --- | --- |
| `available` | provider 選好了、key 也在 |
| `reason` | 不能用的原因，直接拿去當 `skip` 的訊息 |
| `provider` | 實際會用到的 provider（`openai`／`gemini`／…） |
| `accountId` | 測試帳號代碼，沒設定時為 `null` |

沒設定 `TEST_AI_ACCOUNT_ID` 時 `available` 是 `false`，測試會**明確地 skip 並說明怎麼啟用**，
所以 CI 或沒有 key 的機器上整套測試照常綠燈，不會因為缺 key 而紅。

## 範例與驗證

[backend/test/test-ai-account.test.ts](../backend/test/test-ai-account.test.ts) 同時是這個機制
本身的測試與使用範例：前三個測試不需要任何 key、永遠會跑；後兩個是真的打 LLM／TTS 的範例。

```bash
scripts/run-tests.sh backend test/test-ai-account.test.ts
```
