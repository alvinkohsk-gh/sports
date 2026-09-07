const test = require('node:test');
const assert = require('node:assert/strict');
const { inferPickFromProse } = require('../src/scrapers/tipsters/whoscored');

// (contextText, homeTeam, awayTeam, expectedPick)
const CASES = [
  // scoreline still wins outright
  ['Cagliari vs Lecce: we predict a 2-1 home win', 'Cagliari', 'Lecce', 'home'],
  ['Nantes vs Nancy: our man tips a 2-2 draw', 'Nantes', 'AS Nancy', 'draw'],
  // draw phrasing without a scoreline
  ['Bromley vs AFC Wimbledon - honours even looks likely', 'Bromley', 'AFC Wimbledon', 'draw'],
  // "<team> to <win-verb>" — the case the old parser returned null for
  ['Preview: Getafe vs Celta Vigo - our reporter expects Getafe to edge past Celta', 'Getafe', 'Celta Vigo', 'home'],
  ['Elche vs Real Sociedad: Real Sociedad to see off Elche', 'Elche', 'Real Sociedad', 'away'],
  ['Barracas Central vs Argentinos Jrs: backing Barracas Central to claim all three points', 'Barracas Central', 'Argentinos Jrs', 'home'],
  // "<win-noun> for <team>"
  ['Al Hilal vs Neom: a comfortable win for Al Hilal is predicted', 'Al Hilal', 'Neom Sports', 'home'],
  ['Sabadell vs Cordoba: the verdict is a win for Cordoba', 'Sabadell', 'Cordoba', 'away'],
  // "too strong for <team>" => that team loses
  ['Udinese vs Lazio: expect Lazio to be too strong for Udinese here', 'Udinese', 'Lazio', 'away'],
  // "<team> to lose"
  ['Malmo vs AIK Stockholm: Malmo to lose this one', 'Malmo', 'AIK Stockholm', 'away'],
  // nothing to go on => null (not a guess)
  ['Palermo vs Sampdoria preview and team news', 'Palermo', 'Sampdoria', null],
  ['5.30pm Cagliari vs. Lecce', 'Cagliari', 'Lecce', null],
];

test('inferPickFromProse', () => {
  for (const [textInput, home, away, expected] of CASES) {
    assert.equal(inferPickFromProse(textInput, home, away), expected, textInput);
  }
});
