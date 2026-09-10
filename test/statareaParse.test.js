const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDay } = require('../src/scrapers/tipsters/statarea');

function matchHtml({ home, away, vals, tip }) {
  const boxes = vals.map((v) => `<div class="coefbox"><div class="value">${v}</div></div>`).join('');
  const tipHtml = tip ? `<div class="tip"><div class="value"><span class="type1">${tip}</span></div></div>` : '';
  return `
    <div class="match" id="1">
      <div class="hostteam"><div class="name"><a>${home}</a></div></div>
      <div class="guestteam"><div class="name"><a>${away}</a></div></div>
      <div class="inforow"><div class="coefrow">${boxes}</div></div>
      ${tipHtml}
    </div>`;
}

test('statarea parseDay: reads the BTS box (index 9) into a yes/no bttsPick', () => {
  const html = matchHtml({
    home: 'Team A',
    away: 'Team B',
    vals: [40, 30, 30, 50, 30, 20, 80, 60, 40, 65, 35],
    tip: '1',
  });
  const [m] = parseDay(html);
  assert.equal(m.homeTeam, 'Team A');
  assert.equal(m.awayTeam, 'Team B');
  assert.equal(m.bttsPick, 'yes'); // BTS 65% > 50
  assert.equal(m.totalsPick.selection, 'over'); // O2.5 60% > 50
  assert.match(m.rawText, /BTS 65%/);
});

test('statarea parseDay: BTS <= 50 reads as a "no" bttsPick', () => {
  const html = matchHtml({
    home: 'Team A',
    away: 'Team B',
    vals: [40, 30, 30, 50, 30, 20, 80, 60, 40, 38, 62],
    tip: '1',
  });
  const [m] = parseDay(html);
  assert.equal(m.bttsPick, 'no');
});

test('statarea parseDay: no BTS box present leaves bttsPick null without disturbing 1X2/O-U parsing', () => {
  const html = matchHtml({
    home: 'Team A',
    away: 'Team B',
    vals: [40, 30, 30, 50, 30, 20, 80, 60], // only 8 values, no BTS/OTS boxes
    tip: '1',
  });
  const [m] = parseDay(html);
  assert.equal(m.bttsPick, null);
  assert.equal(m.pick, 'home');
  assert.equal(m.totalsPick.selection, 'over');
});
