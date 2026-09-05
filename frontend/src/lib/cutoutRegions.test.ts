import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRegion, dragToRegion, regionAtPoint } from './cutoutRegions';

test('dragToRegion normalises any drag direction, clamps to the page, and rejects clicks', () => {
  assert.deepEqual(dragToRegion({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 }), { x: 0.2, y: 0.3, w: 0.4, h: 0.4 });
  assert.deepEqual(dragToRegion({ x: -0.2, y: 0.5 }, { x: 0.5, y: 1.4 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  assert.equal(dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.9 }), null, 'too thin');
  assert.equal(dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), null, 'a click');
});

test('regionAtPoint prefers the last-drawn region and describeRegion rounds to percent', () => {
  const regions = [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }];
  assert.equal(regionAtPoint(regions, { x: 0.3, y: 0.3 }), 1);
  assert.equal(regionAtPoint(regions, { x: 0.1, y: 0.1 }), 0);
  assert.equal(regionAtPoint(regions, { x: 0.9, y: 0.9 }), -1);
  assert.equal(describeRegion({ x: 0.123, y: 0.3, w: 0.4, h: 0.2 }), 'x 12% · y 30% · 40×20%');
});
