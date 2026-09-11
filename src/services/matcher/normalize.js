const { ALIAS_LOOKUP, TOKEN_EXPANSIONS, YOUTH_TOKENS } = require('./aliases');

function stripDiacritics(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Lower-cases, strips diacritics and punctuation, splits into tokens,
// applies per-token abbreviation expansions, then a whole-string alias
// lookup. The output is what every comparison in index.js / tokens.js
// works on.
function normalizeTeamName(raw) {
  let s = stripDiacritics(String(raw || '').toLowerCase())
    // Drop parenthetical qualifiers: "Vitoria (BRA)", "Al Hilal (KSA)" —
    // except a reserve/youth marker written the same way ("Sociedad (B)",
    // "Ajax (Jong)"), which is kept as its own token instead of discarded.
    // Losing it entirely used to make a reserve-side fixture ("Sociedad
    // (B)" on SG Pools) fail to match its own full name elsewhere ("Real
    // Sociedad B" on Forebet) — both index.js's youth-marker guard and its
    // overlap scoring need that token present on both sides.
    .replace(/\(([^)]*)\)/g, (_, inner) => (YOUTH_TOKENS.has(inner.trim()) ? ` ${inner} ` : ' '))
    // separators to spaces so "al-hilal", "j.league" split into tokens
    .replace(/[.\-_/&+',]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const expanded = s
    .split(' ')
    .map((tok) => (TOKEN_EXPANSIONS.has(tok) ? TOKEN_EXPANSIONS.get(tok) : tok))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return ALIAS_LOOKUP.get(expanded) || expanded;
}

module.exports = { stripDiacritics, normalizeTeamName };
