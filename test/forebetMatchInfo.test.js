const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { parseH2H, parseForm } = require('../src/scrapers/tipsters/forebetMatchInfo');

// These fixtures encode this parser's own structural assumptions (see the
// UNVERIFIED note in forebetMatchInfo.js) — they prove the parsing logic
// itself is sound, not that it matches Forebet's real markup, which this
// environment has no network path to check.

test('parseH2H: reads scorelines out of rows following an "H2H" heading', () => {
  const html = `
    <div>
      <h3>H2H</h3>
      <table>
        <tr><td>12.03.2024</td><td>Team A</td><td>2 - 1</td><td>Team B</td></tr>
        <tr><td>01.11.2023</td><td>Team B</td><td>0 - 0</td><td>Team A</td></tr>
      </table>
      <p>unrelated 9 - 9 text elsewhere should not matter since it's not in the container</p>
    </div>`;
  const $ = cheerio.load(html);
  const h2h = parseH2H($);
  assert.equal(h2h.length, 2);
  assert.deepEqual(h2h[0], { raw: h2h[0].raw, homeGoals: 2, awayGoals: 1, date: '12.03.2024' });
  assert.deepEqual(h2h[1], { raw: h2h[1].raw, homeGoals: 0, awayGoals: 0, date: '01.11.2023' });
});

test('parseH2H: no H2H heading -> empty array, no throw', () => {
  const $ = cheerio.load('<div><p>nothing relevant here</p></div>');
  assert.deepEqual(parseH2H($), []);
});

test('parseForm: groups W/D/L badges by their parent widget, home first then away', () => {
  const html = `
    <div>
      <div class="homeForm">
        <span class="formBadge" title="Win">W</span>
        <span class="formBadge" title="Draw">D</span>
        <span class="formBadge" title="Loss">L</span>
      </div>
      <div class="awayForm">
        <span class="formBadge" title="Win">W</span>
        <span class="formBadge" title="Win">W</span>
      </div>
    </div>`;
  const $ = cheerio.load(html);
  assert.deepEqual(parseForm($, 'home'), ['W', 'D', 'L']);
  assert.deepEqual(parseForm($, 'away'), ['W', 'W']);
});

test('parseForm: no matching badges -> empty array', () => {
  const $ = cheerio.load('<div><p>no form widgets on this page</p></div>');
  assert.deepEqual(parseForm($, 'home'), []);
  assert.deepEqual(parseForm($, 'away'), []);
});
