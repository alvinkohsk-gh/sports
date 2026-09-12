const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScore, projectStandings } = require('../public/live-standings-calc');

function row(overrides) {
  return {
    position: 1, team: 'X', points: 0, played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, goalDiff: 0, isMatchTeam: false, side: null,
    ...overrides,
  };
}

test('parseScore: reads "H-A" into home/away goal counts', () => {
  assert.deepEqual(parseScore('2-1'), { homeGoals: 2, awayGoals: 1 });
  assert.deepEqual(parseScore('0-0'), { homeGoals: 0, awayGoals: 0 });
});

test('parseScore: null for anything unparseable', () => {
  assert.equal(parseScore(null), null);
  assert.equal(parseScore(undefined), null);
  assert.equal(parseScore('TBD'), null);
  assert.equal(parseScore(''), null);
});

test('projectStandings: adds the current score onto the home/away rows as if it were final, then re-sorts', () => {
  const standings = [
    row({ position: 1, team: 'Leader', points: 45, played: 20, won: 14, drawn: 3, lost: 3, goalsFor: 40, goalsAgainst: 15, goalDiff: 25 }),
    row({ position: 2, team: 'Home Club', points: 44, played: 20, won: 13, drawn: 5, lost: 2, goalsFor: 35, goalsAgainst: 18, goalDiff: 17, isMatchTeam: true, side: 'home' }),
    row({ position: 3, team: 'Away Club', points: 40, played: 20, won: 12, drawn: 4, lost: 4, goalsFor: 30, goalsAgainst: 20, goalDiff: 10, isMatchTeam: true, side: 'away' }),
  ];
  const projected = projectStandings(standings, '3-0');
  const byTeam = Object.fromEntries(projected.map((r) => [r.team, r]));

  assert.equal(byTeam['Home Club'].points, 47);
  assert.equal(byTeam['Home Club'].played, 21);
  assert.equal(byTeam['Home Club'].won, 14);
  assert.equal(byTeam['Home Club'].goalsFor, 38);
  assert.equal(byTeam['Home Club'].goalsAgainst, 18);
  assert.equal(byTeam['Home Club'].goalDiff, 20);

  assert.equal(byTeam['Away Club'].points, 40); // unbeaten losing side gains nothing
  assert.equal(byTeam['Away Club'].played, 21);
  assert.equal(byTeam['Away Club'].lost, 5);
  assert.equal(byTeam['Away Club'].goalsAgainst, 23);

  assert.equal(byTeam['Leader'].points, 45); // untouched, third team not in this fixture
  // Home Club's projected 47 points overtakes Leader's untouched 45 — the
  // re-sort (not just the row math) has to actually run for this to show.
  assert.deepEqual(projected.map((r) => r.team), ['Home Club', 'Leader', 'Away Club']);
  assert.deepEqual(projected.map((r) => r.position), [1, 2, 3]);
});

test('projectStandings: a draw awards both sides a point and no result letter tilts either way', () => {
  const standings = [
    row({ team: 'Home Club', points: 10, played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 10, goalsAgainst: 5, goalDiff: 5, side: 'home' }),
    row({ team: 'Away Club', points: 8, played: 5, won: 2, drawn: 2, lost: 1, goalsFor: 8, goalsAgainst: 6, goalDiff: 2, side: 'away' }),
  ];
  const projected = projectStandings(standings, '1-1');
  const byTeam = Object.fromEntries(projected.map((r) => [r.team, r]));
  assert.equal(byTeam['Home Club'].points, 11);
  assert.equal(byTeam['Home Club'].drawn, 2);
  assert.equal(byTeam['Away Club'].points, 9);
  assert.equal(byTeam['Away Club'].drawn, 3);
});

test('projectStandings: returns the table unchanged when the score cannot be parsed', () => {
  const standings = [row({ team: 'Home Club', side: 'home' }), row({ team: 'Away Club', side: 'away' })];
  assert.equal(projectStandings(standings, 'TBD'), standings);
  assert.equal(projectStandings(standings, null), standings);
});

test('projectStandings: returns the table unchanged when it has no home/away rows to project onto', () => {
  const standings = [row({ team: 'Someone Else' })];
  assert.equal(projectStandings(standings, '2-1'), standings);
});

test('projectStandings: an empty/missing table stays as-is', () => {
  assert.deepEqual(projectStandings([], '2-1'), []);
  assert.equal(projectStandings(null, '2-1'), null);
});
