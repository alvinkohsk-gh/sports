const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { parseH2H, parseForm, parseTeamFixtures, parseStandings, parseOverallStats } = require('../src/scrapers/tipsters/forebetMatchInfo');

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
    { homeGoals: sections[0][0].homeGoals, awayGoals: sections[0][0].awayGoals, date: sections[0][0].date, opponent: sections[0][0].opponent, result: sections[0][0].result, venue: sections[0][0].venue },
    { homeGoals: 2, awayGoals: 3, date: '09/06/2026', opponent: 'Internacional', result: 'W', venue: 'A' } // Santos (.active-team, away side) scored 3, conceded 2
  );
  assert.equal(sections[1].length, 1);
  assert.deepEqual(
    { homeGoals: sections[1][0].homeGoals, awayGoals: sections[1][0].awayGoals, date: sections[1][0].date, opponent: sections[1][0].opponent, result: sections[1][0].result, venue: sections[1][0].venue },
    { homeGoals: 2, awayGoals: 0, date: '09/05/2026', opponent: 'Sao Paulo', result: 'L', venue: 'A' } // Atletico (.active-team, away side) scored 0, conceded 2
  );
});

test('parseTeamFixtures: venue is "H" when the subject team is marked .active-team on the home side', () => {
  const html = `
    <div class="mptlt with_logo">
      <div class="st_logo_box"><div>STS</div></div>
      <div>Last 6 matches</div>
    </div>
    <div class="st_scrblock"><div class="st_rmain">
      <div class="st_row st_0">
        <div class="st_date"><div>09/06</div><div>2026</div></div>
        <div class="st_hteam active-team"><a href="/en/teams/santos-sp">Santos</a></div>
        <a href="/x" class="stat_link"><div class="st_rescnt">
          <span class="st_res lscrsp">1 - 0</span></a>
        </div>
        <div class="st_ateam"><a href="/en/teams/internacional">Internacional</a></div>
      </div>
    </div></div>`;
  const $ = cheerio.load(html);
  const sections = parseTeamFixtures($);
  assert.equal(sections[0][0].venue, 'H');
  assert.equal(sections[0][0].result, 'W'); // Santos (home) scored 1, conceded 0
});

test('parseTeamFixtures: result is null when neither side is marked .active-team', () => {
  const html = `
    <div>
      <div class="mptlt with_logo">
        <div class="st_logo_box"><div>STS</div></div>
        <div>Last 6 matches</div>
      </div>
      <div class="st_scrblock"><div class="st_rmain">
        <div class="st_row st_0">
          <div class="st_date"><div>09/06</div><div>2026</div></div>
          <div class="st_hteam"><a>Internacional</a></div>
          <a href="/x" class="stat_link"><div class="st_rescnt"><span class="st_res lscrsp">2 - 3</span></a></div>
          <div class="st_ateam"><a>Santos</a></div>
        </div>
      </div></div>
    </div>`;
  const $ = cheerio.load(html);
  const sections = parseTeamFixtures($);
  assert.equal(sections[0][0].result, null);
  assert.equal(sections[0][0].venue, null);
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
  assert.deepEqual(h2h[0], { raw: h2h[0].raw, homeGoals: 2, awayGoals: 1, date: '12.03.2024', homeTeamName: null, awayTeamName: null });
  assert.deepEqual(h2h[1], { raw: h2h[1].raw, homeGoals: 0, awayGoals: 0, date: '01.11.2023', homeTeamName: null, awayTeamName: null });
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

// Real markup shape verified 2026-09-12 against a fresh Forebet match-page
// capture (debug-tipsters/forebet-match.html, pulled via the debug-capture
// branch): the "Standings of both teams" panel duplicates the same table
// twice — a short `#short_standings` preview (only the fixture teams'
// neighbors) and the full `#stand_hidden` one (every club) — parseStandings
// must read only the full one, or a team near the two fixture teams in the
// table would look like the entire league.
const STANDINGS_HTML = `
  <div id="short_standings">
    <table id="standings" class="standings">
      <tr class="hdn2"><td colspan="2">x</td></tr>
      <tr class="color0">
        <td class="std_pos"><div class="standing-first-td-"><span>4</span></div></td>
        <td class="standing-second-td"><a href="/t/x">Neighbor Only FC</a></td>
        <td align="center"><b>99</b></td><td align="center">1</td><td align="center">1</td>
        <td align="center">0</td><td align="center">0</td><td align="center">9</td>
        <td align="center">0</td><td align="center">9</td>
      </tr>
    </table>
  </div>
  <div id="stand_hidden">
    <table width="100%" class="standings" id="standings">
      <thead><tr class="standings_meta_data"><td colspan="2">Regular Season</td></tr></thead>
      <tr class="hdn2 std_btn-heading">
        <td colspan="2"><b>REGULAR SEASON</b></td>
        <td><span>PTS</span></td><td><span>GP</span></td><td><span>W</span></td>
        <td><span>D</span></td><td><span>L</span></td><td><span>GF</span></td>
        <td><span>GA</span></td><td><span>+/-</span></td>
      </tr>
      <tr class="color0">
        <td class="std_pos"><div class="standing-first-td-"><span>1</span></div></td>
        <td class="standing-second-td"><a href="/en/teams/omiya-ardija">Omiya Ardija</a></td>
        <td align="center"><b>11</b></td><td align="center">5</td><td align="center">3</td>
        <td align="center">2</td><td align="center">0</td><td align="center">10</td>
        <td align="center">5</td><td align="center">5</td>
      </tr>
      <tr class="color1">
        <td class="std_pos"><div class="standing-first-td-4"><span class="std_zn">18</span></div></td>
        <td class="standing-second-td"><a href="/en/teams/iwaki-fc">Iwaki FC</a></td>
        <td align="center"><b>3</b></td><td align="center">5</td><td align="center">1</td>
        <td align="center">0</td><td align="center">4</td><td align="center">6</td>
        <td align="center">12</td><td align="center">-6</td>
      </tr>
    </table>
  </div>`;

test('parseStandings: reads the full #stand_hidden table, ignoring the #short_standings preview', () => {
  const $ = cheerio.load(STANDINGS_HTML);
  const rows = parseStandings($);
  assert.deepEqual(rows, [
    { position: 1, team: 'Omiya Ardija', points: 11, played: 5, won: 3, drawn: 2, lost: 0, goalsFor: 10, goalsAgainst: 5, goalDiff: 5 },
    { position: 18, team: 'Iwaki FC', points: 3, played: 5, won: 1, drawn: 0, lost: 4, goalsFor: 6, goalsAgainst: 12, goalDiff: -6 },
  ]);
  assert.ok(!rows.some((r) => r.team === 'Neighbor Only FC'));
});

test('parseStandings: no standings panel -> empty array, no throw', () => {
  const $ = cheerio.load('<div><p>nothing relevant here</p></div>');
  assert.deepEqual(parseStandings($), []);
});

// The "Overall statistics" widget's bar chart only renders relative
// bar-height percentages in the DOM (scaled to a shared axis max, not to
// games played), so the real counts are read out of the `get_ovd(type)`
// JS function Forebet embeds on the page instead — this fixture keeps the
// function's real (minified) shape from a genuine capture
// (2026-09-12), trimmed to just the fields parseOverallStats reads, to
// prove the brace-balanced extraction handles real nesting/whitespace
// rather than a hand-shaped string that happens to regex-match.
const OVERALL_STATS_SCRIPT_HTML = `<script>
function get_ovd(type){
	if(type=="h"){
		return {"all":{"ft":{"scr":[5,2,3],"cnd":[15,6,9],"pl":[6,2,4],"scr_min_0_15":[1,1,0],"scr_min_15_30":[1,0,1],"scr_min_30_45":[0,0,0],"scr_min_45_60":[1,0,1],"scr_min_60_75":[2,1,1],"scr_min_75_90":[0,0,0],"cnd_min_0_15":[1,1,0],"cnd_min_15_30":[3,1,2],"cnd_min_30_45":[0,0,0],"cnd_min_45_60":[4,1,3],"cnd_min_60_75":[0,0,0],"cnd_min_75_90":[7,3,4]},"ht1":{"scr":[2,1,1],"cnd":[4,2,2],"pl":[6,2,4]},"ht2":{"scr":[3,1,2],"cnd":[11,4,7],"pl":[6,2,4]}}};
	}else{
    	return {"all":{"ft":{"scr":[9,5,4],"cnd":[6,3,3],"pl":[6,3,3],"scr_min_0_15":[2,1,1],"scr_min_15_30":[0,0,0],"scr_min_30_45":[2,1,1],"scr_min_45_60":[1,1,0],"scr_min_60_75":[2,1,1],"scr_min_75_90":[1,0,1],"cnd_min_0_15":[1,0,1],"cnd_min_15_30":[0,0,0],"cnd_min_30_45":[0,0,0],"cnd_min_45_60":[3,2,1],"cnd_min_60_75":[0,0,0],"cnd_min_75_90":[2,1,1]},"ht1":{"scr":[4,2,2],"cnd":[2,0,2],"pl":[6,3,3]},"ht2":{"scr":[5,3,2],"cnd":[4,3,1],"pl":[6,3,3]}}};
    }
}
</script>`;

test('parseOverallStats: reads goals/half-splits/goal-timing out of the real get_ovd(type) script shape', () => {
  const $ = cheerio.load(OVERALL_STATS_SCRIPT_HTML);
  const stats = parseOverallStats($);
  assert.deepEqual(stats, {
    home: {
      played: 6,
      goalsScored: { fullTime: 5, firstHalf: 2, secondHalf: 3 },
      goalsConceded: { fullTime: 15, firstHalf: 4, secondHalf: 11 },
      goalTiming: { scored: [1, 1, 0, 1, 2, 0], conceded: [1, 3, 0, 4, 0, 7] },
    },
    away: {
      played: 6,
      goalsScored: { fullTime: 9, firstHalf: 4, secondHalf: 5 },
      goalsConceded: { fullTime: 6, firstHalf: 2, secondHalf: 4 },
      goalTiming: { scored: [2, 0, 2, 1, 2, 1], conceded: [1, 0, 0, 3, 0, 2] },
    },
  });
});

test('parseOverallStats: no get_ovd script -> null, no throw', () => {
  const $ = cheerio.load('<div><p>nothing relevant here</p></div>');
  assert.equal(parseOverallStats($), null);
});
