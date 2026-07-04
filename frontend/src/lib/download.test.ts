import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerDownload, downloadBlob } from './download';

interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  clicked: boolean;
  removed: boolean;
  click(): void;
  remove(): void;
}

function createMockDocument() {
  const anchors: FakeAnchor[] = [];
  const appended: FakeAnchor[] = [];
  const doc = {
    createElement(tag: 'a') {
      assert.equal(tag, 'a');
      const a: FakeAnchor = {
        href: '',
        download: '',
        rel: '',
        clicked: false,
        removed: false,
        click() { this.clicked = true; },
        remove() { this.removed = true; },
      };
      anchors.push(a);
      return a;
    },
    body: { appendChild(node: FakeAnchor) { appended.push(node); } },
  };
  return { doc, anchors, appended };
}

test('triggerDownload sets href/download/rel, appends, clicks, and removes the anchor', () => {
  const { doc, anchors, appended } = createMockDocument();
  triggerDownload('https://example.com/file.zip', 'out.zip', doc as never);
  assert.equal(anchors.length, 1);
  const a = anchors[0]!;
  assert.equal(a.href, 'https://example.com/file.zip');
  assert.equal(a.download, 'out.zip');
  assert.equal(a.rel, 'noopener');
  assert.equal(appended[0], a);
  assert.ok(a.clicked);
  assert.ok(a.removed);
});

test('downloadBlob creates an object URL, downloads it, and revokes it', () => {
  const { doc, anchors } = createMockDocument();
  const created: string[] = [];
  const revoked: string[] = [];
  const urlLike = {
    createObjectURL() { const u = `blob:mock-${created.length}`; created.push(u); return u; },
    revokeObjectURL(u: string) { revoked.push(u); },
  };
  downloadBlob(new Blob(['hi']), 'note.md', doc as never, urlLike as never);
  assert.deepEqual(created, ['blob:mock-0']);
  assert.equal(anchors[0]!.href, 'blob:mock-0');
  assert.equal(anchors[0]!.download, 'note.md');
  assert.deepEqual(revoked, ['blob:mock-0']); // revoked even after download
});

test('helpers are a no-op when no document/URL is available (SSR-safe)', () => {
  assert.doesNotThrow(() => triggerDownload('x', 'y', undefined));
  assert.doesNotThrow(() => downloadBlob(new Blob(['x']), 'y', undefined, undefined));
});
