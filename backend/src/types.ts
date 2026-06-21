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
  | 'extract_figures'
  | 'split_text'
  | 'generate_scripts'
  | 'synthesize_audio'
  | 'generate_animations'
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

export interface PipelineRunStageSummary {
  stage: PipelineStage;
  status: TimingEventStatus;
  attempt: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  sla_target_ms: number | null;
  sla_status: TimingSlaStatus;
  error_code: string | null;
  error_message: string | null;
}

export interface LlmUsageSummary {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_latency_ms: number;
  estimated_cost_usd: number | null;
}

export interface PipelineRunSummary {
  id: string;
  run_type: PipelineRunType;
  parent_run_id: string | null;
  triggered_by: string;
  status: PipelineRunStatus;
  attempt: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  sla_status: TimingSlaStatus;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  stages: PipelineRunStageSummary[];
  llm_usage: LlmUsageSummary;
}

export interface PipelineRunsResponse {
  runs: PipelineRunSummary[];
}

export interface SlowArtifactSummary {
  page_number: number;
  artifact: PageArtifact;
  status: TimingEventStatus;
  duration_ms: number | null;
  sla_target_ms: number | null;
  sla_status: TimingSlaStatus;
  updated_at: string;
}

export interface SlowArtifactsResponse {
  artifacts: SlowArtifactSummary[];
}

export type SlaTargetKind = 'stage' | 'artifact';

export interface SlaTargetSetting {
  kind: SlaTargetKind;
  name: string;
  default_ms: number;
  override_ms: number | null;
  effective_ms: number;
  updated_at: string | null;
}

export interface SlaSettingsResponse {
  bounds: { min_ms: number; max_ms: number };
  stages: SlaTargetSetting[];
  artifacts: SlaTargetSetting[];
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
  require_split_confirmation: number;
  category: string;
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_voice: string | null;
  tts_speed: number | null;
  host_mode?: string | null;
  script_max_chars_per_page: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  source_type?: 'pdf' | 'youtube';
  source_url?: string | null;
  source_video_id?: string | null;
  source_caption_language?: string | null;
  github_synced_commit?: string | null;
  github_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type SlideRenderType = 'static-image' | 'gsap-image';

export interface PageRow {
  pdf_id: string;
  page_number: number;
  page_uid: string;
  image_path: string | null;
  text_path: string | null;
  script_path: string | null;
  audio_path: string | null;
  audio_duration_seconds: number | null;
  status: PageStatus;
  error_message: string | null;
  // GSAP slide animation V1 — older SELECTs that don't need these cast rows
  // without them, so keep them optional at the type level.
  render_type?: SlideRenderType | null;
  animation_spec_path?: string | null;
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
  require_split_confirmation: boolean;
  category: string;
  owner_sub?: string | null;
  /** Best-effort human-readable name (or email) for `owner_sub`, from the `accounts` table; null when the owner has never logged in since this field existed. Only set on list items, not on `PdfDetail`. */
  owner_name?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  host_mode?: 'solo' | 'dual';
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  source_type?: 'pdf' | 'youtube';
  source_url?: string | null;
  source_video_id?: string | null;
  source_caption_language?: string | null;
  github_sync_dirty?: boolean;
  github_synced_at?: string | null;
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
  render_type: SlideRenderType;
  animation_spec_url: string | null;
  status: PageStatus;
  error_message?: string | null;
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
  require_split_confirmation: boolean;
  category: string;
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  host_mode?: 'solo' | 'dual';
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
  /**
   * Whether the requester is this PDF's owner (or the PDF has no owner, i.e.
   * legacy/anonymous data). Lets the frontend always treat the owner as
   * read-write, even when `visibility`/`share_mode` mark the PDF read-only
   * for a public read-only share link.
   */
  is_owner?: boolean;
  video_url?: string | null;
  pages: PdfDetailPage[];
  sources?: PdfSourceItem[];
}

export interface PdfSourceItem {
  id: number;
  pdf_id: string;
  source_kind: 'pdf' | 'txt' | 'youtube_caption' | 'youtube_audio';
  source_name: string | null;
  content_text: string;
  created_at: string;
  updated_at: string;
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
  require_split_confirmation?: boolean;
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
  source_audio?: string | null;
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
