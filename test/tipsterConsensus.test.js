const test = require('node:test');
const assert = require('node:assert/strict');
const { attachTipsterConsensus } = require('../src/services/tipsterConsensus');

const MATCH = { homeTeam: 'Arsenal', awayTeam: 'Chelsea' };

function tip(site, totalsPick) {
  return { site, homeTeam: MATCH.homeTeam, awayTeam: MATCH.awayTeam, pick: null, totalsPick };
}

test('tipsterConsensus: O/U tally follows the actual SG Pools line, not a fixed 2.5', () => {
  // A predicted scoreline of 2-0 (total 2) reads as "under 2.5" by the
  // 2.5-line heuristic, but is "over 1.5" against a real 1.5 line.
  const tips = [
    tip('a', { selection: 'under', point: 2.5, total: 2 }),
    tip('b', { selection: 'under', point: 2.5, total: 2 }),
    tip('c', { selection: 'over', point: 2.5, total: 3 }),
  ];

  const match = { ...MATCH, odds: { ou: { point: 1.5, over: 1.9, under: 1.9 } } };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  // total=2 -> over 1.5; total=2 -> over 1.5; total=3 -> over 1.5: unanimous over.
  assert.deepEqual(withConsensus.tipsterConsensus.totalsTally, { over: 3, under: 0 });
  assert.equal(withConsensus.tipsterConsensus.totalsMajorityPoint, 1.5);
});

test('tipsterConsensus: an explicit-line O/U opinion is excluded when the real line differs', () => {
  const tips = [tip('a', { selection: 'over', point: 2.5 })]; // no `total`, so it's an explicit 2.5-line opinion
  const match = { ...MATCH, odds: { ou: { point: 1.5, over: 1.9, under: 1.9 } } };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  assert.equal(withConsensus.tipsterConsensus.totalTotalsTipsters, 0);
  assert.equal(withConsensus.tipsterConsensus.totalsMajorityPick, null);
});

test('tipsterConsensus: falls back to the pick\'s own point when the SG Pools line is unknown', () => {
  const tips = [tip('a', { selection: 'over', point: 2.5 }), tip('b', { selection: 'over', point: 2.5 })];
  const match = { ...MATCH, odds: null };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  assert.deepEqual(withConsensus.tipsterConsensus.totalsTally, { over: 2, under: 0 });
  assert.equal(withConsensus.tipsterConsensus.totalsMajorityPoint, 2.5);
});
