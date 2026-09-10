const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeValuePicks } = require('../src/results/valuePicks');

const KICKOFF = '2026-01-10T18:00:00.000Z';

function matchWithValue(odd, ev = 0.1) {
  return {
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    league: 'EPL',
    kickoffISO: KICKOFF,
    odds: { oneX2: { home: odd, draw: 3.3, away: 3.4 } },
    value: {
      oneX2: {
        outcomes: [
          { key: 'home', label: 'Arsenal', odd, value: true, ev, refProb: 0.5, impliedProb: 1 / odd, quarterKelly: 0.05 },
        ],
      },
    },
  };
}

test('mergeValuePicks: captures openOdd on first sight and freezes it as the odd moves', () => {
  let log = { picks: [] };
  log = mergeValuePicks(log, [matchWithValue(2.1)], '2026-01-09T00:00:00Z'); // first seen at 2.10
  let pick = log.picks[0];
  assert.equal(pick.openOdd, 2.1);
  assert.equal(pick.odd, 2.1);
  assert.equal(pick.clvPct, 0);

  log = mergeValuePicks(log, [matchWithValue(1.9)], '2026-01-09T12:00:00Z'); // line shortened pre-kickoff
  pick = log.picks[0];
  assert.equal(pick.openOdd, 2.1); // unchanged
  assert.equal(pick.odd, 1.9); // tracks the latest pre-kickoff price
  // openOdd 2.1 vs closing-so-far 1.9: (2.1/1.9 - 1) * 100 ≈ +10.53% — you'd have beaten this price
  assert.equal(pick.clvPct, Number(((2.1 / 1.9 - 1) * 100).toFixed(2)));
});

test('mergeValuePicks: odd (and clvPct) freeze once kickoff passes, even if the match is scraped again', () => {
  let log = { picks: [] };
  log = mergeValuePicks(log, [matchWithValue(2.1)], '2026-01-09T00:00:00Z');
  log = mergeValuePicks(log, [matchWithValue(1.8)], '2026-01-10T17:59:00Z'); // last pre-kickoff price
  const closingOdd = log.picks[0].odd;
  assert.equal(closingOdd, 1.8);

  // A later cycle, now past kickoff, with a different price on the match
  // object (e.g. a stale/live-market price) must not move the locked pick.
  log = mergeValuePicks(log, [matchWithValue(2.5)], '2026-01-10T19:00:00Z');
  const pick = log.picks[0];
  assert.equal(pick.odd, 1.8); // still the pre-kickoff closing price
  assert.equal(pick.openOdd, 2.1);
  assert.equal(pick.clvPct, Number(((2.1 / 1.8 - 1) * 100).toFixed(2)));
});

test('mergeValuePicks: a positive clvPct means the entry price was better (higher) than the closing price', () => {
  let log = { picks: [] };
  log = mergeValuePicks(log, [matchWithValue(3.0)], '2026-01-09T00:00:00Z'); // bet at 3.00
  log = mergeValuePicks(log, [matchWithValue(2.5)], '2026-01-10T17:59:00Z'); // closed at 2.50 (shortened — you beat it)
  assert.ok(log.picks[0].clvPct > 0);

  let log2 = { picks: [] };
  log2 = mergeValuePicks(log2, [matchWithValue(2.0)], '2026-01-09T00:00:00Z'); // bet at 2.00
  log2 = mergeValuePicks(log2, [matchWithValue(2.5)], '2026-01-10T17:59:00Z'); // closed at 2.50 (drifted out — you lost value)
  assert.ok(log2.picks[0].clvPct < 0);
});
