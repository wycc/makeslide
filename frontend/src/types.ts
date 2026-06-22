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
  | 'rendering_video'
  | 'extracting_text'
  | 'text_extracted'
  | 'scripting'
  | 'script_ready'
  | 'synthesizing'
  | 'downloading_captions'
  | 'downloading_audio'
  | 'transcribing_audio';

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
  /** Best-effort human-readable name (or email) for `owner_sub`; null when the owner has never logged in since this field existed. */
  owner_name?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  has_source_text?: boolean;
  github_sync_dirty?: boolean;
  github_synced_at?: string | null;
  tags?: string;
  last_played_at?: string | null;
  description?: string;
  created_at: string;
  updated_at: string;
}

export type SlideRenderType = 'static-image' | 'gsap-image';

export type SlideAnimationEffectType =
  | 'fade-in'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down'
  | 'highlight-box'
  | 'spotlight'
  | 'pointer'
  | 'text-callout'
  | 'shape'
  | 'step-list'
  | 'overlay-image'
  | 'formula'
  | 'pause-playback'
  | 'realtime-poll'
  | 'custom-script';

export type SlideAnimationEase = 'none' | 'power1.in' | 'power1.out' | 'power1.inOut' | 'power2.inOut' | 'elastic.out' | 'back.out';

/** SVG primitive shapes drawable by `shape` effects (design doc §12 V2 "SVG 圖元"). */
export type SlideAnimationShapeKind = 'circle' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'triangle' | 'star' | 'hexagon';

/** Ties an effect's start time to a transcript sentence instead of a fixed offset. */
export interface SlideAnimationStartTrigger {
  type: 'transcript-line';
  /** 0-based index into the page script's sentence list. */
  line: number;
  /** Seconds to start before the referenced sentence's estimated playback time. */
  offsetSeconds?: number;
}

export interface SlideAnimationEffect {
  id: string;
  target: 'slide';
  type: SlideAnimationEffectType;
  start: number;
  duration: number;
  ease: SlideAnimationEase;
  params?: Record<string, number>;
  /** When set, `start` is resolved at runtime from this transcript sentence's playback time. */
  startTrigger?: SlideAnimationStartTrigger;
  /**
   * Rotation angle in degrees for `pointer` effects (ignored by other effect types).
   * Defaults to `0` (pointing down-right) when omitted.
   */
  angle?: number;
  /** Arrow colour (CSS hex) for `pointer` effects. Defaults to `#f43f5e`. Ignored by other effect types. */
  pointerColor?: string;
  /** Arrow size in rem for `pointer` effects. Defaults to 2.5. Ignored by other effect types. */
  pointerSize?: number;
  /** Shape of the pointer. 'arrow' (default) = cursor SVG; 'dot' = filled circle. Ignored by other effect types. */
  pointerShape?: 'arrow' | 'dot' | 'cross';
  /** When `true`, the pointer pulses with a scale yoyo animation while visible. Ignored by other effect types. */
  pointerPulse?: boolean;
  /** Visible-state opacity (0–1) for `pointer` effects. Defaults to 1. Ignored by other effect types. */
  pointerOpacity?: number;
  /** Border colour (CSS hex) for `highlight-box` effects. Defaults to `#ef4444`. Ignored by other effect types. */
  highlightColor?: string;
  /** Border width (px) for `highlight-box` effects. Defaults to 4. Ignored by other effect types. */
  highlightBorderWidth?: number;
  /** Border radius (px) for `highlight-box` effects. Defaults to 8. Ignored by other effect types. */
  highlightBorderRadius?: number;
  /** Outer ring colour (CSS hex) for `highlight-box` effects. When set, adds a second outer border for contrast. Ignored by other effect types. */
  highlightOuterColor?: string;
  /** When `true`, the `highlight-box` border glow pulses periodically while visible. Ignored by other effect types. */
  highlightPulse?: boolean;
  /** Semi-transparent fill colour (CSS hex with optional alpha) for `highlight-box` effects. Default `'transparent'`. */
  highlightFillColor?: string;
  /** Border style for `highlight-box` effects. Defaults to `'solid'`. Ignored by other effect types. */
  highlightBorderStyle?: 'solid' | 'dashed' | 'dotted';
  /** When true, adds a drop shadow to the `highlight-box` overlay. Ignored by other effect types. */
  highlightShadow?: boolean;
  /** Caption text for `text-callout`, `pause-playback` and `realtime-poll` effects (ignored by other effect types). */
  text?: string;
  /** Font size in rem for `text-callout` effects. Defaults to 1.25. Ignored by other effect types. */
  textCalloutFontSize?: number;
  /** Background colour (CSS hex) for `text-callout` effects. Defaults to `#0f172a`. Ignored by other effect types. */
  textCalloutBgColor?: string;
  /** Text colour (CSS hex) for `text-callout` effects. Defaults to `#f8fafc`. Ignored by other effect types. */
  textCalloutTextColor?: string;
  /** Corner radius (px) for `text-callout` effects. Defaults to 8. Range 0-32. Ignored by other effect types. */
  textCalloutBorderRadius?: number;
  /** Text alignment for `text-callout` effects. Defaults to `'center'`. Ignored by other effect types. */
  textCalloutAlign?: 'left' | 'center' | 'right';
  /** Border colour (CSS hex) for `text-callout` effects. When set, adds a 2px solid border. Ignored by other effect types. */
  textCalloutBorderColor?: string;
  /** When true, adds a drop shadow to the `text-callout` box. Ignored by other effect types. */
  textCalloutShadow?: boolean;
  /** Maximum width in vw for `text-callout` effects. Range 10–80. Ignored by other effect types. */
  textCalloutMaxWidth?: number;
  /** Padding preset for `text-callout` effects. Defaults to `'md'`. Ignored by other effect types. */
  textCalloutPadding?: 'sm' | 'md' | 'lg';
  /** Mask colour (CSS hex) for `spotlight` effects. Defaults to `#000000`. Ignored by other effect types. */
  spotlightColor?: string;
  /** Mask opacity (0–1) for `spotlight` effects. Defaults to 0.6. Ignored by other effect types. */
  spotlightOpacity?: number;
  /** Soft-edge blur radius (px) for `spotlight` effects. 0 = hard edge. Ignored by other effect types. */
  spotlightSoftEdge?: number;
  /** Shape of the `spotlight` mask. `'circle'` (default) = elliptic; `'rect'` = rectangular. Ignored by other effect types. */
  spotlightShape?: 'circle' | 'rect';
  /** Corner radius (px) for rect-shaped `spotlight` effects. Defaults to 8. Range 0–32. Ignored by other effect types. */
  spotlightBorderRadius?: number;
  /** SVG primitive drawn by `shape` effects (ignored by other effect types). Defaults to `'circle'` when omitted. */
  shape?: SlideAnimationShapeKind;
  /**
   * Stroke colour (CSS hex, e.g. `#f43f5e`) for `shape` effects. Defaults to
   * `'#f43f5e'` when omitted. Ignored by other effect types.
   */
  color?: string;
  /** Fill colour (CSS hex) for `shape` effects. When absent the shape is hollow. Ignored by other effect types. */
  shapeFillColor?: string;
  /** Base opacity (0-1) for `shape` effects. Layered on top of GSAP fade-in/out. Defaults to 1. Ignored by other effect types. */
  shapeOpacity?: number;
  /** SVG stroke-dasharray value for `shape` effects. Empty string = solid. Format: space-separated numbers e.g. '8 4'. Ignored by other effect types. */
  shapeDashArray?: string;
  /** Corner radius (SVG rx units) for `rect` shape effects. Defaults to 6. Range 0–24. Ignored by other shape kinds and effect types. */
  shapeRectRadius?: number;
  /** When true, applies a stroke-colour glow to `shape` effects. Ignored by other effect types. */
  shapeGlow?: boolean;
  /**
   * Stroke width (SVG user units in a 100×100 viewBox) for `shape` effects.
   * Defaults to 5 when omitted. Ignored by other effect types.
   */
  strokeWidth?: number;
  /**
   * Bullet items for `step-list` effects (ignored by other effect types).
   * Each item is revealed in sequence (staggered fade-in) over `duration`.
   * Up to `MAX_STEP_LIST_ITEMS` items, each up to `MAX_STEP_LIST_ITEM_LENGTH` chars.
   */
  items?: string[];
  /** Background colour (CSS hex) for `step-list` effects. Defaults to `#1e293b`. Ignored by other effect types. */
  stepListBgColor?: string;
  /** Text colour (CSS hex) for `step-list` effects. Defaults to `#f1f5f9`. Ignored by other effect types. */
  stepListTextColor?: string;
  /** Font size in rem for `step-list` effects. Defaults to 1.1. Ignored by other effect types. */
  stepListFontSize?: number;
  /** Corner radius (px) for `step-list` effects. Defaults to 8. Range 0-32. Ignored by other effect types. */
  stepListBorderRadius?: number;
  /** Border colour (CSS hex) for `step-list` effects. When set, adds a 2px solid border. Ignored by other effect types. */
  stepListBorderColor?: string;
  /** List bullet/numbering style for `step-list` effects. Defaults to `'disc'`. Ignored by other effect types. */
  stepListBulletStyle?: 'disc' | 'decimal' | 'none';
  /** 0-based item index to highlight in `step-list` effects. Omitted means no highlighted item. Ignored by other effect types. */
  stepListHighlightIndex?: number;
  /**
   * Id of a figure extracted from the slide's source PDF (see
   * `fetchPageFigures`), shown as a positioned image overlay by
   * `overlay-image` effects (ignored by other effect types). Up to
   * `MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH` chars.
   */
  figureId?: string;
  /** Opacity (0–1) for `overlay-image` effects. Defaults to 1. Ignored by other effect types. */
  overlayImageOpacity?: number;
  /** Corner radius (px) for `overlay-image` effects. Defaults to 0. Range 0–48. Ignored by other effect types. */
  overlayImageBorderRadius?: number;
  /** When true, adds a drop shadow to the `overlay-image`. Ignored by other effect types. */
  overlayImageShadow?: boolean;
  /**
   * LaTeX source rendered as a math formula by `formula` effects (ignored by
   * other effect types), via KaTeX. Up to `MAX_FORMULA_LENGTH` chars.
   */
  formula?: string;
  /**
   * Font size in em units for `formula` effect rendering. Defaults to 1.5em.
   * Range: 0.5–4em. Ignored by other effect types.
   */
  formulaFontSize?: number;
  /** Background colour (CSS hex) for `formula` effects. Defaults to `#0f172a`. */
  formulaBgColor?: string;
  /** Text/symbol colour (CSS hex) for `formula` effects. Defaults to `#f8fafc`. */
  formulaTextColor?: string;
  /** Corner radius (px) for `formula` effects. Defaults to 8. Range 0-32. */
  formulaBorderRadius?: number;
  /** Border colour (CSS hex) for `formula` effects. When set, adds a 2px solid border. Ignored by other effect types. */
  formulaBorderColor?: string;
  /** When true, adds a drop shadow to the `formula` box. Ignored by other effect types. */
  formulaShadow?: boolean;
  /**
   * Id of a `PagePoll` already defined for this page (see `fetchPagePolls`),
   * shown by `realtime-poll` effects (ignored by other effect types).
   */
  pollId?: number;
  /**
   * Seconds to remain in the "entered" state after the entrance animation
   * completes before automatically reversing back to the original state
   * (same `duration`/`ease`, played in reverse). For overlay effect types
   * (`highlight-box`, `spotlight`, `pointer`, `text-callout`, `shape`, `step-list`, `overlay-image`, `formula`, `pause-playback`, `realtime-poll`, `custom-script`)
   * this fades the overlay back out; for whole-slide transform effect types
   * (`fade-in`, `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `pan-up`,
   * `pan-down`) this animates the slide back to its pre-effect state.
   */
  exitDuration?: number;
  /**
   * JavaScript source for `custom-script` effects, executed inside a
   * sandboxed `<iframe sandbox="allow-scripts">`. Ignored by other effect types.
   */
  code?: string;
  /** The prompt that produced `code`, kept so the user can iterate. Ignored by other effect types. */
  prompt?: string;
  /**
   * Multi-turn chat history with the AI custom-script generator, so each new
   * prompt can build on prior turns. Ignored by other effect types.
   */
  conversation?: ChatMessage[];
}

export interface SlideAnimationSpec {
  version: 1;
  enabled: boolean;
  effects: SlideAnimationEffect[];
  /**
   * Optional per-sentence animation guidance, keyed by 0-based transcript
   * line index (as a string). Free-text notes the user writes manually to
   * describe what animation they want for that sentence; reserved as
   * reference input for a future LLM-based animation generator.
   */
  hints?: Record<string, string>;
}

/** A figure (chart/image) extracted from the slide's source PDF page(s), for the figure-asset browser/picker. */
export interface PageFigure {
  id: string;
  caption: string | null;
  context: string | null;
  bbox: { xPct: number; yPct: number; widthPct: number; heightPct: number };
  source: 'raster' | 'vector';
  image_url: string;
  /** Whether the user has excluded this figure from use as an image-generation reference. */
  excluded: boolean;
}

export interface PageFiguresResponse {
  page_number: number;
  source_pdf_pages: number[];
  figures: PageFigure[];
}

export interface PdfDetailPage {
  page_number: number;
  image_url: string | null;
  thumbnail_url?: string | null;
  text_url: string | null;
  script_url?: string | null;
  audio_url?: string | null;
  audio_duration_seconds?: number | null;
  render_type?: SlideRenderType;
  animation_spec_url?: string | null;
  status: PageStatus;
  error_message?: string | null;
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
  owner_sub?: string | null;
  visibility?: 'private' | 'public' | 'public_editable';
  tts_provider?: 'openai' | 'gemini';
  tts_voice?: string | null;
  tts_speed?: number | null;
  host_mode?: 'solo' | 'dual';
  script_max_chars_per_page?: number | null;
  image_style_prompt?: string | null;
  total_audio_duration_seconds?: number | null;
  share_mode?: 'read_only' | 'editable';
  /**
   * Whether the requester is this PDF's owner (or the PDF has no owner, i.e.
   * legacy/anonymous data). The owner is always read-write regardless of
   * `visibility`/`share_mode`, which only restrict other visitors.
   */
  is_owner?: boolean;
  /** Whether the requester has an authenticated session (logged in). False for anonymous visitors. */
  is_authenticated?: boolean;
  has_source_text?: boolean;
  tags?: string;
  last_played_at?: string | null;
  description?: string;
  created_at: string;
  updated_at: string;
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
  score?: number | null;
  page_number?: number | null;
}

export interface QuizSet {
  id: number;
  pdf_id: string;
  title: string;
  prompt: string;
  questions: QuizQuestion[];
  time_limit_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface UploadResponse {
  id: string;
  status: PdfStatus;
  title: string | null;
  original_filename: string;
  user_prompt: string | null;
  require_script_confirmation: boolean;
  category: string;
  has_source_text?: boolean;
  tts_provider?: 'openai' | 'gemini';
  host_mode?: 'solo' | 'dual';
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

export type RegenStepName = 'script' | 'audio' | 'image' | 'animation';

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

export interface SyncQuizProgress {
  client_id: string;
  code: string | null;
  quiz_id: number;
  answered_count: number;
  total_questions: number;
  submitted: boolean;
  updated_at: string;
}

export interface QuizAttempt {
  id: number;
  quiz_id: number;
  session_id: string;
  client_id: string;
  code: string | null;
  answers: Record<string, number[]>;
  score: number | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export interface QuizAttemptSession {
  session_id: string;
  submitted_at: string;
  attempts: QuizAttempt[];
}

export interface QuizAttemptsResponse {
  sessions: QuizAttemptSession[];
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
  user_code: string | null;
  master_client_id: string | null;
  page_number: number;
  is_playing: boolean;
  current_time: number;
  follower_audio_unlocked: boolean;
  realtime_poll_started: boolean;
  quiz_mode: boolean;
  active_quiz_id: number | null;
  quiz_session_id?: string | null;
  quiz_show_answers: boolean;
  follower_questions: SyncFollowerQuestion[];
  questions: SyncFollowerQuestion[];
  displayed_question_id: string | null;
  quiz_progress?: SyncQuizProgress[];
  ai_answer: SyncAiAnswer | null;
  updated_at: string;
  master_expires_at: string | null;
  online_count?: number;
  cursor_x?: number | null;
  cursor_y?: number | null;
  drawing_page_number?: number | null;
  drawing_json?: string | null;
}

export interface SyncStateResponse {
  pdf_id: string;
  role: SyncRole;
  user_code: string | null;
  master_client_id: string | null;
  page_number: number;
  is_playing: boolean;
  current_time: number;
  follower_audio_unlocked: boolean;
  realtime_poll_started: boolean;
  quiz_mode: boolean;
  active_quiz_id: number | null;
  quiz_session_id?: string | null;
  quiz_show_answers: boolean;
  follower_questions: SyncFollowerQuestion[];
  displayed_question_id: string | null;
  quiz_progress?: SyncQuizProgress[];
  ai_answer: SyncAiAnswer | null;
  updated_at: string;
  master_expires_at: string | null;
  online_count?: number;
  questions?: SyncFollowerQuestion[];
  cursor_x?: number | null;
  cursor_y?: number | null;
  drawing_page_number?: number | null;
  drawing_json?: string | null;
}
