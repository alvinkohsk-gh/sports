const test = require('node:test');
const assert = require('node:assert/strict');
const { devig, consensusProbs, assessMarket, assessValue } = require('../src/services/value');

test('devig: no-vig probabilities sum to 1 and margin is Σ(1/odd) − 1', () => {
  const d = devig({ home: 2.0, draw: 4.0, away: 4.0 });
  const sum = d.noVig.home + d.noVig.draw + d.noVig.away;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  // 0.5 + 0.25 + 0.25 = 1.0 -> overround 0
  assert.ok(Math.abs(d.overround - 0) < 1e-9);

  const d2 = devig({ over: 1.8, under: 1.8 }); // Σ implied = 1.111...
  assert.ok(Math.abs(d2.overround - (2 / 1.8 - 1)) < 1e-9);
  assert.ok(Math.abs(d2.noVig.over - 0.5) < 1e-9);
});

test('devig: needs at least two priced outcomes', () => {
  assert.equal(devig({ home: 2.0 }), null);
  assert.equal(devig({ home: 2.0, draw: 1 /* invalid */ }), null);
});

test('consensusProbs: null below the vote threshold, smoothed above it', () => {
  assert.equal(consensusProbs({ home: 1, draw: 1, away: 1 }, ['home', 'draw', 'away']), null); // 3 < 4
  const p = consensusProbs({ home: 8, draw: 0, away: 2 }, ['home', 'draw', 'away']);
  const sum = p.home + p.draw + p.away;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(p.draw > 0, 'smoothing keeps a zero-vote outcome non-zero');
  assert.ok(p.home > p.away && p.away > p.draw);
});

test('assessMarket: flags a value outcome when the consensus leans hard against a ~even price', () => {
  // Over/Under priced ~50/50 with margin; consensus 8-2 for Over
  const m = assessMarket(
    { over: 2.07, under: 1.65 },
    { over: 8, under: 2 },
    { over: 'Over 2.5', under: 'Under 2.5' }
  );
  assert.ok(m.hasConsensus);
  const over = m.outcomes.find((o) => o.key === 'over');
  assert.ok(over.ev > 0.05, `EV ${over.ev} should clear the 0.05 threshold`);
  assert.ok(over.value);
  assert.ok(over.quarterKelly > 0 && over.quarterKelly < 0.25);
  assert.equal(m.best.key, 'over');
});

test('assessMarket: no consensus -> reference is the no-vig line -> nothing flagged', () => {
  const m = assessMarket(
    { home: 1.97, draw: 2.95, away: 3.5 },
    { home: 1, draw: 1, away: 0 }, // 2 votes, below threshold
    { home: 'Home', draw: 'Draw', away: 'Away' }
  );
  assert.equal(m.hasConsensus, false);
  assert.equal(m.best, null);
  for (const o of m.outcomes) {
    assert.equal(o.value, false);
    assert.ok(Math.abs(o.refProb - o.noVigProb) < 1e-9);
  }
});

test('assessValue: picks the single highest-EV flagged outcome across 1X2 and O/U', () => {
  const sgOdds = {
    oneX2: { home: 1.97, draw: 2.95, away: 3.5 },
    ou: { point: 2.5, over: 2.07, under: 1.65 },
  };
  const consensus = {
    tally: { home: 6, draw: 1, away: 3 },
    totalsTally: { over: 9, under: 1 },
  };
  const v = assessValue(sgOdds, consensus);
  assert.ok(v.best, 'a value bet is found');
  assert.equal(v.best.market, 'O/U 2.5');
  assert.equal(v.best.key, 'over');
  assert.ok(v.best.ev >= v.oneX2.outcomes.reduce((mx, o) => Math.max(mx, o.ev), -Infinity));
});

test('assessValue: labels the O/U market with the actual SG Pools line, not always 2.5', () => {
  const sgOdds = {
    oneX2: { home: 1.97, draw: 2.95, away: 3.5 },
    ou: { point: 1.5, over: 1.5, under: 2.6 },
  };
  const consensus = {
    tally: { home: 1, draw: 1, away: 1 },
    totalsTally: { over: 8, under: 2 },
  };
  const v = assessValue(sgOdds, consensus);
  assert.equal(v.ou.outcomes.find((o) => o.key === 'over').label, 'Over 1.5');
  assert.equal(v.ou.outcomes.find((o) => o.key === 'under').label, 'Under 1.5');
  if (v.best) assert.equal(v.best.market, 'O/U 1.5');
});

test('assessValue: tolerates a missing O/U market', () => {
  const v = assessValue({ oneX2: { home: 2.5, draw: 3.2, away: 2.8 }, ou: null }, {
    tally: { home: 5, draw: 3, away: 2 },
    totalsTally: {},
  });
  assert.equal(v.ou, null);
  assert.ok(v.oneX2);
});

test('assessValue: uses weightedTally for the reference probability but tally for the MIN_VOTES gate', () => {
  const sgOdds = { oneX2: { home: 1.97, draw: 2.95, away: 3.5 } };
  // Only 3 raw votes (below the default MIN_VOTES=4) but a heavily
  // upweighted score above 4 — the gate must key off the raw count, so
  // this market should NOT get a consensus even though the weighted sum
  // clears the threshold.
  const belowGate = assessValue(sgOdds, {
    tally: { home: 2, draw: 1, away: 0 },
    weightedTally: { home: 5, draw: 1, away: 0 },
    totalsTally: {},
  });
  assert.equal(belowGate.oneX2.hasConsensus, false);

  // Same raw vote count (5, clears MIN_VOTES) but weighted scores skew
  // hard toward home — the reference probability should reflect the
  // weighted shape, not a plain 3-2 split.
  const weighted = assessValue(sgOdds, {
    tally: { home: 3, draw: 0, away: 2 },
    weightedTally: { home: 8, draw: 0, away: 0.5 },
    totalsTally: {},
  });
  const unweighted = assessValue(sgOdds, {
    tally: { home: 3, draw: 0, away: 2 },
    totalsTally: {},
  });
  const homeOutWeighted = weighted.oneX2.outcomes.find((o) => o.key === 'home');
  const homeOutUnweighted = unweighted.oneX2.outcomes.find((o) => o.key === 'home');
  assert.ok(
    homeOutWeighted.refProb > homeOutUnweighted.refProb,
    `expected weighted refProb (${homeOutWeighted.refProb}) > unweighted (${homeOutUnweighted.refProb})`
  );
});
