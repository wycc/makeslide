import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  continuePromptOutlineChat,
  mapApiErrorToHumanMessage,
  uploadPdf,
  type PromptChatMessage,
} from '../lib/api';

type ImportMode = 'paste' | 'prompt';

function buildRecoveryGuide(err: unknown): string[] {
  if (err instanceof ApiError) {
    if (err.code === 'API_KEY_MISSING') return ['先到設定頁補上 API key。', '回到此頁重新送出文字。'];
    if (err.code === 'POPPLER_NOT_FOUND' || err.code === 'DEPENDENCY_MISSING') return ['安裝 poppler 相關工具。', '確認環境 PATH 後重試。'];
    if (err.code === 'MODEL_QUOTA_EXCEEDED' || err.code === 'MODEL_UNAVAILABLE') return ['稍後重試或切換模型。', '先縮短文本再測試流程。'];
    if (err.code === 'INVALID_UPLOAD_TYPE' || err.code === 'INVALID_URL') return ['檢查輸入格式是否正確。', '確認來源內容有效且可讀取。'];
  }
  return ['檢查內容後重試。', '必要時參考錯誤碼文件。'];
}

export default function ImportTextPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ImportMode>('paste');
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recoveryGuide, setRecoveryGuide] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<PromptChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [outlineText, setOutlineText] = useState('');

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content) {
      setError('請先貼上文字內容');
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = await uploadPdf(new File([content], 'pasted.txt', { type: 'text/plain' }), {
        onProgress: (loaded, total) => {
          if (total > 0) setProgress(Math.round((loaded / total) * 100));
        },
      });
      navigate(`/?openPrompt=${encodeURIComponent(resp.id)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`上傳失敗：${h.title}｜${h.message}（建議：${h.nextStep}）`);
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`上傳失敗：${h.title}｜${h.message}（建議：${h.nextStep}）`);
      } else {
        setError('上傳失敗：未知錯誤');
      }
      setRecoveryGuide(buildRecoveryGuide(err));
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  const handleSendChat = async () => {
    const content = chatInput.trim();
    if (!content) {
      setError('請先輸入想和 AI 討論的簡報需求');
      return;
    }
    const nextMessages: PromptChatMessage[] = [...chatMessages, { role: 'user', content }];
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatting(true);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = await continuePromptOutlineChat({ messages: nextMessages });
      setOutlineText(resp.outline_text);
      setText(resp.outline_text);
      setChatMessages([...nextMessages, { role: 'assistant', content: resp.assistant_message }]);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`AI 對話失敗：${h.title}｜${h.message}（建議：${h.nextStep}）`);
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`AI 對話失敗：${h.title}｜${h.message}（建議：${h.nextStep}）`);
      } else {
        setError('AI 對話失敗：未知錯誤');
      }
      setRecoveryGuide(buildRecoveryGuide(err));
    } finally {
      setIsChatting(false);
    }
  };

  const handleCreateFromOutline = async () => {
    const content = (outlineText || text).trim();
    if (!content) {
      setError('請先透過對話產生簡報大綱');
      return;
    }
    setText(content);
    setIsUploading(true);
    setProgress(0);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = await uploadPdf(new File([content], 'prompt-outline.txt', { type: 'text/plain' }), {
        onProgress: (loaded, total) => {
          if (total > 0) setProgress(Math.round((loaded / total) * 100));
        },
      });
      navigate(`/?openPrompt=${encodeURIComponent(resp.id)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`建立簡報失敗：${h.title}｜${h.message}（建議：${h.nextStep}）`);
      } else if (err instanceof Error) {
        const h = mapApiErrorToHumanMessage(err);
        setError(`建立簡報失敗：${h.title}｜${h.message}（建議：${h.nextStep}）`);
      } else {
        setError('建立簡報失敗：未知錯誤');
      }
      setRecoveryGuide(buildRecoveryGuide(err));
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">貼上文字匯入</h1>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            返回首頁
          </button>
        </div>

        <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="text-sm font-semibold">首次流程導引（Text 匯入）</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Step 1 準備 API key</li>
            <li>Step 2 匯入來源（PDF / Text / YouTube）</li>
            <li>Step 3 啟動處理與等待</li>
            <li>Step 4 進入播放頁調整</li>
          </ol>
          <a className="mt-2 inline-block text-xs underline underline-offset-2 text-slate-400 hover:text-slate-200" href="/docs/error-codes.md" target="_blank" rel="noreferrer">
            查看錯誤碼文件（docs/error-codes.md）
          </a>
        </section>

        <section className="mb-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="text-sm font-semibold">匯入方式</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                mode === 'paste'
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100'
                  : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="block text-sm font-medium">貼上現有文字</span>
              <span className="mt-1 block text-xs text-slate-400">直接使用貼上的 TXT 內容進入原本流程。</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('prompt')}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                mode === 'prompt'
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100'
                  : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="block text-sm font-medium">從提示詞生成</span>
              <span className="mt-1 block text-xs text-slate-400">透過多輪對話和 AI 逐步完成簡報大綱，再進入 TXT 上傳後續流程。</span>
            </button>
          </div>
        </section>

        {mode === 'paste' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="請貼上要轉成簡報的文字內容"
            className="h-[70vh] w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400"
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
            <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-slate-100">AI 大綱對話</h2>
                <p className="mt-1 text-xs text-slate-400">
                  先描述主題、聽眾、頁數、重點或風格；AI 會持續更新右側大綱。
                </p>
              </div>
              <div className="mb-3 h-[44vh] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                {chatMessages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                    範例：請幫我做一份 8 頁簡報，介紹傳統機器學習中的無監督學習，對象是大學部學生，重點放在 K-means 與相關方法。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((message, idx) => (
                      <div
                        key={`${message.role}-${idx}`}
                        className={`rounded-lg px-3 py-2 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'ml-8 bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/30'
                            : 'mr-8 bg-slate-800 text-slate-100 ring-1 ring-slate-700'
                        }`}
                      >
                        <div className="mb-1 text-xs font-medium text-slate-400">
                          {message.role === 'user' ? '你' : 'AI'}
                        </div>
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="輸入下一輪需求，例如：請改成 10 頁、加入 DBSCAN 比較、語氣更適合高中生..."
                className="h-28 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 outline-none focus:border-indigo-400"
                disabled={isChatting || isUploading}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={isChatting || isUploading}
                  className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChatting ? 'AI 思考中…' : chatMessages.length === 0 ? '開始規劃' : '送出並更新大綱'}
                </button>
                {chatMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setChatMessages([]);
                      setChatInput('');
                      setOutlineText('');
                      setText('');
                    }}
                    disabled={isChatting || isUploading}
                    className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    重新開始
                  </button>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">目前簡報大綱</h2>
                  <p className="mt-1 text-xs text-slate-400">可手動微調，確認後建立 TXT 任務。</p>
                </div>
                <button
                  type="button"
                  onClick={handleCreateFromOutline}
                  disabled={isUploading || isChatting || !(outlineText || text).trim()}
                  className="shrink-0 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? `建立中 ${progress}%` : '用此大綱建立簡報'}
                </button>
              </div>
              <textarea
                value={outlineText || text}
                onChange={(e) => {
                  setOutlineText(e.target.value);
                  setText(e.target.value);
                }}
                placeholder="AI 產生的大綱會出現在這裡。格式範例：\nSlide 1: 標題\n- 重點一\n- 重點二"
                className="h-[58vh] w-full rounded-lg border border-slate-700 bg-slate-950 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400"
              />
            </section>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          {mode === 'paste' && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isUploading}
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? `上傳中 ${progress}%` : '送出 TXT'}
            </button>
          )}
          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <p>{error}</p>
              {recoveryGuide.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-100/90">
                  {recoveryGuide.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
