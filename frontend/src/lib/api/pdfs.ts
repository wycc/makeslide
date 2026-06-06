import type {
  ChatHistoryResponse,
  ChatMessage,
  PageChatResponse,
  PagePoll,
  PdfDetail,
  PdfListItem,
  QuizQuestion,
  QuizSet,
  RegenJobState,
  RollbackRegenerateResponse,
  SyncAiAnswer,
  SyncFollowerQuestion,
  SyncJoinResponse,
  SyncStateResponse,
  StartProcessingResponse,
  PdfSourceItem,
} from '../../types';
import { ApiError, isApiErrorBody, parseErrorBody } from './common';

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

export async function addPdfTextSource(
  id: string,
  payload: { source_name?: string; content_text: string },
): Promise<PdfSourceItem> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sources/txt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PdfSourceItem;
}

export async function addPdfFileSource(id: string, file: File): Promise<PdfSourceItem> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sources/pdf`, {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PdfSourceItem;
}

export type ShareAccessMode = 'read_only' | 'editable';

export interface ShareInfoResponse {
  token: string;
  pdf_id: string;
  access: ShareAccessMode;
  created_at: string;
  updated_at: string;
}

export interface CreateShareResponse extends ShareInfoResponse {
  share_url: string;
}

export async function resolveShareToken(token: string): Promise<ShareInfoResponse> {
  const resp = await fetch(`api/share/${encodeURIComponent(token)}`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as ShareInfoResponse;
}

export async function createPdfShare(id: string, access: ShareAccessMode): Promise<CreateShareResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access }),
  });
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as CreateShareResponse;
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

export async function exportPdfZip(id: string): Promise<Blob> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/export.zip`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return await resp.blob();
}

export async function importPdfZip(
  file: File,
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<PdfListItem> {
  return await new Promise<PdfListItem>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/pdfs/import.zip');

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
        resolve(body as PdfListItem);
        return;
      }

      if (isApiErrorBody(body)) {
        reject(new ApiError(body.error.message, body.error.code, xhr.status));
        return;
      }

      reject(new ApiError(`HTTP ${xhr.status}`, 'HTTP_ERROR', xhr.status));
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
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
    requireSplitConfirmation?: boolean;
  } = {},
): Promise<StartProcessingResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      require_script_confirmation: requireScriptConfirmation,
      require_split_confirmation: opts.requireSplitConfirmation,
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

export interface InpaintImageResponse {
  id: string;
  page_number: number;
  image_url: string;
  candidate_id: string;
  updated_at: string;
}

export interface UpdateTtsSettingsResponse {
  id: string;
  tts_voice: string;
  tts_speed: number;
  updated_at: string;
}

export interface UpdateScriptSettingsResponse {
  id: string;
  script_max_chars_per_page: number | null;
  updated_at: string;
}

export interface UpdatePdfTitleResponse {
  id: string;
  title: string;
  updated_at: string;
}

export interface RegeneratePdfTitleResponse {
  id: string;
  title: string;
  updated_at: string;
  source: 'script' | 'text';
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

export async function regeneratePdfTitle(id: string): Promise<RegeneratePdfTitleResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/regenerate-title`, {
    method: 'POST',
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RegeneratePdfTitleResponse;
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

export async function createPagePoll(id: string, pageNumber: number, question: string, options: string[], showResults = true): Promise<PagePoll> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/polls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, options, show_results: showResults }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PagePoll;
}

export interface CreateVoicePagePollResponse {
  poll: PagePoll;
  transcript: string;
}

export async function createVoicePagePoll(
  id: string,
  pageNumber: number,
  audio: Blob,
  prompt: string,
): Promise<CreateVoicePagePollResponse> {
  const form = new FormData();
  const ext = audio.type.includes('mp4') ? 'm4a' : 'webm';
  form.append('audio', audio, `voice-poll.${ext}`);
  form.append('prompt', prompt);
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/polls/voice`, {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as CreateVoicePagePollResponse;
}
export async function deletePagePoll(id: string, pollId: number): Promise<void> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/polls/${encodeURIComponent(String(pollId))}`, {
    method: 'DELETE',
  });
  if (!resp.ok && resp.status !== 204) throw await parseErrorBody(resp);
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

export async function resetPagePollVotes(id: string, pollId: number): Promise<PagePoll> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/polls/${encodeURIComponent(String(pollId))}/reset-votes`, {
    method: 'POST',
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PagePoll;
}

export async function fetchQuizSets(id: string): Promise<QuizSet[]> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/quizzes`);
  if (!resp.ok) throw await parseErrorBody(resp);
  const data = (await resp.json()) as { quizzes?: QuizSet[] };
  return Array.isArray(data.quizzes) ? data.quizzes : [];
}

export async function generateQuizSet(
  id: string,
  prompt: string,
  existingQuestions: QuizQuestion[],
): Promise<{ title: string; questions: QuizQuestion[] }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/quizzes/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, existing_questions: existingQuestions }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { title: string; questions: QuizQuestion[] };
}

export async function saveQuizSet(
  id: string,
  payload: { title: string; prompt: string; questions: QuizQuestion[]; quizId?: number | null },
): Promise<QuizSet> {
  const url = payload.quizId
    ? `api/pdfs/${encodeURIComponent(id)}/quizzes/${encodeURIComponent(String(payload.quizId))}`
    : `api/pdfs/${encodeURIComponent(id)}/quizzes`;
  const resp = await fetch(url, {
    method: payload.quizId ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: payload.title, prompt: payload.prompt, questions: payload.questions }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as QuizSet;
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

export async function inpaintImage(
  id: string,
  pageNumber: number,
  imageFile: File,
  maskFile: File | null,
  prompt: string,
): Promise<InpaintImageResponse> {
  const form = new FormData();
  form.append('image', imageFile);
  if (maskFile) form.append('mask', maskFile);
  form.append('prompt', prompt);
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/inpaint-image`,
    { method: 'POST', body: form },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as InpaintImageResponse;
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

export async function updatePdfScriptSettings(
  id: string,
  scriptMaxCharsPerPage: number | null,
  hostMode?: 'solo' | 'dual',
): Promise<UpdateScriptSettingsResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/script-settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      script_max_chars_per_page: scriptMaxCharsPerPage,
      ...(hostMode ? { host_mode: hostMode } : {}),
    }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as UpdateScriptSettingsResponse;
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
  scripts?: { prompt?: string; script_max_chars_per_page?: number } | null;
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
    const scriptsBody: Record<string, unknown> = { prompt: options.scripts.prompt ?? '' };
    if (options.scripts.script_max_chars_per_page !== undefined) {
      scriptsBody.script_max_chars_per_page = options.scripts.script_max_chars_per_page;
    }
    body.scripts = scriptsBody;
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

export async function joinPlaybackSync(id: string, clientId: string, followerCode?: string): Promise<SyncJoinResponse> {
  const body: { client_id: string; follower_code?: string } = { client_id: clientId };
  const code = followerCode?.trim();
  if (code) body.follower_code = code;
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SyncJoinResponse;
}

export async function fetchPlaybackSyncState(id: string, clientId?: string): Promise<SyncStateResponse> {
  const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/state${q}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SyncStateResponse;
}

export async function updatePlaybackSyncState(
  id: string,
  clientId: string,
  payload: {
    page_number: number;
    is_playing: boolean;
    current_time: number;
    follower_audio_unlocked?: boolean;
    realtime_poll_started?: boolean;
    quiz_mode?: boolean;
    active_quiz_id?: number | null;
    quiz_show_answers?: boolean;
    cursor_x?: number | null;
    cursor_y?: number | null;
  },
): Promise<{ ok: boolean; role: 'master'; updated_at: string }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, ...payload }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean; role: 'master'; updated_at: string };
}

export async function leavePlaybackSync(id: string, clientId: string): Promise<{ ok: boolean }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/leave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean };
}

export async function submitSyncFollowerQuestion(
  id: string,
  clientId: string,
  question: string,
  code?: string,
): Promise<SyncFollowerQuestion> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, question, code }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SyncFollowerQuestion;
}

export async function toggleSyncDisplayedQuestion(
  id: string,
  clientId: string,
): Promise<{ ok: boolean; displayed_question_id: string | null }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/questions/toggle-display`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean; displayed_question_id: string | null };
}

export async function answerSyncFollowerQuestionsWithAi(
  id: string,
  clientId: string,
): Promise<SyncAiAnswer> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/questions/ai-answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SyncAiAnswer;
}

/**
 * 向後端送出「停止正在執行中的重生任務」請求；實際會在下一個頁面安全檢查點
 * 停止，並讓 status 進入 `cancelling` → `cancelled`。
 */
export type AddPagesStep =
  | 'generating_outline'
  | 'rendering_images'
  | 'generating_scripts'
  | 'synthesizing_audio';

export interface AddPagesPageResult {
  pageNumber: number;
  imageDone: boolean;
  scriptPreview: string | null;
}

export interface AddPagesJobState {
  pdfId: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  step: AddPagesStep | null;
  progress: { current: number; total: number } | null;
  addedPageNumbers: number[];
  totalPagesAfter: number | null;
  insertAfterPage: number | null;
  pageResults: AddPagesPageResult[];
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface StartAddPagesOptions {
  prompt?: string;
  outlineText?: string;
  insertAfterPage?: number;
}

export async function startAddPagesFromPrompt(
  id: string,
  opts: StartAddPagesOptions,
): Promise<AddPagesJobState> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/add-pages-from-prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: opts.prompt ?? '',
      outline_text: opts.outlineText,
      insert_after_page: opts.insertAfterPage,
    }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as AddPagesJobState;
}

export async function fetchAddPagesStatus(id: string): Promise<AddPagesJobState> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/add-pages-from-prompt/status`,
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as AddPagesJobState;
}

export async function cancelAddPagesJob(id: string): Promise<void> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/add-pages-from-prompt/cancel`,
    { method: 'POST' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
}

export interface AddPagesOutlineChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AddPagesOutlineChatResponse {
  assistant_message: string;
  outline_text: string;
}

export interface PageGenerationPrompt {
  stage: string;
  prompt_text: string;
  model: string | null;
  created_at: string;
}

export async function fetchPageGenerationPrompts(
  pdfId: string,
  pageNumber: number,
): Promise<PageGenerationPrompt[]> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(pdfId)}/pages/${encodeURIComponent(String(pageNumber))}/generation-prompts`,
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PageGenerationPrompt[];
}

export async function continueAddPagesOutlineChat(
  pdfId: string,
  messages: AddPagesOutlineChatMessage[],
  insertAfterPage?: number,
): Promise<AddPagesOutlineChatResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(pdfId)}/add-pages-outline-chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, insert_after_page: insertAfterPage }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as AddPagesOutlineChatResponse;
}

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

export async function confirmScript(id: string): Promise<{ id: string; status: string }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/confirm-script`, {
    method: 'POST',
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { id: string; status: string };
}
