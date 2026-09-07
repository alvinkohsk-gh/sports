const test = require('node:test');
const assert = require('node:assert/strict');
const { teamsMatch, normalizeTeamName } = require('../src/services/matcher');

// Names on the left are as Singapore Pools' fixture feed writes them; on
// the right as a tipster site (Forebet / PredictZ / WinDrawWin / Sports
// Mole / WhoScored) tends to. These are the pairings the old
// jaccard-only matcher dropped.
const SHOULD_MATCH = [
  ['Atl Tucuman', 'Atletico Tucuman'],
  ['Celta de Vigo', 'Celta Vigo'],
  ['Sociedad', 'Real Sociedad'],
  ['Vitoria (BRA)', 'Vitoria'],
  ['Al Hilal (KSA)', 'Al-Hilal'],
  ['Man Utd', 'Manchester United'],
  ['Real Madrid', 'Real Madrid CF'],
  ['Bayern Munich', 'Bayern Munchen'],
  ['PSG', 'Paris Saint Germain'],
  ['Barca', 'Barcelona'],
  ['Kalmar', 'Kalmar FF'],
  ['Djurgarden', 'Djurgardens IF'],
  ['Mjallby AIF', 'Mjallby'],
  ['IFK Gothenburg', 'Gothenburg'],
  ['AIK Stockholm', 'AIK'],
  ['Gladbach', 'Borussia Monchengladbach'],
  ['Udinese', 'Udinese Calcio'],
  ['Nantes', 'FC Nantes'],
  ['Elche', 'Elche CF'],
];

const SHOULD_NOT_MATCH = [
  ['Leeds United', 'Newcastle United'],
  ['Real Madrid', 'Real Sociedad'],
  ['Atletico Madrid', 'Atletico Tucuman'],
  ['San Lorenzo', 'Santos'],
  ['Al Hilal', 'Al Nassr'],
  ['Jong PSV', 'PSV'],
  ['Jong Utrecht', 'FC Utrecht'],
  ['Manchester United', 'Manchester City'],
  ['Sporting Gijon', 'Sporting CP'],
  ['Getafe', 'Elche'],
];

test('pairs that should match', () => {
  for (const [a, b] of SHOULD_MATCH) {
    assert.ok(teamsMatch(a, b), `${a} ~ ${b} (norm: ${normalizeTeamName(a)} / ${normalizeTeamName(b)})`);
    assert.ok(teamsMatch(b, a), `${b} ~ ${a} (symmetry)`);
  }
});

test('pairs that should not match', () => {
  for (const [a, b] of SHOULD_NOT_MATCH) {
    assert.ok(!teamsMatch(a, b), `${a} !~ ${b} (norm: ${normalizeTeamName(a)} / ${normalizeTeamName(b)})`);
    assert.ok(!teamsMatch(b, a), `${b} !~ ${a} (symmetry)`);
  }
});

test('identical names still match', () => {
  for (const n of ['Cagliari', 'Getafe', 'Lecce', 'Al Riyadh']) {
    assert.ok(teamsMatch(n, n));
  }
});
