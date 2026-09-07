const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');
const { inferTotalsPick } = require('./totalsHeuristics');
const { normalizeTeamName } = require('../../services/matcher');

// Named PAGE_URL, not URL — a module-level `const URL = '...'` would shadow
// the global URL constructor, breaking `new URL(href, ...)` below (this
// exact bug hit sportsmole.js's copy of this pattern in production:
// "URL is not a constructor").
const PAGE_URL = 'https://www.whoscored.com/previews';

// Unlike Forebet/PredictZ/WinDrawWin, WhoScored doesn't publish predictions
// as a structured table — its "previews" page is a list of prose preview
// articles per match ("Team A vs Team B Preview: ..."). There's no verified
// selector for this (no reference scraper found for it), so this is a
// best-effort generic extraction: find links whose text looks like
// "Team A vs Team B", and scan nearby teaser text for a plain scoreline
// (e.g. "2-1") or a "to win"/"draw" phrase to infer a pick. When neither is
// found, the tip is still returned with pick: null (still shown as a
// preview link) rather than dropped.
async function fetchWhoScoredTips() {
  const html = await fetchHtml('whoscored', PAGE_URL);
  const $ = cheerio.load(html);
  const tips = [];

  $('a').each((_, el) => {
    const link = $(el);
    const text = link.text().trim();
    const teamsMatch = text.match(/^([A-Za-z .'-]{3,40})\s+v[s]?\.?\s+([A-Za-z .'-]{3,40})/i);
    if (!teamsMatch) return;

    const contextText = link.closest('li, article, div').first().text().replace(/\s+/g, ' ').trim();
    const href = link.attr('href');

    tips.push({
      site: 'whoscored',
      homeTeam: teamsMatch[1].trim(),
      awayTeam: teamsMatch[2].trim(),
      pick: inferPickFromProse(contextText, teamsMatch[1].trim(), teamsMatch[2].trim()),
      totalsPick: inferTotalsPickFromProse(contextText),
      rawText: contextText.slice(0, 200),
      sourceUrl: href ? new URL(href, PAGE_URL).toString() : PAGE_URL,
    });
  });

  return dedupeByTeams(tips);
}

// Draw / stalemate phrasing seen in preview prose.
const DRAW_RE = /\b(?:to draw|honou?rs even|share the (?:spoils|points)|stalemate|all square|points? apiece|cancel each other out|nothing to separate|too close to call)\b/i;

// Distinctive (>=4-char) tokens of a team name, for locating that team in
// prose. Generic words like "real"/"city" survive the length filter but
// only cause a miss when they're the sole token, which is rare.
function nameTokens(name) {
  return normalizeTeamName(name)
    .split(' ')
    .filter((t) => t.length >= 4);
}

// Filler allowed between a team name and its verb: a longish run when the
// team is the grammatical subject ("<team> ... to win"), but only a couple
// of words after "for" (which normally sits right before the team).
const GAP = "[a-z0-9' -]{0,25}";
const FOR_GAP = "[a-z' -]{0,5}";

// Does the prose predict this team (identified by any of `tokens`) to win,
// or to lose? Handles both word orders: "<team> to win / to see off ..."
// and "victory / win / edge for <team>", plus "too strong for <team>"
// (team loses) and "<team> to lose / to be beaten ...".
function sideResult(t, tokens) {
  if (!tokens.length) return null;
  const T = `(?:${tokens.join('|')})`;
  const winSubject = new RegExp(
    `${T}${GAP}\\b(?:to win|will win|to beat|to see off|to edge|edge past|to overcome|to nick|to claim|to prevail|to run riot|to progress|to advance|too (?:strong|good))\\b`,
    'i'
  );
  const winFor = new RegExp(`\\b(?:win|victory|winners?|edge|nod|verdict|advantage)\\b${GAP}\\bfor\\b${FOR_GAP}${T}`, 'i');
  const loseSubject = new RegExp(`${T}${GAP}\\b(?:to lose|to be beaten|to fall|to slip up|to come unstuck|to be edged)\\b`, 'i');
  const loseFor = new RegExp(`\\b(?:too (?:strong|good) for|no match for)\\b${FOR_GAP}${T}`, 'i');

  if (winSubject.test(t) || winFor.test(t)) return 'win';
  if (loseSubject.test(t) || loseFor.test(t)) return 'lose';
  return null;
}

function inferPickFromProse(text, homeTeam, awayTeam) {
  const scoreline = text.match(/\b(\d)\s*[-–]\s*(\d)\b/);
  if (scoreline) {
    const [, home, away] = scoreline;
    if (home > away) return 'home';
    if (away > home) return 'away';
    return 'draw';
  }
  if (DRAW_RE.test(text)) return 'draw';

  if (!homeTeam || !awayTeam) return null;
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ')} `;
  const homeTok = nameTokens(homeTeam);
  const awayTok = nameTokens(awayTeam);

  // Preview prose usually opens by restating the fixture ("Preview: A vs B
  // prediction team news"). Drop just that "<home> v <away>" lead-in (no
  // greedy tail) so each name mostly remains only where the analysis
  // discusses it.
  if (homeTok.length && awayTok.length) {
    const title = new RegExp(
      `^ (?:preview )?(?:${homeTok.join('|')})[a-z0-9' -]{0,15}\\bv(?:s)?\\b[a-z0-9' -]{0,15}?(?:${awayTok.join('|')})`,
      'i'
    );
    t = ` ${t.replace(title, '').trim()} `;
  }

  const home = sideResult(t, homeTok);
  const away = sideResult(t, awayTok);

  // "home wins" and "away loses" both point to a home pick; take it only
  // when the other side isn't also implied (contradictory phrasing, or
  // both names sitting next to a verb) — otherwise stay null, don't guess.
  const homePick = home === 'win' || away === 'lose';
  const awayPick = away === 'win' || home === 'lose';
  if (homePick && !awayPick) return 'home';
  if (awayPick && !homePick) return 'away';
  return null;
}

// A predicted scoreline implies a total-goals pick directly (e.g. "2-1"
// sums to 3, i.e. over 2.5) — more reliable for prose text than hoping the
// article explicitly says "over"/"under", so try that first and fall back
// to the shared word-based heuristic.
function inferTotalsPickFromProse(text) {
  const scoreline = text.match(/\b(\d)\s*-\s*(\d)\b/);
  if (scoreline) {
    const total = Number(scoreline[1]) + Number(scoreline[2]);
    return { selection: total > 2.5 ? 'over' : 'under', point: 2.5 };
  }
  return inferTotalsPick(text);
}

function dedupeByTeams(tips) {
  const seen = new Set();
  return tips.filter((t) => {
    const key = `${t.homeTeam.toLowerCase()}|${t.awayTeam.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { fetchWhoScoredTips, inferPickFromProse, inferTotalsPickFromProse };
