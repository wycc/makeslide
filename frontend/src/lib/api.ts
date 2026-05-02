import type {
  ApiErrorBody,
  ChatMessage,
  ChatHistoryResponse,
  PageChatResponse,
  PdfDetail,
  PdfListItem,
  StartProcessingResponse,
  UploadResponse,
} from '../types';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

async function parseErrorBody(resp: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    // ignore
  }
  if (isApiErrorBody(body)) {
    return new ApiError(body.error.message, body.error.code, resp.status);
  }
  return new ApiError(`HTTP ${resp.status}`, 'HTTP_ERROR', resp.status);
}

export async function fetchPdfs(): Promise<PdfListItem[]> {
  const resp = await fetch('/api/pdfs');
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  const data = (await resp.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new ApiError('Invalid list response', 'INVALID_RESPONSE', 500);
  }
  return data as PdfListItem[];
}

export async function fetchPdfDetail(id: string): Promise<PdfDetail> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as PdfDetail;
}

export async function deletePdf(id: string): Promise<void> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!resp.ok && resp.status !== 204) {
    throw await parseErrorBody(resp);
  }
}

export async function retryFailedPdf(id: string): Promise<{ id: string; status: string; updated_at: string }> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as { id: string; status: string; updated_at: string };
}

/**
 * Submit the user's style / tone prompt and ask the backend to start the
 * full pipeline. `prompt` may be an empty string (user skipped customising).
 */
export async function startProcessing(
  id: string,
  prompt: string,
  requireScriptConfirmation: boolean,
  opts: {
    ttsVoice?: string;
    ttsSpeed?: number;
    scriptMaxCharsPerPage?: number;
  } = {},
): Promise<StartProcessingResponse> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      require_script_confirmation: requireScriptConfirmation,
      tts_voice: opts.ttsVoice,
      tts_speed: opts.ttsSpeed,
      script_max_chars_per_page: opts.scriptMaxCharsPerPage,
    }),
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as StartProcessingResponse;
}

export interface RegenerateAudioResponse {
  id: string;
  page_number: number;
  script_url: string;
  audio_url: string;
  updated_at: string;
}

export interface RewriteScriptResponse {
  id: string;
  page_number: number;
  script: string;
}

export interface GenerateVideoResponse {
  id: string;
  video_url: string;
  updated_at: string;
}

export interface AddSlideResponse {
  id: string;
  page_number: number;
  page_count: number;
  updated_at: string;
}

export interface DeleteSlideResponse {
  id: string;
  page_count: number;
  updated_at: string;
}

export interface ReplaceSlideImageResponse {
  id: string;
  page_number: number;
  image_url: string;
  updated_at: string;
}

export interface RegenerateSlideImageResponse {
  id: string;
  page_number: number;
  image_url: string;
  updated_at: string;
}

export async function addSlide(id: string, afterPageNumber: number): Promise<AddSlideResponse> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ after_page_number: afterPageNumber }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as AddSlideResponse;
}

export async function deleteSlide(id: string, pageNumber: number): Promise<DeleteSlideResponse> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}`,
    { method: 'DELETE' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as DeleteSlideResponse;
}

export async function replaceSlideImage(
  id: string,
  pageNumber: number,
  file: File,
): Promise<ReplaceSlideImageResponse> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/replace-image`,
    { method: 'POST', body: form },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as ReplaceSlideImageResponse;
}

export async function regenerateSlideImage(
  id: string,
  pageNumber: number,
  prompt: string,
): Promise<RegenerateSlideImageResponse> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/regenerate-image`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegenerateSlideImageResponse;
}

export async function generatePdfVideo(id: string): Promise<GenerateVideoResponse> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/generate-video`, {
    method: 'POST',
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as GenerateVideoResponse;
}

export async function regeneratePageAudio(
  id: string,
  pageNumber: number,
  script: string,
): Promise<RegenerateAudioResponse> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/regenerate-audio`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script }),
    },
  );
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as RegenerateAudioResponse;
}

export async function rewritePageScript(
  id: string,
  pageNumber: number,
  prompt: string,
  script: string,
  history: ChatMessage[] = [],
): Promise<RewriteScriptResponse> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/rewrite-script`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, script, history }),
    },
  );
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as RewriteScriptResponse;
}

export interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload a PDF file via XHR so we can report progress.
 */
export function uploadPdf(file: File, opts: UploadOptions = {}): Promise<UploadResponse> {
  return new Promise<UploadResponse>((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/pdfs');

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

export async function chatWithPageContext(
  id: string,
  pageNumber: number,
  question: string,
  history: ChatMessage[],
): Promise<PageChatResponse> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/chat`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, history }),
    },
  );
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as PageChatResponse;
}

export async function fetchPageChatHistory(
  id: string,
  pageNumber: number,
): Promise<ChatHistoryResponse> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/chat-history`,
  );
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as ChatHistoryResponse;
}

export async function clearPageChatHistory(id: string, pageNumber: number): Promise<void> {
  const resp = await fetch(
    `/api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/chat-history`,
    { method: 'DELETE' },
  );
  if (!resp.ok && resp.status !== 204) {
    throw await parseErrorBody(resp);
  }
}
