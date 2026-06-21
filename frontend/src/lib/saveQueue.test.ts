import test from 'node:test';
import assert from 'node:assert/strict';

import { createSequentialQueue } from './saveQueue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('createSequentialQueue runs calls in dispatch order even if an earlier call resolves later', async () => {
  const landed: string[][] = [];
  const gate1 = deferred<void>();
  const gate2 = deferred<void>();
  const queue = createSequentialQueue<string[]>(async (ids) => {
    // First call (ids = ['A']) waits on gate1; second call (ids = ['A','B']) waits on gate2.
    if (ids.length === 1) await gate1.promise;
    else await gate2.promise;
    landed.push(ids);
  });

  const p1 = queue(['A']);
  const p2 = queue(['A', 'B']);

  // Resolve the *second* call's gate first to simulate a faster network response for the
  // later-dispatched request — without the queue this would let it land before the first call.
  gate2.resolve();
  gate1.resolve();
  await Promise.all([p1, p2]);

  assert.deepEqual(landed, [['A'], ['A', 'B']]);
});

test('createSequentialQueue keeps running later calls after an earlier call rejects', async () => {
  const landed: string[][] = [];
  const queue = createSequentialQueue<string[]>(async (ids) => {
    if (ids[0] === 'fail') throw new Error('boom');
    landed.push(ids);
  });

  await assert.rejects(queue(['fail']));
  await queue(['ok']);

  assert.deepEqual(landed, [['ok']]);
});

test('createSequentialQueue resolves each call with its own outcome, not a shared one', async () => {
  const queue = createSequentialQueue<number>(async (n) => {
    if (n === 2) throw new Error('boom');
  });

  const r1 = queue(1);
  const r2 = queue(2);
  const r3 = queue(3);

  await assert.doesNotReject(r1);
  await assert.rejects(r2);
  await assert.doesNotReject(r3);
});
