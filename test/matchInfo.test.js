const test = require('node:test');
const assert = require('node:assert/strict');
const { attachMatchInfo, findForebetUrl, annotateH2HResults, annotateStandings, SCHEMA_VERSION } = require('../src/results/matchInfo');

const NOW = Date.parse('2026-01-10T00:00:00Z');
const IN_2_DAYS = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString();
const IN_10_DAYS = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString();
const YESTERDAY = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();

function match(homeTeam, awayTeam, kickoffISO) {
  return { homeTeam, awayTeam, kickoffISO };
}

function forebetRow(homeTeam, awayTeam, matchUrl) {
  return { site: 'forebet', homeTeam, awayTeam, matchUrl };
}

test('findForebetUrl: matches home/away in either order', () => {
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  assert.equal(findForebetUrl(match('Arsenal', 'Chelsea', IN_2_DAYS), rows), 'https://forebet.example/arsenal-chelsea');
  assert.equal(findForebetUrl(match('Chelsea', 'Arsenal', IN_2_DAYS), rows), 'https://forebet.example/arsenal-chelsea');
  assert.equal(findForebetUrl(match('Liverpool', 'Everton', IN_2_DAYS), rows), null);
});

test('attachMatchInfo: fetches and attaches info for a covered, in-range match', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const fetchFn = async (url) => ({ h2h: [{ raw: '2-1', homeGoals: 2, awayGoals: 1 }], homeForm: ['W'], awayForm: ['L'], sourceUrl: url });

  const cache = await attachMatchInfo([m], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.ok(m.headToHead);
  assert.equal(m.headToHead.homeForm[0], 'W');
  assert.equal(cache.entries.length, 1);
  assert.equal(cache.entries[0].info.awayForm[0], 'L');
});

test('attachMatchInfo: skips a match Forebet does not cover', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  let called = false;
  const fetchFn = async () => { called = true; return null; };
  await attachMatchInfo([m], [], { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(called, false);
  assert.equal(m.headToHead, undefined);
});

test('attachMatchInfo: skips a match too far in the future (beyond MAX_LOOKAHEAD_MS)', async () => {
  const m = match('Arsenal', 'Chelsea', IN_10_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  let called = false;
  const fetchFn = async () => { called = true; return null; };
  await attachMatchInfo([m], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(called, false);
});

test('attachMatchInfo: never fetches for a match that already kicked off', async () => {
  const m = match('Arsenal', 'Chelsea', YESTERDAY);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  let called = false;
  const fetchFn = async () => { called = true; return null; };
  await attachMatchInfo([m], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(called, false);
});

test('attachMatchInfo: still serves cached pre-match info for a live/finished match (never fetches, but does not drop it)', async () => {
  const m = match('Arsenal', 'Chelsea', YESTERDAY); // already kicked off relative to NOW
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + YESTERDAY.slice(0, 10),
        fetchedAtISO: new Date(NOW - 26 * 60 * 60 * 1000).toISOString(), // fetched well before kickoff, now "stale" by TTL_MS
        schemaVersion: SCHEMA_VERSION,
        info: { h2h: [], homeForm: ['W'], awayForm: ['L'] },
      },
    ],
  };
  let called = false;
  const fetchFn = async () => { called = true; return null; };
  await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(called, false); // never re-fetches for a live/finished match
  assert.equal(m.headToHead.homeForm[0], 'W'); // but the pre-match cache is still served, not dropped
});

test('attachMatchInfo: serves a fresh cache entry without re-fetching', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + IN_2_DAYS.slice(0, 10),
        fetchedAtISO: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h old, well under the 24h TTL
        schemaVersion: SCHEMA_VERSION,
        info: { h2h: [], homeForm: ['D'], awayForm: ['D'] },
      },
    ],
  };
  let called = false;
  const fetchFn = async () => { called = true; return null; };
  await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(called, false);
  assert.equal(m.headToHead.homeForm[0], 'D');
});

test('attachMatchInfo: re-fetches once a cache entry is past its TTL', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + IN_2_DAYS.slice(0, 10),
        fetchedAtISO: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(), // 25h old, past the 24h TTL
        info: { h2h: [], homeForm: ['D'], awayForm: ['D'] },
      },
    ],
  };
  const fetchFn = async () => ({ h2h: [], homeForm: ['W'], awayForm: ['W'] });
  await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(m.headToHead.homeForm[0], 'W');
});

test('attachMatchInfo: caps new fetches at MAX_FETCHES_PER_RUN, serving stale cache for the rest', async () => {
  const matches = Array.from({ length: 20 }, (_, i) => match(`Home${i}`, `Away${i}`, IN_2_DAYS));
  const rows = matches.map((m) => forebetRow(m.homeTeam, m.awayTeam, `https://forebet.example/${m.homeTeam}`));
  let fetchCount = 0;
  const fetchFn = async () => { fetchCount += 1; return { h2h: [], homeForm: ['W'], awayForm: ['W'] }; };
  await attachMatchInfo(matches, rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.ok(fetchCount <= 15, `expected at most 15 fetches (MAX_FETCHES_PER_RUN default), got ${fetchCount}`);
});

test('attachMatchInfo: keeps last-known-good info when a re-fetch returns null', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + IN_2_DAYS.slice(0, 10),
        fetchedAtISO: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(),
        schemaVersion: SCHEMA_VERSION,
        info: { h2h: [], homeForm: ['D'], awayForm: ['D'] },
      },
    ],
  };
  const fetchFn = async () => null; // e.g. page structure changed, nothing parsed
  await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(m.headToHead.homeForm[0], 'D');
});

test('attachMatchInfo: retries a null-info cache entry even within the TTL, instead of treating it as fresh', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + IN_2_DAYS.slice(0, 10),
        fetchedAtISO: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h old, well under the 24h TTL
        info: null, // a prior fetch/parse failure — should not block a retry
      },
    ],
  };
  let called = false;
  const fetchFn = async () => { called = true; return { h2h: [], homeForm: ['W'], awayForm: ['W'] }; };
  await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(called, true);
  assert.equal(m.headToHead.homeForm[0], 'W');
});

test('attachMatchInfo: retries a cache entry from an older SCHEMA_VERSION even within the TTL, instead of serving stale-shaped data', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + IN_2_DAYS.slice(0, 10),
        fetchedAtISO: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h old, well under the 24h TTL
        // no schemaVersion at all — as if written before the field existed
        info: { h2h: [{ homeGoals: 1, awayGoals: 0 }], homeForm: ['D'], awayForm: ['D'] },
      },
    ],
  };
  let called = false;
  const fetchFn = async () => {
    called = true;
    return { h2h: [{ homeGoals: 2, awayGoals: 0, homeTeamName: 'Arsenal', awayTeamName: 'Chelsea' }], homeForm: ['W'], awayForm: ['W'] };
  };
  const cache = await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(called, true);
  assert.equal(m.headToHead.homeForm[0], 'W');
  assert.equal(cache.entries[0].schemaVersion, SCHEMA_VERSION);
});

test('attachMatchInfo: chaining a second call for the in-play array (as scrape-snapshot.js does) serves the just-fetched cache without a new fetch', async () => {
  // Mirrors scripts/scrape-snapshot.js: a fixture that was fetched while
  // still in snapshot.matches must still show up when the *same* fixture
  // (now already kicked off) is passed again as part of a separate
  // in-play array built from a different source.
  const upcoming = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  let fetchCount = 0;
  const fetchFn = async () => {
    fetchCount += 1;
    return { h2h: [], homeForm: ['W'], awayForm: ['L'] };
  };
  const cacheAfterBoard = await attachMatchInfo([upcoming], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(fetchCount, 1);

  // Same fixture, now already kicked off, arriving via the separate
  // in-play array — same team names/kickoff, so the same matchKey.
  const nowLive = Date.parse(IN_2_DAYS) + 60 * 60 * 1000; // an hour after that kickoff
  const inPlayFixture = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const cacheAfterInPlay = await attachMatchInfo([inPlayFixture], rows, cacheAfterBoard, { nowMs: nowLive, fetchFn });

  assert.equal(fetchCount, 1); // never re-fetched for the already-started in-play pass
  assert.ok(inPlayFixture.headToHead);
  assert.equal(inPlayFixture.headToHead.homeForm[0], 'W');
  assert.equal(cacheAfterInPlay.entries.length, 1);
});

test('annotateH2HResults: labels each row from the current match home team\'s perspective, flipping when that team was away in the past meeting', () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const h2h = [
    { homeGoals: 2, awayGoals: 1, homeTeamName: 'Arsenal', awayTeamName: 'Chelsea' }, // Arsenal (us) won as home
    { homeGoals: 1, awayGoals: 3, homeTeamName: 'Chelsea', awayTeamName: 'Arsenal' }, // Arsenal (us) won as the away side, 3-1
    { homeGoals: 0, awayGoals: 0, homeTeamName: 'Arsenal', awayTeamName: 'Chelsea' }, // draw
    { homeGoals: 2, awayGoals: 0, homeTeamName: 'Chelsea', awayTeamName: 'Arsenal' }, // Arsenal (us) lost as the away side
  ];
  const results = annotateH2HResults(h2h, m).map((r) => r.result);
  assert.deepEqual(results, ['W', 'W', 'D', 'L']);
});

test('annotateH2HResults: leaves result null when a row has no team names', () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const h2h = [{ homeGoals: 1, awayGoals: 0 }];
  assert.equal(annotateH2HResults(h2h, m)[0].result, null);
});

test('annotateH2HResults: attachMatchInfo annotates h2h rows on a freshly fetched result', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const fetchFn = async () => ({
    h2h: [{ homeGoals: 2, awayGoals: 0, homeTeamName: 'Arsenal', awayTeamName: 'Chelsea' }],
    homeForm: [],
    awayForm: [],
  });
  await attachMatchInfo([m], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(m.headToHead.h2h[0].result, 'W');
});

test('annotateStandings: flags rows matching either the home or away team, leaving the rest false', () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const standings = [
    { position: 1, team: 'Arsenal', points: 50 },
    { position: 2, team: 'Liverpool', points: 48 },
    { position: 3, team: 'Chelsea', points: 45 },
  ];
  const flags = annotateStandings(standings, m).map((r) => r.isMatchTeam);
  assert.deepEqual(flags, [true, false, true]);
});

test('annotateStandings: labels which flagged row is the home team vs the away team', () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const standings = [
    { position: 1, team: 'Arsenal', points: 50 },
    { position: 2, team: 'Liverpool', points: 48 },
    { position: 3, team: 'Chelsea', points: 45 },
  ];
  const sides = annotateStandings(standings, m).map((r) => r.side);
  assert.deepEqual(sides, ['home', null, 'away']);
});

test('annotateStandings: attachMatchInfo annotates standings rows on a freshly fetched result', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const fetchFn = async () => ({
    h2h: [],
    homeForm: [],
    awayForm: [],
    standings: [
      { position: 1, team: 'Arsenal', points: 50 },
      { position: 2, team: 'Liverpool', points: 48 },
    ],
  });
  await attachMatchInfo([m], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(m.headToHead.standings[0].isMatchTeam, true);
  assert.equal(m.headToHead.standings[1].isMatchTeam, false);
});
