/**
 * Pure decision for whether the play deck should render in read-only mode for the current viewer.
 *
 * Access to a presentation comes from two independent systems, and the effective level is the
 * higher of the two:
 * - identity-based access (the deck's visibility default + per-user/group ACL), and
 * - the capability of any share token the viewer holds (read_only / editable).
 * The backend already folds both into `accessLevel` (the effective level), so an editable token or
 * a read-write ACL grant resolves to 'edit'. We therefore show a read-only UI when the viewer does
 * not effectively have edit — without ever surfacing edit controls the backend would reject.
 *
 * The owner (and legacy ownerless decks, which report is_owner=true) is always read-write; the
 * read-only restriction only applies to other visitors, so the owner never gets locked out of
 * their own deck by a read-only share they created.
 */
export interface DeckReadOnlyInput {
  /** Whether the viewer is the owner (or the deck is ownerless / legacy). */
  isOwner: boolean;
  /** The share-link mode in effect on this request, if any. */
  shareMode: 'read_only' | 'editable' | null | undefined;
  /** The deck's visibility default. */
  visibility: 'private' | 'public' | 'public_editable' | undefined;
  /** The viewer's effective access level (identity max token), as reported by the backend. */
  accessLevel: 'none' | 'read' | 'edit' | undefined;
  /** Whether the current URL carries a share token. */
  hasShareToken: boolean;
}

export function resolveDeckReadOnly(input: DeckReadOnlyInput): boolean {
  // An explicit read-only effective level always means read-only (a read-only ACL grant, or a
  // read-only default with no higher grant/token).
  if (input.accessLevel === 'read') return true;
  // Otherwise a non-owner is read-only when they opened an explicit read-only share link, or the
  // deck is public (read-only) and they hold no token. Owners and edit-level viewers are read-write.
  return (
    !input.isOwner &&
    (input.shareMode === 'read_only' || (!input.hasShareToken && input.visibility === 'public'))
  );
}
