import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXEMPTION_MAX_MS,
  EXEMPTION_TAIL_MS,
  __resetProctorExemptionForTest,
  beginProctorExemption,
  isProctorExempt,
  onProctorExemptionEnd,
  withProctorExemption,
} from './proctorExemption';

test('exempt while the camera request is pending and for a short tail after it ends', () => {
  __resetProctorExemptionForTest();
  assert.equal(isProctorExempt(1000), false);
  const end = beginProctorExemption(1000);
  assert.equal(isProctorExempt(5000), true);
  end(6000);
  assert.equal(isProctorExempt(6000 + EXEMPTION_TAIL_MS - 1), true);
  assert.equal(isProctorExempt(6000 + EXEMPTION_TAIL_MS), false);
});

test('a prompt left open too long stops being exempt (no "open the camera, then leave" loophole)', () => {
  __resetProctorExemptionForTest();
  const end = beginProctorExemption(0);
  assert.equal(isProctorExempt(EXEMPTION_MAX_MS - 1), true);
  assert.equal(isProctorExempt(EXEMPTION_MAX_MS), false);
  // 很晚才結束：寬限從上限時間點算，不從結束時間點算。
  end(EXEMPTION_MAX_MS * 3);
  assert.equal(isProctorExempt(EXEMPTION_MAX_MS * 3), false);
});

test('ending notifies listeners once, even if the request throws (e.g. permission denied)', async () => {
  __resetProctorExemptionForTest();
  let calls = 0;
  const off = onProctorExemptionEnd(() => { calls += 1; });
  await assert.rejects(withProctorExemption(async () => { throw new Error('NotAllowedError'); }));
  assert.equal(calls, 1);
  const end = beginProctorExemption();
  end();
  end();
  assert.equal(calls, 2);
  off();
  beginProctorExemption()();
  assert.equal(calls, 2);
});

test('the essay camera is wrapped, and the proctor gate honours the exemption and rechecks afterwards', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const essay = fs.readFileSync(path.join(dir, '..', 'components', 'EssayAnswerUploader.tsx'), 'utf8');
  const gate = fs.readFileSync(path.join(dir, '..', 'components', 'QuizProctorGate.tsx'), 'utf8');
  assert.match(essay, /withProctorExemption\(\(\) =>\s*navigator\.mediaDevices\.getUserMedia/);
  const leave = /const handleLeave = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(gate)?.[1] ?? '';
  assert.match(leave, /if \(isProctorExempt\(now\)\) return;/);
  assert.match(gate, /onProctorExemptionEnd\(/);
  assert.match(gate, /if \(document\.hidden \|\| !document\.hasFocus\(\)\) \{ handleLeave\(\); return; \}/, 'really switched away → counted as usual');
  assert.match(gate, /addEventListener\('pointerdown', restoreOnTap, true\)/, 'fullscreen comes back on the next tap');
});
