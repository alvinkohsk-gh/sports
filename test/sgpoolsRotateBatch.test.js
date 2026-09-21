const test = require('node:test');
const assert = require('node:assert/strict');
const { pickRotateBatch } = require('../src/scrapers/singaporePools/render');

const WINDOW_MS = 15 * 60 * 1000;

test('pickRotateBatch: alternates between the two batches across successive 15-minute windows', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0); // aligned to a window boundary
  const batchA = pickRotateBatch(t0);
  const batchB = pickRotateBatch(t0 + WINDOW_MS);
  const batchA2 = pickRotateBatch(t0 + 2 * WINDOW_MS);
  assert.notDeepEqual(batchA, batchB);
  assert.deepEqual(batchA, batchA2);
});

test('pickRotateBatch: every batch is 3 markets, and the two batches partition all 6 rotating markets', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const batchA = pickRotateBatch(t0);
  const batchB = pickRotateBatch(t0 + WINDOW_MS);
  assert.equal(batchA.length, 3);
  assert.equal(batchB.length, 3);
  const all = [...batchA, ...batchB].sort();
  assert.deepEqual(all, ['btts', 'firstGoal', 'goalHandicap', 'h1', 'handicap1x2', 'oe']);
});

test('pickRotateBatch: stays constant within the same 15-minute window', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0) + 3000; // a few seconds into the window
  const t1 = t0 + 5 * 60 * 1000; // still inside the same 15-min window
  assert.deepEqual(pickRotateBatch(t0), pickRotateBatch(t1));
});
