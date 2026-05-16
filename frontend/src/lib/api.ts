import type {
  ApiErrorBody,
  ChatMessage,
  ChatHistoryResponse,
  PageChatResponse,
  PdfDetail,
  PdfListItem,
  RegenJobState,
  RollbackRegenerateResponse,
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



export interface HumanReadableApiError {
  title: string;
  message: string;
  nextStep: string;
}

const ERROR_HINTS: Record<string, HumanReadableApiError> = {
  INVALID_UPLOAD_TYPE: { title: '檔案格式不支援', message: '目前僅支援 PDF 或純文字檔。', nextStep: '請改上傳 .pdf 或 .txt，並確認檔案未損毀。' },
  FILE_REQUIRED: { title: '缺少檔案', message: '請先選擇要上傳的檔案。', nextStep: '重新選檔後再送出。' },
  FILE_TOO_LARGE: { title: '檔案太大', message: '檔案超過系統允許大小。', nextStep: '請壓縮檔案、拆分內容或降低頁數後重試。' },
  INVALID_URL: { title: '連結格式錯誤', message: '無法解析提供的 URL。', nextStep: '請貼上完整且可公開存取的 YouTube 連結。' },
  API_KEY_MISSING: { title: '金鑰尚未設定', message: '系統缺少必要 API 金鑰。', nextStep: '請先到設定頁補上 API key 再重試。' },
  MODEL_QUOTA_EXCEEDED: { title: '模型配額不足', message: '模型配額已用盡或被限制。', nextStep: '請稍後重試，或切換到其他可用模型。' },
  MODEL_UNAVAILABLE: { title: '模型暫時不可用', message: '目前模型服務不可用。', nextStep: '稍後重試，或改用其他模型與供應商。' },
  DEPENDENCY_MISSING: { title: '系統依賴缺失', message: '執行環境缺少必要工具（例如 poppler）。', nextStep: '請依文件安裝缺失依賴後再重試。' },
  POPPLER_NOT_FOUND: { title: 'PDF 解析工具缺失', message: '系統找不到 poppler（pdftoppm / pdftotext）。', nextStep: '請先安裝 poppler，並確認可在系統 PATH 中使用。' },
  PDF_NOT_FOUND: { title: '找不到簡報資料', message: '此簡報可能已被刪除或不存在。', nextStep: '請回首頁重新整理清單，再重新操作。' },
  PAGE_NOT_FOUND: { title: '找不到頁面', message: '指定頁面不存在。', nextStep: '請重新整理頁面並確認頁碼。' },
  RESOURCE_NOT_FOUND: { title: '資源尚未產生', message: '目前請求的檔案資源不存在。', nextStep: '等待流程完成後再試，或先確認流程是否失敗。' },
  INVALID_STATE: { title: '目前狀態不可執行', message: '當前任務狀態不允許此操作。', nextStep: '請依照流程先完成前一步，或重新整理後再嘗試。' },
  JOB_CONFLICT: { title: '任務狀態衝突', message: '已有任務進行中或不可取消。', nextStep: '請等待目前任務結束，或稍後再發送同類操作。' },
  INTERNAL_ERROR: { title: '系統內部錯誤', message: '伺服器處理時發生例外。', nextStep: '請稍後重試；若持續發生請提供錯誤碼回報。' },
};

export function mapApiErrorToHumanMessage(err: unknown): HumanReadableApiError {
  if (err instanceof ApiError) {
    const found = ERROR_HINTS[err.code];
    if (found) return found;
    return { title: '請求失敗', message: err.message, nextStep: '請稍後再試，或檢查輸入內容後重送。' };
  }
  if (err instanceof Error) {
    return { title: '請求失敗', message: err.message, nextStep: '請確認網路連線後再重試。' };
  }
  return { title: '未知錯誤', message: '發生未知錯誤。', nextStep: '請重新操作，必要時回報操作步驟。' };
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
  const resp = await fetch('api/pdfs');
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
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as PdfDetail;
}

export interface CreateYoutubeTaskResponse {
  id: string;
  status: string;
  source_type: 'youtube';
  source_url: string;
  source_video_id: string;
  source_caption_language: string | null;
  created_at: string;
}

export async function createYoutubeTask(
  youtubeUrl: string,
  language?: string,
): Promise<CreateYoutubeTaskResponse> {
  const resp = await fetch('api/youtube', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      youtube_url: youtubeUrl,
      language: language?.trim() || undefined,
    }),
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as CreateYoutubeTaskResponse;
}

export async function deletePdf(id: string): Promise<void> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!resp.ok && resp.status !== 204) {
    throw await parseErrorBody(resp);
  }
}

export async function duplicatePdf(id: string): Promise<PdfListItem> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as PdfListItem;
}

export async function retryFailedPdf(id: string): Promise<{ id: string; status: string; updated_at: string }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/retry`, {
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
    tonePrompt?: string;
    imageStylePrompt?: string;
  } = {},
): Promise<StartProcessingResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      require_script_confirmation: requireScriptConfirmation,
      tts_voice: opts.ttsVoice,
      tts_speed: opts.ttsSpeed,
      script_max_chars_per_page: opts.scriptMaxCharsPerPage,
      tone_prompt: opts.tonePrompt,
      image_style_prompt: opts.imageStylePrompt,
    }),
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as StartProcessingResponse;
}

export interface ImagePromptTemplate {
  key: string;
  label: string;
  description: string;
  prompt_en: string;
  prompt_zh: string;
}

export interface ImagePromptTemplatesResponse {
  templates: ImagePromptTemplate[];
  default_template_key: string | null;
}

export async function getImagePromptTemplates(): Promise<ImagePromptTemplatesResponse> {
  const resp = await fetch('api/system/image-prompt-templates');
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as ImagePromptTemplatesResponse;
}

export interface RegenerateAudioResponse {
  id: string;
  page_number: number;
  script_url: string;
  audio_url: string;
  updated_at: string;
  audio_bytes?: number;
  audio_mime?: string;
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

export interface MoveSlideResponse {
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
  candidate_id?: string;
  updated_at: string;
}

export interface UpdateTtsSettingsResponse {
  id: string;
  tts_voice: string;
  tts_speed: number;
  updated_at: string;
}

export interface UpdatePdfTitleResponse {
  id: string;
  title: string;
  updated_at: string;
}

export interface UpdatePdfPromptResponse {
  id: string;
  page_number: number;
  page_prompt: string | null;
  updated_at: string;
}

export interface PagePromptResponse {
  id: string;
  page_number: number;
  page_prompt: string | null;
  updated_at: string;
}

export async function fetchPagePrompt(
  id: string,
  pageNumber: number,
): Promise<PagePromptResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/prompt`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PagePromptResponse;
}

export async function updatePdfTitle(
  id: string,
  title: string,
): Promise<UpdatePdfTitleResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/title`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as UpdatePdfTitleResponse;
}

export async function updatePdfPrompt(
  id: string,
  pageNumber: number,
  prompt: string,
): Promise<UpdatePdfPromptResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/prompt`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as UpdatePdfPromptResponse;
}

export interface RegenerateAllImagesResponse {
  id: string;
  page_count: number;
  updated_at: string;
}

export async function addSlide(id: string, afterPageNumber: number): Promise<AddSlideResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ after_page_number: afterPageNumber }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as AddSlideResponse;
}

export async function deleteSlide(id: string, pageNumber: number): Promise<DeleteSlideResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}`,
    { method: 'DELETE' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as DeleteSlideResponse;
}

export async function moveSlide(
  id: string,
  fromPageNumber: number,
  toPageNumber: number,
): Promise<MoveSlideResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from_page_number: fromPageNumber,
      to_page_number: toPageNumber,
    }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as MoveSlideResponse;
}

export async function replaceSlideImage(
  id: string,
  pageNumber: number,
  file: File,
): Promise<ReplaceSlideImageResponse> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/replace-image`,
    { method: 'POST', body: form },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as ReplaceSlideImageResponse;
}

export async function regenerateSlideImage(
  id: string,
  pageNumber: number,
  prompt: string,
  history: ChatMessage[] = [],
): Promise<RegenerateSlideImageResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/regenerate-image`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, history }),
    },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegenerateSlideImageResponse;
}

export async function updatePdfTtsSettings(
  id: string,
  ttsVoice: string,
  ttsSpeed: number,
): Promise<UpdateTtsSettingsResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/tts-settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tts_voice: ttsVoice, tts_speed: ttsSpeed }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as UpdateTtsSettingsResponse;
}

export async function updatePdfImageStyleSettings(
  id: string,
  imageStylePrompt: string,
): Promise<{ id: string; image_style_prompt: string | null; updated_at: string }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/image-style-settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_style_prompt: imageStylePrompt }),
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as { id: string; image_style_prompt: string | null; updated_at: string };
}

export async function regenerateAllImages(
  id: string,
  prompt: string,
): Promise<RegenerateAllImagesResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/regenerate-images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegenerateAllImagesResponse;
}

export interface StartRegenerateOptions {
  scripts?: { prompt?: string } | null;
  audio?: { voice?: string; speed?: number } | null;
  images?: { prompt: string } | null;
}

/**
 * 啟動批次「重生」任務（逐字稿 / 語音 / 圖檔，至少選一）。
 * 後端以 image → script → audio 順序執行，進度以 {@link fetchRegenerateStatus}
 * 輪詢。回傳值是任務建立當下的初始狀態（202 Accepted）。
 */
export async function startRegenerateJob(
  id: string,
  options: StartRegenerateOptions,
): Promise<RegenJobState> {
  const body: Record<string, unknown> = {};
  if (options.scripts) {
    body.scripts = { prompt: options.scripts.prompt ?? '' };
  }
  if (options.audio) {
    const audioBody: Record<string, unknown> = {};
    if (options.audio.voice !== undefined) audioBody.voice = options.audio.voice;
    if (options.audio.speed !== undefined) audioBody.speed = options.audio.speed;
    body.audio = audioBody;
  }
  if (options.images) {
    body.images = { prompt: options.images.prompt };
  }
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/regenerate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegenJobState;
}

/** 查詢批次重生任務的最新進度。未建立過任務時會回傳 404 ApiError。 */
export async function fetchRegenerateStatus(id: string): Promise<RegenJobState> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/regenerate/status`,
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegenJobState;
}

/**
 * 向後端送出「停止正在執行中的重生任務」請求；實際會在下一個頁面安全檢查點
 * 停止，並讓 status 進入 `cancelling` → `cancelled`。
 */
export async function cancelRegenerateJob(id: string): Promise<RegenJobState> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/regenerate/cancel`,
    { method: 'POST' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegenJobState;
}

/**
 * 還原最近一次重生任務啟動前的快照；包含圖片 / 逐字稿 / 語音，「原本不存在」
 * 的檔案也會被還原為不存在。
 */
export async function rollbackRegenerate(
  id: string,
): Promise<RollbackRegenerateResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/regenerate/rollback`,
    { method: 'POST' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RollbackRegenerateResponse;
}

export async function generatePdfVideo(id: string): Promise<GenerateVideoResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/generate-video`, {
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
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/regenerate-audio`,
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
  context: {
    previousScript?: string;
    currentScript?: string;
    nextScript?: string;
  } = {},
  history: ChatMessage[] = [],
): Promise<RewriteScriptResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/rewrite-script`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        script,
        previous_script: context.previousScript,
        current_script: context.currentScript,
        next_script: context.nextScript,
        history,
      }),
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

export async function chatWithPageContext(
  id: string,
  pageNumber: number,
  question: string,
  history: ChatMessage[],
): Promise<PageChatResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/chat`,
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
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/chat-history`,
  );
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as ChatHistoryResponse;
}

export async function clearPageChatHistory(id: string, pageNumber: number): Promise<void> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/chat-history`,
    { method: 'DELETE' },
  );
  if (!resp.ok && resp.status !== 204) {
    throw await parseErrorBody(resp);
  }
}

export interface OpenAIKeyStatusResponse {
  has_key: boolean;
}

export interface SystemAiSettings {
  openai_api_key?: string;
  gemini_api_key?: string;
  has_openai_key: boolean;
  has_gemini_key: boolean;
  llm_provider: 'openai' | 'gemini';
  tts_provider: 'openai' | 'gemini';
  openai_llm_model: string;
  gemini_llm_model: string;
  openai_tts_model: string;
  gemini_tts_model: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
}

export interface UpdateSystemAiSettingsPayload {
  openai_api_key?: string;
  gemini_api_key?: string;
  llm_provider?: 'openai' | 'gemini';
  tts_provider?: 'openai' | 'gemini';
  openai_llm_model?: string;
  gemini_llm_model?: string;
  openai_tts_model?: string;
  gemini_tts_model?: string;
  gemini_tts_speaker1?: string;
  gemini_tts_speaker2?: string;
}

export async function getOpenAIKeyStatus(): Promise<OpenAIKeyStatusResponse> {
  const resp = await fetch('api/system/openai-key-status');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as OpenAIKeyStatusResponse;
}

export async function getSystemAiSettings(): Promise<SystemAiSettings> {
  const resp = await fetch('api/system/ai-settings');
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SystemAiSettings;
}

export async function updateSystemAiSettings(
  payload: UpdateSystemAiSettingsPayload,
): Promise<SystemAiSettings> {
  const resp = await fetch('api/system/ai-settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SystemAiSettings;
}

export async function setOpenAIApiKey(apiKey: string): Promise<{ ok: boolean; has_key: boolean }> {
  const resp = await fetch('api/system/openai-api-key', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean; has_key: boolean };
}
