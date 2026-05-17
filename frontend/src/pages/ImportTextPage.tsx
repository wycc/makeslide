import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, generatePromptTextUpload, mapApiErrorToHumanMessage, uploadPdf } from '../lib/api';

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
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recoveryGuide, setRecoveryGuide] = useState<string[]>([]);

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content) {
      setError(mode === 'prompt' ? '請先輸入要生成簡報的提示詞' : '請先貼上文字內容');
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setError(null);
    setRecoveryGuide([]);
    try {
      const resp = mode === 'prompt'
        ? await generatePromptTextUpload({ prompt: content })
        : await uploadPdf(new File([content], 'pasted.txt', { type: 'text/plain' }), {
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
              <span className="mt-1 block text-xs text-slate-400">先用 AI 產生投影片文字，再進入 TXT 上傳後續流程。</span>
            </button>
          </div>
        </section>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'prompt' ? '請描述想產生的簡報內容，例如：為新進工程師介紹 Kubernetes 基礎概念、常見元件與部署流程' : '請貼上要轉成簡報的文字內容'}
          className="h-[70vh] w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isUploading}
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading
              ? mode === 'prompt'
                ? '生成文字中…'
                : `上傳中 ${progress}%`
              : mode === 'prompt'
                ? '生成 TXT 並送出'
                : '送出 TXT'}
          </button>
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
