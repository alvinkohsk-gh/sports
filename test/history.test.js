const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeHistory, matchKey } = require('../src/results/history');

function match(overrides = {}) {
  return {
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    kickoffISO: '2026-01-10T15:00:00Z',
    league: 'English Premier',
    odds: { ah: { point: -0.5, home: 1.9, away: 1.95 } },
    tipsterConsensus: {
      picks: [
        { site: 'forebet', pick: 'home', totalsPick: { selection: 'over', point: 2.5, total: 3, homeGoals: 2, awayGoals: 1 } },
      ],
    },
    ...overrides,
  };
}

test('mergeHistory: captures the SG Pools AH line + a derived AH pick alongside the tipster pick', () => {
  const { entries } = mergeHistory({ entries: [] }, [match()], '2026-01-09T00:00:00Z');
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.ahLine, -0.5);
  assert.equal(e.ahPick, 'home'); // predicted margin +1, line -0.5 -> adjusted +0.5 -> home covers
  assert.equal(e.ahOdd, 1.9); // the home-side price, since ahPick is 'home'
});

test('mergeHistory: no SG Pools AH line for the match -> ahLine/ahPick/ahOdd all null', () => {
  const m = match({ odds: {} });
  const { entries } = mergeHistory({ entries: [] }, [m], '2026-01-09T00:00:00Z');
  assert.equal(entries[0].ahLine, null);
  assert.equal(entries[0].ahPick, null);
  assert.equal(entries[0].ahOdd, null);
});

test('mergeHistory: a site with no predicted scoreline (bare totalsPick) never gets an AH pick', () => {
  const m = match({
    tipsterConsensus: { picks: [{ site: 'sportsmole', pick: 'home', totalsPick: { selection: 'over', point: 2.5 } }] },
  });
  const { entries } = mergeHistory({ entries: [] }, [m], '2026-01-09T00:00:00Z');
  assert.equal(entries[0].ahLine, -0.5); // still captured — it's match-level, not site-level
  assert.equal(entries[0].ahPick, null);
  assert.equal(entries[0].ahOdd, null);
});

test('matchKey: still exported and usable', () => {
  assert.equal(typeof matchKey('A', 'B', '2026-01-01T00:00:00Z'), 'string');
});
