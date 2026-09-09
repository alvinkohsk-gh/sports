const test = require('node:test');
const assert = require('node:assert/strict');
const { carryForwardInPlayPicks } = require('../src/services/inPlayCarryForward');
const { matchKey } = require('../src/results/history');

const KO = '2026-09-09T00:30:00.000Z';
const MATCH = { homeTeam: 'Boca Juniors', awayTeam: 'Sao Paulo', kickoffISO: KO };

function histEntry(site, over, { kickoffISO = KO } = {}) {
  return {
    matchKey: matchKey(MATCH.homeTeam, MATCH.awayTeam, kickoffISO),
    site,
    homeTeam: MATCH.homeTeam,
    awayTeam: MATCH.awayTeam,
    kickoffISO,
    pick: 'home',
    totalsPick: over ? { selection: 'over', point: 2.5 } : null,
  };
}

function liveTip(site) {
  return { site, homeTeam: MATCH.homeTeam, awayTeam: MATCH.awayTeam, pick: 'home', totalsPick: null };
}

test('carryForward: re-adds a site that dropped the fixture after kick-off', () => {
  const live = [liveTip('forebet'), liveTip('predictz')];
  const history = { entries: [histEntry('statarea', true), histEntry('forebet', false)] };

  const merged = carryForwardInPlayPicks([MATCH], live, history);
  const sites = merged.map((t) => t.site).sort();
  assert.deepEqual(sites, ['forebet', 'predictz', 'statarea']);

  const sta = merged.find((t) => t.site === 'statarea');
  assert.equal(sta.carriedForward, true);
  assert.equal(sta.pick, 'home');
  assert.deepEqual(sta.totalsPick, { selection: 'over', point: 2.5 });
});

test('carryForward: never duplicates a site already in the live scrape', () => {
  const live = [liveTip('forebet')];
  const history = { entries: [histEntry('forebet', true)] };
  const merged = carryForwardInPlayPicks([MATCH], live, history);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].carriedForward, undefined);
});

test('carryForward: ignores a same-teams entry from the other leg (outside the time window)', () => {
  const otherLeg = '2026-09-16T00:30:00.000Z';
  const live = [liveTip('forebet')];
  const history = { entries: [histEntry('statarea', true, { kickoffISO: otherLeg })] };
  const merged = carryForwardInPlayPicks([MATCH], live, history);
  assert.deepEqual(merged.map((t) => t.site), ['forebet']);
});

test('carryForward: no history is a no-op (returns the same array)', () => {
  const live = [liveTip('forebet')];
  assert.equal(carryForwardInPlayPicks([MATCH], live, { entries: [] }), live);
  assert.equal(carryForwardInPlayPicks([MATCH], live, null), live);
});

test('carryForward: skips history entries with neither a pick nor a totals pick', () => {
  const live = [liveTip('forebet')];
  const empty = { ...histEntry('statarea', false), pick: null, totalsPick: null };
  const merged = carryForwardInPlayPicks([MATCH], live, { entries: [empty] });
  assert.deepEqual(merged.map((t) => t.site), ['forebet']);
});
