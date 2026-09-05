const fs = require('fs');
const path = require('path');

const sampleFixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sample-fixtures.json'), 'utf8')
);
const sampleOdds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sample-odds.json'), 'utf8'));
const sampleTipsters = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sample-tipsters.json'), 'utf8')
);

function inMinutes(mins) {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

function getMockSgpFixtures() {
  return sampleFixtures.map((f) => ({
    sgpMatchId: f.sgpMatchId,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    league: f.league,
    kickoffISO: inMinutes(f.kickoffInMinutes),
    source: 'singaporepools.com.sg (mock)',
  }));
}

function getMockOddsEvents() {
  return sampleOdds.map((e, idx) => {
    const bookmakers = e.bookmakers.map((bk) => ({
      key: bk.key,
      title: bk.title,
      lastUpdate: new Date().toISOString(),
      markets: { h2h: bk.h2h, totals: bk.totals },
    }));

    const best = { home: null, draw: null, away: null };
    const totalsMap = new Map();
    for (const bk of e.bookmakers) {
      if (bk.h2h.home > (best.home ?? 0)) best.home = bk.h2h.home;
      if (bk.h2h.draw > (best.draw ?? 0)) best.draw = bk.h2h.draw;
      if (bk.h2h.away > (best.away ?? 0)) best.away = bk.h2h.away;
      for (const t of bk.totals) {
        if (!totalsMap.has(t.point)) totalsMap.set(t.point, { point: t.point, over: null, under: null });
        const entry = totalsMap.get(t.point);
        if (t.over > (entry.over ?? 0)) entry.over = t.over;
        if (t.under > (entry.under ?? 0)) entry.under = t.under;
      }
    }

    return {
      oddsApiEventId: `mock-${idx}`,
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      kickoffISO: inMinutes(e.kickoffInMinutes),
      league: e.league,
      bestOneXTwo: best,
      bestTotals: [...totalsMap.values()],
      bookmakers,
      source: 'the-odds-api.com (mock)',
    };
  });
}

function getMockTipsterPicks() {
  return sampleTipsters.map((t) => ({
    site: t.site,
    homeTeam: t.homeTeam,
    awayTeam: t.awayTeam,
    pick: t.pick,
    rawText: t.rawText,
    sourceUrl: `https://${t.site}.example (mock)`,
  }));
}

module.exports = { getMockSgpFixtures, getMockOddsEvents, getMockTipsterPicks };
