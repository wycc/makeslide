import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCloseOnOutsidePointer, isDropdownDismissKey } from './headerDropdownDismiss';

test('shouldCloseOnOutsidePointer only closes an open dropdown clicked outside its root', () => {
  assert.equal(shouldCloseOnOutsidePointer(true, false), true); // open + outside → close
  assert.equal(shouldCloseOnOutsidePointer(true, true), false); // open + inside → keep open
  assert.equal(shouldCloseOnOutsidePointer(false, false), false); // already closed → nothing to do
  assert.equal(shouldCloseOnOutsidePointer(false, true), false);
});

test('isDropdownDismissKey matches only Escape', () => {
  assert.equal(isDropdownDismissKey('Escape'), true);
  assert.equal(isDropdownDismissKey('Enter'), false);
  assert.equal(isDropdownDismissKey('Esc'), false); // legacy IE value, not used by modern browsers
  assert.equal(isDropdownDismissKey(' '), false);
});
