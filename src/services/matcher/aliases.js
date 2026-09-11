// Lookup data for team-name matching. Edit this file when a specific club
// pair won't match — the algorithm (normalize.js / tokens.js / index.js)
// rarely needs touching.

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
  // SG Pools lists this Liga MX/Expansion MX club as "UNAM Mexico",
  // Flashscore as "UNAM Pumas" — no shared token besides "unam" itself,
  // so plain overlap scoring rejects it (score 0.5, one matched token).
  ['unam pumas', 'unam mexico', 'pumas unam'],
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
  // SG Pools abbreviates MLS clubs ("NY City FC", "NE Revolution") more
  // aggressively than the tipster sites ("New York City FC", "New
  // England Revolution") — both "ny"/"ne" are too short (2 chars) for
  // tokensEqual's fuzzy prefix/edit-distance match (which requires >=4),
  // so without an explicit expansion the only shared tokens left are
  // generic ones ("city", "fc") and the match is rejected outright.
  ['ny', 'new york'],
  ['ne', 'new england'],
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

module.exports = { ALIAS_LOOKUP, TOKEN_EXPANSIONS, GENERIC_TOKENS, YOUTH_TOKENS };
