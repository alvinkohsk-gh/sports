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

// smoothed vote share -> probability distribution over the same keys
function consensusProbs(countsByKey, keys) {
  let total = 0;
  for (const k of keys) total += Math.max(0, Number(countsByKey[k]) || 0);
  if (total < MIN_VOTES) return null;
  const probs = {};
  const denom = total + SMOOTHING * keys.length;
  for (const k of keys) probs[k] = ((Number(countsByKey[k]) || 0) + SMOOTHING) / denom;
  return probs;
}

function assessMarket(oddsByKey, countsByKey, labels) {
  const d = devig(oddsByKey);
  if (!d) return null;
  const consensus = consensusProbs(countsByKey, d.keys);

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
 * @param sgOdds  { oneX2:{home,draw,away}, ou25:{over,under}|null }
 * @param consensus  a match's tipsterConsensus (needs `tally` and `totalsTally`)
 * @returns { oneX2, ou25, best } — `best` is the single highest-EV flagged
 *          outcome across both markets, tagged with its market, or null.
 */
function assessValue(sgOdds, consensus) {
  if (!sgOdds || !sgOdds.oneX2) return null;
  const tally = (consensus && consensus.tally) || {};
  const totalsTally = (consensus && consensus.totalsTally) || {};

  const oneX2 = assessMarket(
    sgOdds.oneX2,
    { home: tally.home, draw: tally.draw, away: tally.away },
    { home: 'Home', draw: 'Draw', away: 'Away' }
  );
  const ou25 = sgOdds.ou25
    ? assessMarket(
        sgOdds.ou25,
        { over: totalsTally.over, under: totalsTally.under },
        { over: 'Over 2.5', under: 'Under 2.5' }
      )
    : null;

  const candidates = [];
  if (oneX2 && oneX2.best) candidates.push({ market: '1X2', ...oneX2.best });
  if (ou25 && ou25.best) candidates.push({ market: 'O/U 2.5', ...ou25.best });
  candidates.sort((a, b) => b.ev - a.ev);

  return { oneX2, ou25, best: candidates[0] || null };
}

module.exports = { assessValue, assessMarket, devig, consensusProbs, CONSENSUS_WEIGHT, MIN_EV_THRESHOLD };
