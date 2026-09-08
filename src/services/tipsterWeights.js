// Turns each tipster site's graded track record (src/results/accuracy.js)
// into a per-market weight, so a site that's actually beaten chance on a
// market counts for more in the consensus than one that hasn't — instead
// of every tipster's vote counting equally regardless of how often they've
// been right.
//
// weight = 1 + SCALE * shrink(n) * (hitRate - baseline)
//   baseline   chance level for the market (1/3 for 1X2, 1/2 for O/U), so
//              only sites actually beating chance pull weight above 1
//   shrink(n)  n / (n + PRIOR_N) — fades toward neutral (weight 1) when a
//              site only has a handful of graded picks, so an early hot
//              streak doesn't dominate the consensus
// Weight is clamped to [MIN_WEIGHT, MAX_WEIGHT] so one outlier site can't
// swamp the vote, and a site with no graded samples yet defaults to 1.

const PRIOR_N = 20;
const SCALE = 1.5;
const MIN_WEIGHT = 0.4;
const MAX_WEIGHT = 2.0;
const BASELINE = { oneX2: 1 / 3, totals: 0.5 };

function weightFor(correct, total, baseline) {
  const n = Number(total) || 0;
  if (n <= 0) return 1;
  const hitRate = Number(correct) / n;
  const shrink = n / (n + PRIOR_N);
  const raw = 1 + SCALE * shrink * (hitRate - baseline);
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, raw));
}

// accuracySummary: the published accuracy.json shape, { perSite: { [site]:
// { oneX2Correct, oneX2Total, ouCorrect, ouTotal } } }. Returns
// { [site]: { oneX2: weight, totals: weight } }.
function computeSiteWeights(accuracySummary) {
  const perSite = (accuracySummary && accuracySummary.perSite) || {};
  const weights = {};
  for (const [site, b] of Object.entries(perSite)) {
    weights[site] = {
      oneX2: weightFor(b.oneX2Correct, b.oneX2Total, BASELINE.oneX2),
      totals: weightFor(b.ouCorrect, b.ouTotal, BASELINE.totals),
    };
  }
  return weights;
}

function siteWeight(siteWeights, site, market) {
  const w = siteWeights && siteWeights[site];
  const v = w && w[market];
  return Number.isFinite(v) ? v : 1;
}

module.exports = { computeSiteWeights, siteWeight, BASELINE, PRIOR_N, SCALE, MIN_WEIGHT, MAX_WEIGHT };
