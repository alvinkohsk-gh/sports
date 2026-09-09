const test = require('node:test');
const assert = require('node:assert/strict');
const { attachMatchInfo, findForebetUrl } = require('../src/results/matchInfo');

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

test('attachMatchInfo: skips a match that already kicked off', async () => {
  const m = match('Arsenal', 'Chelsea', YESTERDAY);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  let called = false;
  const fetchFn = async () => { called = true; return null; };
  await attachMatchInfo([m], rows, { entries: [] }, { nowMs: NOW, fetchFn });
  assert.equal(called, false);
});

test('attachMatchInfo: serves a fresh cache entry without re-fetching', async () => {
  const m = match('Arsenal', 'Chelsea', IN_2_DAYS);
  const rows = [forebetRow('Arsenal', 'Chelsea', 'https://forebet.example/arsenal-chelsea')];
  const prevCache = {
    entries: [
      {
        matchKey: 'arsenal|chelsea|' + IN_2_DAYS.slice(0, 10),
        fetchedAtISO: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h old, well under the 24h TTL
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
        info: { h2h: [], homeForm: ['D'], awayForm: ['D'] },
      },
    ],
  };
  const fetchFn = async () => null; // e.g. page structure changed, nothing parsed
  await attachMatchInfo([m], rows, prevCache, { nowMs: NOW, fetchFn });
  assert.equal(m.headToHead.homeForm[0], 'D');
});
