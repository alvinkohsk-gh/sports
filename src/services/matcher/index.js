// Team-name matching between Singapore Pools fixtures and tipster-site
// picks. The two sources name the same club very differently — SG Pools
// leans on short/local forms ("Atl Tucuman", "RC Avellaneda", "Celta de
// Vigo", "Vitoria (BRA)"), tipster sites on fuller or differently
// abbreviated ones ("Atletico Tucuman", "Racing Club", "Celta Vigo") —
// so a plain token-overlap check missed most non-"big five league"
// fixtures. This normalizes aggressively (normalize.js + aliases.js), then
// compares with an overlap coefficient plus fuzzy (prefix / 1-edit) token
// equality (tokens.js), with guards against the usual false positives
// (shared generic words like "United"/"Real", and youth/reserve sides vs
// their first team).
const { stripDiacritics, normalizeTeamName } = require('./normalize');
const { overlap } = require('./tokens');
const { GENERIC_TOKENS, YOUTH_TOKENS } = require('./aliases');

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
