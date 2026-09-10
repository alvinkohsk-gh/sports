const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeOddsHistory } = require('../src/results/oddsHistory');

const KICKOFF = '2026-01-10T18:00:00.000Z';

function match(oneX2, ou) {
  return {
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    league: 'EPL',
    kickoffISO: KICKOFF,
    odds: { oneX2, ou },
  };
}

test('mergeOddsHistory: records a first point for a fixture with odds', () => {
  const store = mergeOddsHistory({ entries: [] }, [match({ home: 2.1, draw: 3.3, away: 3.4 }, { point: 2.5, over: 1.9, under: 1.9 })], '2026-01-09T00:00:00Z');
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].points.length, 1);
  assert.equal(store.entries[0].points[0].oneX2.home, 2.1);
});

test('mergeOddsHistory: skips a scrape cycle where nothing moved', () => {
  let store = mergeOddsHistory({ entries: [] }, [match({ home: 2.1, draw: 3.3, away: 3.4 }, null)], '2026-01-09T00:00:00Z');
  store = mergeOddsHistory(store, [match({ home: 2.1, draw: 3.3, away: 3.4 }, null)], '2026-01-09T00:15:00Z');
  assert.equal(store.entries[0].points.length, 1); // unchanged price -> no new point
});

test('mergeOddsHistory: appends a new point when the price moves', () => {
  let store = mergeOddsHistory({ entries: [] }, [match({ home: 2.1, draw: 3.3, away: 3.4 }, null)], '2026-01-09T00:00:00Z');
  store = mergeOddsHistory(store, [match({ home: 1.9, draw: 3.3, away: 3.4 }, null)], '2026-01-09T00:15:00Z');
  assert.equal(store.entries[0].points.length, 2);
  assert.equal(store.entries[0].points[1].oneX2.home, 1.9);
});

test('mergeOddsHistory: a match with no odds at all is skipped', () => {
  const m = { homeTeam: 'Arsenal', awayTeam: 'Chelsea', kickoffISO: KICKOFF, odds: null };
  const store = mergeOddsHistory({ entries: [] }, [m], '2026-01-09T00:00:00Z');
  assert.equal(store.entries.length, 0);
});

test('mergeOddsHistory: caps points per fixture at MAX_POINTS_PER_MATCH, dropping the oldest', () => {
  const { MAX_POINTS_PER_MATCH } = require('../src/results/oddsHistory');
  let store = { entries: [] };
  for (let i = 0; i < MAX_POINTS_PER_MATCH + 10; i += 1) {
    const capturedAtISO = new Date(Date.parse('2026-01-09T00:00:00Z') + i * 15 * 60 * 1000).toISOString();
    store = mergeOddsHistory(store, [match({ home: 2 + i * 0.01, draw: 3.3, away: 3.4 }, null)], capturedAtISO);
  }
  assert.equal(store.entries[0].points.length, MAX_POINTS_PER_MATCH);
  // the oldest points should have been dropped, keeping the most recent
  const lastPoint = store.entries[0].points[store.entries[0].points.length - 1];
  assert.equal(lastPoint.oneX2.home, 2 + (MAX_POINTS_PER_MATCH + 9) * 0.01);
});

test('mergeOddsHistory: prunes fixtures long past kickoff', () => {
  const longAgo = { ...match({ home: 2.1, draw: 3.3, away: 3.4 }, null), kickoffISO: '2026-01-01T00:00:00Z' };
  let store = mergeOddsHistory({ entries: [] }, [longAgo], '2026-01-01T00:00:00Z');
  assert.equal(store.entries.length, 1);
  // a much later merge cycle, well past PRUNE_AFTER_MS, with no matches at all
  store = mergeOddsHistory(store, [], '2026-01-10T00:00:00Z');
  assert.equal(store.entries.length, 0);
});
