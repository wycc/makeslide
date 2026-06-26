import { useEffect } from 'react';

// Shared dismiss behaviour for full-screen overlays/modals so they all close the
// same way (Escape key + a click on the backdrop itself). The decision parts are
// pure and exported for unit testing; the hook wires them to real DOM events.

/** Whether a key press should dismiss an overlay (Escape). */
export function isOverlayDismissKey(key: string): boolean {
  return key === 'Escape';
}

/**
 * Whether a backdrop pointer event should dismiss the overlay: only when the
 * event landed on the backdrop element itself, not when it bubbled up from a
 * child (so clicks inside the dialog panel don't close it).
 */
export function isBackdropClick(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  return target === currentTarget;
}

export interface OverlayDismissHandlers {
  /** Attach to the backdrop element's `onClick`. */
  onBackdropClick: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => void;
}

/**
 * Closes an overlay on Escape (global keydown) and returns an `onBackdropClick`
 * handler that closes only when the backdrop itself is clicked.
 */
export function useOverlayDismiss(onClose: () => void): OverlayDismissHandlers {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isOverlayDismissKey(event.key)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return {
    onBackdropClick: (event) => {
      if (isBackdropClick(event.target, event.currentTarget)) onClose();
    },
  };
}
