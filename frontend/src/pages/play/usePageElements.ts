import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { ApiError, pageElementAssetUrl, savePageElements, uploadPageElementAsset } from '../../lib/api';
import type { PdfDetailPage } from '../../types';
import {
  MAX_ELEMENT_ASSET_BYTES,
  MAX_PAGE_ELEMENTS,
  duplicateElement,
  newImageElement,
  newShapeElement,
  newTextElement,
  nudgeDelta,
  pageSupportsElements,
  reorderElement,
  type ElementShape,
  type PageElement,
} from '../../lib/pageElements';
import type { PageElementsEditor } from '../../components/slide/PageElementsLayer';

type TKey = Parameters<ReturnType<typeof useI18n>['t']>[0];

export type ElementsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 800;
const UNDO_LIMIT = 50;

interface UsePageElementsArgs {
  pdfId: string | null;
  currentPage: PdfDetailPage | null;
  isReadOnlyProcessing: boolean;
  elementsTabActive: boolean;
  activateElementsTab: () => void;
  reloadDetail: () => Promise<void>;
  withShareToken: (url: string | null | undefined) => string | null;
  t: (key: TKey) => string;
}

export interface PageElementsState {
  /** The draft for the current page — what the layer draws. */
  pageElements: PageElement[];
  hasDraftElements: boolean;
  /** True while the elements tab is open on a page that supports the layer. */
  elementsEditing: boolean;
  currentPageSupportsElements: boolean;
  elementsEditor: PageElementsEditor;
  selectedElement: PageElement | null;
  selectElement: (id: string | null) => void;
  updateSelectedElement: (patch: Partial<PageElement>) => void;
  addTextElement: (text?: string) => void;
  addImageElementsFromFiles: (files: File[]) => Promise<void>;
  addShapeElement: (shape: ElementShape) => void;
  removeSelectedElement: () => void;
  duplicateSelectedElement: () => void;
  reorderSelectedElement: (move: 'up' | 'down' | 'top' | 'bottom') => void;
  clearAllElements: () => void;
  undoElements: () => void;
  redoElements: () => void;
  canUndoElements: boolean;
  canRedoElements: boolean;
  elementsSaveStatus: ElementsSaveStatus;
  elementsSaveError: string | null;
  retryElementsSave: () => void;
  elementsAssetUrl: (assetName: string) => string;
  /** Flushes any pending draft to the server right away (before an operation that reads it). */
  flushElementsSave: () => Promise<void>;
}

export function usePageElements({
  pdfId,
  currentPage,
  isReadOnlyProcessing,
  elementsTabActive,
  activateElementsTab,
  reloadDetail,
  withShareToken,
  t,
}: UsePageElementsArgs): PageElementsState {
  const pageNumber = currentPage?.page_number ?? null;
  const supportsElements = pageSupportsElements(currentPage?.render_type);

  const [elements, setElements] = useState<PageElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PageElement[][]>([]);
  const [redoStack, setRedoStack] = useState<PageElement[][]>([]);
  const [saveStatus, setSaveStatus] = useState<ElementsSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Which page the draft belongs to, and whether it has changes the server has not seen.
  const draftPageRef = useRef<{ pdfId: string; pageNumber: number } | null>(null);
  const dirtyRef = useRef(false);
  const elementsRef = useRef<PageElement[]>([]);
  elementsRef.current = elements;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVersionRef = useRef(0);
  const pageSizeRef = useRef<{ width: number; height: number }>({ width: 16, height: 9 });

  const saveNow = useCallback(
    async (target: { pdfId: string; pageNumber: number }, list: PageElement[]) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const version = ++saveVersionRef.current;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        await savePageElements(target.pdfId, target.pageNumber, list);
        if (version === saveVersionRef.current) {
          dirtyRef.current = false;
          setSaveStatus('saved');
        }
        await reloadDetail();
      } catch (err) {
        if (version === saveVersionRef.current) {
          setSaveStatus('error');
          setSaveError(err instanceof ApiError ? err.message : t('play.elements.saveFailed'));
        }
      }
    },
    [reloadDetail, t],
  );

  const scheduleSave = useCallback(
    (list: PageElement[]) => {
      const target = draftPageRef.current;
      if (!target || isReadOnlyProcessing) return;
      dirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveNow(target, list);
      }, AUTOSAVE_DELAY_MS);
    },
    [isReadOnlyProcessing, saveNow],
  );

  const flushElementsSave = useCallback(async () => {
    const target = draftPageRef.current;
    if (!target || !dirtyRef.current) return;
    await saveNow(target, elementsRef.current);
  }, [saveNow]);

  // Load the draft when the page changes; flush the previous page's pending draft first so a
  // change made right before turning the page is never lost.
  useEffect(() => {
    const previous = draftPageRef.current;
    const previousElements = elementsRef.current;
    const wasDirty = dirtyRef.current;
    if (previous && wasDirty && (previous.pdfId !== pdfId || previous.pageNumber !== pageNumber)) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      dirtyRef.current = false;
      void savePageElements(previous.pdfId, previous.pageNumber, previousElements)
        .then(() => reloadDetail())
        .catch(() => {
          /* the next visit to that page shows the server's copy; nothing better to do here */
        });
    }
    if (!pdfId || pageNumber == null) {
      draftPageRef.current = null;
      setElements([]);
    } else if (!previous || previous.pdfId !== pdfId || previous.pageNumber !== pageNumber) {
      draftPageRef.current = { pdfId, pageNumber };
      dirtyRef.current = false;
      setElements(((currentPage?.elements as PageElement[] | null | undefined) ?? []).slice());
      setUndoStack([]);
      setRedoStack([]);
      setSaveStatus('idle');
      setSaveError(null);
    }
    setSelectedId(null);
    setEditingTextId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId, pageNumber]);

  // Server-side changes to the current page (another editor, an AI redraw that fused the layer)
  // replace a clean draft; a dirty draft wins until it is saved.
  const incoming = currentPage?.elements as PageElement[] | null | undefined;
  useEffect(() => {
    if (dirtyRef.current || saveStatus === 'saving') return;
    const next = incoming ?? [];
    if (JSON.stringify(next) !== JSON.stringify(elementsRef.current)) {
      setElements(next.slice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, currentPage?.updated_at]);

  // The page's own size, so a pasted picture gets the right height for its aspect ratio.
  const baseImageUrl = currentPage?.base_image_url ?? currentPage?.image_url ?? null;
  useEffect(() => {
    if (!baseImageUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) pageSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
    };
    img.src = withShareToken(baseImageUrl) ?? baseImageUrl;
  }, [baseImageUrl, withShareToken]);

  const commit = useCallback(
    (next: PageElement[], options: { record?: boolean } = {}) => {
      const record = options.record ?? true;
      if (record) {
        setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), elementsRef.current]);
        setRedoStack([]);
      }
      setElements(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  // The draft as it was when a drag started, so one drag is one undo step.
  const dragBaselineRef = useRef<PageElement[] | null>(null);
  const updateElement = useCallback(
    (id: string, patch: Partial<PageElement>, shouldCommit: boolean) => {
      const base = elementsRef.current;
      const next = base.map((el) => (el.id === id ? ({ ...el, ...patch } as PageElement) : el));
      if (shouldCommit) {
        // Continuous drag updates already put the final geometry in the draft; record the state
        // *before* the drag started so one drag is one undo step.
        setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), dragBaselineRef.current ?? base]);
        dragBaselineRef.current = null;
        setRedoStack([]);
        setElements(next);
        scheduleSave(next);
      } else {
        if (!dragBaselineRef.current) dragBaselineRef.current = base;
        setElements(next);
      }
    },
    [scheduleSave],
  );

  const addElement = useCallback(
    (el: PageElement) => {
      if (!supportsElements || isReadOnlyProcessing) return;
      if (elementsRef.current.length >= MAX_PAGE_ELEMENTS) return;
      commit([...elementsRef.current, el]);
      setSelectedId(el.id);
      activateElementsTab();
    },
    [supportsElements, isReadOnlyProcessing, commit, activateElementsTab],
  );

  const addTextElement = useCallback(
    (text?: string) => {
      const el = newTextElement(text ?? t('play.elements.defaultText'));
      addElement(el);
      if (!text) setEditingTextId(el.id);
    },
    [addElement, t],
  );

  const addShapeElement = useCallback((shape: ElementShape) => addElement(newShapeElement(shape)), [addElement]);

  const addImageElementsFromFiles = useCallback(
    async (files: File[]) => {
      if (!pdfId || pageNumber == null || !supportsElements || isReadOnlyProcessing) return;
      setSaveError(null);
      for (const file of files) {
        if (file.size > MAX_ELEMENT_ASSET_BYTES) {
          setSaveStatus('error');
          setSaveError(t('play.elements.assetTooLarge'));
          continue;
        }
        try {
          const uploaded = await uploadPageElementAsset(pdfId, pageNumber, file);
          addElement(newImageElement(uploaded.asset, uploaded, pageSizeRef.current));
        } catch (err) {
          setSaveStatus('error');
          setSaveError(err instanceof ApiError ? err.message : t('play.elements.uploadFailed'));
        }
      }
    },
    [pdfId, pageNumber, supportsElements, isReadOnlyProcessing, addElement, t],
  );

  const selectedElement = useMemo(() => elements.find((el) => el.id === selectedId) ?? null, [elements, selectedId]);

  const updateSelectedElement = useCallback(
    (patch: Partial<PageElement>) => {
      if (!selectedId) return;
      updateElement(selectedId, patch, true);
    },
    [selectedId, updateElement],
  );

  const removeSelectedElement = useCallback(() => {
    if (!selectedId) return;
    commit(elementsRef.current.filter((el) => el.id !== selectedId));
    setSelectedId(null);
    setEditingTextId(null);
  }, [selectedId, commit]);

  const duplicateSelectedElement = useCallback(() => {
    const el = elementsRef.current.find((e) => e.id === selectedId);
    if (!el || elementsRef.current.length >= MAX_PAGE_ELEMENTS) return;
    const copy = duplicateElement(el);
    commit([...elementsRef.current, copy]);
    setSelectedId(copy.id);
  }, [selectedId, commit]);

  const reorderSelectedElement = useCallback(
    (move: 'up' | 'down' | 'top' | 'bottom') => {
      if (!selectedId) return;
      const next = reorderElement(elementsRef.current, selectedId, move);
      if (next !== elementsRef.current) commit(next);
    },
    [selectedId, commit],
  );

  const clearAllElements = useCallback(() => {
    if (elementsRef.current.length === 0) return;
    commit([]);
    setSelectedId(null);
    setEditingTextId(null);
  }, [commit]);

  const undoElements = useCallback(() => {
    setUndoStack((stack) => {
      const prev = stack[stack.length - 1];
      if (!prev) return stack;
      setRedoStack((redo) => [...redo, elementsRef.current]);
      setElements(prev);
      scheduleSave(prev);
      return stack.slice(0, -1);
    });
  }, [scheduleSave]);

  const redoElements = useCallback(() => {
    setRedoStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setUndoStack((undo) => [...undo, elementsRef.current]);
      setElements(next);
      scheduleSave(next);
      return stack.slice(0, -1);
    });
  }, [scheduleSave]);

  const retryElementsSave = useCallback(() => {
    const target = draftPageRef.current;
    if (!target) return;
    void saveNow(target, elementsRef.current);
  }, [saveNow]);

  const elementsEditing = elementsTabActive && supportsElements && !isReadOnlyProcessing && Boolean(pdfId);

  // Keyboard: delete, nudge, duplicate, undo / redo — only while the editor is open, something is
  // selected, and the focus is not in a text field (the panel's own inputs keep their keys).
  useEffect(() => {
    if (!elementsEditing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoElements();
        else undoElements();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoElements();
        return;
      }
      if (!selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelectedElement();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelectedElement();
        return;
      }
      const nudge = nudgeDelta(e.key, e.shiftKey);
      if (nudge) {
        e.preventDefault();
        const el = elementsRef.current.find((x) => x.id === selectedId);
        if (el) updateElement(selectedId, { x: el.x + nudge.dx, y: el.y + nudge.dy }, true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [elementsEditing, selectedId, removeSelectedElement, duplicateSelectedElement, undoElements, redoElements, updateElement]);

  // Leaving the editor (tab change, unmount) flushes a pending draft immediately.
  useEffect(() => {
    if (elementsEditing) return;
    void flushElementsSave();
  }, [elementsEditing, flushElementsSave]);
  useEffect(() => () => { void flushElementsSave(); }, [flushElementsSave]);

  const elementsAssetUrl = useCallback(
    (assetName: string) => {
      if (!pdfId || pageNumber == null) return '';
      const url = pageElementAssetUrl(pdfId, pageNumber, assetName);
      return withShareToken(url) ?? url;
    },
    [pdfId, pageNumber, withShareToken],
  );

  const elementsEditor = useMemo<PageElementsEditor>(
    () => ({
      selectedId,
      onSelect: setSelectedId,
      onChange: updateElement,
      onEditText: (id, text) => updateElement(id, { text } as Partial<PageElement>, true),
      editingTextId,
      setEditingTextId,
    }),
    [selectedId, updateElement, editingTextId],
  );

  return {
    pageElements: elements,
    hasDraftElements: elements.length > 0,
    elementsEditing,
    currentPageSupportsElements: supportsElements,
    elementsEditor,
    selectedElement,
    selectElement: setSelectedId,
    updateSelectedElement,
    addTextElement,
    addImageElementsFromFiles,
    addShapeElement,
    removeSelectedElement,
    duplicateSelectedElement,
    reorderSelectedElement,
    clearAllElements,
    undoElements,
    redoElements,
    canUndoElements: undoStack.length > 0,
    canRedoElements: redoStack.length > 0,
    elementsSaveStatus: saveStatus,
    elementsSaveError: saveError,
    retryElementsSave,
    elementsAssetUrl,
    flushElementsSave,
  };
}

