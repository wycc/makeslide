import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ApiError, rewritePageScript } from '../../lib/api';
import type { ChatMessage, PdfDetailPage } from '../../types';
import { useI18n } from '../../i18n';

const CHAT_HISTORY_REQUEST_LIMIT = 20;

function limitChatHistoryForRequest(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-CHAT_HISTORY_REQUEST_LIMIT);
}

interface UseScriptEditorParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  currentScript: string;
  currentIdx: number;
  deckPages: PdfDetailPage[];
  scripts: Record<number, string>;
  isReadOnlyProcessing: boolean;
  // chat state injected so handleRewriteScript can use it
  chatInput: string;
  chatHistory: ChatMessage[];
  setChatHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setChatInput: Dispatch<SetStateAction<string>>;
}

export interface ScriptEditorState {
  editingScript: string;
  setEditingScript: Dispatch<SetStateAction<string>>;
  editorBusy: boolean;
  setEditorBusy: Dispatch<SetStateAction<boolean>>;
  editorError: string | null;
  setEditorError: Dispatch<SetStateAction<string | null>>;
  rewriteBusy: boolean;
  rewriteError: string | null;
  setRewriteError: Dispatch<SetStateAction<string | null>>;
  editTab: 'content' | 'script' | 'prompt' | 'animation' | 'react' | 'figures' | 'source' | 'system';
  setEditTab: Dispatch<SetStateAction<'content' | 'script' | 'prompt' | 'animation' | 'react' | 'figures' | 'source' | 'system'>>;
  transcriptFocusMode: boolean;
  setTranscriptFocusMode: Dispatch<SetStateAction<boolean>>;
  handleRewriteScript: () => Promise<void>;
  /** 逐字稿已被改寫（rewrite-script 端點會直接落檔），但語音還沒重新生成。 */
  scriptAudioOutdated: boolean;
  /** 套用一次改寫後呼叫：語音自此落後於逐字稿，直到重生或換頁。 */
  markScriptAudioOutdated: () => void;
  /** 重生（或只存檔）成功後呼叫。 */
  clearScriptAudioOutdated: () => void;
}

export function useScriptEditor({
  pdfId,
  currentPage,
  currentScript,
  currentIdx,
  deckPages,
  scripts,
  isReadOnlyProcessing,
  chatInput,
  chatHistory,
  setChatHistory,
  setChatInput,
}: UseScriptEditorParams): ScriptEditorState {
  const { t } = useI18n();
  const [editingScript, setEditingScript] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<'content' | 'script' | 'prompt' | 'animation' | 'react' | 'figures' | 'source' | 'system'>('content');
  const [transcriptFocusMode, setTranscriptFocusMode] = useState(false);
  // AI 改寫／對話式改寫走的 rewrite-script 端點會把改寫後的稿子直接寫進檔案，於是
  // 「編輯器內容 vs. 已儲存內容」的比對看不出差別——但語音仍是改寫前那一段。這個旗標
  // 記住「語音落後了」，讓「儲存並重生語音」在改寫之後仍然可按。
  const [scriptAudioOutdated, setScriptAudioOutdated] = useState(false);

  // 換頁時重置編輯器內容；同時記住目前頁碼供下方非同步改寫呼叫比對，
  // 避免使用者在等待改寫結果時切到別的頁面，遲到的結果把新頁面的編輯器內容/對話串蓋掉。
  const currentPageNumberRef = useRef<number | null>(null);
  useEffect(() => {
    currentPageNumberRef.current = currentPage?.page_number ?? null;
    setEditingScript(currentScript);
    setEditorError(null);
  }, [currentPage?.page_number, currentScript]);

  // 只看頁碼：改寫會讓 currentScript 跟著變，和上面那個 effect 併在一起會把旗標一起洗掉。
  useEffect(() => {
    setScriptAudioOutdated(false);
  }, [currentPage?.page_number]);

  const markScriptAudioOutdated = useCallback(() => setScriptAudioOutdated(true), []);
  const clearScriptAudioOutdated = useCallback(() => setScriptAudioOutdated(false), []);

  const handleRewriteScript = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId || !currentPage) return;
    const pageNumberAtSend = currentPage.page_number;
    const prompt = chatInput.trim();
    const sourceScript = editingScript.trim();
    setRewriteBusy(true);
    setRewriteError(null);
    const nextHistory = [...chatHistory, { role: 'user' as const, content: prompt }];
    setChatHistory(nextHistory);
    setChatInput('');
    try {
      const res = await rewritePageScript(
        pdfId,
        pageNumberAtSend,
        prompt,
        sourceScript,
        {
          previousScript:
            currentIdx > 0
              ? (scripts[deckPages[currentIdx - 1]?.page_number ?? -1] ?? '').trim()
              : '',
          currentScript: sourceScript,
          nextScript:
            currentIdx < deckPages.length - 1
              ? (scripts[deckPages[currentIdx + 1]?.page_number ?? -1] ?? '').trim()
              : '',
        },
        limitChatHistoryForRequest(chatHistory),
      );
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      setEditingScript(res.script);
      markScriptAudioOutdated();
      setChatHistory((prev) => [...prev, { role: 'assistant', content: res.script }]);
    } catch (err) {
      if (currentPageNumberRef.current !== pageNumberAtSend) return;
      setChatHistory(chatHistory);
      setRewriteError(err instanceof ApiError ? err.message : t('play.scriptRewrite.rewriteFailed'));
    } finally {
      setRewriteBusy(false);
    }
  }, [
    pdfId,
    currentPage,
    chatInput,
    editingScript,
    chatHistory,
    currentIdx,
    deckPages,
    scripts,
    isReadOnlyProcessing,
    setChatHistory,
    setChatInput,
    markScriptAudioOutdated,
    t,
  ]);

  return {
    editingScript,
    setEditingScript,
    editorBusy,
    setEditorBusy,
    editorError,
    setEditorError,
    rewriteBusy,
    rewriteError,
    setRewriteError,
    editTab,
    setEditTab,
    transcriptFocusMode,
    setTranscriptFocusMode,
    scriptAudioOutdated,
    markScriptAudioOutdated,
    clearScriptAudioOutdated,
    handleRewriteScript,
  };
}
