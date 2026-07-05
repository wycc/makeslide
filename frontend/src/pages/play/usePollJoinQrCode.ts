import { useEffect, useState } from 'react';
import { createPdfShare } from '../../lib/api';
import { buildJoinQrImageUrl } from '../../lib/joinQr';

export interface PollJoinQrState {
  // QR image URL that encodes the read-only share link; null while inactive or before it resolves.
  pollJoinQrImageUrl: string | null;
  // The absolute share URL the QR encodes (shown as a fallback so the audience can also type it in).
  pollJoinShareUrl: string | null;
}

const EMPTY: PollJoinQrState = { pollJoinQrImageUrl: null, pollJoinShareUrl: null };

/**
 * When a live poll is running (`active`) and the current viewer may present it (`eligible`, i.e. the
 * owner/master), lazily mint a read-only share link and turn it into a scannable QR code. Scanning the
 * code opens the presentation via the share link, which auto-enables sync mode (see PlayPage), so the
 * audience lands straight in the synced deck and can vote.
 *
 * The share link is created once per activation (effect keyed on `active`/`eligible`/`pdfId`); the QR
 * clears as soon as the poll stops so it never lingers on screen.
 */
export function usePollJoinQrCode({
  pdfId,
  active,
  eligible,
}: {
  pdfId: string | undefined;
  active: boolean;
  eligible: boolean;
}): PollJoinQrState {
  const [state, setState] = useState<PollJoinQrState>(EMPTY);

  useEffect(() => {
    if (!active || !eligible || !pdfId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    void createPdfShare(pdfId, 'read_only')
      .then((res) => {
        if (cancelled) return;
        const absoluteUrl = `${window.location.origin}${res.share_url}`;
        setState({ pollJoinShareUrl: absoluteUrl, pollJoinQrImageUrl: buildJoinQrImageUrl(absoluteUrl) });
      })
      .catch(() => {
        if (!cancelled) setState(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, active, eligible]);

  return state;
}
