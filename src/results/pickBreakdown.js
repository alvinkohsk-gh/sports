// Shared "how did these picks do" breakdowns for the Value Picks / Statarea
// Picks pages: segmented backtesting (by market, league, odds band) plus
// closing-line-value stats. Used by src/routes/value.js; public/value-
// picks.html duplicates the same logic in browser JS since it re-aggregates
// locally whenever the date-range picker changes — same duplication the
// page's own summarize() already has with this one.

const ODDS_BANDS = [
  { label: '< 1.50', max: 1.5 },
  { label: '1.50–1.99', max: 2 },
  { label: '2.00–2.99', max: 3 },
  { label: '3.00+', max: Infinity },
];

function oddsBand(odd) {
  const b = ODDS_BANDS.find((b) => odd < b.max);
  return b ? b.label : ODDS_BANDS[ODDS_BANDS.length - 1].label;
}

// Groups settled picks by whatever keyFn returns, with the same flat-1u
// win rate / P&L / ROI shape as the top-level summary.
function segmentBy(settled, keyFn) {
  const out = {};
  for (const p of settled) {
    const k = keyFn(p) || 'Unknown';
    const b = (out[k] = out[k] || { n: 0, won: 0, profitUnits: 0 });
    b.n += 1;
    if (p.won) b.won += 1;
    b.profitUnits = Number((b.profitUnits + p.profitUnits).toFixed(2));
  }
  for (const b of Object.values(out)) {
    b.winRate = b.n ? Number((b.won / b.n).toFixed(4)) : null;
    b.roi = b.n ? Number((b.profitUnits / b.n).toFixed(4)) : null;
  }
  return out;
}

// Closing-line value only needs the line to have closed (kickoff passed),
// not a graded result — so this runs over every pick past kickoff, open or
// settled alike, not just settled ones.
function clvStats(picks, nowMs = Date.now()) {
  const locked = (picks || []).filter(
    (p) => Number.isFinite(p.clvPct) && (Date.parse(p.kickoffISO) || Infinity) < nowMs
  );
  if (!locked.length) return { n: 0, avgClvPct: null, beatCloseRate: null };
  const avg = locked.reduce((s, p) => s + p.clvPct, 0) / locked.length;
  const beat = locked.filter((p) => p.clvPct > 0).length;
  return {
    n: locked.length,
    avgClvPct: Number(avg.toFixed(2)),
    beatCloseRate: Number((beat / locked.length).toFixed(4)),
  };
}

module.exports = { oddsBand, segmentBy, clvStats, ODDS_BANDS };
