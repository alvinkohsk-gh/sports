// "Confidence" here means market-consensus implied probability, not a
// scraped tipster pick. Rationale: aggregating arbitrary prediction/tipster
// sites would mean more unverified scrapers on top of the ones already
// flagged as fragile/unverified for Singapore Pools, with the same ToS and
// network-access problems. Bookmaker odds already encode each book's own
// probability model tuned on real money — averaging several of them after
// removing the overround ("devigging") is a standard, well-grounded way to
// get a consensus probability, using data this app already collects.

function devigTwoWay(overPrice, underPrice) {
  if (!overPrice || !underPrice) return null;
  const impliedOver = 1 / overPrice;
  const impliedUnder = 1 / underPrice;
  const total = impliedOver + impliedUnder;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { over: impliedOver / total, under: impliedUnder / total };
}

function devigThreeWay(homePrice, drawPrice, awayPrice) {
  if (!homePrice || !drawPrice || !awayPrice) return null;
  const iH = 1 / homePrice;
  const iD = 1 / drawPrice;
  const iA = 1 / awayPrice;
  const total = iH + iD + iA;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { home: iH / total, draw: iD / total, away: iA / total };
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

// Bookmakers' totals markets come in two shapes depending on source:
// paired ({point, over, under} — used by mock data) or unpaired
// ([{name: 'Over'|'Under', point, price}] — The Odds API's native shape).
function normalizeTotals(totalsRaw) {
  if (!totalsRaw || !totalsRaw.length) return [];
  if ('over' in totalsRaw[0] || 'under' in totalsRaw[0]) {
    return totalsRaw.map((t) => ({ point: t.point, overPrice: t.over, underPrice: t.under }));
  }
  const byPoint = new Map();
  for (const o of totalsRaw) {
    if (!byPoint.has(o.point)) byPoint.set(o.point, { point: o.point, overPrice: null, underPrice: null });
    const entry = byPoint.get(o.point);
    if (o.name === 'Over') entry.overPrice = o.price;
    if (o.name === 'Under') entry.underPrice = o.price;
  }
  return [...byPoint.values()];
}

// Relative spread of a set of probabilities, 0 (perfect agreement) to 1 (capped).
function agreementScore(probs) {
  if (probs.length <= 1) return 0.5; // only one book quoted it — treat as middling confidence
  const m = mean(probs);
  const sd = stddev(probs);
  const relativeSpread = m > 0 ? sd / m : 1;
  return 1 - Math.min(relativeSpread, 1);
}

/**
 * Scores every candidate bet (1X2 outcomes + each totals line's over/under)
 * for one match and returns them sorted best-first. `confidenceScore`
 * blends consensus probability, cross-bookmaker agreement, and how many
 * bookmakers actually quoted the market (more quotes = more trustworthy
 * consensus).
 */
function rankCandidateBets(match) {
  const h2hProbs = [];
  const totalsProbsByPoint = new Map();

  for (const bk of match.bookmakers || []) {
    const h2h = bk.markets?.h2h;
    if (h2h && h2h.home && h2h.draw && h2h.away) {
      const d = devigThreeWay(h2h.home, h2h.draw, h2h.away);
      if (d) h2hProbs.push(d);
    }
    for (const t of normalizeTotals(bk.markets?.totals)) {
      if (!t.overPrice || !t.underPrice) continue;
      const d = devigTwoWay(t.overPrice, t.underPrice);
      if (!d) continue;
      if (!totalsProbsByPoint.has(t.point)) totalsProbsByPoint.set(t.point, []);
      totalsProbsByPoint.get(t.point).push(d);
    }
  }

  const candidates = [];

  if (h2hProbs.length) {
    const outcomes = [
      { selection: 'home', label: `${match.homeTeam} to win`, values: h2hProbs.map((p) => p.home) },
      { selection: 'draw', label: 'Draw', values: h2hProbs.map((p) => p.draw) },
      { selection: 'away', label: `${match.awayTeam} to win`, values: h2hProbs.map((p) => p.away) },
    ];
    for (const o of outcomes) {
      candidates.push({
        market: '1X2',
        selection: o.selection,
        label: o.label,
        probability: mean(o.values),
        agreement: agreementScore(o.values),
        bookmakerCount: h2hProbs.length,
      });
    }
  }

  for (const [point, list] of totalsProbsByPoint) {
    candidates.push({
      market: 'totals',
      selection: 'over',
      point,
      label: `Over ${point} goals`,
      probability: mean(list.map((p) => p.over)),
      agreement: agreementScore(list.map((p) => p.over)),
      bookmakerCount: list.length,
    });
    candidates.push({
      market: 'totals',
      selection: 'under',
      point,
      label: `Under ${point} goals`,
      probability: mean(list.map((p) => p.under)),
      agreement: agreementScore(list.map((p) => p.under)),
      bookmakerCount: list.length,
    });
  }

  for (const c of candidates) {
    const bookmakerBoost = Math.min(c.bookmakerCount / 5, 1); // saturates once 5+ books agree
    c.confidenceScore = c.probability * (0.7 + 0.3 * c.agreement) * (0.85 + 0.15 * bookmakerBoost);
    c.tipsterBoost = 0;
  }

  applyTipsterBoost(candidates, match.tipsterConsensus);

  return candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

// Tipster picks only cover 1X2 (no totals), and they're a discrete vote,
// not a probability — so rather than mixing them into the market math,
// this nudges the matching 1X2 candidate's score by a small, capped amount
// proportional to how many of the tipster sites agree, and records exactly
// how much of a boost was applied so the UI/API can show it plainly rather
// than hiding it inside one opaque number.
function applyTipsterBoost(candidates, tipsterConsensus) {
  if (!tipsterConsensus || !tipsterConsensus.majorityPick || tipsterConsensus.totalTipsters === 0) return;
  const candidate = candidates.find((c) => c.market === '1X2' && c.selection === tipsterConsensus.majorityPick);
  if (!candidate) return;
  const agreementRatio = tipsterConsensus.majorityCount / tipsterConsensus.totalTipsters;
  const boost = 1 + 0.15 * agreementRatio; // up to +15% when tipsters unanimously agree
  candidate.tipsterBoost = boost - 1;
  candidate.confidenceScore *= boost;
}

function attachConfidence(matches) {
  return matches.map((match) => {
    const ranked = rankCandidateBets(match);
    return { ...match, topPick: ranked[0] || null, allCandidates: ranked };
  });
}

function pickBestBetOverall(matchesWithConfidence) {
  let best = null;
  for (const match of matchesWithConfidence) {
    if (!match.topPick) continue;
    if (!best || match.topPick.confidenceScore > best.topPick.confidenceScore) {
      best = match;
    }
  }
  if (!best) return null;
  return {
    homeTeam: best.homeTeam,
    awayTeam: best.awayTeam,
    league: best.league,
    kickoffISO: best.kickoffISO,
    tipsterConsensus: best.tipsterConsensus,
    ...best.topPick,
  };
}

module.exports = { devigTwoWay, devigThreeWay, rankCandidateBets, attachConfidence, pickBestBetOverall };
