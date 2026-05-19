import type { PageStatus, PdfStatus, ProgressStep } from './statusMachine';

export type { PageStatus, PdfStatus, ProgressStep } from './statusMachine';

export type PipelineRunType =
  | 'initial'
  | 'retry'
  | 'resume'
  | 'regenerate_batch'
  | 'regenerate_page'
  | 'regenerate_artifact'
  | 'generate_video';

export type PipelineRunStatus = 'running' | 'succeeded' | 'failed' | 'canceled' | 'partial';

export type PipelineStage =
  | 'queue_wait'
  | 'source_prepare'
  | 'render_pages'
  | 'extract_text'
  | 'split_text'
  | 'generate_scripts'
  | 'synthesize_audio'
  | 'generate_title'
  | 'generate_video'
  | 'finalize';

export type PageArtifact = 'image' | 'text' | 'script' | 'audio';

export type PageArtifactReason = 'initial' | 'regenerate' | 'resume' | 'retry' | 'dependency_changed' | 'manual_edit';

export type TimingEventStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled' | 'unknown';

export type TimingSlaStatus = 'met' | 'warning' | 'breached' | 'unknown';

export interface PdfDetailPageTimingItem {
  artifact: PageArtifact;
  status: TimingEventStatus;
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
  sla_target_ms: number | null;
  sla_status: TimingSlaStatus;
  run_id: string | null;
  attempt: number | null;
  reason: PageArtifactReason | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface PdfDetailPageTimings {
  image: PdfDetailPageTimingItem | null;
  text: PdfDetailPageTimingItem | null;
  script: PdfDetailPageTimingItem | null;
  audio: PdfDetailPageTimingItem | null;
}

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
  category: string;
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_voice: string | null;
  tts_speed: number | null;
  script_max_chars_per_page: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  source_type?: 'pdf' | 'youtube';
  source_url?: string | null;
  source_video_id?: string | null;
  source_caption_language?: string | null;
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
  cover_thumbnail_url?: string | null;
  user_prompt: string | null;
  require_script_confirmation: boolean;
  category: string;
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  source_type?: 'pdf' | 'youtube';
  source_url?: string | null;
  source_video_id?: string | null;
  source_caption_language?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PdfDetailPage {
  page_number: number;
  image_url: string | null;
  thumbnail_url?: string | null;
  text_url: string | null;
  script_url: string | null;
  audio_url: string | null;
  audio_duration_seconds: number | null;
  status: PageStatus;
  timings?: PdfDetailPageTimings | null;
}

export interface PagePollOption {
  text: string;
  votes: number;
}

export interface PagePoll {
  id: number;
  pdf_id: string;
  page_number: number;
  question: string;
  options: PagePollOption[];
  total_votes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
  category: string;
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  source_type?: 'pdf' | 'youtube';
  source_url?: string | null;
  source_video_id?: string | null;
  source_caption_language?: string | null;
  outline_url?: string | null;
  created_at: string;
  updated_at: string;
  share_mode?: 'read_only' | 'editable';
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
  category?: string | null;
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  source_type?: 'pdf' | 'youtube';
  source_url?: string | null;
  source_video_id?: string | null;
  source_caption_language?: string | null;
  captions_raw?: string | null;
  captions_normalized?: string | null;
  outline?: string | null;
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
