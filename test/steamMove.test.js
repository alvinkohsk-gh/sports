const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSteamMove, THRESHOLD_PCT, WINDOW_MIN } = require('../src/services/steamMove');

function point(minutesAgoFromEpoch, oneX2, ou) {
  return { capturedAtISO: new Date(minutesAgoFromEpoch * 60000).toISOString(), oneX2, ou };
}

test('detectSteamMove: null with fewer than two points', () => {
  assert.equal(detectSteamMove([]), null);
  assert.equal(detectSteamMove([point(0, { home: 2, draw: 3, away: 4 }, null)]), null);
});

test('detectSteamMove: flags a big, fast shortening move on 1X2 home', () => {
  const points = [
    point(0, { home: 2.2, draw: 3.2, away: 3.4 }, null),
    point(10, { home: 1.9, draw: 3.2, away: 3.4 }, null), // home 2.2 -> 1.9, -13.6%, 10 min
  ];
  const move = detectSteamMove(points);
  assert.ok(move);
  assert.equal(move.market, '1X2');
  assert.equal(move.outcome, 'home');
  assert.equal(move.direction, 'shortening');
  assert.equal(move.minutesApart, 10);
  assert.ok(move.pctChange < 0);
});

test('detectSteamMove: a drifting (odds lengthening) move is flagged as drifting', () => {
  const points = [
    point(0, { home: 2.0, draw: 3.2, away: 3.4 }, null),
    point(5, { home: 2.3, draw: 3.2, away: 3.4 }, null), // +15%
  ];
  const move = detectSteamMove(points);
  assert.equal(move.direction, 'drifting');
  assert.ok(move.pctChange > 0);
});

test('detectSteamMove: below the percentage threshold is not a steam move', () => {
  const points = [
    point(0, { home: 2.0, draw: 3.2, away: 3.4 }, null),
    point(5, { home: 2.05, draw: 3.2, away: 3.4 }, null), // +2.5%, under 8%
  ];
  assert.equal(detectSteamMove(points), null);
});

test('detectSteamMove: a big move that took too long is not steam (just drift)', () => {
  const points = [
    point(0, { home: 2.2, draw: 3.2, away: 3.4 }, null),
    point(WINDOW_MIN + 30, { home: 1.9, draw: 3.2, away: 3.4 }, null), // same -13.6%, but slow
  ];
  assert.equal(detectSteamMove(points), null);
});

test('detectSteamMove: picks the largest-magnitude qualifying move across outcomes', () => {
  const points = [
    point(0, { home: 2.0, draw: 3.0, away: 4.0 }, null),
    point(5, { home: 1.85, draw: 3.0, away: 4.8 }, null), // home -7.5% (below threshold), away +20%
  ];
  const move = detectSteamMove(points);
  assert.equal(move.outcome, 'away');
  assert.equal(move.direction, 'drifting');
});

test('detectSteamMove: compares O/U prices only when the line point is unchanged', () => {
  const withPointChange = [
    point(0, null, { point: 2.5, over: 1.9, under: 1.9 }),
    point(5, null, { point: 1.5, over: 1.5, under: 2.4 }), // point itself moved — not comparable
  ];
  assert.equal(detectSteamMove(withPointChange), null);

  const samePoint = [
    point(0, null, { point: 2.5, over: 2.0, under: 1.8 }),
    point(5, null, { point: 2.5, over: 1.75, under: 1.8 }), // over -12.5%, under unchanged
  ];
  const move = detectSteamMove(samePoint);
  assert.ok(move);
  assert.equal(move.market, 'O/U 2.5');
  assert.equal(move.outcome, 'over');
  assert.equal(move.direction, 'shortening');
});

test('detectSteamMove: respects custom thresholdPct/windowMin options', () => {
  const points = [
    point(0, { home: 2.0, draw: 3.2, away: 3.4 }, null),
    point(5, { home: 1.94, draw: 3.2, away: 3.4 }, null), // -3%
  ];
  assert.equal(detectSteamMove(points), null); // below default 8%
  const move = detectSteamMove(points, { thresholdPct: 0.02 });
  assert.ok(move);
  assert.equal(THRESHOLD_PCT, 0.08); // default unchanged by passing an override
});
