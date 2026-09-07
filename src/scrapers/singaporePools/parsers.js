const cheerio = require('cheerio');

// Pure parsers for Singapore Pools fixture data. No I/O — every function
// takes an already-fetched payload (a captured JSON body or rendered HTML)
// and returns normalized fixtures. The browser render that produces those
// payloads lives in ./render.js; the orchestration that picks which parser
// to trust lives in ./index.js.

/**
 * Normalizes one fixture into the shape the rest of the app expects.
 */
function toFixture({ homeTeam, awayTeam, kickoffISO, league, sgpMatchId }) {
  if (!homeTeam || !awayTeam || !kickoffISO) return null;
  return {
    sgpMatchId: sgpMatchId || `${homeTeam}-${awayTeam}-${kickoffISO}`,
    homeTeam: homeTeam.trim(),
    awayTeam: awayTeam.trim(),
    kickoffISO,
    league: league || null,
    source: 'online.singaporepools.com',
  };
}

/**
 * Parses the real fixture-events API confirmed via production capture:
 * api.singaporepools.com/football/events/v1/{upcoming-event,live}. Unlike
 * what extractFixturesFromJson assumes, there's no separate home/away
 * field — each event's teams are combined into one "name" string like
 * "Ascoli vs Benevento SRL" (or "... (Live)" for in-play events), with
 * startTime already a clean ISO 8601 UTC string and type.name giving the
 * competition/league. When the payload is the betType=MR view its events
 * also carry the 1X2 market with prices, so we lift those here rather than
 * making a second API call for them (see ./odds.js — only O/U 2.5 needs
 * its own fetch).
 */
function oneX2OddsFromEvent(event) {
  const mkt = (event.markets || []).find((m) => m.minorCode === 'MR');
  if (!mkt) return null;
  const o = {};
  for (const out of mkt.outcomes || []) {
    const dec = Number(out.prices && out.prices[0] && out.prices[0].decimal);
    if (!(dec > 1)) continue;
    if (out.minorCode === 'H') o.home = dec;
    else if (out.minorCode === 'D') o.draw = dec;
    else if (out.minorCode === 'A') o.away = dec;
  }
  return o.home && o.draw && o.away ? o : null;
}

function eventTeams(event) {
  if (!event || typeof event.name !== 'string') return null;
  const clean = event.name.replace(/\s*\(live\)\s*$/i, '').trim();
  const parts = clean.split(/\s+vs\s+/i);
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : null;
}

function extractFixturesFromEventsApi(data) {
  if (!data || !Array.isArray(data.events)) return [];
  const results = [];
  for (const event of data.events) {
    if (!event || !event.startTime) continue;
    const teams = eventTeams(event);
    if (!teams) continue;
    const fixture = toFixture({
      homeTeam: teams[0],
      awayTeam: teams[1],
      kickoffISO: new Date(event.startTime).toISOString(),
      league: event.type?.name || null,
      sgpMatchId: event.id != null ? String(event.id) : null,
    });
    if (!fixture) continue;
    const oneX2 = oneX2OddsFromEvent(event);
    if (oneX2) fixture.odds = { oneX2, ou25: null };
    results.push(fixture);
  }
  return results;
}

/**
 * In-play fixtures from the .../events/v1/live payload. Same shape as an
 * upcoming fixture (teams, kickoffISO, league, sgpMatchId) plus:
 *   live: true
 *   odds.oneX2       live 1X2 prices
 *   liveLine         the lowest Over/Under line still on offer, e.g.
 *                    { point: 2.5, over, under }. SG Pools opens the next
 *                    half-goal line above the current total, so
 *                    `point - 0.5` is a rough count of goals scored so far.
 */
function extractLiveFixtures(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const event of events) {
    if (!event || !event.startTime) continue;
    const teams = eventTeams(event);
    if (!teams) continue;
    const fixture = toFixture({
      homeTeam: teams[0],
      awayTeam: teams[1],
      kickoffISO: new Date(event.startTime).toISOString(),
      league: (event.type?.name || '').replace(/\s*\(live\)\s*$/i, '').trim() || null,
      sgpMatchId: event.id != null ? String(event.id) : null,
    });
    if (!fixture) continue;
    fixture.live = true;

    const oneX2 = oneX2OddsFromEvent(event);
    if (oneX2) fixture.odds = { oneX2, ou25: null };

    let lowest = null;
    for (const m of event.markets || []) {
      if (m.minorCode !== 'HL' || !/total goals over\/under/i.test(m.name || '')) continue;
      if (/halftime/i.test(m.name || '')) continue;
      const point = Number(m.handicapValue);
      if (!Number.isFinite(point)) continue;
      const o = {};
      for (const out2 of m.outcomes || []) {
        const dec = Number(out2.prices && out2.prices[0] && out2.prices[0].decimal);
        if (!(dec > 1)) continue;
        if (out2.minorCode === 'H') o.over = dec;
        else if (out2.minorCode === 'L') o.under = dec;
      }
      if (o.over && o.under && (!lowest || point < lowest.point)) lowest = { point, ...o };
    }
    if (lowest) fixture.liveLine = lowest;

    out.push(fixture);
  }
  return out;
}

// Singapore Pools displays local (Asia/Singapore, UTC+8) times with no
// timezone marker. This assumes UTC+8; adjust if the source format differs.
function coerceSgTimeToISO(raw) {
  const now = new Date();
  const parts = raw.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(\d{1,2}):(\d{2})/);
  if (!parts) return null;
  const [, d, mo, y, h, min] = parts;
  const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : now.getUTCFullYear();
  // Construct as UTC+8 then convert to true UTC by subtracting 8 hours.
  const asUtc8 = Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(min));
  return new Date(asUtc8 - 8 * 60 * 60 * 1000).toISOString();
}

/**
 * Best-effort parser for the rendered page. Real markup/selectors are not
 * yet verified against the live site (see README "Debugging" section), so
 * this looks for generic "Team A v Team B" (or "vs") text patterns plus a
 * nearby date/time rather than a brittle exact CSS selector. Treat this as
 * a starting point: once you have a real debug-sgpools-raw.html capture,
 * replace this with selectors/patterns matched to what's actually there.
 */
function parseRenderedHtml(html) {
  const $ = cheerio.load(html);
  const results = [];
  const text = $('body').text().replace(/\s+/g, ' ');

  const matchPattern = /([A-Za-z .'-]{3,40})\s+v[s]?\.?\s+([A-Za-z .'-]{3,40})/g;
  const datePattern = /(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s+\d{1,2}:\d{2})/;

  let m;
  while ((m = matchPattern.exec(text)) !== null) {
    const homeTeam = m[1].trim();
    const awayTeam = m[2].trim();
    const windowText = text.slice(m.index, m.index + 200);
    const dateMatch = windowText.match(datePattern);
    if (!dateMatch) continue;
    const kickoffISO = coerceSgTimeToISO(dateMatch[1]);
    const fixture = toFixture({ homeTeam, awayTeam, kickoffISO });
    if (fixture) results.push(fixture);
  }
  return results;
}

/**
 * Shape-agnostic walk: looks for objects that look like fixtures (two
 * team-name fields + a date field) anywhere in an arbitrary JSON payload,
 * rather than depending on one exact schema.
 */
function extractFixturesFromJson(data) {
  const results = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const keys = Object.keys(node).reduce((acc, k) => {
      acc[k.toLowerCase()] = k;
      return acc;
    }, {});
    const homeKey = keys.hometeam || keys.home || keys.team1 || keys.hometeamname;
    const awayKey = keys.awayteam || keys.away || keys.team2 || keys.awayteamname;
    const dateKey = keys.kickoff || keys.matchdate || keys.eventdate || keys.datetime || keys.matchtime;
    if (homeKey && awayKey && node[homeKey] && node[awayKey]) {
      const kickoffRaw = dateKey ? node[dateKey] : null;
      const kickoffISO = kickoffRaw ? new Date(kickoffRaw).toISOString() : null;
      const fixture = toFixture({
        homeTeam: String(node[homeKey]),
        awayTeam: String(node[awayKey]),
        kickoffISO,
        league: node[keys.league] || node[keys.competition] || null,
        sgpMatchId: node[keys.matchid] || node[keys.eventid] || null,
      });
      if (fixture && kickoffISO && !seen.has(fixture.sgpMatchId)) {
        seen.add(fixture.sgpMatchId);
        results.push(fixture);
      }
    }
    Object.values(node).forEach(visit);
  }

  visit(data);
  return results;
}

/**
 * Debug helper: finds objects that look like a fixture/event (an "id" key
 * plus some "market"-ish key, matching the real /sports/football API shape
 * discovered in production) and returns their own keys with nested
 * arrays/objects collapsed to a short marker — enough to read off the real
 * team-name/date field names without the multi-KB odds payload each event
 * carries under "markets".
 */
function summarizeEventShapes(data, maxResults = 3) {
  const results = [];
  const seen = new Set();

  function visit(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8 || results.length >= maxResults) return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const keys = Object.keys(node);
    if (keys.includes('id') && keys.some((k) => /market/i.test(k))) {
      const shallow = {};
      for (const k of keys) {
        const v = node[k];
        shallow[k] = Array.isArray(v) ? `[array len=${v.length}]` : v && typeof v === 'object' ? '[object]' : v;
      }
      const fingerprint = JSON.stringify(shallow);
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        results.push(shallow);
      }
    }
    Object.values(node).forEach((v) => visit(v, depth + 1));
  }

  visit(data, 0);
  return results;
}

module.exports = {
  toFixture,
  extractFixturesFromEventsApi,
  extractLiveFixtures,
  extractFixturesFromJson,
  parseRenderedHtml,
  coerceSgTimeToISO,
  summarizeEventShapes,
};
