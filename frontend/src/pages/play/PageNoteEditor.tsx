import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownMath } from '../../components/MarkdownMath';
import { useI18n } from '../../i18n';
import { updatePageNote } from '../../lib/api/pdfs';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { getTextLengthHint } from '../../lib/textLengthHint';
import { MAX_PAGE_NOTE_LENGTH } from '../../lib/noteLimits';
import { clampPageNote, isPageNoteDirty, normalizePageNote } from '../../lib/pageNoteDraft';
import { usePlayPageContext } from './PlayPageContext';

/** 一頁備註的檢視／編輯狀態，由 `usePageNoteEditor` 提供、側邊欄與全螢幕面板共用。 */
export interface PageNoteEditorState {
  /** 已儲存的備註內容（Markdown 原始碼，正規化後）。 */
  note: string;
  /** 是否有編輯權限（唯讀分享的觀看者、生成處理中都不給編）。 */
  canEdit: boolean;
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  /** 進入編輯：以目前已儲存內容當草稿起點。 */
  begin: () => void;
  /** 放棄編輯，草稿丟掉。 */
  cancel: () => void;
  /** 儲存草稿；沒有實際變更時直接離開編輯模式、不打 API。 */
  save: () => Promise<void>;
  busy: boolean;
  status: 'idle' | 'saved' | 'failed';
  dirty: boolean;
}

/**
 * 頁面備註的編輯狀態機。備註是一份 **Markdown 文件**：讀的時候渲染、改的時候編原始碼，
 * 因此顯示與編輯是兩個模式而不是一個永遠攤開的 textarea。儲存走既有的 `updatePageNote`，
 * 成功後同步更新本地 detail，讓徽章、綠點與其他讀 `page_notes` 的地方立刻反映。
 */
export function usePageNoteEditor(): PageNoteEditorState {
  const { currentPage, pdfId, setDetail, isReadOnlyProcessing } = usePlayPageContext();
  const note = normalizePageNote(currentPage?.page_notes ?? '');
  const pageNumber = currentPage?.page_number ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const savingRef = useRef(false);

  // 換頁時一律退出編輯：草稿屬於「那一頁」，跟著翻頁留在畫面上只會把 A 頁的內容存到 B 頁。
  useEffect(() => {
    setEditing(false);
    setStatus('idle');
  }, [pageNumber]);

  // 沒在編輯時，草稿跟著已儲存內容走（外部變更，例如 AI 導師的「存成筆記」，也會即時反映）。
  useEffect(() => {
    if (!editing) setDraft(note);
  }, [note, editing]);

  const begin = useCallback(() => {
    setDraft(note);
    setStatus('idle');
    setEditing(true);
  }, [note]);

  const cancel = useCallback(() => {
    setDraft(note);
    setStatus('idle');
    setEditing(false);
  }, [note]);

  const save = useCallback(async () => {
    if (!pdfId || !currentPage || savingRef.current) return;
    const next = normalizePageNote(clampPageNote(draft));
    if (!isPageNoteDirty(next, note)) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setBusy(true);
    setStatus('idle');
    try {
      await updatePageNote(pdfId, currentPage.page_number, next);
      setDetail((prev) => prev ? {
        ...prev,
        pages: prev.pages.map((p) => p.page_number === currentPage.page_number ? { ...p, page_notes: next } : p),
      } : prev);
      setStatus('saved');
      setEditing(false);
    } catch {
      setStatus('failed');
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  }, [pdfId, currentPage, draft, note, setDetail]);

  return {
    note,
    canEdit: Boolean(pdfId && currentPage && !isReadOnlyProcessing),
    editing,
    draft,
    setDraft,
    begin,
    cancel,
    save,
    busy,
    status,
    dirty: isPageNoteDirty(draft, note),
  };
}

/** 已儲存備註的呈現：有內容就渲染 Markdown，沒有就給一句提示。 */
export function PageNoteView({ note, className }: { note: string; className?: string }) {
  const { t } = useI18n();
  if (!note) return <p className={`text-xs text-muted ${className ?? ''}`}>{t('play.pageNote.empty')}</p>;
  return <MarkdownMath content={note} className={`break-words text-[13px] leading-relaxed ${className ?? ''}`} />;
}

/**
 * 備註編輯器。`preview` 為 true 時左右分割：左邊 Markdown 原始碼、右邊即時預覽——
 * 編輯 Markdown 卻看不到渲染結果等於盲打，所以側邊欄與全螢幕兩個入口都給。
 *
 * 分欄用 `auto-fit` + `minmax` 而不是 `md:` 斷點分欄：Tailwind 斷點看的是 viewport，
 * 但這個編輯器會被放進寬度差很多的容器（全螢幕面板 vs. 可收合的側邊欄），照 viewport
 * 分欄會在寬螢幕的窄側欄裡擠出兩條細長欄。`auto-fit` 看的是**容器自己**有多寬，
 * 放得下兩欄就左右分割，真的太窄（< 28rem）才讓預覽掉到下一列。
 */
export function PageNoteEditorFields({
  editor,
  preview = false,
  rows = 6,
}: {
  editor: PageNoteEditorState;
  preview?: boolean;
  rows?: number;
}) {
  const { t } = useI18n();
  const hint = useMemo(() => getTextLengthHint(editor.draft.length, MAX_PAGE_NOTE_LENGTH), [editor.draft.length]);

  const textarea = (
    <textarea
      value={editor.draft}
      onChange={(e) => editor.setDraft(e.target.value)}
      placeholder={t('play.pageNote.placeholder')}
      rows={rows}
      maxLength={MAX_PAGE_NOTE_LENGTH}
      spellCheck={false}
      autoFocus
      className="w-full flex-1 resize-y rounded-md border border-border bg-surface-muted px-2 py-1.5 font-mono text-xs leading-relaxed text-text outline-none focus:border-indigo-400"
    />
  );

  const lengthHint = hint.count > 0 ? (
    <p className="mt-1 text-right text-[11px] text-muted">
      <span className={hint.nearLimit ? 'text-amber-600 dark:text-amber-400' : undefined}>{hint.label}</span>
    </p>
  ) : null;

  if (!preview) {
    return (
      <div className="flex flex-col">
        {textarea}
        {lengthHint}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2">
      <div className="flex min-h-0 flex-col">
        <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{t('play.pageNote.sourceLabel')}</span>
        {textarea}
      </div>
      <div className="flex min-h-0 flex-col">
        <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{t('play.pageNote.previewLabel')}</span>
        <div className="min-h-0 max-h-72 flex-1 overflow-y-auto rounded-md border border-border bg-surface px-3 py-2">
          <PageNoteView note={normalizePageNote(editor.draft)} />
        </div>
      </div>
      <div className="col-span-full">{lengthHint}</div>
    </div>
  );
}

/**
 * 備註的內容區：沒在編輯就是渲染好的文件，編輯中則是「原始碼｜即時預覽」加上儲存／取消。
 * 側邊欄的備註區與投影片下方的備註分頁共用這一塊，兩邊不會長得不一樣。
 */
export function PageNoteBody({ editor, rows = 6 }: { editor: PageNoteEditorState; rows?: number }) {
  if (!editor.editing) return <PageNoteView note={editor.note} />;
  return (
    <>
      <PageNoteEditorFields editor={editor} preview rows={rows} />
      <div className="mt-2 flex items-center justify-end">
        <PageNoteEditActions editor={editor} />
      </div>
    </>
  );
}

/** 進入編輯的按鈕，沒有編輯權限（唯讀分享、生成處理中）時不出現。 */
export function PageNoteEditButton({ editor, className }: { editor: PageNoteEditorState; className?: string }) {
  const { t } = useI18n();
  if (editor.editing || !editor.canEdit) return null;
  return (
    <button
      type="button"
      onClick={editor.begin}
      className={className ?? 'rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-muted hover:text-text'}
      title={t('play.pageNote.edit')}
    >
      ✎ {t('play.pageNote.edit')}
    </button>
  );
}

/** 儲存／取消與儲存結果訊息，兩處編輯器共用。 */
export function PageNoteEditActions({ editor }: { editor: PageNoteEditorState }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      {editor.busy ? <span className="text-[11px] text-muted">{t('play.pageNote.saving')}</span> : null}
      {!editor.busy && editor.status === 'saved' ? (
        <span className="text-[11px] text-emerald-600 dark:text-emerald-300">{t('play.pageNote.saved')}</span>
      ) : null}
      {!editor.busy && editor.status === 'failed' ? (
        <span className="text-[11px] text-red-600 dark:text-red-400">{t('play.pageNote.saveFailed')}</span>
      ) : null}
      <button
        type="button"
        onClick={editor.cancel}
        disabled={editor.busy}
        className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
      >
        {t('play.pageNote.cancel')}
      </button>
      <button
        type="button"
        onClick={() => void editor.save()}
        disabled={editor.busy}
        className="rounded border border-indigo-400/60 bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-500/25 disabled:opacity-50 dark:text-indigo-200"
      >
        {t('play.pageNote.save')}
      </button>
    </div>
  );
}

/**
 * 全螢幕的頁面備註面板：點頂端 📝 徽章展開，讀的時候是渲染好的 Markdown，
 * 按「編輯」就地改，並在右半邊即時預覽——授課途中不必離開全螢幕去側邊欄。
 */
export function FullscreenPageNotePanel({
  pageNumber,
  editor,
  onClose,
}: {
  pageNumber: number;
  editor: PageNoteEditorState;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const title = interpolateTemplate(t('play.fullscreen.notesTitle'), { page: pageNumber });

  return (
    <div
      className={`absolute left-1/2 top-16 z-40 flex max-h-[70vh] -translate-x-1/2 flex-col rounded-xl border border-amber-400/40 bg-surface-muted text-text shadow-2xl backdrop-blur dark:bg-slate-900/95 dark:text-slate-100 ${editor.editing ? 'w-[min(64rem,94vw)]' : 'w-[min(40rem,92vw)]'}`}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-400/25 px-4 py-2">
        <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-200">📝 {title}</h3>
        <div className="flex items-center gap-1">
          {editor.editing ? (
            <PageNoteEditActions editor={editor} />
          ) : editor.canEdit ? (
            <button
              type="button"
              onClick={editor.begin}
              className="rounded border border-amber-300/50 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-500/10 dark:border-amber-700/50 dark:text-amber-300"
              title={t('play.pageNote.edit')}
            >
              ✎ {t('play.pageNote.edit')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-amber-300/50 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-500/10 dark:border-amber-700/50 dark:text-amber-300"
            title={t('play.fullscreen.notesClose')}
            aria-label={t('play.fullscreen.notesClose')}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {editor.editing ? <PageNoteEditorFields editor={editor} preview rows={12} /> : <PageNoteView note={editor.note} />}
      </div>
    </div>
  );
}
