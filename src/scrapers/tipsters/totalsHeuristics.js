// Shared heuristics for inferring an Over/Under (2.5 goals) pick from a
// tipster site's text.
//
// Every site we scrape publishes a predicted correct score somewhere on
// the same page (Forebet .ex_sc "3 - 2", PredictZ .ptpredboxsml "Draw
// 1-1", WinDrawWin .predscore "2-0", WhoScored/Sports Mole in the prose),
// so `totalsFromScoreline` — sum the two goals, compare to 2.5 — is the
// primary signal. `inferTotalsPick` falls back to an explicit
// "over"/"under" word or a leading "O"/"U" shorthand when no scoreline is
// present.

const SCORELINE_RE = /\b([0-9])\s*[-–—]\s*([0-9])\b/;

function totalsFromScoreline(text) {
  if (!text) return null;
  const m = String(text).match(SCORELINE_RE);
  if (!m) return null;
  const total = Number(m[1]) + Number(m[2]);
  return { selection: total > 2.5 ? 'over' : 'under', point: 2.5 };
}

function inferTotalsPick(text) {
  if (!text) return null;
  const t = String(text).trim();

  const fromScore = totalsFromScoreline(t);
  if (fromScore) return fromScore;

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

module.exports = { inferTotalsPick, totalsFromScoreline };
