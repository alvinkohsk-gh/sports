const ALIASES = [
  ['manchester united', 'man utd', 'man united', 'man u'],
  ['manchester city', 'man city'],
  ['tottenham hotspur', 'tottenham', 'spurs'],
  ['wolverhampton wanderers', 'wolves'],
  ['newcastle united', 'newcastle'],
  ['brighton and hove albion', 'brighton'],
  ['west ham united', 'west ham'],
  ['nottingham forest', 'nottm forest', "notts forest"],
  ['paris saint germain', 'psg', 'paris sg'],
  ['bayern munich', 'bayern munchen', 'fc bayern munich'],
  ['internazionale', 'inter milan', 'inter'],
  ['atletico madrid', 'atletico de madrid', 'atl madrid'],
  ['real madrid', 'real madrid cf'],
];

const ALIAS_LOOKUP = new Map();
for (const group of ALIASES) {
  const canonical = group[0];
  for (const name of group) ALIAS_LOOKUP.set(name, canonical);
}

function normalizeTeamName(raw) {
  let s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bfc\b|\bcf\b|\bafc\b|\bsc\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIAS_LOOKUP.get(s) || s;
}

function tokenSet(name) {
  return new Set(normalizeTeamName(name).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function teamsMatch(a, b) {
  if (normalizeTeamName(a) === normalizeTeamName(b)) return true;
  return jaccard(a, b) >= 0.5;
}

module.exports = { normalizeTeamName, teamsMatch };
