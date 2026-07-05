import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJoinQrImageUrl } from './joinQr';

test('buildJoinQrImageUrl encodes the data and uses the default size', () => {
  const url = buildJoinQrImageUrl('https://example.com/play/abc?share=tok');
  assert.equal(
    url,
    'https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=https%3A%2F%2Fexample.com%2Fplay%2Fabc%3Fshare%3Dtok',
  );
});

test('buildJoinQrImageUrl honours a custom size', () => {
  const url = buildJoinQrImageUrl('hello', 256);
  assert.ok(url.includes('size=256x256'));
  assert.ok(url.endsWith('data=hello'));
});

test('buildJoinQrImageUrl floors and clamps the size to at least 1', () => {
  assert.ok(buildJoinQrImageUrl('x', 100.9).includes('size=100x100'));
  assert.ok(buildJoinQrImageUrl('x', 0).includes('size=1x1'));
  assert.ok(buildJoinQrImageUrl('x', -50).includes('size=1x1'));
});
