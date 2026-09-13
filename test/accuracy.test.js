const test = require('node:test');
const assert = require('node:assert/strict');
const { grade, summarize } = require('../src/results/accuracy');

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

// ---- Asian Handicap ----
// Arsenal (home) won 2-1 (margin +1). ahLine/ahPick/ahOdd are set at
// history-merge time (src/results/history.js), not derived here — grade()
// just settles them against the real score (src/services/asianHandicap.js).
test('grade: settles a derived AH pick against the real score (half-win case)', () => {
  const result = grade(historyWith({ ahLine: -0.75, ahPick: 'home', ahOdd: 1.87 }), RESULT, [], { nowMs: NOW });
  const sample = result.samples[0];
  assert.equal(sample.ah, 'home -0.75');
  assert.equal(sample.ahResult, 'half-win'); // -0.75, won by 1 -> half-win
  assert.equal(sample.ahValue, 0.5);
  assert.equal(sample.ahOdd, 1.87);
});

test('grade: an away AH pick displays and settles off the negated (away-side) line', () => {
  const result = grade(historyWith({ ahLine: -0.75, ahPick: 'away', ahOdd: 1.9 }), RESULT, [], { nowMs: NOW });
  const sample = result.samples[0];
  assert.equal(sample.ah, 'away 0.75'); // away's own line is +0.75
  assert.equal(sample.ahResult, 'half-loss'); // complement of home's half-win
  assert.equal(sample.ahValue, -0.5);
});

test('grade: no AH pick for this entry -> ah fields stay null, doesn\'t block 1X2/O/U grading', () => {
  const result = grade(historyWith({ ahLine: null, ahPick: null, ahOdd: null }), RESULT, [], { nowMs: NOW });
  const sample = result.samples[0];
  assert.equal(sample.ah, null);
  assert.equal(sample.ahResult, null);
  assert.equal(sample.ahValue, null);
  assert.equal(sample.oneX2Correct, true); // still graded normally
});

test('grade: an entry with only an AH pick (no 1X2/O/U pick) still gets graded, not skipped', () => {
  const result = grade(
    historyWith({ pick: null, totalsPick: null, ahLine: -0.5, ahPick: 'home', ahOdd: 1.9 }),
    RESULT,
    [],
    { nowMs: NOW }
  );
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].ahResult, 'win'); // -0.5, won by 1 -> clean win
  assert.equal(result.samples[0].oneX2Correct, null);
  assert.equal(result.samples[0].ouCorrect, null);
});

test('summarize: AH win rate excludes pushes and treats half-win/half-loss as partial equity', () => {
  const samples = [
    { site: 'forebet', kickoffISO: KICKOFF, ahResult: 'win', ahValue: 1 },
    { site: 'forebet', kickoffISO: KICKOFF, ahResult: 'half-win', ahValue: 0.5 },
    { site: 'forebet', kickoffISO: KICKOFF, ahResult: 'push', ahValue: 0 },
    { site: 'forebet', kickoffISO: KICKOFF, ahResult: 'half-loss', ahValue: -0.5 },
    { site: 'forebet', kickoffISO: KICKOFF, ahResult: 'loss', ahValue: -1 },
  ];
  const s = summarize(samples, 24 * 365, Date.parse(KICKOFF) + 60 * 60 * 1000);
  const b = s.perSite.forebet;
  assert.equal(b.ahTotal, 5);
  assert.equal(b.ahPush, 1);
  assert.equal(b.ahDecided, 4); // push excluded
  // equity: win=1, half-win=0.75, half-loss=0.25, loss=0 -> avg = 0.5 -> 50%
  assert.equal(b.ahPct, 50);
});
