import { useState, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ApiError, fetchPdfDetail, generatePdfVideo } from '../../lib/api';
import type { PdfDetail } from '../../types';

interface UseVideoGenerationParams {
  pdfId: string | undefined;
  isReadOnlyProcessing: boolean;
  detail: PdfDetail | null;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
}

export interface VideoGenerationState {
  videoBusy: boolean;
  setVideoBusy: Dispatch<SetStateAction<boolean>>;
  videoError: string | null;
  setVideoError: Dispatch<SetStateAction<string | null>>;
  videoUrl: string | null;
  setVideoUrl: Dispatch<SetStateAction<string | null>>;
  videoProgressText: string | null;
  handleGenerateVideo: () => void;
}

export function useVideoGeneration({
  pdfId,
  isReadOnlyProcessing,
  detail,
  setDetail,
}: UseVideoGenerationParams): VideoGenerationState {
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const videoProgressCurrent = Math.max(0, detail?.progress_current ?? 0);
  const videoProgressTotal = Math.max(0, detail?.progress_total ?? 0);
  const videoProgressText =
    videoBusy && videoProgressTotal > 0
      ? `${videoProgressCurrent}/${videoProgressTotal}`
      : null;

  const handleGenerateVideo = useCallback(async () => {
    if (isReadOnlyProcessing) return;
    if (!pdfId) return;
    setVideoBusy(true);
    setVideoError(null);
    try {
      const res = await generatePdfVideo(pdfId);
      setVideoUrl(res.video_url);
      setDetail((prev) =>
        prev ? { ...prev, video_url: res.video_url, updated_at: res.updated_at } : prev,
      );
    } catch (err) {
      setVideoError(err instanceof ApiError ? err.message : '產生影片失敗');
    } finally {
      setVideoBusy(false);
    }
  }, [pdfId, isReadOnlyProcessing, setDetail]);

  // 影片渲染中時輪詢 detail 取得進度。
  useEffect(() => {
    if (!videoBusy || !pdfId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const d = await fetchPdfDetail(pdfId);
          if (cancelled) return;
          setDetail((prev) => {
            if (!prev) return d;
            return {
              ...prev,
              progress_step: d.progress_step,
              progress_current: d.progress_current,
              progress_total: d.progress_total,
              updated_at: d.updated_at,
            };
          });
        } catch {
          // non-fatal while video rendering
        }
      })();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [videoBusy, pdfId, setDetail]);

  // 從 detail.progress_step 同步 videoBusy。
  useEffect(() => {
    const isRenderingVideo = detail?.progress_step === 'rendering_video';
    if (isRenderingVideo) {
      setVideoBusy(true);
      setVideoError(null);
      return;
    }
    setVideoBusy(false);
  }, [detail?.progress_step]);

  return {
    videoBusy,
    setVideoBusy,
    videoError,
    setVideoError,
    videoUrl,
    setVideoUrl,
    videoProgressText,
    handleGenerateVideo,
  };
}
