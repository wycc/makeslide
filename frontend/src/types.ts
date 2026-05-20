/**
 * PDF lifecycle states. `awaiting_prompt` is the initial state right
 * after upload — the frontend should show a prompt dialog and call
 * POST /api/pdfs/:id/start before the backend pipeline runs.
 */
export type PdfStatus =
  | 'awaiting_prompt'
  | 'uploaded'
  | 'processing'
  | 'awaiting_script_confirmation'
  | 'ready'
  | 'failed';

export type ProgressStep =
  | null
  | 'rendering'
  | 'extracting_text'
  | 'text_extracted'
  | 'scripting'
  | 'script_ready'
  | 'synthesizing';

export type PageStatus =
  | 'pending'
  | 'rendered'
  | 'text_ready'
  | 'script_ready'
  | 'audio_ready'
  | 'failed';

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
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  created_at: string;
  updated_at: string;
}

export interface PdfDetailPage {
  page_number: number;
  image_url: string | null;
  thumbnail_url?: string | null;
  text_url: string | null;
  script_url?: string | null;
  audio_url?: string | null;
  audio_duration_seconds?: number | null;
  status: PageStatus;
  timings?: PdfDetailPageTimings | null;
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
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  share_mode?: 'read_only' | 'editable';
  created_at: string;
  updated_at: string;
  video_url?: string | null;
  pages: PdfDetailPage[];
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
  answered_count?: number;
  is_active: boolean;
  show_results: boolean;
  created_at: string;
  updated_at: string;
}

export type QuizQuestionType = 'single' | 'multiple';

export interface QuizOption {
  text: string;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  options: QuizOption[];
  answer_indices: number[];
  explanation: string;
}

export interface QuizSet {
  id: number;
  pdf_id: string;
  title: string;
  prompt: string;
  questions: QuizQuestion[];
  created_at: string;
  updated_at: string;
}

export interface UploadResponse {
  id: string;
  status: PdfStatus;
  title: string;
  original_filename: string;
  user_prompt: string | null;
  require_script_confirmation: boolean;
  category: string;
  tts_provider?: 'openai' | 'gemini';
  created_at: string;
}

export interface StartProcessingResponse {
  id: string;
  status: PdfStatus;
  user_prompt: string | null;
  require_script_confirmation: boolean;
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  updated_at: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatHistoryResponse {
  history: ChatMessage[];
}

export interface PageChatResponse {
  answer: string;
}

export type RegenStepName = 'script' | 'audio' | 'image';

export type RegenStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type RegenJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export interface RegenStepProgress {
  name: RegenStepName;
  status: RegenStepStatus;
  total: number;
  completed: number;
  eta_seconds: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface RegenJobState {
  job_id: string;
  pdf_id: string;
  steps: RegenStepProgress[];
  current_step: RegenStepName | null;
  step_index: number;
  status: RegenJobStatus;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  error: string | null;
  message: string | null;
  cancel_requested: boolean;
  last_processed_page: number | null;
  last_generated_page: number | null;
  eta_seconds: number | null;
  estimated_completion_at: string | null;
  snapshot_id: string | null;
  rollback_available: boolean;
}

export interface RollbackRegenerateResponse {
  id: string;
  rolled_back_pages: number;
  asset_types: RegenStepName[];
  snapshot_id: string;
}

export type SyncRole = 'master' | 'follower';

export interface SyncFollowerQuestion {
  id: string;
  clientId: string;
  client_id?: string;
  code: string | null;
  question: string;
  show_on_screen?: boolean;
  createdAt: string;
  created_at?: string;
}

export interface SyncAiAnswer {
  id: string;
  answer: string;
  questionIds: string[];
  question_ids?: string[];
  createdAt: string;
  created_at?: string;
}

export interface SyncJoinResponse {
  pdf_id: string;
  role: SyncRole;
  follower_code: string | null;
  master_client_id: string | null;
  page_number: number;
  is_playing: boolean;
  current_time: number;
  follower_audio_unlocked: boolean;
  realtime_poll_started: boolean;
  quiz_mode: boolean;
  active_quiz_id: number | null;
  quiz_show_answers: boolean;
  follower_questions: SyncFollowerQuestion[];
  questions: SyncFollowerQuestion[];
  displayed_question_id: string | null;
  ai_answer: SyncAiAnswer | null;
  updated_at: string;
  master_expires_at: string | null;
  online_count?: number;
}

export interface SyncStateResponse {
  pdf_id: string;
  role: SyncRole;
  follower_code: string | null;
  master_client_id: string | null;
  page_number: number;
  is_playing: boolean;
  current_time: number;
  follower_audio_unlocked: boolean;
  realtime_poll_started: boolean;
  quiz_mode: boolean;
  active_quiz_id: number | null;
  quiz_show_answers: boolean;
  follower_questions: SyncFollowerQuestion[];
  displayed_question_id: string | null;
  ai_answer: SyncAiAnswer | null;
  updated_at: string;
  master_expires_at: string | null;
  online_count?: number;
  questions?: SyncFollowerQuestion[];
}
