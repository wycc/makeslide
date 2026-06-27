import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debugLog, debugWarn } from './debugLog';

const g = globalThis as { localStorage?: unknown };

function withLocalStorage(impl: { getItem(key: string): string | null }, fn: () => void): void {
  const had = 'localStorage' in g;
  const prev = g.localStorage;
  (g as { localStorage: unknown }).localStorage = impl;
  try {
    fn();
  } finally {
    if (had) (g as { localStorage: unknown }).localStorage = prev;
    else delete g.localStorage;
  }
}

function captureConsole(method: 'info' | 'warn', fn: () => void): unknown[][] {
  const calls: unknown[][] = [];
  const orig = console[method];
  console[method] = (...args: unknown[]) => { calls.push(args); };
  try {
    fn();
  } finally {
    console[method] = orig;
  }
  return calls;
}

test('debugLog logs via console.info only when makeslide.debug === "1"', () => {
  let calls = captureConsole('info', () => {
    withLocalStorage({ getItem: () => '1' }, () => debugLog('hello', 42));
  });
  assert.deepEqual(calls, [['hello', 42]]);

  calls = captureConsole('info', () => {
    withLocalStorage({ getItem: () => '0' }, () => debugLog('nope'));
  });
  assert.deepEqual(calls, []);
});

test('debugWarn logs via console.warn only when enabled', () => {
  const calls = captureConsole('warn', () => {
    withLocalStorage({ getItem: () => '1' }, () => debugWarn('w', { a: 1 }));
  });
  assert.deepEqual(calls, [['w', { a: 1 }]]);
});

test('debug logging is silent (and does not throw) when localStorage access throws', () => {
  const calls = captureConsole('info', () => {
    withLocalStorage({ getItem: () => { throw new Error('blocked'); } }, () => {
      assert.doesNotThrow(() => debugLog('x'));
    });
  });
  assert.deepEqual(calls, []);
});
