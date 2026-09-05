import type { UploadResponse } from '../../types';
import { ApiError, isApiErrorBody } from './common';

export interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  pdfImportMode?: 'slides' | 'document';
  hostMode?: 'solo' | 'dual';
  /** Category to file the new presentation under; omit/null = backend default. */
  category?: string | null;
  /**
   * 這份簡報要用哪一種語言產生內容。上傳畫面預設帶當下的系統語言；省略時後端會
   * 自己記下帳號設定的語言，之後改設定也不會回頭影響這份簡報。
   */
  contentLanguage?: 'zh-TW' | 'en';
}

export interface GeneratePromptTextRequest {
  prompt: string;
  category?: string | null;
  content_language?: 'zh-TW' | 'en';
}

export interface PromptChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PromptChatRequest {
  messages: PromptChatMessage[];
}

export interface PromptChatResponse {
  assistant_message: string;
  outline_text: string;
}

/**
 * Upload a PDF file via XHR so we can report progress.
 */
export function uploadPdf(file: File, opts: UploadOptions = {}): Promise<UploadResponse> {
  return new Promise<UploadResponse>((resolve, reject) => {
    const formData = new FormData();
    // NOTE:
    // Fastify's request.file() may parse multipart fields incrementally.
    // Put mode field before file to ensure backend can read pdf_import_mode
    // consistently when deciding slides vs document flow.
    formData.append('pdf_import_mode', opts.pdfImportMode ?? 'slides');
    formData.append('host_mode', opts.hostMode ?? 'solo');
    if (opts.contentLanguage) formData.append('content_language', opts.contentLanguage);
    if (opts.category) formData.append('category', opts.category);
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/pdfs');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && opts.onProgress) {
        opts.onProgress(ev.loaded, ev.total);
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error', 'NETWORK_ERROR', 0));
    };

    xhr.onabort = () => {
      reject(new ApiError('Upload aborted', 'ABORTED', 0));
    };

    xhr.onload = () => {
      const text = xhr.responseText;
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadResponse);
      } else if (isApiErrorBody(body)) {
        reject(new ApiError(body.error.message, body.error.code, xhr.status));
      } else {
        reject(new ApiError(`HTTP ${xhr.status}`, 'HTTP_ERROR', xhr.status));
      }
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

export async function generatePromptTextUpload(body: GeneratePromptTextRequest): Promise<UploadResponse> {
  const resp = await fetch('api/prompt-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(data.error.message, data.error.code, resp.status);
    }
    throw new ApiError(`HTTP ${resp.status}`, 'HTTP_ERROR', resp.status);
  }
  return data as UploadResponse;
}

export async function continuePromptOutlineChat(body: PromptChatRequest): Promise<PromptChatResponse> {
  const resp = await fetch('api/prompt-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(data.error.message, data.error.code, resp.status);
    }
    throw new ApiError(`HTTP ${resp.status}`, 'HTTP_ERROR', resp.status);
  }
  return data as PromptChatResponse;
}
