// Pure money-math for the bankroll tracker (bankroll.html). No DOM/browser
// dependency so it can be unit-tested directly with node:test; bankroll.html
// loads it as a plain <script> (UMD-ish export at the bottom picks whichever
// environment it's running in).
//
// A bet: { id, date (YYYY-MM-DD), fixture, market, pick, odd, stake, result }
// result is 'pending' | 'won' | 'lost' | 'void'. Decimal odds throughout,
// consistent with the rest of the site (see public/app.js).

function profitFor(bet) {
  if (bet.result === 'won') return bet.stake * (bet.odd - 1);
  if (bet.result === 'lost') return -bet.stake;
  return 0; // pending or void: no effect on bankroll (void returns the stake)
}

// Only won/lost bets count toward staked totals, win rate and ROI — a void
// bet returns its stake (net zero) and a pending bet hasn't settled yet, so
// neither belongs in a record of realized results.
function isDecided(bet) {
  return bet.result === 'won' || bet.result === 'lost';
}

function summarize(startingBankroll, bets) {
  const decided = bets.filter(isDecided);
  const pending = bets.filter((b) => b.result === 'pending');
  const totalStaked = decided.reduce((s, b) => s + b.stake, 0);
  const netProfit = decided.reduce((s, b) => s + profitFor(b), 0);
  const won = decided.filter((b) => b.result === 'won').length;
  return {
    currentBankroll: startingBankroll + netProfit,
    netProfit,
    totalStaked,
    roi: totalStaked ? netProfit / totalStaked : null,
    settledCount: decided.length,
    wonCount: won,
    winRate: decided.length ? won / decided.length : null,
    pendingCount: pending.length,
    pendingStaked: pending.reduce((s, b) => s + b.stake, 0),
  };
}

// Running bankroll after each decided bet, in chronological (settle) order —
// the curve bankroll.html plots. Starts with a single point at the starting
// bankroll so an empty or all-pending log still renders a flat line.
function bankrollCurve(startingBankroll, bets) {
  const decided = bets
    .filter(isDecided)
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || (a.id > b.id ? 1 : -1));
  let running = startingBankroll;
  const points = [{ date: null, bankroll: running }];
  for (const b of decided) {
    running += profitFor(b);
    points.push({ date: b.date, bankroll: running });
  }
  return points;
}

// Largest peak-to-trough drop in the bankroll curve, as a fraction of the
// peak (0 = never dropped below its own high-water mark).
function maxDrawdown(points) {
  let peak = -Infinity;
  let worst = 0;
  for (const p of points) {
    if (p.bankroll > peak) peak = p.bankroll;
    if (peak > 0) worst = Math.max(worst, (peak - p.bankroll) / peak);
  }
  return worst;
}

// Kelly-suggested stake in bankroll units, given the fractional-Kelly value
// the board already computes per pick (m.value.*.outcomes[].quarterKelly —
// a fraction of bankroll, e.g. 0.02 = 2%). Never negative, never more than
// the whole bankroll.
function suggestedStake(bankroll, quarterKelly) {
  if (!(bankroll > 0) || typeof quarterKelly !== 'number' || !(quarterKelly > 0)) return null;
  return Math.min(bankroll, bankroll * quarterKelly);
}

const api = { profitFor, isDecided, summarize, bankrollCurve, maxDrawdown, suggestedStake };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  (typeof window !== 'undefined' ? window : globalThis).BankrollCalc = api;
}
