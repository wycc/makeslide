import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNotebookHost,
  registerNotebookHost,
  subscribeNotebookHosts,
  type NotebookHostEntry,
} from './notebookHostStore';

function fakeEl(): HTMLElement {
  return {} as HTMLElement;
}

test('activeNotebookHost returns null with no registrations', () => {
  assert.equal(activeNotebookHost(), null);
});

test('a fullscreen slot wins over the normal slot regardless of registration order', () => {
  const normal: NotebookHostEntry = { el: fakeEl(), fullscreen: false, maxHeight: '60vh' };
  const fullscreen: NotebookHostEntry = { el: fakeEl(), fullscreen: true };

  const unregisterNormal = registerNotebookHost(normal);
  assert.equal(activeNotebookHost(), normal);

  const unregisterFullscreen = registerNotebookHost(fullscreen);
  assert.equal(activeNotebookHost(), fullscreen);

  // Leaving fullscreen unregisters its slot → the panel returns to the normal slot.
  unregisterFullscreen();
  assert.equal(activeNotebookHost(), normal);

  unregisterNormal();
  assert.equal(activeNotebookHost(), null);
});

test('subscribers are notified on register and unregister, and can unsubscribe', () => {
  let calls = 0;
  const unsubscribe = subscribeNotebookHosts(() => {
    calls += 1;
  });
  const unregister = registerNotebookHost({ el: fakeEl(), fullscreen: false });
  assert.equal(calls, 1);
  unregister();
  assert.equal(calls, 2);
  unsubscribe();
  const unregister2 = registerNotebookHost({ el: fakeEl(), fullscreen: false });
  assert.equal(calls, 2);
  unregister2();
});

test('activeNotebookHost returns a stable reference while registrations are unchanged', () => {
  const unregister = registerNotebookHost({ el: fakeEl(), fullscreen: false });
  try {
    // useSyncExternalStore requires getSnapshot to be referentially stable between
    // store changes, or React loops re-rendering.
    assert.equal(activeNotebookHost(), activeNotebookHost());
  } finally {
    unregister();
  }
});
