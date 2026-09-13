const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScore, settleBet, findScore, normTeam, splitFixture } = require('../public/bankroll-settle');

test('parseScore: reads a plain "H-A" final score', () => {
  assert.deepEqual(parseScore('2-1'), { homeGoals: 2, awayGoals: 1 });
  assert.deepEqual(parseScore('0-0'), { homeGoals: 0, awayGoals: 0 });
});
test('parseScore: anything else (null, postponed, malformed) -> null', () => {
  assert.equal(parseScore(null), null);
  assert.equal(parseScore('postponed'), null);
  assert.equal(parseScore(''), null);
});

const score = (h, a) => ({ homeGoals: h, awayGoals: a });

// ---- 1X2 ----
test('settleBet: 1X2 — home win, home pick', () => {
  assert.equal(settleBet({ market: '1X2', pick: 'Home' }, score(2, 1)), 'won');
});
test('settleBet: 1X2 — draw, away pick loses', () => {
  assert.equal(settleBet({ market: '1X2', pick: 'Away' }, score(1, 1)), 'lost');
});
test('settleBet: "1X2 (live)" market settles the same as plain 1X2', () => {
  assert.equal(settleBet({ market: '1X2 (live)', pick: 'Draw' }, score(1, 1)), 'won');
});

// ---- O/U ----
test('settleBet: O/U — total over the line wins an Over pick', () => {
  assert.equal(settleBet({ market: 'O/U 2.5', pick: 'Over 2.5' }, score(2, 1)), 'won');
});
test('settleBet: O/U — total under the line loses an Over pick', () => {
  assert.equal(settleBet({ market: 'O/U 2.5', pick: 'Over 2.5' }, score(1, 0)), 'lost');
});
test('settleBet: O/U — Under pick on a low-scoring game wins', () => {
  assert.equal(settleBet({ market: 'O/U 3.5', pick: 'Under 3.5' }, score(1, 1)), 'won');
});

// ---- Asian Handicap (2-way, whole/half/quarter) ----
test('settleBet: Asian Handicap — whole line push settles as void', () => {
  assert.equal(settleBet({ market: 'Asian Handicap -1', pick: 'Home -1' }, score(2, 1)), 'void');
});
test('settleBet: Asian Handicap — favorite covers a whole line', () => {
  assert.equal(settleBet({ market: 'Asian Handicap -1', pick: 'Home -1' }, score(3, 1)), 'won');
});
test('settleBet: Asian Handicap — half line never pushes', () => {
  assert.equal(settleBet({ market: 'Asian Handicap -0.5', pick: 'Home -0.5' }, score(1, 1)), 'lost');
});
test('settleBet: Asian Handicap — away side is the mirror of the home line', () => {
  assert.equal(settleBet({ market: 'Asian Handicap -0.5', pick: 'Away +0.5' }, score(1, 1)), 'won');
});
test('settleBet: Asian Handicap — a quarter line landing on a half-win/half-loss is left unresolved (null)', () => {
  // -0.75 with a 1-goal win splits into -0.5 (win) and -1.0 (push) -> half-win, not representable
  assert.equal(settleBet({ market: 'Asian Handicap -0.75', pick: 'Home -0.75' }, score(2, 1)), null);
});
test('settleBet: Asian Handicap — a quarter line that resolves cleanly (full win) still auto-settles', () => {
  // -0.75 with a 2-goal win: -0.5 (win) and -1.0 (win) -> full win
  assert.equal(settleBet({ market: 'Asian Handicap -0.75', pick: 'Home -0.75' }, score(3, 1)), 'won');
});

// ---- 1/2 Goal (same engine as AH) ----
test('settleBet: "1/2 Goal" settles like Asian Handicap', () => {
  // market's home line is +1.5 (the away side's own line is its negation, -1.5)
  assert.equal(settleBet({ market: '1/2 Goal +1.5', pick: 'Home +1.5' }, score(2, 0)), 'won');
  assert.equal(settleBet({ market: '1/2 Goal +1.5', pick: 'Away -1.5' }, score(2, 0)), 'lost');
});

// ---- Handicap 1X2 (3-way, never a push) ----
test('settleBet: Handicap 1X2 — adjusted score picks the actual side', () => {
  // home +2, real score 1-2 -> adjusted 3-2 -> home
  assert.equal(settleBet({ market: 'Handicap 1X2 +2', pick: 'Home +2' }, score(1, 2)), 'won');
  assert.equal(settleBet({ market: 'Handicap 1X2 +2', pick: 'Away -2' }, score(1, 2)), 'lost');
});
test('settleBet: Handicap 1X2 — adjusted score ties -> draw pick wins', () => {
  // home -2, real score 3-1 -> adjusted 1-1 -> draw
  assert.equal(settleBet({ market: 'Handicap 1X2 -2', pick: 'Draw -2' }, score(3, 1)), 'won');
});

// ---- Odd/Even ----
test('settleBet: Odd/Even reads total goals parity', () => {
  assert.equal(settleBet({ market: 'Odd/Even', pick: 'Odd' }, score(2, 1)), 'won');
  assert.equal(settleBet({ market: 'Odd/Even', pick: 'Even' }, score(2, 1)), 'lost');
});

// ---- Both Teams to Score ----
test('settleBet: Both Teams to Score', () => {
  assert.equal(settleBet({ market: 'Both Teams to Score', pick: 'Yes' }, score(1, 1)), 'won');
  assert.equal(settleBet({ market: 'Both Teams to Score', pick: 'Yes' }, score(2, 0)), 'lost');
  assert.equal(settleBet({ market: 'Both Teams to Score', pick: 'No' }, score(2, 0)), 'won');
});

// ---- unsettleable markets / unrecognized text ----
test('settleBet: "1st Goal" and Halftime markets have no data to settle against -> null', () => {
  assert.equal(settleBet({ market: '1st Goal', pick: 'Home' }, score(1, 0)), null);
  assert.equal(settleBet({ market: 'Halftime 1X2', pick: 'Home' }, score(1, 0)), null);
});
test('settleBet: unrecognized/hand-typed market or pick text -> null, never guessed', () => {
  assert.equal(settleBet({ market: 'Correct Score', pick: '2-1' }, score(2, 1)), null);
  assert.equal(settleBet({ market: '1X2', pick: 'Man Utd' }, score(2, 1)), null);
});
test('settleBet: missing bet/score inputs -> null', () => {
  assert.equal(settleBet(null, score(1, 0)), null);
  assert.equal(settleBet({ market: '1X2', pick: 'Home' }, null), null);
  assert.equal(settleBet({ market: '1X2', pick: 'Home' }, score(NaN, 0)), null);
});

// ---- fixture matching ----
test('splitFixture: splits on "vs", "v", or a bare hyphen, normalizing team names', () => {
  assert.deepEqual(splitFixture('Man Utd vs Arsenal'), { home: 'man utd', away: 'arsenal' });
  assert.deepEqual(splitFixture('Man Utd v Arsenal'), { home: 'man utd', away: 'arsenal' });
  assert.deepEqual(splitFixture('Man Utd - Arsenal'), { home: 'man utd', away: 'arsenal' });
});
test('normTeam: case/punctuation-insensitive', () => {
  assert.equal(normTeam('Sports Mole F.C.'), normTeam('sports mole f c'));
  assert.equal(normTeam('Man Utd'), normTeam('MAN UTD'));
});

test('findScore: a bet with a matchKey looks itself up directly', () => {
  const index = {
    byMatchKey: new Map([['k1', { matchKey: 'k1', fixture: 'A vs B', kickoffISO: '2026-01-01T00:00:00Z', score: '2-1' }]]),
    all: [],
  };
  assert.deepEqual(findScore({ matchKey: 'k1', fixture: 'A vs B', date: '2026-01-01' }, index), { homeGoals: 2, awayGoals: 1 });
});
test('findScore: falls back to fixture text + nearby date when there is no matchKey', () => {
  const index = {
    byMatchKey: new Map(),
    all: [{ matchKey: 'k1', fixture: 'Man Utd vs Arsenal', kickoffISO: '2026-01-10T15:00:00Z', score: '3-1' }],
  };
  assert.deepEqual(findScore({ fixture: 'Man Utd v Arsenal', date: '2026-01-10' }, index), { homeGoals: 3, awayGoals: 1 });
});
test('findScore: no confident match (wrong teams, or date too far off) -> null', () => {
  const index = {
    byMatchKey: new Map(),
    all: [{ matchKey: 'k1', fixture: 'Man Utd vs Arsenal', kickoffISO: '2026-01-10T15:00:00Z', score: '3-1' }],
  };
  assert.equal(findScore({ fixture: 'Chelsea v Liverpool', date: '2026-01-10' }, index), null);
  assert.equal(findScore({ fixture: 'Man Utd v Arsenal', date: '2026-03-01' }, index), null);
});
