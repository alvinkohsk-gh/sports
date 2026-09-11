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
  ['NY City FC', 'New York City FC'],
  ['NE Revolution', 'New England Revolution'],
  ['NE Revolution', 'New Eng. Revolution'],
  ['NY Red Bulls', 'New York Red Bulls'],
  // SG Pools writes this Liga MX/Expansion MX club as "UNAM Mexico",
  // Flashscore as "UNAM Pumas" — production showed this pair failing to
  // match (in-play live score never got filled in from Flashscore).
  ['UNAM Mexico', 'UNAM Pumas'],
  // SG Pools writes this Brazilian club as "Atl Paranaense", Forebet as
  // "Atlético PR" — production showed this pair failing to match (no
  // Forebet H2H/form/recent-fixtures fetched for the fixture at all).
  ['Atl Paranaense', 'Atlético PR'],
  // Full board audit against a real production snapshot (2026-09-11)
  // turned up these further mismatches, all missing Forebet H2H data:
  ['Tochigi City', 'Tochigi Uva'], // club renamed; SG Pools uses the new name
  ['V Hachinohe', 'Vanraure Hachinohe'],
  ['Yokohama FM', 'Yokohama Marinos'],
  ['T Miyazaki', 'Tegevajaro Miyazaki'],
  ['Fujieda FC', 'Fujieda MYFC'],
  ['L City Sailors', 'Lion City'],
  ["Monchengladbach", "Borussia M'gladbach"], // apostrophe splits into "m gladbach"
  ['E Frankfurt', 'Eintracht Frankfurt'],
  ['MK Dons', 'Milton Keynes Dons'],
  ['Everton VDM', 'Everton de Vina'],
  ['Sporting KC', 'Sporting Kansas City'],
  ['LA Galaxy', 'Los Angeles Galaxy'],
  ['Seattle Sndrs', 'Seattle Sounders'],
  // "(B)" is a reserve-team marker, not a country/qualifier tag like
  // "(BRA)"/"(KSA)" above — normalize.js used to strip it the same way,
  // losing the marker entirely and breaking the youth-side guard below.
  ['Sociedad (B)', 'Real Sociedad B'],
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
  // Regression check for the "(B)" reserve-marker fix above: the main
  // team must still not match its own reserve side.
  ['Sociedad', 'Real Sociedad B'],
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
