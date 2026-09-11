const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDay } = require('../src/scrapers/tipsters/vitibet');

function card({ href = 'index.php?clanek=match-detail&fixture_id=1&league_id=2', home, away, score, badge }) {
  return `
    <a href="${href}" class="viti-v6-card">
      <div class="viti-v6-m-time">18:45</div>
      <div class="viti-v6-team-side viti-v6-team-home">${home}</div>
      <div class="viti-v6-center"><span class="viti-v6-m-score">${score}</span></div>
      <div class="viti-v6-team-side viti-v6-team-away">${away}</div>
      <div class="viti-v6-tip-box"><span class="viti-v6-badge viti-v6-bg-${badge}">${badge}</span></div>
    </a>`;
}

test('vitibet parseDay: a "1" badge reads as a straight home pick', () => {
  const html = card({ home: 'Fenerbahce', away: 'AS Roma', score: '2 : 0', badge: '1' });
  const [t] = parseDay(html);
  assert.equal(t.site, 'vitibet');
  assert.equal(t.homeTeam, 'Fenerbahce');
  assert.equal(t.awayTeam, 'AS Roma');
  assert.equal(t.pick, 'home');
});

test('vitibet parseDay: a "2" badge reads as a straight away pick', () => {
  const html = card({ home: 'PSV', away: 'Shakhtar Donetsk', score: '1 : 2', badge: '2' });
  const [t] = parseDay(html);
  assert.equal(t.pick, 'away');
});

test('vitibet parseDay: a two-digit double-chance badge ("10"/"02") is left unclassified, not guessed', () => {
  const html = card({ home: 'Como', away: 'RB Leipzig', score: '1 : 1', badge: '10' });
  const [t] = parseDay(html);
  assert.equal(t.pick, null);
});

test('vitibet parseDay: totalsPick is derived from the predicted correct score against the 2.5 line', () => {
  const over = parseDay(card({ home: 'A', away: 'B', score: '2 : 1', badge: '1' }))[0];
  assert.deepEqual(over.totalsPick, { selection: 'over', point: 2.5, total: 3 });

  const under = parseDay(card({ home: 'A', away: 'B', score: '1 : 0', badge: '1' }))[0];
  assert.deepEqual(under.totalsPick, { selection: 'under', point: 2.5, total: 1 });
});

test('vitibet parseDay: bttsPick is derived from the predicted correct score (both sides score > 0)', () => {
  const yes = parseDay(card({ home: 'A', away: 'B', score: '2 : 1', badge: '1' }))[0];
  assert.equal(yes.bttsPick, 'yes');

  const no = parseDay(card({ home: 'A', away: 'B', score: '2 : 0', badge: '1' }))[0];
  assert.equal(no.bttsPick, 'no');
});

test('vitibet parseDay: sourceUrl resolves the relative match-detail href against the site root', () => {
  const html = card({ home: 'A', away: 'B', score: '1 : 0', badge: '1', href: 'index.php?clanek=match-detail&fixture_id=42&league_id=9' });
  const [t] = parseDay(html);
  assert.equal(t.sourceUrl, 'https://www.vitibet.com/index.php?clanek=match-detail&fixture_id=42&league_id=9');
});

test('vitibet parseDay: parses multiple cards on one page', () => {
  const html = [
    card({ home: 'Team A', away: 'Team B', score: '1 : 0', badge: '1' }),
    card({ home: 'Team C', away: 'Team D', score: '0 : 2', badge: '2' }),
  ].join('\n');
  const tips = parseDay(html);
  assert.equal(tips.length, 2);
  assert.deepEqual(tips.map((t) => t.homeTeam), ['Team A', 'Team C']);
});

test('vitibet parseDay: skips a card with no score (badge without a parseable scoreline)', () => {
  const html = card({ home: 'A', away: 'B', score: 'TBD', badge: '1' });
  const [t] = parseDay(html);
  assert.equal(t.totalsPick, null);
  assert.equal(t.bttsPick, null);
  assert.equal(t.pick, 'home'); // pick still comes from the badge, independent of the score
});
