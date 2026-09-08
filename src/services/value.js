// Value / EV assessment for a Singapore Pools price.
//
// Professional value betting compares the price on offer against an
// independent probability estimate. This app's independent estimate is
// the 10-source tipster consensus (see AskUserQuestion history) — softer
// than a true sharp line, so treat the output as "where the crowd
// disagrees with the SG Pools price", not a guaranteed edge.
//
// Pipeline per market:
//   1. implied prob  = 1 / decimal_odd
//   2. overround     = Σ implied − 1            (the bookmaker margin)
//   3. no-vig prob   = implied / (1 + overround) (SG Pools' own fair line)
//   4. consensus prob = smoothed tipster vote share
//   5. reference     = (1−w)·no-vig + w·consensus
//   6. EV/unit       = reference · odd − 1
//      Kelly frac    = (reference·odd − 1) / (odd − 1)
// A market is only assessed when at least MIN_VOTES tipsters weighed in.

const CONSENSUS_WEIGHT = clamp01(Number(process.env.VALUE_CONSENSUS_WEIGHT) || 0.35);
const MIN_EV = Number(process.env.VALUE_MIN_EV);
const MIN_EV_THRESHOLD = Number.isFinite(MIN_EV) ? MIN_EV : 0.05;
const MIN_VOTES = Math.max(1, Number(process.env.VALUE_MIN_VOTES) || 4);
const SMOOTHING = 0.5;

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// implied + no-vig probabilities for a set of {key: decimalOdd}
function devig(oddsByKey) {
  const keys = Object.keys(oddsByKey).filter((k) => Number(oddsByKey[k]) > 1);
  if (keys.length < 2) return null;
  const implied = {};
  let sum = 0;
  for (const k of keys) {
    implied[k] = 1 / Number(oddsByKey[k]);
    sum += implied[k];
  }
  const overround = sum - 1;
  const noVig = {};
  for (const k of keys) noVig[k] = implied[k] / sum;
  return { keys, implied, noVig, overround };
}

// smoothed vote share -> probability distribution over the same keys.
// `countsByKey` may be per-tipster-accuracy-weighted (see
// tipsterWeights.js) rather than raw vote counts, in which case
// `voteCount` — the actual number of tipsters, unweighted — should be
// passed separately so the MIN_VOTES gate still reads "enough opinions",
// not "enough weighted score". Omit it to gate on the counts themselves
// (old behavior, unaffected when countsByKey is already a raw tally).
function consensusProbs(countsByKey, keys, voteCount) {
  let total = 0;
  for (const k of keys) total += Math.max(0, Number(countsByKey[k]) || 0);
  const gate = Number.isFinite(voteCount) ? voteCount : total;
  if (gate < MIN_VOTES) return null;
  const probs = {};
  const denom = total + SMOOTHING * keys.length;
  for (const k of keys) probs[k] = ((Number(countsByKey[k]) || 0) + SMOOTHING) / denom;
  return probs;
}

function assessMarket(oddsByKey, countsByKey, labels, voteCount) {
  const d = devig(oddsByKey);
  if (!d) return null;
  const consensus = consensusProbs(countsByKey, d.keys, voteCount);

  const outcomes = d.keys.map((k) => {
    const odd = Number(oddsByKey[k]);
    const ref = consensus ? (1 - CONSENSUS_WEIGHT) * d.noVig[k] + CONSENSUS_WEIGHT * consensus[k] : d.noVig[k];
    const ev = ref * odd - 1;
    const kelly = odd > 1 ? (ref * odd - 1) / (odd - 1) : 0;
    return {
      key: k,
      label: labels[k] || k,
      odd,
      impliedProb: d.implied[k],
      noVigProb: d.noVig[k],
      consensusProb: consensus ? consensus[k] : null,
      refProb: ref,
      ev,
      edge: ref - d.implied[k],
      quarterKelly: Math.max(0, kelly / 4),
      value: consensus != null && ev >= MIN_EV_THRESHOLD,
    };
  });

  const flagged = outcomes.filter((o) => o.value).sort((a, b) => b.ev - a.ev);
  return {
    overround: d.overround,
    hasConsensus: consensus != null,
    outcomes,
    best: flagged[0] || null,
  };
}

/**
 * @param sgOdds  { oneX2:{home,draw,away}, ou:{point,over,under}|null }
 * @param consensus  a match's tipsterConsensus (needs `tally`/`totalsTally`
 *                    — raw vote counts — and, when tipster accuracy
 *                    weighting is in play, `weightedTally`/
 *                    `weightedTotalsTally`; falls back to the raw tallies
 *                    when the weighted ones aren't present)
 * @returns { oneX2, ou, best } — `best` is the single highest-EV flagged
 *          outcome across both markets, tagged with its market, or null.
 */
function assessValue(sgOdds, consensus) {
  if (!sgOdds || !sgOdds.oneX2) return null;
  const tally = (consensus && consensus.tally) || {};
  const totalsTally = (consensus && consensus.totalsTally) || {};
  const weightedTally = (consensus && consensus.weightedTally) || tally;
  const weightedTotalsTally = (consensus && consensus.weightedTotalsTally) || totalsTally;

  const oneX2VoteCount = (tally.home || 0) + (tally.draw || 0) + (tally.away || 0);
  const oneX2 = assessMarket(
    sgOdds.oneX2,
    { home: weightedTally.home, draw: weightedTally.draw, away: weightedTally.away },
    { home: 'Home', draw: 'Draw', away: 'Away' },
    oneX2VoteCount
  );
  const ouPoint = sgOdds.ou ? sgOdds.ou.point : null;
  const totalsVoteCount = (totalsTally.over || 0) + (totalsTally.under || 0);
  const ou = sgOdds.ou
    ? assessMarket(
        { over: sgOdds.ou.over, under: sgOdds.ou.under },
        { over: weightedTotalsTally.over, under: weightedTotalsTally.under },
        { over: `Over ${ouPoint}`, under: `Under ${ouPoint}` },
        totalsVoteCount
      )
    : null;

  const candidates = [];
  if (oneX2 && oneX2.best) candidates.push({ market: '1X2', ...oneX2.best });
  if (ou && ou.best) candidates.push({ market: `O/U ${ouPoint}`, point: ouPoint, ...ou.best });
  candidates.sort((a, b) => b.ev - a.ev);

  return { oneX2, ou, best: candidates[0] || null };
}

module.exports = { assessValue, assessMarket, devig, consensusProbs, CONSENSUS_WEIGHT, MIN_EV_THRESHOLD };
