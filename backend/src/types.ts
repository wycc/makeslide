/**
 * PDF lifecycle states.
 *
 * - `awaiting_prompt`: just uploaded; backend is waiting for the user to
 *   submit a style / tone prompt before firing the pipeline.
 * - `uploaded`: user submitted the prompt (or skipped it); queued to run
 *   but not yet started. On server crash recovery, rows in this state are
 *   re-enqueued automatically.
 * - `processing`: pipeline actively running.
 * - `ready`: all pages rendered + script + audio done.
 * - `failed`: pipeline threw; see `error_message`.
 */
export type PdfStatus =
  | 'awaiting_prompt'
  | 'uploaded'
  | 'processing'
  | 'awaiting_script_confirmation'
  | 'ready'
  | 'failed';

/**
 * Pipeline progress indicator written alongside status while a PDF is being
 * processed. Stored as a column on `pdfs` and in `metadata.json`.
 *
 * M2 stages: rendering → text_extracted.
 * M3/M4 will extend this with scripting / synthesizing.
 */
export type ProgressStep =
  | null
  | 'rendering'
  | 'extracting_text'
  | 'text_extracted'
  | 'scripting'
  | 'script_ready'
  | 'synthesizing'
  | 'rendering_video';

export type PageStatus =
  | 'pending'
  | 'rendered'
  | 'text_ready'
  | 'script_ready'
  | 'audio_ready'
  | 'failed';

export interface PdfRow {
  id: string;
  title: string | null;
  original_filename: string;
  status: PdfStatus;
  page_count: number | null;
  progress_step: ProgressStep;
  progress_current: number | null;
  progress_total: number | null;
  error_message: string | null;
  user_prompt: string | null;
  require_script_confirmation: number;
  tts_voice: string | null;
  tts_speed: number | null;
  script_max_chars_per_page: number | null;
  image_style_prompt?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageRow {
  pdf_id: string;
  page_number: number;
  image_path: string | null;
  text_path: string | null;
  script_path: string | null;
  audio_path: string | null;
  audio_duration_seconds: number | null;
  status: PageStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface PdfListItem {
  id: string;
  title: string | null;
  status: PdfStatus;
  page_count: number | null;
  progress_step: ProgressStep;
  progress_current: number | null;
  progress_total: number | null;
  cover_url: string | null;
  user_prompt: string | null;
  require_script_confirmation: boolean;
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  created_at: string;
}

export interface PdfDetailPage {
  page_number: number;
  image_url: string | null;
  text_url: string | null;
  script_url: string | null;
  audio_url: string | null;
  audio_duration_seconds: number | null;
  status: PageStatus;
}

export interface PdfDetail {
  id: string;
  title: string | null;
  original_filename: string;
  status: PdfStatus;
  page_count: number | null;
  progress_step: ProgressStep;
  progress_current: number | null;
  progress_total: number | null;
  error_message: string | null;
  user_prompt: string | null;
  require_script_confirmation: boolean;
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  created_at: string;
  updated_at: string;
  video_url?: string | null;
  pages: PdfDetailPage[];
}

export interface PdfMetadataPage {
  page_number: number;
  image: string | null;
  text: string | null;
  script?: string | null;
  audio?: string | null;
  status: PageStatus;
  text_empty?: boolean;
  script_chars?: number;
  script_generated_at?: string;
  audio_chars?: number;
  audio_generated_at?: string;
  audio_duration_seconds?: number | null;
}

export interface PdfMetadataModels {
  llm?: string;
  tts?: string;
  voice?: string;
  format?: string;
  speed?: number;
}

export interface PdfMetadataUsage {
  llm_tokens_total?: number;
  llm_prompt_tokens_total?: number;
  llm_completion_tokens_total?: number;
  tts_chars_total?: number;
}

export interface PdfMetadata {
  id: string;
  title: string | null;
  original_filename: string;
  status: PdfStatus;
  progress_step: ProgressStep;
  progress_current: number | null;
  progress_total: number | null;
  page_count: number | null;
  error_message: string | null;
  user_prompt?: string | null;
  require_script_confirmation?: boolean;
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  created_at: string;
  updated_at: string;
  video?: string | null;
  pages: PdfMetadataPage[];
  notes?: string;
  models?: PdfMetadataModels;
  usage?: PdfMetadataUsage;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
