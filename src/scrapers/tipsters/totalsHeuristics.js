// Shared heuristic for inferring an Over/Under pick from a tipster site's
// text. Unlike the 1X2 selectors (ported from a verified reference
// scraper), no verified reference exists for any site's O/U page/wording,
// so this is a best-effort pattern match: an explicit "over"/"under" word,
// or a leading "O"/"U" shorthand some sites use next to a goal line.
function inferTotalsPick(text) {
  if (!text) return null;
  const t = text.trim();

  let selection = null;
  if (/^u\b/i.test(t)) selection = 'under';
  else if (/^o\b/i.test(t)) selection = 'over';
  else if (/\bunder\b/i.test(t) && !/\bover\b/i.test(t)) selection = 'under';
  else if (/\bover\b/i.test(t) && !/\bunder\b/i.test(t)) selection = 'over';

  if (!selection) return null;

  const lineMatch = t.match(/(\d(?:\.5)?)/);
  const point = lineMatch ? Number(lineMatch[1]) : 2.5; // most tipster O/U content defaults to the 2.5 line

  return { selection, point };
}

module.exports = { inferTotalsPick };
