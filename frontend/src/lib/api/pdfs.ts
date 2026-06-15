import type {
  ChatHistoryResponse,
  ChatMessage,
  PageChatResponse,
  PageFiguresResponse,
  PagePoll,
  PdfDetail,
  PdfListItem,
  PipelineRunsResponse,
  QuizAttempt,
  SlowArtifactsResponse,
  QuizAttemptsResponse,
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
  SlideAnimationSpec,
  SlideRenderType,
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

export async function fetchPdfDetail(id: string, shareToken?: string): Promise<PdfDetail> {
  const token = shareToken?.trim();
  const suffix = token ? `?share=${encodeURIComponent(token)}` : '';
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}${suffix}`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as PdfDetail;
}

/** Pipeline run history (initial/regenerate/resume/...) for this PDF, for the "系統資料" tab's run history section. */
export async function fetchPdfRunHistory(id: string, shareToken?: string, limit?: number): Promise<PipelineRunsResponse> {
  const token = shareToken?.trim();
  const params = new URLSearchParams();
  if (token) params.set('share', token);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/runs${suffix}`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as PipelineRunsResponse;
}

/** Slowest page artifacts (image/text/script/audio) ranked by duration_ms, for the "系統資料" tab's slow artifact ranking section. */
export async function fetchPdfSlowArtifacts(id: string, shareToken?: string, limit?: number): Promise<SlowArtifactsResponse> {
  const token = shareToken?.trim();
  const params = new URLSearchParams();
  if (token) params.set('share', token);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/slow-artifacts${suffix}`);
  if (!resp.ok) {
    throw await parseErrorBody(resp);
  }
  return (await resp.json()) as SlowArtifactsResponse;
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

export interface PageAnimationResponse {
  page_number: number;
  render_type: SlideRenderType;
  spec: SlideAnimationSpec;
}

export async function fetchPageAnimation(
  id: string,
  pageNumber: number,
  shareToken?: string,
): Promise<PageAnimationResponse> {
  const token = shareToken?.trim();
  const suffix = token ? `?share=${encodeURIComponent(token)}` : '';
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/pages/${pageNumber}/animation${suffix}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PageAnimationResponse;
}

export interface SavePageAnimationResponse {
  page_number: number;
  render_type: SlideRenderType;
  animation_spec_url: string | null;
  updated_at: string;
}

export async function savePageAnimation(
  id: string,
  pageNumber: number,
  spec: SlideAnimationSpec,
): Promise<SavePageAnimationResponse> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/pages/${pageNumber}/animation`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spec }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SavePageAnimationResponse;
}

/** Relative URL for an extracted figure's image, as used by `PageFigure.image_url` and `overlay-image` effects (`effect.figureId`). */
export function figureImageUrl(pdfId: string, figureId: string): string {
  return `api/pdfs/${encodeURIComponent(pdfId)}/figures/${encodeURIComponent(figureId)}/image`;
}

/** Lists the figures extracted from this slide's source PDF page(s), for the figure-asset browser/picker. */
export async function fetchPageFigures(
  id: string,
  pageNumber: number,
  shareToken?: string,
): Promise<PageFiguresResponse> {
  const token = shareToken?.trim();
  const suffix = token ? `?share=${encodeURIComponent(token)}` : '';
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${pageNumber}/figures${suffix}`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as PageFiguresResponse;
}

export interface SaveFigureSelectionResponse {
  page_number: number;
  excluded: string[];
  updated_at: string;
}

/** Saves which extracted figure ids are excluded from use as image-generation reference for this slide. */
export async function savePageFigureSelection(
  id: string,
  pageNumber: number,
  excluded: string[],
): Promise<SaveFigureSelectionResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/pages/${pageNumber}/figures/selection`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ excluded }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SaveFigureSelectionResponse;
}

export interface GenerateAiFocusEffectsResponse {
  effects: SlideAnimationSpec['effects'];
}

/** Asks the backend's LLM to decide, per transcript sentence, whether/where to show a focus effect. */
export async function generateAiFocusEffects(
  id: string,
  pageNumber: number,
  body: { sentences: string[]; hints?: Record<string, string> },
): Promise<GenerateAiFocusEffectsResponse> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/pages/${pageNumber}/animation/auto-focus-ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as GenerateAiFocusEffectsResponse;
}

export interface GenerateCustomScriptCodeResponse {
  code: string;
  plan: string;
}

export interface GenerateCustomScriptCodeCallbacks {
  /** A chunk of the implementation step plan, streamed before code generation begins. */
  onPlanDelta?: (delta: string) => void;
  /** The final implementation step plan, shown to the user before code generation begins. */
  onPlanDone?: (plan: string) => void;
  /** A chunk of generated code, streamed as it's produced. */
  onDelta?: (delta: string) => void;
}

/**
 * Asks the backend's LLM to generate (or revise) the JavaScript source for a
 * `custom-script` effect, in two steps. The backend responds with an SSE stream:
 * - `event: plan-delta` — `{ text }`, a chunk of the implementation step plan; reported via `onPlanDelta`.
 * - `event: plan-done`  — `{ plan }`, the final step plan, shown to the user before code generation begins; reported via `onPlanDone`.
 * - `event: delta` — `{ text }`, a chunk of generated code; reported via `onDelta` as it arrives.
 * - `event: done`  — `{ code }`, the final, validated code.
 * - `event: error` — `{ code, message }`, thrown as an `ApiError`.
 */
export async function generateCustomScriptCode(
  id: string,
  pageNumber: number,
  body: { prompt: string; previousCode?: string; history?: ChatMessage[] },
  callbacks?: GenerateCustomScriptCodeCallbacks,
): Promise<GenerateCustomScriptCodeResponse> {
  const resp = await fetch(`/api/pdfs/${encodeURIComponent(id)}/pages/${pageNumber}/animation/custom-script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  if (!resp.body) throw new ApiError('Empty response body', 'INTERNAL_ERROR', resp.status);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let code: string | null = null;
  let plan = '';

  const handleEvent = (block: string): void => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
    }
    if (!data) return;
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (event === 'plan-delta') {
      const text = parsed.text;
      if (typeof text === 'string' && text) callbacks?.onPlanDelta?.(text);
    } else if (event === 'plan-done') {
      const donePlan = parsed.plan;
      if (typeof donePlan === 'string') {
        plan = donePlan;
        callbacks?.onPlanDone?.(donePlan);
      }
    } else if (event === 'delta') {
      const text = parsed.text;
      if (typeof text === 'string' && text) callbacks?.onDelta?.(text);
    } else if (event === 'done') {
      const doneCode = parsed.code;
      if (typeof doneCode === 'string') code = doneCode;
    } else if (event === 'error') {
      throw new ApiError(
        typeof parsed.message === 'string' ? parsed.message : 'Generation failed',
        typeof parsed.code === 'string' ? parsed.code : 'INTERNAL_ERROR',
        resp.status,
      );
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        handleEvent(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }

  if (code === null) {
    throw new ApiError('Stream ended without a result', 'INTERNAL_ERROR', resp.status);
  }
  return { code, plan };
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
  host_mode?: 'solo' | 'dual';
  category: string;
  created_at: string;
}

export async function createYoutubeTask(
  youtubeUrl: string,
  language?: string,
  hostMode?: 'solo' | 'dual',
): Promise<CreateYoutubeTaskResponse> {
  const resp = await fetch('api/youtube', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      youtube_url: youtubeUrl,
      language: language?.trim() || undefined,
      host_mode: hostMode,
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
  maskFile: File | null,
  referenceFile: File | null,
  prompt: string,
): Promise<InpaintImageResponse> {
  const form = new FormData();
  if (maskFile) form.append('mask', maskFile);
  if (referenceFile) form.append('reference', referenceFile);
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
  animations?: Record<string, never> | null;
  page_numbers?: number[] | null;
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
  if (options.animations) {
    body.animations = {};
  }
  if (options.page_numbers?.length) {
    body.page_numbers = options.page_numbers;
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

export async function joinPlaybackSync(id: string, clientId: string, userCode?: string): Promise<SyncJoinResponse> {
  const body: { client_id: string; user_code?: string } = { client_id: clientId };
  const code = userCode?.trim();
  if (code) body.user_code = code;
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as SyncJoinResponse;
}

export async function joinSharedPlaybackSync(
  id: string,
  clientId: string,
  shareToken: string,
): Promise<SyncJoinResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/share-join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-makeslide-share-token': shareToken,
    },
    body: JSON.stringify({ client_id: clientId }),
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
    drawing_page_number?: number | null;
    drawing_json?: string | null;
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
  userCode?: string,
): Promise<SyncFollowerQuestion> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, question, user_code: userCode }),
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

export async function submitSyncQuizProgress(
  id: string,
  clientId: string,
  payload: { quiz_id: number; answered_count: number; total_questions: number; submitted?: boolean },
): Promise<{ ok: boolean }> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/sync/quiz/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, ...payload }),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as { ok: boolean };
}

export async function submitQuizAttempt(
  id: string,
  quizId: number,
  payload: { client_id: string; session_id: string; code?: string | null; answers: Record<string, number[]>; score?: number },
): Promise<QuizAttempt> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/quizzes/${quizId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as QuizAttempt;
}

export async function fetchQuizAttempts(id: string, quizId: number): Promise<QuizAttemptsResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/quizzes/${quizId}/attempts`);
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as QuizAttemptsResponse;
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

// ---- Versioning (git history) ----

export interface FileVersionEntry {
  hash: string;
  date: string;
  message: string;
}

export interface FileHistoryResponse {
  history: FileVersionEntry[];
}

export async function fetchImageHistory(id: string, pageNumber: number): Promise<FileHistoryResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/image/history`,
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as FileHistoryResponse;
}

export async function fetchScriptHistory(id: string, pageNumber: number): Promise<FileHistoryResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/script/history`,
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as FileHistoryResponse;
}

export function imageVersionUrl(id: string, pageNumber: number, hash: string): string {
  return `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/image/versions/${encodeURIComponent(hash)}`;
}

export async function fetchScriptVersion(id: string, pageNumber: number, hash: string): Promise<string> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/script/versions/${encodeURIComponent(hash)}`,
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return resp.text();
}

export interface RestoreImageResponse {
  id: string;
  page_number: number;
  image_url: string;
  updated_at: string;
}

export async function restoreImageVersion(
  id: string,
  pageNumber: number,
  hash: string,
): Promise<RestoreImageResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/image/restore/${encodeURIComponent(hash)}`,
    { method: 'POST' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RestoreImageResponse;
}

export interface RestoreScriptResponse {
  id: string;
  page_number: number;
  script: string;
  updated_at: string;
}

// ---- GitHub sync ----

export interface GithubSyncResponse {
  ok: boolean;
  id: string;
  branch: string;
  repo_url: string;
}

export async function syncPresentationToGitHub(id: string): Promise<GithubSyncResponse> {
  const resp = await fetch(`api/pdfs/${encodeURIComponent(id)}/github-sync`, { method: 'POST' });
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as GithubSyncResponse;
}

export async function restoreScriptVersion(
  id: string,
  pageNumber: number,
  hash: string,
): Promise<RestoreScriptResponse> {
  const resp = await fetch(
    `api/pdfs/${encodeURIComponent(id)}/pages/${encodeURIComponent(String(pageNumber))}/script/restore/${encodeURIComponent(hash)}`,
    { method: 'POST' },
  );
  if (!resp.ok) throw await parseErrorBody(resp);
  return (await resp.json()) as RestoreScriptResponse;
}
