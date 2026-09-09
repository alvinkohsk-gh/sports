const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

// Fetches recent head-to-head meetings, each side's own recent home/away
// fixtures, and each side's recent form from a single Forebet
// match-prediction page (the URL captured per row by forebet.js's
// extractRows, e.g. forebet.com/en/predictions/<slug>).
//
// UNVERIFIED: unlike the list-page scraper in forebet.js (ported from a
// confirmed real-world scraper), these selectors are a best-effort read of
// Forebet's typical match-page layout — this sandbox has no network path
// to forebet.com to check them against real markup. Run with
// TIPSTERS_DEBUG=true (see fetchHtml.js) to capture
// debug-tipsters/forebet-match.html from a real GitHub Actions run, then
// tune parseH2H/parseForm/parseTeamFixtures against it — the same workflow
// already used to verify every other scraper in this repo (see README
// "Debugging").
//
// All parsers are structural-selector-first with a text-anchored
// fallback, so a markup change degrades to "no data" (this function
// returns null) rather than throwing or silently returning garbage.

// No \b before/after the digit groups: cheerio's .text() concatenates
// adjacent table cells with no inserted whitespace (e.g. "Team A2 - 1Team
// B" when the source HTML has no whitespace between </td><td> tags), so a
// word-boundary anchor would miss a scoreline glued to a team name.
// Negative digit lookaround instead avoids matching part of a longer
// number (e.g. a year).
const SCORE_RE = /(?<!\d)(\d{1,2})\s*[-–:]\s*(\d{1,2})(?!\d)/;
const DATE_RE = /(?<!\d)(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{4}-\d{2}-\d{2})(?!\d)/;
const RESULT_LETTER_RE = /^[WDL]$/i;

// Best-effort structural read: a heading/section whose text mentions H2H,
// followed by row-like elements (table rows or list items) each carrying
// a scoreline and, usually, a date and the two team names.
function parseH2H($) {
  const heading = $('*')
    .filter((_, el) => {
      const t = $(el).text().trim();
      return t.length < 40 && /\bh2h\b|head[\s-]?to[\s-]?head/i.test(t);
    })
    .first();
  if (!heading.length) return [];

  // The rows usually live in the nearest following table/list, not
  // necessarily a direct sibling — walk forward through the DOM.
  let container = heading.next();
  let hops = 0;
  while (container.length && !container.find('tr, li').length && hops < 5) {
    container = container.next();
    hops += 1;
  }
  if (!container.length) container = heading.parent();

  const rows = [];
  container.find('tr, li').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const scoreMatch = text.match(SCORE_RE);
    if (!scoreMatch) return;
    const dateMatch = text.match(DATE_RE);
    rows.push({
      raw: text,
      homeGoals: Number(scoreMatch[1]),
      awayGoals: Number(scoreMatch[2]),
      date: dateMatch ? dateMatch[1] : null,
    });
  });
  return rows.slice(0, 10);
}

// Best-effort structural read: recent-form widgets typically render each
// past result as a small W/D/L badge, in DOM order (most recent first or
// last depending on the site — kept as-is, the UI shows them in the order
// found). `side` narrows which of the (usually two, home + away) matching
// widgets to read: 'home' takes the first, 'away' the second.
function parseForm($, side) {
  const badges = $('[class*="form" i] [class*="form" i], [class*="form" i]').filter((_, el) => {
    const $el = $(el);
    if ($el.children().length) return false; // want leaf badges, not the containers
    const label = ($el.attr('title') || $el.attr('aria-label') || $el.text() || '').trim();
    return RESULT_LETTER_RE.test(label) || /\b(win|draw|lose|loss|lost)\b/i.test(label);
  });
  if (!badges.length) return [];

  const toResult = (label) => {
    const l = label.trim().toLowerCase();
    if (l[0] === 'w' || l.includes('win')) return 'W';
    if (l[0] === 'd' || l.includes('draw')) return 'D';
    if (l[0] === 'l' || l.includes('los')) return 'L';
    return null;
  };

  // Group consecutive badges that share a common ancestor (one form widget
  // per team), then take the requested side's group.
  const groups = [];
  let currentGroup = null;
  let currentParent = null;
  badges.each((_, el) => {
    const $el = $(el);
    const parent = $el.parent().get(0);
    if (parent !== currentParent) {
      currentGroup = [];
      groups.push(currentGroup);
      currentParent = parent;
    }
    const label = ($el.attr('title') || $el.attr('aria-label') || $el.text() || '').trim();
    const result = toResult(label);
    if (result) currentGroup.push(result);
  });

  const idx = side === 'away' ? 1 : 0;
  return (groups[idx] || []).slice(0, 5);
}

// Best-effort structural read: sections titled something like "Last 6
// matches"/"Previous matches"/"Recent matches" (distinct from the H2H
// section, which covers meetings between both teams) — Forebet match
// pages typically carry one such section per team. Mirrors parseForm's
// approach of reading two same-shaped widgets in DOM order and assigning
// the first to the home side, the second to the away side. Each row keeps
// the date + scoreline (like parseH2H) plus a best-effort `opponent`
// string (whatever row text remains once the date/score are stripped out
// — may include extra labels the row carries, e.g. a competition name).
function parseTeamFixtures($) {
  const headings = $('*').filter((_, el) => {
    const t = $(el).text().trim();
    if (t.length >= 60 || /h2h|head[\s-]?to[\s-]?head/i.test(t)) return false;
    return /\blast\s*\d*\s*(match|game)|previous\s+match|recent\s+match/i.test(t);
  });

  const sections = [];
  headings.each((_, el) => {
    let container = $(el).next();
    let hops = 0;
    while (container.length && !container.find('tr, li').length && hops < 5) {
      container = container.next();
      hops += 1;
    }
    if (!container.length) container = $(el).parent();

    const rows = [];
    container.find('tr, li').each((_, rowEl) => {
      const text = $(rowEl).text().replace(/\s+/g, ' ').trim();
      const scoreMatch = text.match(SCORE_RE);
      if (!scoreMatch) return;
      const dateMatch = text.match(DATE_RE);
      let opponent = text.replace(scoreMatch[0], ' ');
      if (dateMatch) opponent = opponent.replace(dateMatch[0], ' ');
      opponent = opponent.replace(/\s+/g, ' ').trim();
      rows.push({
        raw: text,
        homeGoals: Number(scoreMatch[1]),
        awayGoals: Number(scoreMatch[2]),
        date: dateMatch ? dateMatch[1] : null,
        opponent: opponent || null,
      });
    });
    if (rows.length) sections.push(rows.slice(0, 6));
  });

  return sections;
}

async function fetchForebetMatchInfo(url) {
  if (!url) return null;
  let html;
  try {
    html = await fetchHtml('forebet-match', url);
  } catch (err) {
    console.error('[tipsters:forebet-match] fetch failed:', err.message || err);
    return null;
  }
  const $ = cheerio.load(html);

  const h2h = parseH2H($);
  const homeForm = parseForm($, 'home');
  const awayForm = parseForm($, 'away');
  const fixtureSections = parseTeamFixtures($);
  const homeFixtures = fixtureSections[0] || [];
  const awayFixtures = fixtureSections[1] || [];

  if (!h2h.length && !homeForm.length && !awayForm.length && !homeFixtures.length && !awayFixtures.length) {
    return null;
  }
  return {
    h2h,
    homeForm,
    awayForm,
    homeFixtures,
    awayFixtures,
    sourceUrl: url,
    fetchedAtISO: new Date().toISOString(),
  };
}

module.exports = { fetchForebetMatchInfo, parseH2H, parseForm, parseTeamFixtures };
