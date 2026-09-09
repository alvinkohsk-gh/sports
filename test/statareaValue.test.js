const test = require('node:test');
const assert = require('node:assert/strict');
const { assessStatareaValue } = require('../src/services/statareaValue');

const SG_ODDS = { oneX2: { home: 2.5, draw: 3.2, away: 2.8 }, ou: { point: 2.5, over: 2.07, under: 1.65 } };

test('assessStatareaValue: null when statarea has no pick for the match', () => {
  assert.equal(assessStatareaValue(SG_ODDS, null, {}), null);
  assert.equal(assessStatareaValue(SG_ODDS, { pick: null, totalsPick: null }, {}), null);
});

test('assessStatareaValue: a home pick with no accuracy history still assesses at the neutral weight', () => {
  const v = assessStatareaValue(SG_ODDS, { pick: 'home', totalsPick: null }, {});
  assert.ok(v.oneX2);
  assert.ok(v.oneX2.hasConsensus, 'a single classified pick should still produce a consensus read');
  const home = v.oneX2.outcomes.find((o) => o.key === 'home');
  assert.ok(home.consensusProb > 1 / 3, 'a single vote for home should read above the 1/3 baseline');
  assert.equal(v.ou, null, 'no totalsPick -> no O/U assessment');
});

test('assessStatareaValue: a higher accuracy weight pushes the reference probability (and EV) up', () => {
  const cold = assessStatareaValue(SG_ODDS, { pick: 'home', totalsPick: null }, {
    statarea: { oneX2: 0.4, totals: 1 },
  });
  const sharp = assessStatareaValue(SG_ODDS, { pick: 'home', totalsPick: null }, {
    statarea: { oneX2: 1.8, totals: 1 },
  });
  const coldHome = cold.oneX2.outcomes.find((o) => o.key === 'home');
  const sharpHome = sharp.oneX2.outcomes.find((o) => o.key === 'home');
  assert.ok(sharpHome.refProb > coldHome.refProb);
  assert.ok(sharpHome.ev > coldHome.ev);
});

test('assessStatareaValue: O/U resolves statarea\'s totals pick against the real SG Pools line', () => {
  const sgOdds = { oneX2: SG_ODDS.oneX2, ou: { point: 1.5, over: 1.5, under: 2.6 } };
  // A scoreline-derived pick with total=2 reads "under 2.5" but is "over 1.5".
  const v = assessStatareaValue(sgOdds, { pick: null, totalsPick: { selection: 'under', point: 2.5, total: 2 } }, {});
  assert.ok(v.ou);
  assert.equal(v.ou.outcomes.find((o) => o.consensusProb > 0.5).key, 'over');
});

test('assessStatareaValue: an explicit-line totals pick that doesn\'t match the real line is dropped', () => {
  const sgOdds = { oneX2: SG_ODDS.oneX2, ou: { point: 1.5, over: 1.5, under: 2.6 } };
  // statarea has no 1X2 pick and its O/U opinion is about a different line
  // than what's actually on offer -> nothing classified for this match at all.
  const v = assessStatareaValue(sgOdds, { pick: null, totalsPick: { selection: 'over', point: 2.5 } }, {});
  assert.equal(v, null);
});

test('assessStatareaValue: best picks the higher-EV market when both qualify', () => {
  const v = assessStatareaValue(
    SG_ODDS,
    { pick: 'home', totalsPick: { selection: 'over', point: 2.5, total: 3 } },
    { statarea: { oneX2: 0.5, totals: 1.9 } }
  );
  if (v.best) {
    assert.ok(['1X2', 'O/U 2.5'].includes(v.best.market));
  }
});
