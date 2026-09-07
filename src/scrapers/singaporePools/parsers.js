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
 * competition/league.
 */
function extractFixturesFromEventsApi(data) {
  if (!data || !Array.isArray(data.events)) return [];
  const results = [];
  for (const event of data.events) {
    if (!event || typeof event.name !== 'string' || !event.startTime) continue;
    const cleanName = event.name.replace(/\s*\(live\)\s*$/i, '').trim();
    const parts = cleanName.split(/\s+vs\s+/i);
    if (parts.length !== 2) continue;
    const [homeTeam, awayTeam] = parts;
    const fixture = toFixture({
      homeTeam,
      awayTeam,
      kickoffISO: new Date(event.startTime).toISOString(),
      league: event.type?.name || null,
      sgpMatchId: event.id != null ? String(event.id) : null,
    });
    if (fixture) results.push(fixture);
  }
  return results;
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
  extractFixturesFromJson,
  parseRenderedHtml,
  coerceSgTimeToISO,
  summarizeEventShapes,
};
