const test = require('node:test');
const assert = require('node:assert/strict');
const { oddsBand, segmentBy, clvStats } = require('../src/results/pickBreakdown');

test('oddsBand: buckets an odd into the right band', () => {
  assert.equal(oddsBand(1.3), '< 1.50');
  assert.equal(oddsBand(1.49), '< 1.50');
  assert.equal(oddsBand(1.5), '1.50–1.99');
  assert.equal(oddsBand(1.99), '1.50–1.99');
  assert.equal(oddsBand(2), '2.00–2.99');
  assert.equal(oddsBand(2.99), '2.00–2.99');
  assert.equal(oddsBand(3), '3.00+');
  assert.equal(oddsBand(10), '3.00+');
});

test('segmentBy: groups picks with a flat-1u win rate / P&L / ROI per bucket', () => {
  const settled = [
    { market: '1X2', won: true, profitUnits: 1.5 },
    { market: '1X2', won: false, profitUnits: -1 },
    { market: 'O/U 2.5', won: true, profitUnits: 0.9 },
  ];
  const byMarket = segmentBy(settled, (p) => p.market);
  assert.deepEqual(byMarket['1X2'], { n: 2, won: 1, profitUnits: 0.5, winRate: 0.5, roi: 0.25 });
  assert.deepEqual(byMarket['O/U 2.5'], { n: 1, won: 1, profitUnits: 0.9, winRate: 1, roi: 0.9 });
});

test('segmentBy: falls back to "Unknown" for a missing key', () => {
  const settled = [{ league: null, won: true, profitUnits: 1 }];
  const byLeague = segmentBy(settled, (p) => p.league);
  assert.ok(byLeague.Unknown);
  assert.equal(byLeague.Unknown.n, 1);
});

test('clvStats: only counts picks whose kickoff has passed', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const picks = [
    { clvPct: 5, kickoffISO: '2026-01-10T10:00:00Z' }, // past kickoff — counted
    { clvPct: -3, kickoffISO: '2026-01-10T14:00:00Z' }, // future kickoff — excluded
    { clvPct: 2, kickoffISO: '2026-01-10T09:00:00Z' }, // past kickoff — counted
  ];
  const s = clvStats(picks, now);
  assert.equal(s.n, 2);
  assert.equal(s.avgClvPct, 3.5); // (5 + 2) / 2
  assert.equal(s.beatCloseRate, 1); // both positive
});

test('clvStats: beatCloseRate reflects a mix of positive/negative CLV', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const picks = [
    { clvPct: 5, kickoffISO: '2026-01-10T10:00:00Z' },
    { clvPct: -5, kickoffISO: '2026-01-10T10:00:00Z' },
    { clvPct: -1, kickoffISO: '2026-01-10T10:00:00Z' },
  ];
  const s = clvStats(picks, now);
  assert.equal(s.n, 3);
  assert.equal(s.beatCloseRate, Number((1 / 3).toFixed(4)));
});

test('clvStats: no locked picks returns nulls, not NaN', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const picks = [{ clvPct: 5, kickoffISO: '2026-01-10T14:00:00Z' }]; // still upcoming
  const s = clvStats(picks, now);
  assert.deepEqual(s, { n: 0, avgClvPct: null, beatCloseRate: null });
});

test('clvStats: ignores picks with no clvPct (e.g. odd/openOdd never captured)', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const picks = [{ clvPct: null, kickoffISO: '2026-01-10T10:00:00Z' }];
  const s = clvStats(picks, now);
  assert.equal(s.n, 0);
});
