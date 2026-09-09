const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { parseH2H, parseForm, parseTeamFixtures } = require('../src/scrapers/tipsters/forebetMatchInfo');

// The "verified markup" tests below use a trimmed-down fixture built from
// a real Forebet match-page capture (debug-tipsters/forebet-match.html,
// pulled 2026-09-09 via the debug-capture branch — see forebetMatchInfo.js's
// header comment) — they prove the primary selectors match production
// markup, not just a plausible guess. The plain `<table>`/`<h3>`-based
// fixtures further down exercise the fallback paths kept for resilience
// against a future layout change; they don't claim to represent real
// Forebet markup on their own.

test('parseH2H: reads real Forebet .st_row markup under a "Head to head" .mptlt panel', () => {
  const html = `
    <div class="moduletable">
      <div class="mptlt">Head to head</div>
      <div class="st_scrblock"><div class="st_rmain">
        <div class="st_row st_0">
          <div class="st_date"><div>04/12</div><div>2026</div></div>
          <div class="st_hteam active-team"><a href="/en/teams/santos-sp">Santos</a></div>
          <a href="/en/football/matches/santos-atl-2417999" class="stat_link"><div class="st_rescnt">
            <span class="st_res lscrsp">1 - 0</span><span class="st_htscr">(0 - 0)</span></a>
          </div>
          <div class="st_ateam"><a href="/en/teams/atletico">Atletico</a></div>
        </div>
        <div class="st_row st_1">
          <div class="st_date"><div>09/14</div><div>2025</div></div>
          <div class="st_hteam"><a href="/en/teams/atletico">Atletico</a></div>
          <a href="/en/football/matches/atl-santos-2256351" class="stat_link"><div class="st_rescnt">
            <span class="st_res lscrsp">1 - 1</span><span class="st_htscr">(0 - 0)</span></a>
          </div>
          <div class="st_ateam active-team"><a href="/en/teams/santos-sp">Santos</a></div>
        </div>
      </div></div>
    </div>`;
  const $ = cheerio.load(html);
  const h2h = parseH2H($);
  assert.equal(h2h.length, 2);
  assert.deepEqual(
    { homeGoals: h2h[0].homeGoals, awayGoals: h2h[0].awayGoals, date: h2h[0].date },
    { homeGoals: 1, awayGoals: 0, date: '04/12/2026' }
  );
  assert.deepEqual(
    { homeGoals: h2h[1].homeGoals, awayGoals: h2h[1].awayGoals, date: h2h[1].date },
    { homeGoals: 1, awayGoals: 1, date: '09/14/2025' }
  );
});

test('parseForm: reads real Forebet .prformcont/.form_w|d|l markup, home widget first then away', () => {
  const html = `
    <div>
      <div class="lLogo">
        <div class="prformcont">
          <span class="form_w"><a>W</a></span>
          <span class="form_d"><a>D</a></span>
          <span class="form_l"><a>L</a></span>
        </div>
      </div>
      <div class="rLogo">
        <div class="prformcont">
          <span class="form_w"><a>W</a></span>
          <span class="form_w"><a>W</a></span>
        </div>
      </div>
    </div>`;
  const $ = cheerio.load(html);
  assert.deepEqual(parseForm($, 'home'), ['W', 'D', 'L']);
  assert.deepEqual(parseForm($, 'away'), ['W', 'W']);
});

test('parseTeamFixtures: reads real Forebet .mptlt "Last N matches" panels, using .st_hteam/.st_ateam for opponent', () => {
  const html = `
    <div>
      <div class="moduletable">
        <div class="mptlt with_logo">
          <div class="st_logo_box"><div>STS</div></div>
          <div>Last 6 matches</div>
        </div>
        <div class="st_scrblock"><div class="st_rmain">
          <div class="st_row st_0">
            <div class="st_date"><div>09/06</div><div>2026</div></div>
            <div class="st_hteam"><a href="/en/teams/internacional">Internacional</a></div>
            <a href="/x" class="stat_link"><div class="st_rescnt">
              <span class="st_res lscrsp">2 - 3</span></a>
            </div>
            <div class="st_ateam active-team"><a href="/en/teams/santos-sp">Santos</a></div>
          </div>
        </div></div>
      </div>
      <div class="moduletable">
        <div class="mptlt with_logo">
          <div class="st_logo_box"><div>ATM</div></div>
          <div>Last 6 matches</div>
        </div>
        <div class="st_scrblock"><div class="st_rmain">
          <div class="st_row st_0">
            <div class="st_date"><div>09/05</div><div>2026</div></div>
            <div class="st_hteam"><a href="/en/teams/sao-paulo">Sao Paulo</a></div>
            <a href="/x" class="stat_link"><div class="st_rescnt">
              <span class="st_res lscrsp">2 - 0</span></a>
            </div>
            <div class="st_ateam active-team"><a href="/en/teams/atletico">Atletico</a></div>
          </div>
        </div></div>
      </div>
    </div>`;
  const $ = cheerio.load(html);
  const sections = parseTeamFixtures($);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].length, 1);
  assert.deepEqual(
    { homeGoals: sections[0][0].homeGoals, awayGoals: sections[0][0].awayGoals, date: sections[0][0].date, opponent: sections[0][0].opponent },
    { homeGoals: 2, awayGoals: 3, date: '09/06/2026', opponent: 'Internacional' }
  );
  assert.equal(sections[1].length, 1);
  assert.deepEqual(
    { homeGoals: sections[1][0].homeGoals, awayGoals: sections[1][0].awayGoals, date: sections[1][0].date, opponent: sections[1][0].opponent },
    { homeGoals: 2, awayGoals: 0, date: '09/05/2026', opponent: 'Sao Paulo' }
  );
});

// These fixtures encode the fallback parsers' own structural assumptions
// (plain <table>/<h3> markup, generic form-badge scan) rather than real
// Forebet markup — they prove that logic is sound as a safety net if the
// primary `.st_row`/`.mptlt`/`.prformcont` selectors above stop matching.

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

test('parseTeamFixtures: reads two "Last matches" sections, home first then away', () => {
  const html = `
    <div>
      <h4>Last 6 matches Team A</h4>
      <table>
        <tr><td>10.02.2024</td><td>Team A</td><td>2 - 0</td><td>Rival X</td></tr>
        <tr><td>03.02.2024</td><td>Rival Y</td><td>1 - 1</td><td>Team A</td></tr>
      </table>
      <h4>Last 6 matches Team B</h4>
      <table>
        <tr><td>11.02.2024</td><td>Team B</td><td>0 - 3</td><td>Rival Z</td></tr>
      </table>
    </div>`;
  const $ = cheerio.load(html);
  const sections = parseTeamFixtures($);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].length, 2);
  assert.deepEqual(
    { homeGoals: sections[0][0].homeGoals, awayGoals: sections[0][0].awayGoals, date: sections[0][0].date },
    { homeGoals: 2, awayGoals: 0, date: '10.02.2024' }
  );
  assert.ok(sections[0][0].opponent.includes('Rival X'));
  assert.equal(sections[1].length, 1);
  assert.deepEqual(
    { homeGoals: sections[1][0].homeGoals, awayGoals: sections[1][0].awayGoals, date: sections[1][0].date },
    { homeGoals: 0, awayGoals: 3, date: '11.02.2024' }
  );
});

test('parseTeamFixtures: does not pick up the H2H section', () => {
  const html = `
    <div>
      <h3>H2H</h3>
      <table><tr><td>12.03.2024</td><td>2 - 1</td></tr></table>
    </div>`;
  const $ = cheerio.load(html);
  assert.deepEqual(parseTeamFixtures($), []);
});

test('parseTeamFixtures: no matching sections -> empty array, no throw', () => {
  const $ = cheerio.load('<div><p>nothing relevant here</p></div>');
  assert.deepEqual(parseTeamFixtures($), []);
});
