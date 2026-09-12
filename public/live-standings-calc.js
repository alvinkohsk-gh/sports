// Pure math for projecting a live match's current score onto the league
// table (public/app.js's match detail modal). No DOM dependency so it can
// be unit-tested directly with node:test; index.html loads it as a plain
// <script> (UMD-ish export at the bottom picks whichever environment it's
// running in).
//
// `standings` is what src/results/matchInfo.js's annotateStandings
// produces: one row per club, with `side` ('home'/'away'/null) flagging
// which of the two fixture teams a row is. The table itself is pre-match
// (Forebet's own table, cached up to a day) and doesn't already include
// this in-progress fixture, so projecting it means: take the in-progress
// score as if it were the final result, add it on top of the home/away
// rows' existing tallies, and re-sort. This is necessarily a simplification
// — it can't account for any *other* match live at the same moment, and
// ties are broken by goal difference then goals scored (not head-to-head,
// which the table doesn't carry) — so it's presented as a projection, not
// the real-time official table.

function parseScore(scoreStr) {
  if (typeof scoreStr !== 'string') return null;
  const m = scoreStr.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (!m) return null;
  return { homeGoals: Number(m[1]), awayGoals: Number(m[2]) };
}

function projectRow(row, goalsFor, goalsAgainst) {
  const won = goalsFor > goalsAgainst ? 1 : 0;
  const drawn = goalsFor === goalsAgainst ? 1 : 0;
  const lost = goalsFor < goalsAgainst ? 1 : 0;
  const newGoalsFor = row.goalsFor + goalsFor;
  const newGoalsAgainst = row.goalsAgainst + goalsAgainst;
  return {
    ...row,
    played: row.played + 1,
    won: row.won + won,
    drawn: row.drawn + drawn,
    lost: row.lost + lost,
    goalsFor: newGoalsFor,
    goalsAgainst: newGoalsAgainst,
    goalDiff: newGoalsFor - newGoalsAgainst,
    points: row.points + (won ? 3 : drawn ? 1 : 0),
  };
}

/**
 * Returns a new standings array with the home/away rows (identified by
 * `side`, not name matching again) updated as if `scoreStr` ("H-A") were
 * this match's final score, re-sorted by points/goal-diff/goals-for, and
 * repositioned. Returns the original array unchanged when there's no
 * parseable score or the table doesn't carry both a home and an away row
 * (so there's nothing to project onto).
 */
function projectStandings(standings, scoreStr) {
  if (!Array.isArray(standings) || !standings.length) return standings;
  const score = parseScore(scoreStr);
  if (!score) return standings;

  const homeRow = standings.find((r) => r.side === 'home');
  const awayRow = standings.find((r) => r.side === 'away');
  if (!homeRow || !awayRow) return standings;

  const projected = standings.map((r) => {
    if (r === homeRow) return projectRow(r, score.homeGoals, score.awayGoals);
    if (r === awayRow) return projectRow(r, score.awayGoals, score.homeGoals);
    return r;
  });

  projected.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
  return projected.map((r, i) => ({ ...r, position: i + 1 }));
}

const api = { parseScore, projectStandings };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  (typeof window !== 'undefined' ? window : globalThis).LiveStandingsCalc = api;
}
