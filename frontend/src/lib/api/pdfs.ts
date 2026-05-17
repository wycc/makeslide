import type {
  ChatHistoryResponse,
  ChatMessage,
  PageChatResponse,
  PagePoll,
  PdfDetail,
  PdfListItem,
  RegenJobState,
  RollbackRegenerateResponse,
  StartProcessingResponse,
} from '../../types';
import { ApiError, parseErrorBody } from './common';

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
  category: string;
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

export async function updatePdfCategory(
  id: string,
  category: string,
): Promise<{ id: string; category: string; updated_at: string }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/category`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category }),
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as { id: string; category: string; updated_at: string };
}

export async function deleteCategory(
  category: string,
): Promise<{ category: string; reassigned_to: string; affected_count: number; updated_at: string }> {
  const resp = await fetch(`api/categories/${encodeURIComponent(category)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as { category: string; reassigned_to: string; affected_count: number; updated_at: string };
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

export async function fetchPagePolls(id: string, pageNumber: number): Promise<PagePoll[]> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/polls`);
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { polls?: PagePoll[] };
  return Array.isArray(data.polls) ? data.polls : [];
}

export async function createPagePoll(id: string, pageNumber: number, question: string, options: string[]): Promise<PagePoll> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/polls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, options }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PagePoll;
}

export async function votePagePoll(id: string, pollId: number, voterId: string, optionIndex: number): Promise<PagePoll> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/polls/${encodeURIComponent(String(pollId))}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voter_id: voterId, option_index: optionIndex }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PagePoll;
}

export interface UpdatePdfCoverFromPageResponse {
  id: string;
  page_number: number;
  cover_url: string;
  cover_thumbnail_url: string;
  updated_at: string;
}

export async function updatePdfCoverFromPage(
  id: string,
  pageNumber: number,
): Promise<UpdatePdfCoverFromPageResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/cover/from-page/${encodeURIComponent(String(pageNumber))}`,
    { method: 'POST' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as UpdatePdfCoverFromPageResponse;
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
