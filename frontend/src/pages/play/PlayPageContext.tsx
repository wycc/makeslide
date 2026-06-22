import { createContext, useContext } from 'react';
import type { ChangeEvent, Dispatch, SetStateAction, RefObject, MutableRefObject } from 'react';
import type {
  ChatMessage,
  PdfDetail,
  PdfDetailPage,
  PagePoll,
  PdfSourceItem,
  RegenJobState,
  SlideAnimationSpec,
  SyncAiAnswer,
  SyncFollowerQuestion,
} from '../../types';
import type { ImagePromptTemplate, PageGenerationPrompt, PageWatchProgressStats, ShareAccessMode } from '../../lib/api';
import type { TtsProvider } from '../../lib/ttsVoices';
import type { SentenceTimelineItem } from '../../lib/subtitles';
import type { DrawingCanvasHandle, DrawingData, DrawingStroke } from '../../components/DrawingCanvas';
import type { SubtitleSize } from '../../i18n';

// ── Inline alias types ────────────────────────────────────────────────────────
type HostMode = 'solo' | 'dual';
type EditTab = 'script' | 'prompt' | 'animation' | 'figures' | 'source' | 'system';
type ActiveTab = 'play' | 'qa';
type SyncRole = 'master' | 'follower';
type FullscreenLayout = 'image' | 'split' | 'edit' | 'animation';
type DrawingTool = 'pen' | 'cursor' | 'eraser';
type RegenOptions = { image: boolean; script: boolean; audio: boolean; animation: boolean };
type ImageEditRegion = { x: number; y: number; w: number; h: number } | null;

// ── Full context interface ────────────────────────────────────────────────────
export interface PlayPageContextValue {
  // ─── Routing / identity ─────────────────────────────────────────────────────
  pdfId: string | undefined;
  currentShareToken: string;
  isLockedFullscreen: boolean;

  // ─── Deck data (derived) ────────────────────────────────────────────────────
  detail: PdfDetail | null;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
  deckPages: PdfDetailPage[];
  currentPage: PdfDetailPage | null;
  currentIdx: number;
  setCurrentIdx: Dispatch<SetStateAction<number>>;
  totalPages: number;
  loadError: string | null;
  /** 僅 owner 可見的每頁觀看進度聚合統計，依 `page_number` 查找；無資料或非 owner 時為空 Map。 */
  watchProgressByPage: Map<number, PageWatchProgressStats>;

  // ─── Playback ───────────────────────────────────────────────────────────────
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  /** 語音已結束，但動畫長度超過語音長度，目前正在延長播放本頁以等動畫播完。 */
  isExtendingAnimation: boolean;
  /** 傳給 SlideRenderer 的 isPlaying：語音播放中或正在延長動畫播放時都為 true，讓 GSAP timeline 繼續播完。 */
  slideAnimationPlaying: boolean;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  duration: number;
  setDuration: Dispatch<SetStateAction<number>>;
  finished: boolean;
  setFinished: Dispatch<SetStateAction<boolean>>;
  audioMuted: boolean;
  setAudioMuted: Dispatch<SetStateAction<boolean>>;
  effectiveAudioMuted: boolean;
  audioVolume: number;
  setAudioVolume: Dispatch<SetStateAction<number>>;
  playbackRate: number;
  setPlaybackRate: Dispatch<SetStateAction<number>>;
  showSubtitle: boolean;
  setShowSubtitle: Dispatch<SetStateAction<boolean>>;
  subtitleSize: SubtitleSize;
  setSubtitleSize: Dispatch<SetStateAction<SubtitleSize>>;
  autoAdvance: boolean;
  setAutoAdvance: Dispatch<SetStateAction<boolean>>;
  playbackSettingsOpen: boolean;
  setPlaybackSettingsOpen: Dispatch<SetStateAction<boolean>>;
  playbackStatusMessage: string | null;
  followerAudioUnlocked: boolean;
  setFollowerAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  scripts: Record<number, string>;
  setScripts: Dispatch<SetStateAction<Record<number, string>>>;
  displayedImageSrc: string | null;

  // ─── Playback actions ───────────────────────────────────────────────────────
  playPause: () => void;
  goPrev: () => void;
  goNext: () => void;
  handleEnded: () => void;
  handleSeek: (ev: ChangeEvent<HTMLInputElement>) => void;
  handleSeekToTime: (seconds: number) => void;
  handleClearPlaybackProgress: () => void;
  scheduleAudioReload: (token: number, audioUrl: string, pageNumber?: number) => void;
  clearAudioRetryTimer: () => void;
  reloadDetail: () => Promise<void>;

  // ─── Slide navigation state ─────────────────────────────────────────────────
  audioError: string | null;
  slideBusy: boolean;
  setSlideBusy: Dispatch<SetStateAction<boolean>>;
  slideError: string | null;
  setSlideError: Dispatch<SetStateAction<string | null>>;
  showAddPagesModal: boolean;
  setShowAddPagesModal: Dispatch<SetStateAction<boolean>>;
  draggingPage: number | null;
  setDraggingPage: Dispatch<SetStateAction<number | null>>;
  thumbLoadUntilIdx: number;
  setThumbLoadUntilIdx: Dispatch<SetStateAction<number>>;

  // ─── Script / editor ────────────────────────────────────────────────────────
  editingScript: string;
  setEditingScript: Dispatch<SetStateAction<string>>;
  editorError: string | null;
  setEditorError: Dispatch<SetStateAction<string | null>>;
  editorBusy: boolean;
  setEditorBusy: Dispatch<SetStateAction<boolean>>;
  rewriteBusy: boolean;
  rewriteError: string | null;
  setRewriteError: Dispatch<SetStateAction<string | null>>;
  editTab: EditTab;
  setEditTab: Dispatch<SetStateAction<EditTab>>;
  transcriptFocusMode: boolean;
  setTranscriptFocusMode: Dispatch<SetStateAction<boolean>>;
  handleRewriteScript: () => void;
  handleRetry: () => void;

  // ─── Slide animation (GSAP V1) ──────────────────────────────────────────────
  /** 播放時實際採用的 spec（動畫 Tab 開啟時為編輯中 draft，可即時預覽）。 */
  currentAnimationSpec: SlideAnimationSpec | null;
  animationDraft: SlideAnimationSpec | null;
  setAnimationDraft: Dispatch<SetStateAction<SlideAnimationSpec | null>>;
  /** Effect whose position box should be draggable directly on the fullscreen slide image (not just the small thumbnail in the editor panel). `null` when none is selected for positioning. */
  positioningEffectId: string | null;
  setPositioningEffectId: Dispatch<SetStateAction<string | null>>;
  animationBusy: boolean;
  animationError: string | null;
  animationMessage: string | null;
  animationWarning: string | null;
  setAnimationWarning: Dispatch<SetStateAction<string | null>>;
  handleSaveAnimation: () => Promise<boolean>;
  handlePreviewAnimation: () => void;
  /** AI 自動產生逐字稿焦點動畫（呼叫中）。 */
  aiFocusBusy: boolean;
  /** 呼叫後端 LLM，依目前逐字稿句子決定每句的焦點效果，並覆蓋 draft 的 effects。 */
  handleGenerateAiFocusEffects: (sentences: string[], hints?: Record<string, string>) => Promise<boolean>;
  /** AI 產生/重新產生自訂腳本動畫程式碼（呼叫中）。 */
  customScriptBusy: boolean;
  /** Effect id currently being generated, used to show row-level busy UI. */
  customScriptBusyEffectId: string | null;
  /** AI 產生 `custom-script` 程式碼時，依 effect id 即時累積的串流輸出文字（產生完成後移除）。 */
  customScriptStreamingCode: Record<string, string>;
  /** AI 產生 `custom-script` 動畫第一階段（實作步驟）時，依 effect id 即時累積的串流輸出文字（步驟產生完成後移除）。 */
  customScriptStreamingPlan: Record<string, string>;
  /** 將訊息加入 `custom-script` 效果的對話紀錄並呼叫後端 LLM 產生/調整程式碼，依結果更新 `code` 與對話紀錄。 */
  handleSendCustomScriptMessage: (effectId: string, message: string) => Promise<boolean>;

  // ─── Prompt / source ────────────────────────────────────────────────────────
  promptInput: string;
  setPromptInput: Dispatch<SetStateAction<string>>;
  sourceTextName: string;
  setSourceTextName: Dispatch<SetStateAction<string>>;
  sourceTextContent: string;
  setSourceTextContent: Dispatch<SetStateAction<string>>;
  sourceBusy: boolean;
  sourceMsg: string | null;
  sourceErr: string | null;
  genPrompts: PageGenerationPrompt[];
  setGenPrompts: Dispatch<SetStateAction<PageGenerationPrompt[]>>;
  genPromptsLoading: boolean;
  setGenPromptsLoading: Dispatch<SetStateAction<boolean>>;
  expandedGenPrompt: string | null;
  setExpandedGenPrompt: Dispatch<SetStateAction<string | null>>;
  expandedSourceId: number | null;
  setExpandedSourceId: Dispatch<SetStateAction<number | null>>;
  promptBusy: boolean;
  promptMsg: string | null;
  pagePrompts: Record<number, string>;
  handleSavePrompt: () => void;
  handleAddPdfSource: (file: File) => void;
  handleAddTxtSource: () => void;

  // ─── Chat ───────────────────────────────────────────────────────────────────
  chatHistory: ChatMessage[];
  setChatHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  chatInput: string;
  setChatInput: Dispatch<SetStateAction<string>>;
  chatBusy: boolean;
  chatError: string | null;
  hasChatInput: boolean;
  chatPastedImage: File | null;
  setChatPastedImage: Dispatch<SetStateAction<File | null>>;
  chatPastedImageUrl: string | null;
  setChatPastedImageUrl: Dispatch<SetStateAction<string | null>>;
  chatInpaintBusy: boolean;
  chatInpaintError: string | null;
  setChatInpaintError: Dispatch<SetStateAction<string | null>>;
  handleSendChat: () => void;
  handleClearChat: () => void;
  clearChatPastedImage: () => void;

  // ─── Image edit / inpaint ───────────────────────────────────────────────────
  imageEditSelectMode: boolean;
  setImageEditSelectMode: Dispatch<SetStateAction<boolean>>;
  imageEditRegion: ImageEditRegion;
  setImageEditRegion: Dispatch<SetStateAction<ImageEditRegion>>;
  clearImageEditRegion: () => void;
  handleInpaintImage: () => void;
  handleReplaceImageFile: (file: File, targetPageNumber?: number) => void;
  handleRegenerateImageWithPrompt: () => void;
  handleApplyPreviewImage: () => void;
  imagePreviewUrl: string | null;
  setImagePreviewUrl: Dispatch<SetStateAction<string | null>>;
  imagePreviewPageNumber: number | null;
  setImagePreviewPageNumber: Dispatch<SetStateAction<number | null>>;
  imagePreviewOpen: boolean;
  setImagePreviewOpen: Dispatch<SetStateAction<boolean>>;

  // ─── TTS / audio settings ───────────────────────────────────────────────────
  ttsProvider: TtsProvider;
  availableTtsVoices: readonly string[];
  ttsVoice: string;
  setTtsVoice: Dispatch<SetStateAction<string>>;
  ttsSpeed: number;
  setTtsSpeed: Dispatch<SetStateAction<number>>;
  scriptMaxCharsPerPage: number | null;
  setScriptMaxCharsPerPage: Dispatch<SetStateAction<number | null>>;
  hostMode: HostMode;
  setHostMode: Dispatch<SetStateAction<HostMode>>;
  ttsBusy: boolean;
  ttsMsg: string | null;
  ttsDialogOpen: boolean;
  setTtsDialogOpen: Dispatch<SetStateAction<boolean>>;
  handleSaveTtsSettings: () => void;
  handleRegenerateAudio: () => void;

  // ─── Image style ────────────────────────────────────────────────────────────
  imageStyleDialogOpen: boolean;
  setImageStyleDialogOpen: Dispatch<SetStateAction<boolean>>;
  imageStyleTemplates: ImagePromptTemplate[];
  selectedImageStyleTemplateKey: string;
  setSelectedImageStyleTemplateKey: Dispatch<SetStateAction<string>>;
  deckImageStylePrompt: string;
  setDeckImageStylePrompt: Dispatch<SetStateAction<string>>;
  applyImageStyleTemplate: (key: string) => void;
  openImageStyleDialog: () => void;
  handleSaveImageStyle: () => void;

  // ─── Regenerate ─────────────────────────────────────────────────────────────
  regenAllDialogOpen: boolean;
  setRegenAllDialogOpen: Dispatch<SetStateAction<boolean>>;
  regenAllPrompt: string;
  setRegenAllPrompt: Dispatch<SetStateAction<string>>;
  regenScriptPrompt: string;
  setRegenScriptPrompt: Dispatch<SetStateAction<string>>;
  regenScriptMaxCharsPerPage: number;
  setRegenScriptMaxCharsPerPage: Dispatch<SetStateAction<number>>;
  regenAllBusy: boolean;
  regenAllMsg: string | null;
  setRegenAllMsg: Dispatch<SetStateAction<string | null>>;
  regenOptions: RegenOptions;
  setRegenOptions: Dispatch<SetStateAction<RegenOptions>>;
  regenJob: RegenJobState | null;
  setRegenJob: Dispatch<SetStateAction<RegenJobState | null>>;
  regenSelectedPages: Set<number>;
  setRegenSelectedPages: Dispatch<SetStateAction<Set<number>>>;
  regenStopBusy: boolean;
  regenRollbackBusy: boolean;
  confirmScriptBusy: boolean;
  regenBannerDismissed: boolean;
  setRegenBannerDismissed: Dispatch<SetStateAction<boolean>>;
  regenAnySelected: boolean;
  regenJobRunning: boolean;
  regenJobTerminal: boolean;
  showRegenBanner: boolean;
  handleConfirmRegenerate: () => void;
  handleStopRegenerate: () => void;
  handleRollbackRegenerate: () => void;
  handleConfirmScript: () => void;

  // ─── Slide actions ──────────────────────────────────────────────────────────
  handleAddSlideAfterCurrent: () => void;
  handleDeleteCurrentSlide: () => void;
  handleMoveSlide: (from: number, to: number) => void;
  handleUpdateCoverFromCurrentPage: () => void;
  aiPollBusy: boolean;
  handleGeneratePollDraft: () => void;
  handleDeletePoll: (pollId: number) => void;
  handleCreatePoll: () => void;
  handleStartPoll: () => void;
  handleStopPoll: () => void;
  handleVotePoll: (pollId: number, optionIndex: number) => void;
  handleResetPollVotes: (pollId: number) => void;
  handleSelectDisplayedPoll: (pollId: number) => void;

  // ─── Title ──────────────────────────────────────────────────────────────────
  titleInput: string;
  setTitleInput: Dispatch<SetStateAction<string>>;
  titleBusy: boolean;
  titleMsg: string | null;
  videoError: string | null;
  shareMessage: string | null;
  setShareMessage: Dispatch<SetStateAction<string | null>>;
  shareError: string | null;
  setShareError: Dispatch<SetStateAction<string | null>>;
  handleSaveTitle: () => void;
  handleRegenerateTitle: () => void;

  // ─── Video ──────────────────────────────────────────────────────────────────
  videoBusy: boolean;
  videoUrl: string | null;
  videoProgressText: string | null;
  handleGenerateVideo: () => void;

  // ─── Share / QR ─────────────────────────────────────────────────────────────
  shareDialogOpen: boolean;
  setShareDialogOpen: Dispatch<SetStateAction<boolean>>;
  shareUrl: string;
  shareAccess: ShareAccessMode;
  setShareAccess: Dispatch<SetStateAction<ShareAccessMode>>;
  shareExpiresDays: number | undefined;
  setShareExpiresDays: Dispatch<SetStateAction<number | undefined>>;
  shareExpiresAt: string | null;
  shareBusy: boolean;
  playQrCodeUrl: string | null;
  handleCreateShareLink: () => void;
  handleMakeSharePrivate: () => void;
  handleShowPlayQrCode: () => void;
  canViewPostClassReport: boolean;
  openPostClassReport: () => void;

  // ─── Tags ───────────────────────────────────────────────────────────────────
  tagsInput: string;
  setTagsInput: Dispatch<SetStateAction<string>>;
  tagsBusy: boolean;
  tagsMsg: string | null;
  handleSaveTags: () => void;

  // ─── Description ────────────────────────────────────────────────────────────
  descriptionInput: string;
  setDescriptionInput: Dispatch<SetStateAction<string>>;
  descriptionBusy: boolean;
  descriptionMsg: string | null;
  handleSaveDescription: () => void;

  // ─── GitHub sync ────────────────────────────────────────────────────────────
  githubSyncBusy: boolean;
  githubSyncMessage: string | null;
  githubSyncError: string | null;
  handleSyncToGithub: () => void;

  // ─── Poll state ─────────────────────────────────────────────────────────────
  pagePolls: PagePoll[];
  pollQuestion: string;
  setPollQuestion: Dispatch<SetStateAction<string>>;
  pollOptionsText: string;
  setPollOptionsText: Dispatch<SetStateAction<string>>;
  pollBusy: boolean;
  pollError: string | null;
  pollVotes: Record<number, number>;
  pollSettingsOpen: boolean;
  setPollSettingsOpen: Dispatch<SetStateAction<boolean>>;
  pollStarted: boolean;
  activePoll: PagePoll | null;
  activePollQuestion: string;
  syncDisplayedPollId: number | null;
  setSyncDisplayedPollId: Dispatch<SetStateAction<number | null>>;
  syncRealtimePollStarted: boolean;
  syncPollShowResults: boolean;
  setSyncPollShowResults: Dispatch<SetStateAction<boolean>>;

  // ─── Classroom / interactive ────────────────────────────────────────────────
  classroomMode: boolean;
  setClassroomMode: Dispatch<SetStateAction<boolean>>;
  classroomAwaitingNext: boolean;
  interactiveMode: boolean;
  setInteractiveMode: Dispatch<SetStateAction<boolean>>;

  // ─── Sync ───────────────────────────────────────────────────────────────────
  syncEnabled: boolean;
  setSyncEnabled: Dispatch<SetStateAction<boolean>>;
  syncRole: SyncRole;
  setSyncRole: Dispatch<SetStateAction<SyncRole>>;
  syncError: string | null;
  setSyncError: Dispatch<SetStateAction<string | null>>;
  syncFollowerQuestionInput: string;
  setSyncFollowerQuestionInput: Dispatch<SetStateAction<string>>;
  syncFollowerQuestions: SyncFollowerQuestion[];
  syncDisplayedQuestionId: string | null;
  syncAiAnswer: SyncAiAnswer | null;
  syncAiAnswerBusy: boolean;
  syncQuestionInput: string;
  setSyncQuestionInput: Dispatch<SetStateAction<string>>;
  fullscreenQuestionDialogOpen: boolean;
  setFullscreenQuestionDialogOpen: Dispatch<SetStateAction<boolean>>;
  fullscreenPollControlOpen: boolean;
  setFullscreenPollControlOpen: Dispatch<SetStateAction<boolean>>;
  remoteCursor: { x: number; y: number } | null;
  syncDrawingState: { pageNumber: number; strokes: DrawingStroke[] } | null;
  isSyncFollower: boolean;
  canUseDrawingTools: boolean;
  handleSyncEnabledChange: (enabled: boolean) => void;
  handleSubmitFollowerQuestion: () => void;
  handleRaiseHand: () => void;
  handleToggleDisplayedQuestion: () => void;
  handleAiAnswerFollowerQuestions: () => void;
  handleSummarizeFollowerQuestions: () => Promise<void>;
  questionSummary: string | null;
  questionSummaryBusy: boolean;

  // ─── Fullscreen / layout ────────────────────────────────────────────────────
  imageOnlyFullscreen: boolean;
  setImageOnlyFullscreen: Dispatch<SetStateAction<boolean>>;
  fullscreenLayout: FullscreenLayout;
  setFullscreenLayout: Dispatch<SetStateAction<FullscreenLayout>>;
  slideImageScale: number;
  setSlideImageScale: Dispatch<SetStateAction<number>>;
  slideImageMaxHeightVh: number;
  activeTab: ActiveTab;
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  qaPanelExpanded: boolean;
  setQaPanelExpanded: Dispatch<SetStateAction<boolean>>;

  // ─── Drawing ────────────────────────────────────────────────────────────────
  drawingMode: boolean;
  setDrawingMode: Dispatch<SetStateAction<boolean>>;
  drawingTool: DrawingTool;
  setDrawingTool: Dispatch<SetStateAction<DrawingTool>>;
  drawingColor: string;
  setDrawingColor: Dispatch<SetStateAction<string>>;
  drawingLineWidth: number;
  setDrawingLineWidth: Dispatch<SetStateAction<number>>;
  remoteDrawingData: DrawingData | undefined;
  pushLocalDrawingChange: (data: DrawingData) => void;
  flushLocalDrawingPush: () => void;

  // ─── Computed / derived ─────────────────────────────────────────────────────
  isReadOnlyProcessing: boolean;
  readOnlyReason: string | null;
  shareIsReadOnly: boolean;
  imageBustKey: string;
  withImageBust: (url: string | null | undefined) => string | null;
  withShareToken: (url: string | null | undefined) => string | null;
  targetImageSrc: string | null;
  playbackImageSrc: string | null;
  fullscreenImageSrc: string | null;
  sourceItems: PdfSourceItem[];
  hasScriptChanges: boolean;
  syncQuestionBusy: boolean;
  openVersionHistory: (type: 'image' | 'script', pageNumber: number) => void;
  pageSentences: string[];
  currentSentence: string;
  activeSentenceIdx: number;
  /** 各句估計的播放起訖時間，供動畫編輯器選擇「依逐字稿句子」起始時間時換算秒數預覽。 */
  sentenceTimeline: SentenceTimelineItem[];

  // ─── Refs used in JSX ───────────────────────────────────────────────────────
  audioRef: RefObject<HTMLAudioElement>;
  fullscreenContainerRef: RefObject<HTMLDivElement>;
  fullscreenImageRef: RefObject<HTMLImageElement>;
  drawingCanvasSplitRef: RefObject<DrawingCanvasHandle>;
  drawingCanvasMainRef: RefObject<DrawingCanvasHandle>;
  drawingCanvasFullscreenRef: RefObject<DrawingCanvasHandle>;
  sourcePdfInputRef: RefObject<HTMLInputElement>;
  imageEditDragRef: MutableRefObject<{ startX: number; startY: number } | null>;
  imageEditRegionOverlayRef: RefObject<HTMLDivElement>;
  activeSentenceRef: RefObject<HTMLParagraphElement>;
  getActiveDrawingCanvas: () => DrawingCanvasHandle | null;

  // ─── Wake lock ──────────────────────────────────────────────────────────────
  acquireWakeLock: () => void;
  releaseWakeLock: () => void;

  // ─── AI 導師：問這一頁 ──────────────────────────────────────────────────────
  canAskPage: boolean;
  pageAskInput: string;
  setPageAskInput: (v: string) => void;
  pageAskAnswer: string | null;
  pageAskBusy: boolean;
  pageAskError: string | null;
  setPageAskError: (v: string | null) => void;
  handleAskPage: () => Promise<void>;
  clearPageAsk: () => void;

  // ─── Page bookmarks ──────────────────────────────────────────────────────────
  bookmarks: number[];
  toggleBookmark: (pageNumber: number) => void;
}

// ── Context instance + hook ───────────────────────────────────────────────────
export const PlayPageCtx = createContext<PlayPageContextValue | null>(null);

export function usePlayPageContext(): PlayPageContextValue {
  const ctx = useContext(PlayPageCtx);
  if (ctx === null) {
    throw new Error('usePlayPageContext must be called inside <PlayPage>');
  }
  return ctx;
}
