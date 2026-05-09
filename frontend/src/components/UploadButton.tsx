import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, createYoutubeTask, uploadPdf } from '../lib/api';
import type { UploadResponse } from '../types';

interface UploadButtonProps {
  /**
   * Fired after a successful upload. The parent is expected to open a
   * prompt-input dialog for the returned PDF id.
   */
  onUploaded: (resp: UploadResponse) => void;
}

export default function UploadButton({ onUploaded }: UploadButtonProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const [error, setError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeLang, setYoutubeLang] = useState('zh-TW');
  const [isSubmittingYoutube, setIsSubmittingYoutube] = useState(false);
  const [showYoutubePanel, setShowYoutubePanel] = useState(false);

  const handlePickPdf = () => {
    if (isUploading) return;
    setError(null);
    fileInputRef.current?.click();
  };

  const handlePickText = () => {
    if (isUploading) return;
    navigate('/import-text');
  };

  const handleChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    // Reset the input so the same file can be selected again later
    ev.target.value = '';
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf';
    if (!isPdf) {
      setError('請選擇 PDF 檔案');
      return;
    }

    setIsUploading(true);
    setProgress(0);
    setError(null);
    try {
      const resp = await uploadPdf(file, {
        onProgress: (loaded, total) => {
          if (total > 0) {
            setProgress(Math.round((loaded / total) * 100));
          }
        },
      });
      onUploaded(resp);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`上傳失敗：${err.message}`);
      } else if (err instanceof Error) {
        setError(`上傳失敗：${err.message}`);
      } else {
        setError('上傳失敗：未知錯誤');
      }
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  const handleSubmitYoutube = async () => {
    if (isSubmittingYoutube || isUploading) return;
    const url = youtubeUrl.trim();
    if (!url) {
      setError('請輸入 YouTube URL');
      return;
    }
    setError(null);
    setIsSubmittingYoutube(true);
    try {
      const resp = await createYoutubeTask(url, youtubeLang.trim() || undefined);
      onUploaded({
        id: resp.id,
        status: 'uploaded',
        title: `YouTube ${resp.source_video_id}`,
        original_filename: resp.source_url,
        user_prompt: null,
        require_script_confirmation: false,
        created_at: resp.created_at,
      });
      setYoutubeUrl('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`建立 YouTube 任務失敗：${err.message}`);
      } else if (err instanceof Error) {
        setError(`建立 YouTube 任務失敗：${err.message}`);
      } else {
        setError('建立 YouTube 任務失敗：未知錯誤');
      }
    } finally {
      setIsSubmittingYoutube(false);
    }
  };


  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePickPdf}
          disabled={isUploading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3zM3.75 14.5a.75.75 0 01.75.75v.75h11v-.75a.75.75 0 011.5 0v1.25a1 1 0 01-1 1h-12a1 1 0 01-1-1v-1.25a.75.75 0 01.75-.75z"
              clipRule="evenodd"
            />
          </svg>
          {isUploading ? `上傳中 ${progress}%` : '上傳 PDF'}
        </button>

        <button
          type="button"
          onClick={handlePickText}
          disabled={isUploading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 shadow transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          貼上 TXT
        </button>

        <button
          type="button"
          onClick={() => setShowYoutubePanel((v) => !v)}
          disabled={isUploading || isSubmittingYoutube}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-900/30 px-4 py-2 text-sm font-medium text-emerald-200 shadow transition hover:bg-emerald-800/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {showYoutubePanel ? '收合 YouTube 匯入' : 'YouTube 匯入'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleChange}
        />

        {isUploading && (
          <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-indigo-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {showYoutubePanel && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
          <input
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="貼上 YouTube URL"
            className="min-w-[260px] flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400"
            disabled={isSubmittingYoutube || isUploading}
          />
          <input
            type="text"
            value={youtubeLang}
            onChange={(e) => setYoutubeLang(e.target.value)}
            placeholder="字幕語言 (選填，例如 zh-TW)"
            className="w-44 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400"
            disabled={isSubmittingYoutube || isUploading}
          />
          <button
            type="button"
            onClick={handleSubmitYoutube}
            disabled={isSubmittingYoutube || isUploading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmittingYoutube ? '建立中...' : '建立 YouTube 任務'}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}
