import { useEffect, useRef } from 'react';
import { fetchPdfRevision } from '../../lib/api';

const POLL_INTERVAL_MS = 6000;

interface UseLiveContentUpdateParams {
  pdfId: string | null | undefined;
  shareToken: string | null | undefined;
  /** Only poll while the deck is fully loaded/ready and on screen. */
  enabled: boolean;
  /** The currently-loaded deck revision (pdfs.updated_at). Seeds the baseline so a change that
   *  lands between the initial detail load and the first poll is still detected. */
  currentUpdatedAt: string | null | undefined;
  /** Called when the deck's content revision changed; the caller should re-fetch the detail. */
  onChanged: () => void;
}

/**
 * Polls the lightweight `GET /api/pdfs/:id/revision` endpoint while a presentation is open and
 * invokes `onChanged` whenever the deck's `updated_at` (or page_count) changes — i.e. when the
 * presentation was rewritten by someone else. Pauses while the tab is hidden to avoid needless
 * traffic. The per-page cache-busting in PlayPage then ensures only the actually-changed page's
 * image/subtitle visibly refresh (and audio is not interrupted mid-playback).
 */
export function useLiveContentUpdate({ pdfId, shareToken, enabled, currentUpdatedAt, onChanged }: UseLiveContentUpdateParams): void {
  // Latest onChanged without retriggering the polling effect on every render.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // Baseline revision we've already reflected locally. Seeded from the loaded detail so the first
  // poll doesn't spuriously re-fetch, but a change since load is still caught.
  const lastSeenRef = useRef<string | null>(currentUpdatedAt ?? null);
  // When the parent re-fetches detail (after a detected change), keep the baseline in step so we
  // don't fire again for the same revision.
  useEffect(() => {
    if (currentUpdatedAt) lastSeenRef.current = currentUpdatedAt;
  }, [currentUpdatedAt]);

  useEffect(() => {
    if (!pdfId || !enabled) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return; // paused while tab hidden
      try {
        const rev = await fetchPdfRevision(pdfId, shareToken || undefined);
        if (cancelled) return;
        if (lastSeenRef.current == null) {
          lastSeenRef.current = rev.updated_at;
          return;
        }
        if (rev.updated_at !== lastSeenRef.current) {
          lastSeenRef.current = rev.updated_at;
          onChangedRef.current();
        }
      } catch {
        // transient network / permission blip — try again next tick
      }
    };

    timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    // Also probe immediately when the tab becomes visible again so a change made while hidden
    // is reflected promptly rather than after up to a full interval.
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pdfId, shareToken, enabled]);
}
