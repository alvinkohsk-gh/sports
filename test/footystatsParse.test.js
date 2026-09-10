const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFootyStats } = require('../src/scrapers/tipsters/footystats');

function betWrapper(market, fixture) {
  return `
    <div class="betWrapper">
      <div class="betHeader"><span class="market">${market}</span></div>
      <div class="betData hidden"><span class="data">${fixture}</span></div>
    </div>`;
}

test('footystats parseFootyStats: "BTTS Yes" market reads as a bttsPick of yes', () => {
  const fixture = 'Palestino vs Univ. Concepcion';
  const html = betWrapper(`BTTS Yes ${fixture}`, fixture);
  const [t] = parseFootyStats(html);
  assert.equal(t.homeTeam, 'Palestino');
  assert.equal(t.awayTeam, 'Univ. Concepcion');
  assert.equal(t.bttsPick, 'yes');
  assert.equal(t.pick, null);
  assert.equal(t.totalsPick, null);
});

test('footystats parseFootyStats: "BTTS No" market reads as a bttsPick of no', () => {
  const fixture = 'Palestino vs Univ. Concepcion';
  const html = betWrapper(`BTTS No ${fixture}`, fixture);
  const [t] = parseFootyStats(html);
  assert.equal(t.bttsPick, 'no');
});

test('footystats parseFootyStats: a 1X2 market block still has no bttsPick', () => {
  const fixture = 'Palestino vs Univ. Concepcion';
  const html = betWrapper(`Home Win ${fixture}`, fixture);
  const [t] = parseFootyStats(html);
  assert.equal(t.pick, 'home');
  assert.equal(t.bttsPick, null);
});

test('footystats parseFootyStats: a clean-sheet/correct-score block with none of the three is skipped', () => {
  const fixture = 'Palestino vs Univ. Concepcion';
  const html = betWrapper(`Correct Score 2-1 ${fixture}`, fixture);
  const tips = parseFootyStats(html);
  assert.equal(tips.length, 0);
});
