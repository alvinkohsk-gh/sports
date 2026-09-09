const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

// Fetches recent head-to-head meetings, each side's own recent home/away
// fixtures, and each side's recent form from a single Forebet
// match-prediction page (the URL captured per row by forebet.js's
// extractRows, e.g. forebet.com/en/predictions/<slug>).
//
// Selectors verified 2026-09-09 against a real match-page capture
// (debug-tipsters/forebet-match.html from a GitHub Actions run, pulled via
// the `debug-capture` branch published by .github/workflows/snapshot.yml's
// opt-in publish_debug input — this sandbox still has no direct network
// path to forebet.com). H2H and each side's recent fixtures both render as
// `.st_row` divs (not `<tr>`/`<li>` as first guessed before verification);
// form badges are `.form_w`/`.form_d`/`.form_l` spans inside two
// `.prformcont` widgets (home side first, then away). Kept tolerant of a
// future markup change: row lookups also accept `<tr>`/`<li>`, and
// parseForm falls back to a generic badge scan if `.prformcont` isn't
// found — a wrong guess degrades to "no data" (this function returns
// null) rather than throwing or silently returning garbage.

// No \b before/after the digit groups: cheerio's .text() concatenates
// adjacent table cells with no inserted whitespace (e.g. "Team A2 - 1Team
// B" when the source HTML has no whitespace between </td><td> tags), so a
// word-boundary anchor would miss a scoreline glued to a team name.
// Negative digit lookaround instead avoids matching part of a longer
// number (e.g. a year).
const SCORE_RE = /(?<!\d)(\d{1,2})\s*[-–:]\s*(\d{1,2})(?!\d)/;
const DATE_RE = /(?<!\d)(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{4}-\d{2}-\d{2})(?!\d)/;
const RESULT_LETTER_RE = /^[WDL]$/i;

// Each H2H/fixture row is a `.st_row` div; kept alongside `tr, li` in case
// a future layout reverts to a table/list.
const ROW_SELECTOR = '.st_row, tr, li';

// `.st_date` holds two child divs (day/month, then year) with no
// separator between them in .text() — read them as separate children
// first; DATE_RE over the full row text is the fallback for a `tr`/`li`
// row shaped like the original (unverified) guess.
function rowDate($, row) {
  const parts = row.find('.st_date').first().children();
  if (parts.length >= 2) {
    const dm = $(parts.get(0)).text().trim();
    const y = $(parts.get(1)).text().trim();
    if (dm && y) return `${dm}/${y}`;
  }
  const text = row.text().replace(/\s+/g, ' ').trim();
  const m = text.match(DATE_RE);
  return m ? m[1] : null;
}

// The non-`.active-team` side of a `.st_hteam`/`.st_ateam` pair is the
// opponent (Forebet marks whichever team this match page's subject is
// with `.active-team`, regardless of whether that team was home or away
// in this particular past fixture).
function rowOpponent($, row) {
  const home = row.find('.st_hteam').first();
  const away = row.find('.st_ateam').first();
  if (home.length && !home.hasClass('active-team')) return home.text().trim() || null;
  if (away.length && !away.hasClass('active-team')) return away.text().trim() || null;
  return null;
}

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
  while (container.length && !container.find(ROW_SELECTOR).length && hops < 5) {
    container = container.next();
    hops += 1;
  }
  if (!container.length) container = heading.parent();

  const rows = [];
  container.find(ROW_SELECTOR).each((_, el) => {
    const row = $(el);
    const text = row.text().replace(/\s+/g, ' ').trim();
    const scoreMatch = text.match(SCORE_RE);
    if (!scoreMatch) return;
    rows.push({
      raw: text,
      homeGoals: Number(scoreMatch[1]),
      awayGoals: Number(scoreMatch[2]),
      date: rowDate($, row),
    });
  });
  return rows.slice(0, 10);
}

// Recent-form widgets: two `.prformcont` containers (home side first, then
// away — mirrors the page's left-logo/right-logo layout), each holding a
// row of `.form_w`/`.form_d`/`.form_l` spans in DOM order.
function parseFormPrimary($, side) {
  const containers = $('.prformcont');
  const idx = side === 'away' ? 1 : 0;
  const container = containers.eq(idx);
  if (!container.length) return [];

  const results = [];
  container.find('[class*="form_"]').each((_, el) => {
    const cls = $(el).attr('class') || '';
    if (/\bform_w\b/.test(cls)) results.push('W');
    else if (/\bform_d\b/.test(cls)) results.push('D');
    else if (/\bform_l\b/.test(cls)) results.push('L');
  });
  return results.slice(0, 5);
}

// Fallback for a layout that doesn't use `.prformcont`/`.form_w|d|l`:
// scan for small leaf-ish elements labelled W/D/L (by title/aria-label/
// text), grouped by shared parent into one widget per team.
function parseFormFallback($, side) {
  const badges = $('[class*="form" i]').filter((_, el) => {
    const $el = $(el);
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

function parseForm($, side) {
  const primary = parseFormPrimary($, side);
  return primary.length ? primary : parseFormFallback($, side);
}

// Sections titled "Last N matches" (distinct from the H2H section, which
// covers meetings between both teams, and from Forebet's separate "home
// matches"/"away matches"/"next matches" widgets, which this doesn't
// read) — one per team, each a `.mptlt` panel heading. `.mptlt`'s own text
// isn't used directly: it also carries a team-code prefix div (e.g. "STS")
// concatenated with no separator, which both pushes real headings over a
// naive length check and makes prefixed-but-unrelated panels ("STS ...
// Straight line distance") harder to rule out. The heading label instead
// lives cleanly in `.mptlt`'s own last child element (no prefix); a
// generic `$('*')` scan is the fallback if `.mptlt` isn't found at all.
function isFixturesHeadingText(t) {
  const norm = t.replace(/\s+/g, ' ').trim();
  if (!norm || norm.length >= 40) return false;
  if (/h2h|head[\s-]?to[\s-]?head/i.test(norm)) return false;
  return /\blast\s*\d*\s*(match|game)|previous\s+match/i.test(norm);
}

function findFixturesHeadings($) {
  const fromPanels = $('.mptlt')
    .filter((_, el) => {
      const last = $(el).children().last();
      return last.length && isFixturesHeadingText(last.text());
    });
  if (fromPanels.length) return fromPanels;

  return $('*').filter((_, el) => isFixturesHeadingText($(el).text()));
}

function parseTeamFixtures($) {
  const headings = findFixturesHeadings($);

  const sections = [];
  headings.each((_, el) => {
    let container = $(el).next();
    let hops = 0;
    while (container.length && !container.find(ROW_SELECTOR).length && hops < 5) {
      container = container.next();
      hops += 1;
    }
    if (!container.length) container = $(el).parent();

    const rows = [];
    container.find(ROW_SELECTOR).each((_, rowEl) => {
      const row = $(rowEl);
      const text = row.text().replace(/\s+/g, ' ').trim();
      const scoreMatch = text.match(SCORE_RE);
      if (!scoreMatch) return;
      // `.st_hteam`/`.st_ateam` give a reliable opponent name; fall back
      // to stripping the score/date out of the row text for a `tr`/`li`
      // row shaped like the original (unverified) guess.
      let opponent = rowOpponent($, row);
      if (!opponent) {
        const dateMatch = text.match(DATE_RE);
        opponent = text.replace(scoreMatch[0], ' ');
        if (dateMatch) opponent = opponent.replace(dateMatch[0], ' ');
        opponent = opponent.replace(/\s+/g, ' ').trim() || null;
      }
      rows.push({
        raw: text,
        homeGoals: Number(scoreMatch[1]),
        awayGoals: Number(scoreMatch[2]),
        date: rowDate($, row),
        opponent,
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
