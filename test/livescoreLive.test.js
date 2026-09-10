const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLivescoreRows } = require('../src/results/livescoreLive');

// These fixtures encode this parser's own structural assumptions (see the
// UNVERIFIED note in livescoreLive.js) — they prove the parsing logic
// itself is sound, not that it matches livescore.com's real markup, which
// this environment has no network path to check.

test('parseLivescoreRows: reads a "Home vs Away N - N" row', () => {
  const html = '<div class="row"><span>Arsenal vs Chelsea 2 - 1</span></div>';
  const rows = parseLivescoreRows(html);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { homeTeam: 'Arsenal', awayTeam: 'Chelsea', homeGoals: 2, awayGoals: 1, league: null });
});

test('parseLivescoreRows: also accepts "v" and "-" as the divider', () => {
  const html = `
    <div><span>Liverpool v Everton 1 - 1</span></div>
    <div><span>Real Madrid - Barcelona 0 - 3</span></div>`;
  const rows = parseLivescoreRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].homeTeam, 'Liverpool');
  assert.equal(rows[1].awayTeam, 'Barcelona');
});

test('parseLivescoreRows: skips a large ancestor container even if it also matches', () => {
  const html = `
    <div id="list">
      <div>Arsenal vs Chelsea 2 - 1</div>
      <div>Liverpool vs Everton 1 - 1</div>
    </div>`;
  const rows = parseLivescoreRows(html);
  // Only the two leaf rows, not the wrapping #list (which has <=8
  // children but whose own text is both rows concatenated with no
  // trailing-name-only tail).
  assert.equal(rows.length, 2);
});

test('parseLivescoreRows: ignores rows with a trailing sentence after the score (promo/odds noise)', () => {
  const html = '<div>Arsenal vs Chelsea 2 - 1 watch highlights now on our app</div>';
  assert.deepEqual(parseLivescoreRows(html), []);
});

test('parseLivescoreRows: no scoreline anywhere -> empty, no throw', () => {
  assert.deepEqual(parseLivescoreRows('<div>Nothing relevant here</div>'), []);
});

test('parseLivescoreRows: dedupes an identical row seen twice', () => {
  const html = `
    <div>Arsenal vs Chelsea 2 - 1</div>
    <div>Arsenal vs Chelsea 2 - 1</div>`;
  assert.equal(parseLivescoreRows(html).length, 1);
});
