import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `tsx watch` adds every file the server imports to its watcher, and its built-in
// `**/node_modules/**` ignore is resolved against the cwd — `backend/`. npm workspaces hoist the
// dependencies into the ROOT node_modules, which is outside that, so the ignore never matched and
// every imported dependency file cost one inotify watch (measured: importing music-metadata alone
// is 80 watches without the exclude, 1 with it). On a machine whose watch budget is mostly taken by
// an editor, the backend then dies on startup with ENOSPC and systemd restarts it forever.

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('backend dev script keeps tsx watch out of the hoisted root node_modules', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
  const dev: string = pkg.scripts.dev;
  assert.match(dev, /tsx watch/);
  assert.match(dev, /--exclude\s+\\?["']\.\.\/node_modules\/\*\*\\?["']/);
  // The pattern is relative to backend/, so it only means something while deps are hoisted there.
  assert.ok(fs.existsSync(path.join(BACKEND_ROOT, '..', 'node_modules', 'tsx')), 'tsx is expected in the root node_modules');
});
