// Value assessment identical in method to value.js's assessValue, but
// scoped to a single tipster site (statarea) instead of the full
// 10-source consensus — for a user who trusts one site's picks more than
// the blended crowd and wants to see, per match, whether SG Pools' price
// on THAT site's pick clears the same EV bar the board uses everywhere
// else.
//
// Reuses assessMarket verbatim: the "vote tally" passed in is just
// statarea's single pick, scaled by its own graded-accuracy weight (see
// tipsterWeights.js) instead of a multi-site vote count. There's no
// MIN_VOTES gate here — with exactly one possible vote, "enough opinions
// weighed in" isn't a meaningful concept, so the market is assessed
// whenever statarea actually has a classified pick for it.
const { assessMarket } = require('./value');
const { siteWeight } = require('./tipsterWeights');
const { resolveTotalsPickAtPoint } = require('./tipsterConsensus');

// A large-but-finite vote count to bypass assessMarket's MIN_VOTES gate —
// consensusProbs() only treats a passed voteCount as active when
// Number.isFinite() is true, so Infinity would fall through to gating on
// the actual (possibly sub-MIN_VOTES) weighted total instead of bypassing
// it.
const NO_VOTE_GATE = 1e9;

/**
 * @param sgOdds  { oneX2:{home,draw,away}, ou:{point,over,under}|null }
 * @param statareaTip  one match's statarea entry from tipsterConsensus.picks,
 *                     { pick, totalsPick } (or null if statarea didn't cover it)
 * @param siteWeights  from tipsterWeights.computeSiteWeights
 * @returns { oneX2, ou, best } — same shape as value.js's assessValue
 */
function assessStatareaValue(sgOdds, statareaTip, siteWeights) {
  if (!sgOdds || !sgOdds.oneX2 || !statareaTip) return null;

  const oneX2Pick = statareaTip.pick;
  let oneX2 = null;
  if (oneX2Pick === 'home' || oneX2Pick === 'draw' || oneX2Pick === 'away') {
    const w = siteWeight(siteWeights, 'statarea', 'oneX2');
    const counts = { home: 0, draw: 0, away: 0 };
    counts[oneX2Pick] = w;
    oneX2 = assessMarket(sgOdds.oneX2, counts, { home: 'Home', draw: 'Draw', away: 'Away' }, NO_VOTE_GATE);
  }

  const ouPoint = sgOdds.ou ? sgOdds.ou.point : null;
  let ou = null;
  if (sgOdds.ou) {
    const selection = resolveTotalsPickAtPoint(statareaTip.totalsPick, ouPoint);
    if (selection === 'over' || selection === 'under') {
      const w = siteWeight(siteWeights, 'statarea', 'totals');
      const counts = { over: 0, under: 0 };
      counts[selection] = w;
      ou = assessMarket(
        { over: sgOdds.ou.over, under: sgOdds.ou.under },
        counts,
        { over: `Over ${ouPoint}`, under: `Under ${ouPoint}` },
        NO_VOTE_GATE
      );
    }
  }

  if (!oneX2 && !ou) return null; // statarea had nothing classified on this match

  const candidates = [];
  if (oneX2 && oneX2.best) candidates.push({ market: '1X2', ...oneX2.best });
  if (ou && ou.best) candidates.push({ market: `O/U ${ouPoint}`, point: ouPoint, ...ou.best });
  candidates.sort((a, b) => b.ev - a.ev);

  return { oneX2, ou, best: candidates[0] || null };
}

module.exports = { assessStatareaValue };
