// Pure dismiss-decision helpers for HeaderDropdown, split out so they can be unit
// tested without rendering the (context-heavy) PlayPageHeader component.

/**
 * Whether an open dropdown should close in response to a pointer-down event.
 * Closes only when the dropdown is open and the pointer landed outside its root
 * element — a click inside the menu (e.g. adjusting a slider) must keep it open.
 */
export function shouldCloseOnOutsidePointer(open: boolean, clickedInsideRoot: boolean): boolean {
  return open && !clickedInsideRoot;
}

/** Whether a key press should dismiss an open dropdown (Escape, matching the rest of the play header). */
export function isDropdownDismissKey(key: string): boolean {
  return key === 'Escape';
}
