import { useState, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  ApiError,
  fetchPdfDetail,
  getImagePromptTemplates,
  updatePdfImageStyleSettings,
  type ImagePromptTemplate,
} from '../../lib/api';
import type { PdfDetail } from '../../types';
import { useI18n } from '../../i18n';

interface UseImageStyleParams {
  pdfId: string | undefined;
  isReadOnlyProcessing: boolean;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
  setRegenAllMsg: Dispatch<SetStateAction<string | null>>;
}

export interface ImageStyleState {
  imageStyleDialogOpen: boolean;
  setImageStyleDialogOpen: Dispatch<SetStateAction<boolean>>;
  deckImageStylePrompt: string;
  setDeckImageStylePrompt: Dispatch<SetStateAction<string>>;
  imageStyleTemplates: ImagePromptTemplate[];
  selectedImageStyleTemplateKey: string;
  setSelectedImageStyleTemplateKey: Dispatch<SetStateAction<string>>;
  applyImageStyleTemplate: (key: string) => void;
  openImageStyleDialog: () => Promise<void>;
  handleSaveImageStyle: () => void;
}

export function useImageStyle({
  pdfId,
  isReadOnlyProcessing,
  setDetail,
  setRegenAllMsg,
}: UseImageStyleParams): ImageStyleState {
  const { t } = useI18n();
  const [imageStyleDialogOpen, setImageStyleDialogOpen] = useState(false);
  // Empty, not a style of its own: this value is sent with every redraw as "整份圖片風格（固定套用）",
  // so a hardcoded default here silently restyles every deck that never saved one — and the old
  // default said 「以深色系為主」, which is why redraws came back dark on decks that were generated
  // light. With it empty the redraw stays quiet about style and the backend applies the same
  // default the initial generation used (IMAGE_PROMPT_TEMPLATES[0]).
  const [deckImageStylePrompt, setDeckImageStylePrompt] = useState('');
  const [imageStyleTemplates, setImageStyleTemplates] = useState<ImagePromptTemplate[]>([]);
  const [selectedImageStyleTemplateKey, setSelectedImageStyleTemplateKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getImagePromptTemplates();
        if (cancelled) return;
        setImageStyleTemplates(res.templates);
        const key = res.default_template_key ?? res.templates[0]?.key ?? '';
        setSelectedImageStyleTemplateKey(key);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyImageStyleTemplate = useCallback(
    (key: string) => {
      setSelectedImageStyleTemplateKey(key);
      const hit = imageStyleTemplates.find((t) => t.key === key);
      if (hit) setDeckImageStylePrompt(hit.prompt_en);
    },
    [imageStyleTemplates],
  );

  const openImageStyleDialog = useCallback(async () => {
    if (!pdfId) {
      setImageStyleDialogOpen(true);
      return;
    }
    try {
      const d = await fetchPdfDetail(pdfId);
      setDetail(d);
      if (d.image_style_prompt && d.image_style_prompt.trim()) {
        setDeckImageStylePrompt(d.image_style_prompt);
      }
    } catch {
      // non-fatal: still allow opening dialog with current local value
    } finally {
      setImageStyleDialogOpen(true);
    }
  }, [pdfId, setDetail]);

  const handleSaveImageStyle = useCallback(() => {
    if (!pdfId) {
      setImageStyleDialogOpen(false);
      return;
    }
    if (isReadOnlyProcessing) return;
    void (async () => {
      try {
        const res = await updatePdfImageStyleSettings(pdfId, deckImageStylePrompt);
        setDetail((prev) =>
          prev
            ? { ...prev, image_style_prompt: res.image_style_prompt, updated_at: res.updated_at }
            : prev,
        );
        setRegenAllMsg(t('play.imageStyleDialog.saved'));
      } catch (err) {
        setRegenAllMsg(err instanceof ApiError ? err.message : t('play.imageStyleDialog.saveFailed'));
      } finally {
        setImageStyleDialogOpen(false);
      }
    })();
  }, [pdfId, isReadOnlyProcessing, deckImageStylePrompt, setDetail, setRegenAllMsg, t]);

  return {
    imageStyleDialogOpen,
    setImageStyleDialogOpen,
    deckImageStylePrompt,
    setDeckImageStylePrompt,
    imageStyleTemplates,
    selectedImageStyleTemplateKey,
    setSelectedImageStyleTemplateKey,
    applyImageStyleTemplate,
    openImageStyleDialog,
    handleSaveImageStyle,
  };
}
