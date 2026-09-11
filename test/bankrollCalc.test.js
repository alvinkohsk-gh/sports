const test = require('node:test');
const assert = require('node:assert/strict');
const {
  profitFor,
  isDecided,
  summarize,
  bankrollCurve,
  maxDrawdown,
  suggestedStake,
} = require('../public/bankroll-calc');

test('profitFor: won pays out stake*(odd-1), lost loses the stake, pending/void are neutral', () => {
  assert.equal(profitFor({ result: 'won', stake: 10, odd: 2.5 }), 15);
  assert.equal(profitFor({ result: 'lost', stake: 10, odd: 2.5 }), -10);
  assert.equal(profitFor({ result: 'pending', stake: 10, odd: 2.5 }), 0);
  assert.equal(profitFor({ result: 'void', stake: 10, odd: 2.5 }), 0);
});

test('isDecided: only won/lost count as decided', () => {
  assert.equal(isDecided({ result: 'won' }), true);
  assert.equal(isDecided({ result: 'lost' }), true);
  assert.equal(isDecided({ result: 'pending' }), false);
  assert.equal(isDecided({ result: 'void' }), false);
});

test('summarize: bankroll, ROI and win rate only reflect decided bets', () => {
  const bets = [
    { result: 'won', stake: 10, odd: 2.0 }, // +10
    { result: 'lost', stake: 10, odd: 3.0 }, // -10
    { result: 'won', stake: 20, odd: 1.5 }, // +10
    { result: 'pending', stake: 50, odd: 4.0 },
    { result: 'void', stake: 15, odd: 2.2 },
  ];
  const s = summarize(1000, bets);
  assert.equal(s.settledCount, 3);
  assert.equal(s.wonCount, 2);
  assert.equal(s.totalStaked, 40);
  assert.equal(s.netProfit, 10);
  assert.equal(s.currentBankroll, 1010);
  assert.ok(Math.abs(s.roi - 0.25) < 1e-9);
  assert.ok(Math.abs(s.winRate - 2 / 3) < 1e-9);
  assert.equal(s.pendingCount, 1);
  assert.equal(s.pendingStaked, 50);
});

test('summarize: no decided bets yields null roi/winRate, bankroll unchanged', () => {
  const s = summarize(500, [{ result: 'pending', stake: 10, odd: 2 }]);
  assert.equal(s.currentBankroll, 500);
  assert.equal(s.roi, null);
  assert.equal(s.winRate, null);
});

test('bankrollCurve: starts at the starting bankroll, runs in chronological order, ignores pending/void', () => {
  const bets = [
    { id: 'b', date: '2026-01-02', result: 'won', stake: 10, odd: 2.0 },
    { id: 'a', date: '2026-01-01', result: 'lost', stake: 10, odd: 3.0 },
    { id: 'c', date: '2026-01-03', result: 'pending', stake: 100, odd: 5.0 },
  ];
  const curve = bankrollCurve(1000, bets);
  assert.deepEqual(
    curve.map((p) => p.bankroll),
    [1000, 990, 1000]
  );
  assert.equal(curve[0].date, null);
  assert.equal(curve[1].date, '2026-01-01');
  assert.equal(curve[2].date, '2026-01-02');
});

test('maxDrawdown: largest peak-to-trough drop as a fraction of the peak', () => {
  const points = [{ bankroll: 1000 }, { bankroll: 1200 }, { bankroll: 900 }, { bankroll: 1100 }];
  // peak 1200 -> trough 900 = 25% drawdown
  assert.ok(Math.abs(maxDrawdown(points) - 0.25) < 1e-9);
});

test('maxDrawdown: a bankroll that only ever rises has zero drawdown', () => {
  assert.equal(maxDrawdown([{ bankroll: 100 }, { bankroll: 150 }, { bankroll: 200 }]), 0);
});

test('suggestedStake: bankroll times the fractional-Kelly value, never above bankroll, null when inputs are missing', () => {
  assert.equal(suggestedStake(1000, 0.02), 20);
  assert.equal(suggestedStake(1000, 2), 1000); // clamped
  assert.equal(suggestedStake(0, 0.02), null);
  assert.equal(suggestedStake(1000, null), null);
  assert.equal(suggestedStake(1000, 0), null);
});
