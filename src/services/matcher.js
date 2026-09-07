// Team-name matching between Singapore Pools fixtures and tipster-site
// picks. The two sources name the same club very differently — SG Pools
// leans on short/local forms ("Atl Tucuman", "RC Avellaneda", "Celta de
// Vigo", "Vitoria (BRA)"), tipster sites on fuller or differently
// abbreviated ones ("Atletico Tucuman", "Racing Club", "Celta Vigo") —
// so a plain token-overlap check missed most non-"big five league"
// fixtures. This module normalizes aggressively, then compares with an
// overlap coefficient plus fuzzy (prefix / 1-edit) token equality, with
// guards against the usual false positives (shared generic words like
// "United"/"Real", and youth/reserve sides vs their first team).

// Alias groups: the first entry is canonical, every other entry in the
// group normalizes to it. Only for pairs that normalization + fuzzy
// matching can't bridge on their own (distinct tokens, no shared prefix).
const ALIASES = [
  ['manchester united', 'man utd', 'man united', 'man u'],
  ['manchester city', 'man city'],
  ['tottenham hotspur', 'tottenham', 'spurs'],
  ['wolverhampton wanderers', 'wolves'],
  ['newcastle united', 'newcastle'],
  ['brighton and hove albion', 'brighton'],
  ['west ham united', 'west ham'],
  ['nottingham forest', 'nottm forest', 'notts forest'],
  ['paris saint germain', 'psg', 'paris sg'],
  ['bayern munich', 'bayern munchen', 'fc bayern munich', 'bayern'],
  ['borussia dortmund', 'dortmund', 'bvb'],
  ['borussia monchengladbach', 'monchengladbach', 'gladbach', 'mgladbach'],
  ['internazionale', 'inter milan', 'inter'],
  ['atletico madrid', 'atletico de madrid', 'atl madrid', 'atletico'],
  ['real madrid', 'real madrid cf'],
  ['barcelona', 'barca', 'fc barcelona'],
  ['sporting cp', 'sporting lisbon', 'sporting clube de portugal', 'sporting'],
  ['racing club', 'rc avellaneda', 'racing club de avellaneda', 'racing de avellaneda'],
  ['boca juniors', 'boca'],
  ['river plate', 'river'],
];

const ALIAS_LOOKUP = new Map();
for (const group of ALIASES) {
  const canonical = group[0];
  for (const name of group) ALIAS_LOOKUP.set(name, canonical);
}

// Per-token abbreviation expansions, applied before comparison so a short
// form and its long form land on the same token.
const TOKEN_EXPANSIONS = new Map([
  ['atl', 'atletico'],
  ['ath', 'athletic'],
  ['ath.', 'athletic'],
  ['dep', 'deportivo'],
  ['depor', 'deportivo'],
  ['utd', 'united'],
  ['cd', 'deportivo'],
  ['st', 'saint'],
  ['sthn', 'southern'],
  ['int', 'international'],
  ['intl', 'international'],
  ['calcio', ''],
  ['sv', ''],
  ['tsv', ''],
  ['vfl', ''],
  ['vfb', ''],
]);

// Generic club-type / filler tokens that carry no identifying weight on
// their own. A match whose only agreeing tokens are all in this set is
// rejected (that's how "Leeds United" vs "Newcastle United" or "Real
// Madrid" vs "Real Sociedad" stay unmatched).
const GENERIC_TOKENS = new Set([
  'fc', 'cf', 'sc', 'ac', 'as', 'ss', 'us', 'ca', 'sd', 'ud', 'afc', 'rc', 'cd',
  'club', 'clube', 'calcio', 'sport', 'sports', 'sportif', 'sportive',
  'united', 'utd', 'city', 'town', 'county', 'rovers', 'wanderers', 'albion',
  'athletic', 'atletico', 'real', 'deportivo', 'deportiva', 'sporting',
  'olympique', 'borussia', 'dynamo', 'dinamo', 'racing', 'hotspur',
  'de', 'del', 'della', 'di', 'do', 'da', 'dos', 'das', 'la', 'le', 'el',
  'los', 'las', 'and', 'of', 'the', 'al', 'as', 'ii', 'b',
]);

// Tokens that mark a youth / reserve / B side. If one name carries one of
// these and the other doesn't, they're different teams (first team vs
// reserves) and must not match.
const YOUTH_TOKENS = new Set(['jong', 'ii', 'b', 'u18', 'u19', 'u20', 'u21', 'u23', 'reserves', 'reserve', 'youth', 'academy']);

function stripDiacritics(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function normalizeTeamName(raw) {
  let s = stripDiacritics(String(raw || '').toLowerCase())
    // drop parenthetical qualifiers: "Vitoria (BRA)", "Al Hilal (KSA)"
    .replace(/\([^)]*\)/g, ' ')
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

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2; // caller only cares about <= 1
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[n];
}

// Fuzzy token equality: exact, shared prefix (>=4 chars, so "djurgarden"
// ~ "djurgardens" and "gothenburg" ~ "gothenburgs" match but "san" ~
// "santos" does not — known 3-letter abbreviations go through
// TOKEN_EXPANSIONS instead), or a single edit on tokens long enough for
// that to be safe.
function tokensEqual(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (min >= 4 && levenshtein(a, b) <= 1) return true;
  return false;
}

// Overlap coefficient over fuzzy-equal tokens: |A ∩ B| / min(|A|, |B|).
// Greedy one-to-one pairing so a token can't be counted twice.
function overlap(aTokens, bTokens) {
  const [shortSet, longSet] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  if (shortSet.length === 0) return { score: 0, matched: [] };
  const usedLong = new Array(longSet.length).fill(false);
  const matched = [];
  for (const t of shortSet) {
    for (let i = 0; i < longSet.length; i += 1) {
      if (usedLong[i]) continue;
      if (tokensEqual(t, longSet[i])) {
        usedLong[i] = true;
        matched.push(t);
        break;
      }
    }
  }
  return { score: matched.length / shortSet.length, matched };
}

function hasYouthMarker(tokens) {
  return tokens.some((t) => YOUTH_TOKENS.has(t));
}

function collapsed(name) {
  return normalizeTeamName(name).replace(/\s+/g, '');
}

function teamsMatch(a, b) {
  const an = normalizeTeamName(a);
  const bn = normalizeTeamName(b);
  if (!an || !bn) {
    // Nothing left after normalization — fall back to raw alnum compare.
    const ar = stripDiacritics(String(a || '').toLowerCase()).replace(/[^a-z0-9]/g, '');
    const br = stripDiacritics(String(b || '').toLowerCase()).replace(/[^a-z0-9]/g, '');
    return ar.length > 0 && ar === br;
  }
  if (an === bn) return true;

  const aTokens = an.split(' ').filter(Boolean);
  const bTokens = bn.split(' ').filter(Boolean);

  // First team vs its reserve/youth side: only one carries the marker.
  if (hasYouthMarker(aTokens) !== hasYouthMarker(bTokens)) return false;

  // Concatenated containment: "borussiamonchengladbach" ⊃ "gladbach",
  // "alhilal" ⊃ "hilal". Guard on length so short tokens don't over-match.
  const ac = collapsed(a);
  const bc = collapsed(b);
  if (Math.min(ac.length, bc.length) >= 5 && (ac.includes(bc) || bc.includes(ac))) return true;

  const { score, matched } = overlap(aTokens, bTokens);
  if (score < 0.5) return false;

  // Need at least one agreeing token that actually identifies the club —
  // not just shared filler like "united" / "real" / "fc".
  const distinctive = matched.some((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
  if (!distinctive) return false;

  // A single shared distinctive token is enough only when it's a large
  // fraction of both names (e.g. "Sociedad" vs "Real Sociedad"); for
  // longer names demand more agreement to avoid coincidental hits.
  if (score >= 0.6) return true;
  return matched.length >= 2;
}

module.exports = { normalizeTeamName, teamsMatch };
