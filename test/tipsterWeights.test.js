const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSiteWeights, siteWeight, MIN_WEIGHT, MAX_WEIGHT } = require('../src/services/tipsterWeights');

test('computeSiteWeights: a site beating chance on 1X2 gets weight above 1', () => {
  const weights = computeSiteWeights({
    perSite: { sharp: { oneX2Correct: 30, oneX2Total: 40, ouCorrect: 0, ouTotal: 0 } }, // 75% vs 33% baseline
  });
  assert.ok(weights.sharp.oneX2 > 1, `expected >1, got ${weights.sharp.oneX2}`);
  assert.ok(weights.sharp.oneX2 <= MAX_WEIGHT);
});

test('computeSiteWeights: a site below chance gets weight below 1, clamped to MIN_WEIGHT', () => {
  const weights = computeSiteWeights({
    perSite: { cold: { oneX2Correct: 2, oneX2Total: 40, ouCorrect: 0, ouTotal: 0 } }, // 5% vs 33% baseline
  });
  assert.ok(weights.cold.oneX2 < 1, `expected <1, got ${weights.cold.oneX2}`);
  assert.ok(weights.cold.oneX2 >= MIN_WEIGHT);
});

test('computeSiteWeights: a site with few graded samples stays close to neutral (shrinkage)', () => {
  const weights = computeSiteWeights({
    perSite: { rookie: { oneX2Correct: 2, oneX2Total: 2, ouCorrect: 0, ouTotal: 0 } }, // 100% on n=2
  });
  assert.ok(weights.rookie.oneX2 > 1 && weights.rookie.oneX2 < 1.3, `expected close to 1, got ${weights.rookie.oneX2}`);
});

test('computeSiteWeights: 1X2 and O/U tracks are weighted independently', () => {
  const weights = computeSiteWeights({
    perSite: { mixed: { oneX2Correct: 30, oneX2Total: 40, ouCorrect: 5, ouTotal: 40 } },
  });
  assert.ok(weights.mixed.oneX2 > 1);
  assert.ok(weights.mixed.totals < 1);
});

test('siteWeight: unknown site or market defaults to 1', () => {
  const weights = computeSiteWeights({ perSite: { known: { oneX2Correct: 30, oneX2Total: 40 } } });
  assert.equal(siteWeight(weights, 'unknown-site', 'oneX2'), 1);
  assert.equal(siteWeight(weights, 'known', 'totals'), 1); // no O/U samples for this site
  assert.equal(siteWeight(null, 'known', 'oneX2'), 1);
});

test('computeSiteWeights: no accuracy data at all -> empty weights map, everything defaults to 1', () => {
  assert.deepEqual(computeSiteWeights(null), {});
  assert.equal(siteWeight(computeSiteWeights(null), 'anyone', 'oneX2'), 1);
});
