import { useRef, useState } from 'react';
import { ApiError, uploadPdf } from '../lib/api';
import type { UploadResponse } from '../types';

interface UploadButtonProps {
  /**
   * Fired after a successful upload. The parent is expected to open a
   * prompt-input dialog for the returned PDF id.
   */
  onUploaded: (resp: UploadResponse) => void;
}

export default function UploadButton({ onUploaded }: UploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const [error, setError] = useState<string | null>(null);

  const handlePick = () => {
    if (isUploading) return;
    setError(null);
    fileInputRef.current?.click();
  };

  const handleChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    // Reset the input so the same file can be selected again later
    ev.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
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

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePick}
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
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}
