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

test('tipsterConsensus: weightedTally applies per-site weights while the raw tally stays a plain vote count', () => {
  const tips = [
    { site: 'sharp', homeTeam: MATCH.homeTeam, awayTeam: MATCH.awayTeam, pick: 'home', totalsPick: null },
    { site: 'cold', homeTeam: MATCH.homeTeam, awayTeam: MATCH.awayTeam, pick: 'away', totalsPick: null },
  ];
  const siteWeights = { sharp: { oneX2: 1.8, totals: 1 }, cold: { oneX2: 0.5, totals: 1 } };
  const match = { ...MATCH, odds: null };
  const [withConsensus] = attachTipsterConsensus([match], tips, siteWeights);

  assert.deepEqual(withConsensus.tipsterConsensus.tally, { home: 1, draw: 0, away: 1, unclassified: 0 });
  assert.deepEqual(withConsensus.tipsterConsensus.weightedTally, { home: 1.8, draw: 0, away: 0.5 });
  // raw majority stays a tie (1 vs 1) even though the weighted score favors home
  assert.equal(withConsensus.tipsterConsensus.majorityCount, 1);
});

test('tipsterConsensus: an unweighted call (no siteWeights arg) leaves weightedTally equal to the raw tally', () => {
  const tips = [tip('a', { selection: 'over', point: 2.5, total: 3 })];
  const match = { ...MATCH, odds: { ou: { point: 2.5, over: 1.9, under: 1.9 } } };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  assert.deepEqual(withConsensus.tipsterConsensus.weightedTotalsTally, { over: 1, under: 0 });
});

function bttsTip(site, bttsPick) {
  return { site, homeTeam: MATCH.homeTeam, awayTeam: MATCH.awayTeam, pick: null, totalsPick: null, bttsPick };
}

test('tipsterConsensus: BTTS tally is a straight yes/no majority vote', () => {
  const tips = [bttsTip('a', 'yes'), bttsTip('b', 'yes'), bttsTip('c', 'no')];
  const match = { ...MATCH, odds: null };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  assert.deepEqual(withConsensus.tipsterConsensus.bttsTally, { yes: 2, no: 1 });
  assert.equal(withConsensus.tipsterConsensus.bttsMajorityPick, 'yes');
  assert.equal(withConsensus.tipsterConsensus.bttsMajorityCount, 2);
  assert.equal(withConsensus.tipsterConsensus.totalBttsTipsters, 3);
});

test('tipsterConsensus: a tipster with no BTTS opinion is excluded from the BTTS tally', () => {
  const tips = [bttsTip('a', 'yes'), tip('b', null)]; // b has neither a totalsPick nor a bttsPick
  const match = { ...MATCH, odds: null };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  assert.deepEqual(withConsensus.tipsterConsensus.bttsTally, { yes: 1, no: 0 });
  assert.equal(withConsensus.tipsterConsensus.totalBttsTipsters, 1);
});

test('tipsterConsensus: no BTTS picks at all leaves bttsMajorityPick null', () => {
  const tips = [tip('a', null)];
  const match = { ...MATCH, odds: null };
  const [withConsensus] = attachTipsterConsensus([match], tips);

  assert.equal(withConsensus.tipsterConsensus.bttsMajorityPick, null);
  assert.equal(withConsensus.tipsterConsensus.totalBttsTipsters, 0);
});

test('tipsterConsensus: weightedBttsTally applies per-site btts weight while the raw tally stays a plain vote count', () => {
  const tips = [bttsTip('sharp', 'yes'), bttsTip('cold', 'no')];
  const siteWeights = { sharp: { btts: 1.8 }, cold: { btts: 0.5 } };
  const match = { ...MATCH, odds: null };
  const [withConsensus] = attachTipsterConsensus([match], tips, siteWeights);

  assert.deepEqual(withConsensus.tipsterConsensus.bttsTally, { yes: 1, no: 1 });
  assert.deepEqual(withConsensus.tipsterConsensus.weightedBttsTally, { yes: 1.8, no: 0.5 });
});
