const axios = require('axios');

const BASE_URL = 'https://api.the-odds-api.com/v4';

// Soccer competitions covered by The Odds API that Singapore Pools also
// typically lists. Trim/extend as needed; each extra key costs API quota.
const SOCCER_SPORT_KEYS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'soccer_fifa_world_cup',
];

/**
 * Fetches h2h (1X2) and totals (over/under total goals) odds for one
 * sport key. Returns The Odds API's native event shape.
 */
async function fetchOddsForSport(sportKey, apiKey) {
  const url = `${BASE_URL}/sports/${sportKey}/odds`;
  try {
    const { data } = await axios.get(url, {
      params: {
        apiKey,
        regions: 'uk,eu,us',
        markets: 'h2h,totals',
        oddsFormat: 'decimal',
        dateFormat: 'iso',
      },
      timeout: 15000,
    });
    return data;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    const isEgressBlock = typeof body === 'string' && body.includes('no rule or allowlist entry allows host');
    if (isEgressBlock) {
      throw new Error(
        'Blocked by the local network egress proxy before reaching The Odds API — not an API key problem. ' +
          'Run this outside the sandboxed environment.'
      );
    }
    if (status === 401 || status === 403) {
      throw new Error(`The Odds API rejected the request (HTTP ${status}) — check ODDS_API_KEY: ${JSON.stringify(body)}`);
    }
    console.error(`[oddsApi] ${sportKey} fetch failed:`, err.message);
    return [];
  }
}

/**
 * Picks the best-priced (highest) 1X2 and totals line across all
 * bookmakers returned for an event, plus a per-bookmaker breakdown.
 */
function summarizeEventOdds(event) {
  const oneXTwo = { home: null, draw: null, away: null };
  const totals = new Map(); // point -> { over, under }
  const bookmakers = [];

  for (const bk of event.bookmakers || []) {
    const bkEntry = { key: bk.key, title: bk.title, lastUpdate: bk.last_update, markets: {} };

    const h2h = bk.markets?.find((m) => m.key === 'h2h');
    if (h2h) {
      const home = h2h.outcomes.find((o) => o.name === event.home_team);
      const away = h2h.outcomes.find((o) => o.name === event.away_team);
      const draw = h2h.outcomes.find((o) => o.name === 'Draw');
      bkEntry.markets.h2h = {
        home: home?.price ?? null,
        draw: draw?.price ?? null,
        away: away?.price ?? null,
      };
      if (home?.price > (oneXTwo.home ?? 0)) oneXTwo.home = home.price;
      if (draw?.price > (oneXTwo.draw ?? 0)) oneXTwo.draw = draw.price;
      if (away?.price > (oneXTwo.away ?? 0)) oneXTwo.away = away.price;
    }

    const totalsMkt = bk.markets?.find((m) => m.key === 'totals');
    if (totalsMkt) {
      bkEntry.markets.totals = totalsMkt.outcomes.map((o) => ({
        name: o.name,
        point: o.point,
        price: o.price,
      }));
      for (const o of totalsMkt.outcomes) {
        const key = o.point;
        if (!totals.has(key)) totals.set(key, { point: key, over: null, under: null });
        const entry = totals.get(key);
        if (o.name === 'Over' && o.price > (entry.over ?? 0)) entry.over = o.price;
        if (o.name === 'Under' && o.price > (entry.under ?? 0)) entry.under = o.price;
      }
    }

    bookmakers.push(bkEntry);
  }

  return {
    oddsApiEventId: event.id,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    kickoffISO: event.commence_time,
    league: event.sport_title,
    bestOneXTwo: oneXTwo,
    bestTotals: [...totals.values()].sort((a, b) => a.point - b.point),
    bookmakers,
    source: 'the-odds-api.com',
  };
}

async function fetchAllSoccerOdds(apiKey) {
  const perSport = await Promise.all(SOCCER_SPORT_KEYS.map((key) => fetchOddsForSport(key, apiKey)));
  return perSport.flat().map(summarizeEventOdds);
}

module.exports = { fetchAllSoccerOdds, fetchOddsForSport, summarizeEventOdds, SOCCER_SPORT_KEYS };
