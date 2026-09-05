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
import type {
  TutorProposal, ImagePromptTemplate, PageGenerationPrompt, PageWatchProgressStats, ShareAccessMode } from '../../lib/api';
import type { TtsProvider } from '../../lib/ttsVoices';
import type { SentenceTimelineItem } from '../../lib/subtitles';
import type { DrawingCanvasHandle, DrawingData, DrawingStroke } from '../../components/DrawingCanvas';
import type { AppLanguage, SubtitleSize, SubtitlePosition } from '../../i18n';
import type { ReactSlideConfig, SlideElementSelection, SlideSandboxStats, SlideTheme } from '../../lib/reactSlide';
import type { DetectedTextRegion } from '../../lib/api';
import type { PageTypeChoice } from './PageTypeDialog';

// ── Inline alias types ────────────────────────────────────────────────────────
type HostMode = 'solo' | 'dual';
type EditTab = 'content' | 'script' | 'prompt' | 'animation' | 'react' | 'figures' | 'source' | 'system';
type ActiveTab = 'play' | 'qa';
type SyncRole = 'master' | 'follower';
type FullscreenLayout = 'image' | 'split' | 'edit' | 'animation';
type DrawingTool = 'pen' | 'cursor' | 'eraser';
type RegenOptions = { image: boolean; script: boolean; audio: boolean; animation: boolean };
type ImageEditRegion = { x: number; y: number; w: number; h: number } | null;

export type NarrationOverlayState =
  | { cursor: { x: number; y: number } | null; drawing: DrawingData | null }
  | null;

// 旁白錄製擷取的回呼：游標移動（座標正規化 0–1）與原生畫筆快照。錄音時由 NarrationPanel 提供。
export interface NarrationCaptureState {
  active: boolean;
  onCursorMove: ((x: number, y: number) => void) | null;
  onDrawSnapshot: ((data: DrawingData) => void) | null;
  // 回報目前頁載入的既有筆數，作為只擷取「錄製期間新增」筆劃的基準。
  onDrawBaseline: ((count: number) => void) | null;
}

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
  visitedIdxSet: ReadonlySet<number>;
  totalPages: number;

  // 旁白錄製/播放：擷取投影片上的指標動作（錄製時），以及重播游標/繪圖疊加（播放時）。
  narrationCapture: NarrationCaptureState;
  setNarrationCapture: Dispatch<SetStateAction<NarrationCaptureState>>;
  narrationOverlay: NarrationOverlayState;
  setNarrationOverlay: Dispatch<SetStateAction<NarrationOverlayState>>;
  // 播放旁白時的同步字幕（顯示於投影片上，取代原字幕）；null 表示無。
  narrationSubtitle: string | null;
  setNarrationSubtitle: Dispatch<SetStateAction<string | null>>;
  // 旁白重播進行中：此時隱藏投影片上原有的已存手繪標註，只顯示旁白重播的筆畫。
  narrationPlaying: boolean;
  setNarrationPlaying: Dispatch<SetStateAction<boolean>>;
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
  /**
   * 播放狀態「指示」用：除了 slideAnimationPlaying 之外，還包含互動動畫仍在進行的期間——
   * 那時投影片時間軸確實停了，但互動動畫用自己的時鐘還在動，顯示「已暫停」會與畫面矛盾。
   */
  playbackIndicatorActive: boolean;
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
  subtitlePosition: SubtitlePosition;
  setSubtitlePosition: Dispatch<SetStateAction<SubtitlePosition>>;
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
  /** 逐字稿已被改寫（改寫端點會直接落檔），但語音還沒重新生成。 */
  scriptAudioOutdated: boolean;
  /** 套用一次改寫後呼叫：語音自此落後於逐字稿。 */
  markScriptAudioOutdated: () => void;
  clearScriptAudioOutdated: () => void;
  handleRetry: () => void;

  /** 「更改頁面類別」對話框（圖片／React／Notebook）。 */
  pageTypeDialogOpen: boolean;
  setPageTypeDialogOpen: Dispatch<SetStateAction<boolean>>;

  // ─── React 投影片頁（docs/react-slide-design.md）─────────────────────────────
  reactCode: string;
  setReactCode: Dispatch<SetStateAction<string>>;
  reactCompiled: string;
  reactConfig: ReactSlideConfig;
  setReactConfig: Dispatch<SetStateAction<ReactSlideConfig>>;
  slideTheme: SlideTheme;
  setSlideTheme: Dispatch<SetStateAction<SlideTheme>>;
  reactBackgroundUrl: string | undefined;
  reactAssets: Record<string, string>;
  reactCanvas: { width: number; height: number } | undefined;
  reactBusy: boolean;
  reactError: string | null;
  reactMessage: string | null;
  setReactError: Dispatch<SetStateAction<string | null>>;
  reactLoaded: boolean;
  handleSaveReactSlide: (code?: string) => Promise<boolean>;
  handleSaveReactConfig: (config: ReactSlideConfig) => Promise<boolean>;
  handleGenerateReactSlide: (prompt: string) => Promise<boolean>;
  handleGenerateReactBackground: (prompt: string, overlayOpacity?: number) => Promise<boolean>;
  handleSaveSlideTheme: (theme: SlideTheme) => Promise<boolean>;
  handleGenerateSlideTheme: (prompt: string) => Promise<boolean>;
  handleConvertToPlainSlide: () => Promise<boolean>;
  handleBakeReactSlide: () => Promise<boolean>;
  handleExtractText: (region: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => Promise<boolean>;
  /** 自動找出這一頁上所有文字框，交給使用者挑選要轉換哪些。 */
  handleDetectTextRegions: () => Promise<DetectedTextRegion[]>;
  /** 一次把選取的框全部轉成文字（一次編譯、一次 commit）。 */
  handleExtractTextBatch: (regions: Array<{ xPct: number; yPct: number; widthPct: number; heightPct: number }>) => Promise<boolean>;
  handleUndoBackground: () => Promise<boolean>;
  handleAddOverlay: (input: { text?: string; file?: File; style: Record<string, string>; href?: string }) => Promise<boolean>;
  handleSetElementLink: (id: string, href: string) => Promise<boolean>;
  /** 「點選投影片上的元素」模式；只有 React 分頁會打開。 */
  reactInspect: boolean;
  setReactInspect: Dispatch<SetStateAction<boolean>>;
  /** 最近一次在投影片上點到的元素（沙箱回報）。 */
  reactSelection: SlideElementSelection | null;
  setReactSelection: Dispatch<SetStateAction<SlideElementSelection | null>>;
  /** 沙箱自報的狀態（可點選元素數量、最後點到什麼），顯示在元素編輯面板上。 */
  reactSandboxStats: SlideSandboxStats | null;
  setReactSandboxStats: Dispatch<SetStateAction<SlideSandboxStats | null>>;
  /** 目前選到的文字層（從背景圖抽出來的文字），與元素選取互斥。 */
  reactSelectedLayerId: string | null;
  setReactSelectedLayerId: Dispatch<SetStateAction<string | null>>;
  /**
   * 刪除目前選取的東西：選到文字層就刪那一層，選到元素就把它標記為刪除（一筆覆寫，可還原）。
   * 回傳 false 代表當下沒有選取任何東西。三個入口（沙箱裡的 Del、面板上的 Del、刪除按鈕）共用。
   */
  deleteReactSelection: () => boolean;
  handleReactElementMove: (move: { id: string; left: string; top: string }) => void;
  /** True when no TTS provider is configured, so narration cannot be (re)generated. */
  chatToolRunning: string | null;
  ttsDisabled: boolean;
  /** Open an edit the tutor offered, for review. Never applies it. */
  openTutorProposal: (proposal: TutorProposal) => void;
  tutorScriptProposal: (TutorProposal & { kind: 'script' }) | null;
  tutorProposalBusy: boolean;
  applyTutorScriptProposal: () => void;
  dismissTutorScriptProposal: () => void;
  /** 自動偵測到的文字框，與目前挑選了哪些（分頁裡的按鍵與投影片上的框共用同一份）。 */
  detectedRegions: DetectedTextRegion[];
  selectedRegionKeys: Set<number>;
  toggleDetectedRegion: (index: number) => void;
  showDetectedRegions: (regions: DetectedTextRegion[]) => void;

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
  /** `images` 為附加的參考圖片（inline data URL），只用於這一次請求，不隨效果存檔。 */
  handleSendCustomScriptMessage: (effectId: string, message: string, images?: string[]) => Promise<boolean>;

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
  /** Per-deck dual-host voices; '' = use the global speaker voice. */
  ttsSpeaker1Voice: string;
  setTtsSpeaker1Voice: Dispatch<SetStateAction<string>>;
  ttsSpeaker2Voice: string;
  setTtsSpeaker2Voice: Dispatch<SetStateAction<string>>;
  ttsSpeed: number;
  setTtsSpeed: Dispatch<SetStateAction<number>>;
  scriptMaxCharsPerPage: number | null;
  setScriptMaxCharsPerPage: Dispatch<SetStateAction<number | null>>;
  hostMode: HostMode;
  setHostMode: Dispatch<SetStateAction<HostMode>>;
  /** 這份簡報的產生語言（生成設定對話框可改）；見 usePdfMetadata。 */
  contentLanguage: AppLanguage;
  setContentLanguage: Dispatch<SetStateAction<AppLanguage>>;
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
  /** 把目前頁在 圖片／React／Notebook 之間切換；成功回傳 true。 */
  handleChangeCurrentPageType: (choice: PageTypeChoice, options?: { force?: boolean }) => Promise<boolean>;
  addOverlayOpen: boolean;
  setAddOverlayOpen: Dispatch<SetStateAction<boolean>>;
  fusionFailure: { message: string; choice: PageTypeChoice } | null;
  setFusionFailure: (value: { message: string; choice: PageTypeChoice } | null) => void;
  handleSplitCurrentSlide: () => void;
  slideMessage: string | null;
  setSlideMessage: Dispatch<SetStateAction<string | null>>;
  handleGenerateNotebookForCurrentPage: () => void;
  handleExportCurrentPageNotebook: () => void;
  handleImportNotebookFile: (file: File) => void;
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
  accessDialogOpen: boolean;
  setAccessDialogOpen: Dispatch<SetStateAction<boolean>>;
  shareUrl: string;
  shareAccess: ShareAccessMode;
  setShareAccess: Dispatch<SetStateAction<ShareAccessMode>>;
  shareExpiresDays: number | undefined;
  setShareExpiresDays: Dispatch<SetStateAction<number | undefined>>;
  shareExpiresAt: string | null;
  shareBusy: boolean;
  playQrCodeUrl: string | null;
  handleCreateShareLink: () => void;
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
  // 投票進行中，供聽眾掃描加入（並自動開啟同步模式）的 QR 與其分享連結（未啟用時為 null）。
  pollJoinQrImageUrl: string | null;
  pollJoinShareUrl: string | null;

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
  handleDeleteFollowerQuestion: (questionId: string) => void;
  handleClearFollowerQuestions: () => void;
  handleAiAnswerFollowerQuestions: () => void;
  handleHideAiAnswer: () => void;
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
  sidebarExpanded: boolean;
  setSidebarExpanded: Dispatch<SetStateAction<boolean>>;

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
  openVersionHistory: (type: 'image' | 'script' | 'react-slide', pageNumber: number) => void;
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
  pageAskMessages: import('../../lib/api').PageAskMessage[];
  pageAskBusy: boolean;
  pageAskError: string | null;
  setPageAskError: (v: string | null) => void;
  pageAskVerbosity: 'brief' | 'detailed';
  setPageAskVerbosity: (v: 'brief' | 'detailed') => void;
  handleAskPage: () => Promise<void>;
  clearPageAsk: () => void;
  cancelAskPage: () => void;

  // ─── Page bookmarks ──────────────────────────────────────────────────────────
  bookmarks: number[];
  toggleBookmark: (pageNumber: number) => void;
  // ─── Important pages ─────────────────────────────────────────────────────────
  importantPages: number[];
  toggleImportantPage: (pageNumber: number) => void;
  // ─── Poll new badge ───────────────────────────────────────────────────────────
  newPollBadge: boolean;
  clearPollBadge: () => void;
  // ─── Goto page dialog ────────────────────────────────────────────────────────
  gotoPageOpen: boolean;
  setGotoPageOpen: (open: boolean) => void;
  gotoPageInput: string;
  setGotoPageInput: (v: string) => void;
  gotoPageInputRef: RefObject<HTMLInputElement>;
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
