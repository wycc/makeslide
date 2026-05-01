import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, uploadPdf } from '../lib/api';

export default function ImportTextPage() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content) {
      setError('請先貼上文字內容');
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setError(null);
    try {
      const file = new File([content], 'pasted.txt', { type: 'text/plain' });
      const resp = await uploadPdf(file, {
        onProgress: (loaded, total) => {
          if (total > 0) setProgress(Math.round((loaded / total) * 100));
        },
      });
      navigate(`/?openPrompt=${encodeURIComponent(resp.id)}`);
    } catch (err) {
      if (err instanceof ApiError) setError(`上傳失敗：${err.message}`);
      else if (err instanceof Error) setError(`上傳失敗：${err.message}`);
      else setError('上傳失敗：未知錯誤');
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
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

