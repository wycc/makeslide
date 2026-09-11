import test from 'node:test';
import assert from 'node:assert/strict';
import { askPageQuestion } from './api';

/** Stub fetch with a one-event SSE stream and return the JSON bodies it was sent. */
function stubAskFetch(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const sse = `event: done\ndata: ${JSON.stringify({ answer: 'ok' })}\n\n`;
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  return bodies;
}

test('askPageQuestion sends allowOutsideKnowledge:true only when the box is checked', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = stubAskFetch();
  try {
    const deltas: string[] = [];
    const result = await askPageQuestion('pdf1', 3, 'why?', undefined, [], 'brief', true, (d) => deltas.push(d));
    assert.equal(result.answer, 'ok');
    assert.equal(bodies[0]?.allowOutsideKnowledge, true);
    assert.equal(bodies[0]?.verbosity, 'brief');

    await askPageQuestion('pdf1', 3, 'why?', undefined, [], 'brief', false);
    await askPageQuestion('pdf1', 3, 'why?', undefined, [], 'brief');
    // Unchecked sends nothing, so the request is the same as before the option existed.
    assert.equal('allowOutsideKnowledge' in bodies[1]!, false);
    assert.equal('allowOutsideKnowledge' in bodies[2]!, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
