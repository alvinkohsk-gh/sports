const test = require('node:test');
const assert = require('node:assert/strict');
const { grade } = require('../src/results/accuracy');

const KICKOFF = '2026-01-10T18:00:00.000Z';
const NOW = Date.parse('2026-01-11T00:00:00Z'); // 6h after kickoff — within the grading window

function historyWith(entry) {
  return {
    entries: [
      {
        matchKey: 'arsenal|chelsea|2026-01-10',
        site: 'forebet',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        kickoffISO: KICKOFF,
        league: 'EPL',
        pick: 'home',
        totalsPick: { selection: 'over', point: 2.5 },
        capturedAt: Date.parse(KICKOFF) - 60 * 60 * 1000, // captured 1h before kickoff
        ...entry,
      },
    ],
  };
}

const RESULT = [{ homeTeam: 'Arsenal', awayTeam: 'Chelsea', dayISO: '2026-01-10', homeGoals: 2, awayGoals: 1 }];

function oddsHistoryWith(points) {
  return { entries: [{ matchKey: 'arsenal|chelsea|2026-01-10', points }] };
}

test('grade: attaches the SG Pools price on the pick as it stood at capture time', () => {
  const capturedAt = Date.parse(KICKOFF) - 60 * 60 * 1000;
  const oddsHistory = oddsHistoryWith([
    { capturedAtISO: new Date(capturedAt - 30 * 60 * 1000).toISOString(), oneX2: { home: 2.2, draw: 3.3, away: 3.0 }, ou: { point: 2.5, over: 1.9, under: 1.9 } },
    { capturedAtISO: new Date(capturedAt + 30 * 60 * 1000).toISOString(), oneX2: { home: 1.9, draw: 3.3, away: 3.5 }, ou: { point: 2.5, over: 1.8, under: 2.0 } },
  ]);
  const result = grade(historyWith({}), RESULT, [], { nowMs: NOW, oddsHistory });
  const sample = result.samples[0];
  // the point at capturedAt-30min is the latest one at-or-before capturedAt
  assert.equal(sample.oneX2Odd, 2.2);
  assert.equal(sample.ouOdd, 1.9);
});

test('grade: never looks at an odds-history point captured after the pick (no future leakage)', () => {
  const capturedAt = Date.parse(KICKOFF) - 60 * 60 * 1000;
  const oddsHistory = oddsHistoryWith([
    { capturedAtISO: new Date(capturedAt + 10 * 60 * 1000).toISOString(), oneX2: { home: 1.5, draw: 4, away: 5 }, ou: { point: 2.5, over: 1.5, under: 2.5 } },
  ]);
  const result = grade(historyWith({}), RESULT, [], { nowMs: NOW, oddsHistory });
  const sample = result.samples[0];
  assert.equal(sample.oneX2Odd, null);
  assert.equal(sample.ouOdd, null);
});

test('grade: ouOdd is null when the recorded O/U point differs from the pick\'s own point', () => {
  const capturedAt = Date.parse(KICKOFF) - 60 * 60 * 1000;
  const oddsHistory = oddsHistoryWith([
    { capturedAtISO: new Date(capturedAt - 5 * 60 * 1000).toISOString(), oneX2: { home: 2.0, draw: 3.3, away: 3.4 }, ou: { point: 1.5, over: 1.4, under: 2.8 } },
  ]);
  const result = grade(historyWith({}), RESULT, [], { nowMs: NOW, oddsHistory });
  const sample = result.samples[0];
  assert.equal(sample.oneX2Odd, 2.0); // 1X2 unaffected by the O/U point mismatch
  assert.equal(sample.ouOdd, null);
});

test('grade: no odds-history entry for the fixture at all leaves both odds null, not an error', () => {
  const result = grade(historyWith({}), RESULT, [], { nowMs: NOW, oddsHistory: { entries: [] } });
  const sample = result.samples[0];
  assert.equal(sample.oneX2Odd, null);
  assert.equal(sample.ouOdd, null);
});

test('grade: omitting oddsHistory entirely (older call sites) still grades correctly, odds fields null', () => {
  const result = grade(historyWith({}), RESULT, [], { nowMs: NOW });
  const sample = result.samples[0];
  assert.equal(sample.oneX2Correct, true); // Arsenal (home) won 2-1
  assert.equal(sample.oneX2Odd, null);
  assert.equal(sample.ouOdd, null);
});
