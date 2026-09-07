// Pure string algorithms for token comparison — no team-name knowledge,
// no alias data. index.js composes these into teamsMatch().

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

module.exports = { levenshtein, tokensEqual, overlap };
