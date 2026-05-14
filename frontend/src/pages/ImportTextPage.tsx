import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, mapApiErrorToHumanMessage, uploadPdf } from '../lib/api';

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
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recoveryGuide, setRecoveryGuide] = useState<string[]>([]);

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
      const file = new File([content], 'pasted.txt', { type: 'text/plain' });
      const resp = await uploadPdf(file, {
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

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="請貼上要轉成簡報的文字內容"
          className="h-[70vh] w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isUploading}
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? `上傳中 ${progress}%` : '送出 TXT'}
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
