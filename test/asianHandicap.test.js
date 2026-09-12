const test = require('node:test');
const assert = require('node:assert/strict');
const { settleLine, settleAh, ahProfit, resolveAhPick } = require('../src/services/asianHandicap');

// ---- whole lines (can push) ----
test('settleLine: whole line, side wins by more than the line -> win', () => {
  assert.equal(settleLine(-1, 2), 1); // -1 handicap, won by 2: adjusted = 1
});
test('settleLine: whole line, side wins by exactly the line -> push', () => {
  assert.equal(settleLine(-1, 1), 0); // -1 handicap, won by exactly 1: adjusted = 0
});
test('settleLine: whole line, side wins by less than the line -> loss', () => {
  assert.equal(settleLine(-2, 1), -1); // -2 handicap, won by 1: adjusted = -1
});
test('settleLine: whole line, draw -> loss for the favorite, win for the underdog', () => {
  assert.equal(settleLine(-1, 0), -1); // favorite -1, draw: adjusted = -1
  assert.equal(settleLine(1, 0), 1); // underdog +1, draw: adjusted = 1
});

// ---- half lines (never push) ----
test('settleLine: half line never pushes, resolves win/loss off actual margin', () => {
  assert.equal(settleLine(-0.5, 1), 1); // won by 1, covers -0.5
  assert.equal(settleLine(-0.5, 0), -1); // draw, -0.5 loses
  assert.equal(settleLine(0.5, 0), 1); // draw, +0.5 wins
});

// ---- quarter lines: split into two adjacent half/whole lines, averaged ----
test('settleLine: -0.75 with a 1-goal win is a half-win (matches real AH settlement tables)', () => {
  // splits into -0.5 (wins: +1) and -1.0 (pushes: 0) -> average 0.5
  assert.equal(settleLine(-0.75, 1), 0.5);
});
test('settleLine: -0.75 with a 2-goal win is a full win', () => {
  // -0.5 (wins) and -1.0 (wins by exactly 1 relative -> adjusted 2-1=1>0 win) -> average 1
  assert.equal(settleLine(-0.75, 2), 1);
});
test('settleLine: -0.75 on a draw is a full loss', () => {
  assert.equal(settleLine(-0.75, 0), -1);
});
test('settleLine: -0.75 losing by 1 is a full loss', () => {
  assert.equal(settleLine(-0.75, -1), -1);
});
test('settleLine: -0.25 with a draw is a half-loss (matches real AH settlement tables)', () => {
  // splits into 0 (pushes: 0) and -0.5 (loses: -1) -> average -0.5
  assert.equal(settleLine(-0.25, 0), -0.5);
});
test('settleLine: +0.25 with a draw is a half-win', () => {
  // splits into 0 (pushes: 0) and +0.5 (wins: +1) -> average 0.5
  assert.equal(settleLine(0.25, 0), 0.5);
});

test('settleLine: incomplete input returns null', () => {
  assert.equal(settleLine(null, 1), null);
  assert.equal(settleLine(-1, null), null);
});

// ---- settleAh: wires the pick side + home-perspective line together ----
test('settleAh: home favorite -0.75, home wins 2-1 (margin +1) -> half-win', () => {
  assert.deepEqual(settleAh('home', -0.75, 2, 1), { result: 'half-win', value: 0.5 });
});
test('settleAh: away side of the same match settles as the exact complement of the home side', () => {
  // away is +0.75, lost by 1 (margin -1 for away) -> splits +0.5 (loses: -1) and +1.0 (pushes: 0) -> -0.5.
  // Home's own -0.75 in this same match was a half-win (+0.5, see above) — the two must always sum to
  // zero in a symmetric split market, so away's half-loss (-0.5) is the correct complement, not a plain loss.
  assert.deepEqual(settleAh('away', -0.75, 2, 1), { result: 'half-loss', value: -0.5 });
});
test('settleAh: unknown pick or missing score returns null', () => {
  assert.equal(settleAh('draw', -0.75, 2, 1), null);
  assert.equal(settleAh('home', -0.75, null, 1), null);
});

// ---- ahProfit: flat 1-unit P/L at decimal odds ----
test('ahProfit: full win pays the full (odd - 1); push is 0; full loss is -1', () => {
  assert.equal(ahProfit(1, 1.9), 1.9 - 1);
  assert.equal(ahProfit(0, 1.9), 0);
  assert.equal(ahProfit(-1, 1.9), -1);
});
test('ahProfit: half-win/half-loss scale the payout/stake by half', () => {
  assert.equal(ahProfit(0.5, 2.0), 0.5);
  assert.equal(ahProfit(-0.5, 2.0), -0.5);
});

// ---- resolveAhPick: derive an implied pick from a predicted scoreline ----
test('resolveAhPick: predicted scoreline covering the home line -> home', () => {
  const totalsPick = { selection: 'over', point: 2.5, total: 3, homeGoals: 2, awayGoals: 1 };
  assert.equal(resolveAhPick(totalsPick, -0.5), 'home'); // predicted margin +1, -0.5 line -> adjusted +0.5
});
test('resolveAhPick: predicted scoreline covering the away line -> away', () => {
  const totalsPick = { selection: 'under', point: 2.5, total: 1, homeGoals: 0, awayGoals: 1 };
  assert.equal(resolveAhPick(totalsPick, -0.5), 'away'); // predicted margin -1, -0.5 line -> adjusted -1.5
});
test('resolveAhPick: predicted exact push -> null (no real opinion either way)', () => {
  const totalsPick = { selection: 'over', point: 2.5, total: 2, homeGoals: 1, awayGoals: 1 };
  assert.equal(resolveAhPick(totalsPick, 0), null); // predicted draw, pick'em line -> adjusted exactly 0
});
test('resolveAhPick: no scoreline (only selection/point) -> null', () => {
  assert.equal(resolveAhPick({ selection: 'over', point: 2.5 }, -0.5), null);
});
test('resolveAhPick: no known line -> null', () => {
  assert.equal(resolveAhPick({ selection: 'over', point: 2.5, total: 3, homeGoals: 2, awayGoals: 1 }, null), null);
});
