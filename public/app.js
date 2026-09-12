const REFRESH_MS = 15000;
const matchesEl = document.getElementById('matches');
const emptyEl = document.getElementById('empty');
const statusEl = document.getElementById('status');
const tipsterSelectEl = document.getElementById('tipster-select');
const modalEl = document.getElementById('match-modal');
const modalBodyEl = document.getElementById('modal-body');
const modalCloseEl = document.getElementById('modal-close');

// One combined, sorted list — `GET /api/matches` splits open (pre-kickoff)
// and in-play fixtures into `matches`/`inPlay` (SG Pools itself serves
// them from two separate feeds — see aggregator.js), but the board shows
// them together: every match a live-betting indicator (`m.live`), sorted
// so live ones surface at the top.
let currentMatches = [];
let selectedTipster = ''; // '' = all tipsters

function formatCountdown(ms) {
  if (ms <= 0) return { text: 'LIVE / KICKED OFF', cls: 'live' };
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  let cls = 'ok';
  if (ms < 5 * 60 * 1000) cls = 'urgent';
  else if (ms < 30 * 60 * 1000) cls = 'soon';
  return { text, cls };
}

function pct(v) {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}

function renderPick(topPick) {
  if (!topPick) return '';
  return `
    <div class="pick">
      <div class="pick-label">Top pick: ${topPick.label}</div>
      <div class="pick-meta">
        ${topPick.tipsterCount}/${topPick.totalTipsters} tipsters agree (${pct(topPick.agreement)})
      </div>
    </div>`;
}

const SITE_LABELS = {
  forebet: 'Forebet',
  predictz: 'PredictZ',
  windrawwin: 'WinDrawWin',
  whoscored: 'WhoScored',
  sportsmole: 'Sports Mole',
  matchoutlook: 'MatchOutlook',
  eaglepredict: 'EaglePredict',
  footystats: 'FootyStats',
  statarea: 'Statarea',
  footballpredictions: 'FootballPredictions',
  vitibet: 'Vitibet',
};

if (tipsterSelectEl) {
  for (const [site, label] of Object.entries(SITE_LABELS)) {
    const opt = document.createElement('option');
    opt.value = site;
    opt.textContent = label;
    tipsterSelectEl.appendChild(opt);
  }
  tipsterSelectEl.addEventListener('change', () => {
    selectedTipster = tipsterSelectEl.value;
    renderMatches(currentMatches);
  });
}

// `filterSite` narrows a match's tipster section down to one site — used
// when the board's tipster filter is active. The majority-vote line only
// makes sense across multiple sites, so a filtered card shows that one
// site's own pick(s) instead.
function renderTipsters(tipsterConsensus, filterSite) {
  if (!tipsterConsensus || tipsterConsensus.totalTipsters === 0) {
    return '<div class="section-label">Tipster picks: none found</div>';
  }
  const cfMark = (p) => (p.carriedForward ? '<sup class="cf-mark" title="pre-match pick — this site stopped listing the fixture after kick-off">ᴾ</sup>' : '');
  const allPicks = filterSite ? tipsterConsensus.picks.filter((p) => p.site === filterSite) : tipsterConsensus.picks;
  if (filterSite && allPicks.length === 0) {
    return `<div class="section-label">${SITE_LABELS[filterSite] || filterSite}: no pick for this match</div>`;
  }

  const chips = allPicks
    .map((p) => {
      const label = SITE_LABELS[p.site] || p.site;
      const pickText = p.pick ? p.pick.toUpperCase() : '?';
      return `<span class="tip-chip site-${p.site}${p.carriedForward ? ' carried' : ''}" title="${escapeHtml(p.rawText || '')}">${label}${cfMark(p)}: <span class="tc-pick">${pickText}</span></span>`;
    })
    .join('');
  const majority = filterSite
    ? (allPicks[0].pick ? `${SITE_LABELS[filterSite] || filterSite} picks ${allPicks[0].pick.toUpperCase()}` : `${SITE_LABELS[filterSite] || filterSite}: no clear 1X2 pick`)
    : tipsterConsensus.majorityPick
      ? `${tipsterConsensus.majorityCount}/${tipsterConsensus.totalTipsters} tipsters pick ${tipsterConsensus.majorityPick.toUpperCase()}`
      : 'no clear majority';

  const ouPicks = allPicks.filter((p) => p.totalsPick);
  const ouChips = ouPicks
    .map((p) => {
      const label = SITE_LABELS[p.site] || p.site;
      const sel = p.totalsPick.selection.toUpperCase();
      return `<span class="tip-chip site-${p.site}${p.carriedForward ? ' carried' : ''}" title="${escapeHtml(p.rawText || '')}">${label}${cfMark(p)}: <span class="tc-pick">${sel} ${p.totalsPick.point}</span></span>`;
    })
    .join('');
  const ouMajority =
    filterSite && ouPicks.length
      ? `${SITE_LABELS[filterSite] || filterSite} picks ${ouPicks[0].totalsPick.selection.toUpperCase()} ${ouPicks[0].totalsPick.point}`
      : !filterSite && tipsterConsensus.totalsMajorityPick
        ? `${tipsterConsensus.totalsMajorityCount}/${tipsterConsensus.totalTotalsTipsters} tipsters pick ${tipsterConsensus.totalsMajorityPick.toUpperCase()} ${tipsterConsensus.totalsMajorityPoint}`
        : 'no clear majority';
  const ouSection = ouPicks.length
    ? `<div class="section-label">Tipster O/U picks (${ouMajority})</div><div class="tip-chips">${ouChips}</div>`
    : '';

  const bttsPicks = allPicks.filter((p) => p.bttsPick);
  const bttsChips = bttsPicks
    .map((p) => {
      const label = SITE_LABELS[p.site] || p.site;
      const sel = p.bttsPick.toUpperCase();
      return `<span class="tip-chip site-${p.site}${p.carriedForward ? ' carried' : ''}" title="${escapeHtml(p.rawText || '')}">${label}${cfMark(p)}: <span class="tc-pick">BTTS ${sel}</span></span>`;
    })
    .join('');
  const bttsMajority =
    filterSite && bttsPicks.length
      ? `${SITE_LABELS[filterSite] || filterSite} picks BTTS ${bttsPicks[0].bttsPick.toUpperCase()}`
      : !filterSite && tipsterConsensus.bttsMajorityPick
        ? `${tipsterConsensus.bttsMajorityCount}/${tipsterConsensus.totalBttsTipsters} tipsters pick BTTS ${tipsterConsensus.bttsMajorityPick.toUpperCase()}`
        : 'no clear majority';
  const bttsSection = bttsPicks.length
    ? `<div class="section-label">Tipster BTTS picks (${bttsMajority})</div><div class="tip-chips">${bttsChips}</div>`
    : '';

  return `
    <div class="section-label">Tipster picks (${majority})</div>
    <div class="tip-chips">${chips}</div>
    ${ouSection}
    ${bttsSection}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const OUTCOME_LABEL_BASE = { home: 'H', draw: 'D', away: 'A' };

function outcomeLabel(key, ouPoint) {
  if (key === 'over') return `O${ouPoint}`;
  if (key === 'under') return `U${ouPoint}`;
  return OUTCOME_LABEL_BASE[key] || key;
}

function signedPct(v) {
  if (v == null) return '—';
  const s = (v * 100).toFixed(1);
  return `${v >= 0 ? '+' : ''}${s}%`;
}

// One market's odds row, highlighting any outcome flagged as value.
function renderOddsRow(label, assessment, rawOdds, keys, ouPoint) {
  if (!assessment && !rawOdds) return '';
  const cells = keys
    .map((k) => {
      const oc = assessment && assessment.outcomes.find((x) => x.key === k);
      const odd = oc ? oc.odd : rawOdds ? rawOdds[k] : null;
      if (odd == null) return '';
      const isVal = !!(oc && oc.value);
      const tip = oc
        ? `no-vig ${pct(oc.noVigProb)} · reference ${pct(oc.refProb)} · EV ${signedPct(oc.ev)}` +
          (isVal ? ` · stake ¼-Kelly ${pct(oc.quarterKelly)} of bank` : '')
        : '';
      return `<span class="odds-cell${isVal ? ' is-value' : ''}" title="${escapeHtml(tip)}"><span class="o-lab">${outcomeLabel(k, ouPoint)}</span>${Number(odd).toFixed(2)}</span>`;
    })
    .join('');
  if (!cells) return '';
  const margin = assessment ? `<span class="odds-margin">margin ${(assessment.overround * 100).toFixed(1)}%</span>` : '';
  return `<div class="odds-row"><span class="odds-market">${label}</span>${cells}${margin}</div>`;
}

function renderOdds(match) {
  const v = match.value;
  const o = match.odds;
  if (!v && !o) return '';
  const ouPoint = o && o.ou ? o.ou.point : null;
  const rows = [
    renderOddsRow('1X2', v && v.oneX2, o && o.oneX2, ['home', 'draw', 'away']),
    renderOddsRow(ouPoint != null ? `O/U ${ouPoint}` : 'O/U', v && v.ou, o && o.ou, ['over', 'under'], ouPoint),
  ].join('');
  if (!rows) return '';

  let badge = '';
  if (v && v.best) {
    const b = v.best;
    badge =
      `<div class="value-badge" title="reference prob ${pct(b.refProb)} vs price-implied ${pct(b.impliedProb)}">` +
      `VALUE · ${b.market} ${b.label} @ ${b.odd.toFixed(2)} · EV ${signedPct(b.ev)} · ¼-Kelly ${pct(b.quarterKelly)} of bank</div>`;
  }
  return `<div class="odds-block"><div class="section-label">Singapore Pools odds</div>${rows}${badge}</div>`;
}

// A sudden, sizeable SG Pools price move (src/services/steamMove.js,
// computed server-side off the price history each scrape already builds)
// — a signal sharp/informed money may have just come in on that side.
// 'shortening' (price came down) is highlighted like a value badge;
// 'drifting' (price went up) uses the "urgent" color since it means
// money is moving away from that side.
function renderSteamMove(match) {
  const s = match.steamMove;
  if (!s) return '';
  const ouPoint = match.odds && match.odds.ou ? match.odds.ou.point : null;
  const label = outcomeLabel(s.outcome, s.market.startsWith('O/U') ? ouPoint : null);
  const verb = s.direction === 'shortening' ? 'shortened' : 'drifted';
  const tip = `${s.market} ${label}: ${s.fromOdd.toFixed(2)} → ${s.toOdd.toFixed(2)} in ~${s.minutesApart} min`;
  return `<div class="steam-badge ${s.direction}" title="${escapeHtml(tip)}">🔥 Steam: ${s.market} ${label} ${verb} ${signedPct(s.pctChange)}</div>`;
}

// ---- match detail modal: recent H2H + form (see src/results/matchInfo.js,
// scraped from Forebet and attached to a match as `headToHead` by the
// periodic snapshot job — only present for matches Forebet also covers
// and that the scrape has already fetched). ----
function renderFormBadges(form) {
  if (!form || !form.length) return '<span class="detail-muted">no data</span>';
  return form
    .map((r) => `<span class="form-badge form-${String(r).toLowerCase()}" title="${escapeHtml(String(r))}">${escapeHtml(String(r))}</span>`)
    .join('');
}

// r.result ('W'/'D'/'L') is a per-row perspective computed server-side
// (src/results/matchInfo.js's annotateH2HResults for h2h rows, src/
// scrapers/tipsters/forebetMatchInfo.js's rowResult for fixture rows) —
// null when it couldn't be determined, left uncolored rather than guessed.
function resultClass(result) {
  if (result === 'W') return ' result-win';
  if (result === 'D') return ' result-draw';
  if (result === 'L') return ' result-loss';
  return '';
}

function renderH2HTable(h2h) {
  if (!h2h || !h2h.length) return '<div class="detail-muted">No head-to-head data available.</div>';
  const rows = h2h
    .map(
      (r) => `
      <tr>
        <td>${r.date ? escapeHtml(r.date) : ''}</td>
        <td class="teams">${r.homeTeamName && r.awayTeamName ? `${escapeHtml(r.homeTeamName)} <span class="vs">v</span> ${escapeHtml(r.awayTeamName)}` : ''}</td>
        <td class="num${resultClass(r.result)}">${r.homeGoals} – ${r.awayGoals}</td>
      </tr>`
    )
    .join('');
  return `<table class="h2h-table"><tbody>${rows}</tbody></table>`;
}

// r.venue ('H'/'A', null if Forebet's markup didn't expose it — see
// forebetMatchInfo.js's rowVenue) is which side THIS panel's own subject
// team played on in that past fixture; homeGoals/awayGoals are always the
// literal home/away score, so the badge is what tells you which of the
// two numbers was the subject team's own.
function venueBadge(venue) {
  if (venue === 'H') return '<span class="venue-badge venue-h" title="Played at home">HOME</span>';
  if (venue === 'A') return '<span class="venue-badge venue-a" title="Played away">AWAY</span>';
  return '';
}

function renderFixturesTable(fixtures) {
  if (!fixtures || !fixtures.length) return '<div class="detail-muted">No recent fixtures available.</div>';
  const rows = fixtures
    .map(
      (r) => `
      <tr>
        <td>${r.date ? escapeHtml(r.date) : ''}</td>
        <td>${venueBadge(r.venue)}</td>
        <td class="num${resultClass(r.result)}">${r.homeGoals} – ${r.awayGoals}</td>
        <td>${r.opponent ? escapeHtml(r.opponent) : ''}</td>
      </tr>`
    )
    .join('');
  return `<table class="h2h-table"><thead><tr><th>Date</th><th>Venue</th><th class="num">Score</th><th>Opponent</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Per-team goals/half-splits + a goal-timing chart, from Forebet's
// "Overall statistics" panel (src/scrapers/tipsters/forebetMatchInfo.js's
// parseOverallStats) — all over the same "last 6 matches" sample the
// form/fixtures panels use. `overallStats.home`/`.away` line up directly
// with this fixture's own home/away teams (Forebet's own designation for
// *this* match, not a past-meeting perspective that needs flipping).
function renderTeamStatsTable(homeTeam, awayTeam, stats) {
  if (!stats || (!stats.home && !stats.away)) return '<div class="detail-muted">No stats available.</div>';
  const row = (label, s) =>
    !s
      ? ''
      : `
      <tr>
        <td class="teams">${escapeHtml(label)}</td>
        <td class="num">${s.goalsScored.fullTime ?? '—'}</td>
        <td class="num">${s.goalsConceded.fullTime ?? '—'}</td>
        <td class="num">${s.goalsScored.firstHalf ?? '—'}</td>
        <td class="num">${s.goalsConceded.firstHalf ?? '—'}</td>
        <td class="num">${s.goalsScored.secondHalf ?? '—'}</td>
        <td class="num">${s.goalsConceded.secondHalf ?? '—'}</td>
      </tr>`;
  return `<table class="h2h-table stats-table"><thead><tr>
    <th>Team</th><th class="num">GF</th><th class="num">GA</th>
    <th class="num">1H GF</th><th class="num">1H GA</th><th class="num">2H GF</th><th class="num">2H GA</th>
  </tr></thead><tbody>${row(homeTeam, stats.home)}${row(awayTeam, stats.away)}</tbody></table>`;
}

const GOAL_TIMING_LABELS = ['0-15', '15-30', '30-45', '45-60', '60-75', '75-90'];

// A small dependency-free bar chart per team: each 15-min bucket gets a
// scored bar and a conceded bar, both scaled to the larger of the two
// teams' max bucket value so the two teams' charts are visually
// comparable rather than each auto-scaling to its own max.
function renderGoalTimingChart(label, timing, maxVal) {
  if (!timing) return '';
  const max = Math.max(1, maxVal);
  const buckets = GOAL_TIMING_LABELS.map((b, i) => {
    const scored = timing.scored[i] ?? 0;
    const conceded = timing.conceded[i] ?? 0;
    const scoredPct = Math.round((scored / max) * 100);
    const concededPct = Math.round((conceded / max) * 100);
    return `
      <div class="timing-bucket">
        <div class="timing-bars">
          <div class="timing-bar scored" style="height:${scoredPct}%" title="${scored} scored, ${b}'"></div>
          <div class="timing-bar conceded" style="height:${concededPct}%" title="${conceded} conceded, ${b}'"></div>
        </div>
        <div class="timing-label">${b}</div>
      </div>`;
  }).join('');
  return `<div class="timing-chart"><div class="timing-chart-title">${escapeHtml(label)}</div><div class="timing-bucket-row">${buckets}</div></div>`;
}

function renderGoalTimingCharts(homeTeam, awayTeam, stats) {
  if (!stats || (!stats.home && !stats.away)) return '';
  const allVals = [stats.home, stats.away]
    .filter(Boolean)
    .flatMap((s) => [...s.goalTiming.scored, ...s.goalTiming.conceded])
    .filter((v) => typeof v === 'number');
  const maxVal = allVals.length ? Math.max(...allVals) : 1;
  return `
    <div class="timing-legend"><span class="timing-swatch scored"></span>Scored <span class="timing-swatch conceded"></span>Conceded</div>
    ${renderGoalTimingChart(homeTeam, stats.home && stats.home.goalTiming, maxVal)}
    ${renderGoalTimingChart(awayTeam, stats.away && stats.away.goalTiming, maxVal)}`;
}

// Full league table (src/scrapers/tipsters/forebetMatchInfo.js's
// parseStandings + src/results/matchInfo.js's annotateStandings). Forebet's
// match page has no home-only/away-only version of this table — its
// "Home/Away" tab belongs to a separate goals-scored/conceded widget — so
// this is the one overall table available; the two fixture teams are just
// highlighted within it via `isMatchTeam`.
//
// For a live match with a real (Flashscore-matched) score, the table is
// projected: public/live-standings-calc.js treats the current score as if
// it were final and re-sorts, so a fan watching a live game sees where it'd
// put the two sides right now rather than the pre-match table. This can't
// account for any other match live at the same moment, so it's labeled as
// a projection rather than presented as the real-time official table.
// `match.goalsSoFar` (the O/U-line estimate used when Flashscore hasn't
// matched the fixture) has no home/away split, so it can't drive this —
// only a real `match.liveScore` can.
function renderStandingsTable(standings, match) {
  if (!standings || !standings.length) return '<div class="detail-muted">No standings data available.</div>';
  const projected = match && match.live && match.liveScore ? LiveStandingsCalc.projectStandings(standings, match.liveScore) : null;
  const note = projected
    ? `<div class="section-label standings-live-note">● LIVE — projected with the current score (${escapeHtml(match.liveScore)}) treated as final</div>`
    : '';
  const rows = (projected || standings)
    .map(
      (r) => `
      <tr class="${r.isMatchTeam ? 'standings-highlight' : ''}">
        <td class="num">${r.position}</td>
        <td class="teams">${escapeHtml(r.team)}</td>
        <td class="num"><b>${r.points}</b></td>
        <td class="num">${r.played}</td>
        <td class="num">${r.won}</td>
        <td class="num">${r.drawn}</td>
        <td class="num">${r.lost}</td>
        <td class="num">${r.goalsFor}</td>
        <td class="num">${r.goalsAgainst}</td>
        <td class="num">${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td>
      </tr>`
    )
    .join('');
  return `${note}<table class="h2h-table standings-table"><thead><tr>
    <th>#</th><th>Team</th><th class="num">Pts</th><th class="num">P</th><th class="num">W</th>
    <th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th><th class="num">+/-</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- odds movement (src/results/oddsHistory.js) — fetched on demand when
// the modal opens (GET /api/odds-history?matchKey=…), not embedded in
// /api/matches: a price point per real move for every open fixture would
// bloat every 15s poll of the main board for a feature only looked at
// per-match. ----
function renderOddsHistoryRow(p) {
  const time = new Date(p.capturedAtISO).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ox = p.oneX2 ? `${p.oneX2.home.toFixed(2)} / ${p.oneX2.draw.toFixed(2)} / ${p.oneX2.away.toFixed(2)}` : '—';
  const ou = p.ou ? `${p.ou.point} · ${p.ou.over.toFixed(2)} / ${p.ou.under.toFixed(2)}` : '—';
  return `<tr><td>${time}</td><td class="num">${ox}</td><td class="num">${ou}</td></tr>`;
}

function renderOddsHistoryTable(points) {
  if (!points || !points.length) return '<div class="detail-muted">No price movement recorded yet.</div>';
  const rows = points.map(renderOddsHistoryRow).join('');
  return `<table class="h2h-table"><thead><tr><th>Time</th><th>1X2 (H/D/A)</th><th>O/U (pt · O/U)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function loadOddsHistory(match) {
  const slot = document.getElementById('odds-history-slot');
  if (!slot || !match.matchKey) return;
  try {
    const res = await fetch(`/api/odds-history?matchKey=${encodeURIComponent(match.matchKey)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    slot.innerHTML = renderOddsHistoryTable(data.points);
  } catch (err) {
    slot.innerHTML = '<div class="detail-muted">Price history unavailable right now.</div>';
  }
}

function renderMatchDetail(match) {
  const hh = match.headToHead;
  return `
    <h2>${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</h2>
    <div class="modal-sub">${escapeHtml(match.league || '')} · Kickoff ${new Date(match.kickoffISO).toLocaleString()}</div>
    <div class="detail-section">
      <h3>Recent form (last 5)</h3>
      <div class="form-row"><span class="form-team">${escapeHtml(match.homeTeam)}</span>${renderFormBadges(hh && hh.homeForm)}</div>
      <div class="form-row"><span class="form-team">${escapeHtml(match.awayTeam)}</span>${renderFormBadges(hh && hh.awayForm)}</div>
    </div>
    <div class="detail-section">
      <h3>Team stats (last 6 matches)</h3>
      ${renderTeamStatsTable(match.homeTeam, match.awayTeam, hh && hh.overallStats)}
      <div class="section-label">Goals by time period</div>
      ${renderGoalTimingCharts(match.homeTeam, match.awayTeam, hh && hh.overallStats)}
    </div>
    <div class="detail-section">
      <h3>Head-to-head</h3>
      ${renderH2HTable(hh && hh.h2h)}
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(match.homeTeam)} — recent fixtures</h3>
      ${renderFixturesTable(hh && hh.homeFixtures)}
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(match.awayTeam)} — recent fixtures</h3>
      ${renderFixturesTable(hh && hh.awayFixtures)}
    </div>
    <div class="detail-section">
      <h3>League standings</h3>
      ${renderStandingsTable(hh && hh.standings, match)}
    </div>
    <div class="detail-section">
      <h3>Singapore Pools price movement</h3>
      <div id="odds-history-slot" class="detail-muted">Loading…</div>
    </div>
    ${
      !hh
        ? '<p class="detail-note">No Forebet head-to-head/form/fixture data for this match yet — either Forebet doesn\'t cover it, or the periodic scrape hasn\'t fetched it yet (upcoming matches are prioritized).</p>'
        : `<p class="detail-note">Source: <a href="${hh.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent)">Forebet</a></p>`
    }
  `;
}

function openMatchDetail(match) {
  if (!modalEl) return;
  modalBodyEl.innerHTML = renderMatchDetail(match);
  modalEl.hidden = false;
  loadOddsHistory(match);
}

function closeMatchDetail() {
  if (!modalEl) return;
  modalEl.hidden = true;
}

if (modalCloseEl) modalCloseEl.addEventListener('click', closeMatchDetail);
if (modalEl) {
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeMatchDetail(); // click outside the panel
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeMatchDetail();
});

// A match card that's currently live (SG Pools has it open for live
// betting — `match.live`, from a separate feed with no clock/score of its
// own; see liveClock's comment) gets a "● LIVE" badge plus a running
// clock/score instead of the plain countdown-to-kickoff.
function renderLiveBadgeAndBody(match) {
  const odds = match.odds && match.odds.oneX2;
  const oddsRow = odds
    ? `<div class="section-label">Live SG Pools 1X2: <b>${Number(odds.home).toFixed(2)}</b> / <b>${Number(odds.draw).toFixed(2)}</b> / <b>${Number(odds.away).toFixed(2)}</b></div>`
    : '';
  // Real running score from Flashscore when we could match it; otherwise
  // the O/U-line estimate ("~N goals so far"). The kickoff time shown
  // here prefers Flashscore's own recorded kickoff too, for the same
  // reason the live-clock above does (see liveClock's comment).
  const actualKickoff = match.liveKickoffISO || match.kickoffISO;
  const scoreRow = match.liveScore
    ? `<div class="live-score">${match.liveScore.replace('-', ' - ')}</div>
       <div class="kickoff-time">kicked off ${new Date(actualKickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · score via Flashscore</div>`
    : `<div class="kickoff-time">Kicked off ${new Date(match.kickoffISO).toLocaleString()}${
        match.goalsSoFar != null ? ` · ~${match.goalsSoFar} goal${match.goalsSoFar === 1 ? '' : 's'} so far (est.)` : ''
      }</div>`;
  return {
    badge: `<span class="badge live-badge"><span class="live-dot" aria-hidden="true"></span>LIVE</span>`,
    body: `
    <div class="live-clock" data-liveclock>${liveClock(match.kickoffISO, match.liveKickoffISO, match.liveStage)}</div>
    ${scoreRow}
    ${renderPick(match.topPick)}
    ${renderTipsters(match.tipsterConsensus, selectedTipster)}
    ${oddsRow}
    ${renderSteamMove(match)}`,
  };
}

function renderCard(match) {
  const div = document.createElement('div');
  div.className = match.live ? 'card live clickable' : 'card clickable';
  div.id = `match-${match.id}`;
  div.dataset.kickoff = match.kickoffISO;
  if (match.live) {
    if (match.liveKickoffISO) div.dataset.livekickoff = match.liveKickoffISO;
    if (match.liveStage) div.dataset.livestage = match.liveStage;
  }
  div.addEventListener('click', () => openMatchDetail(match));

  const live = match.live ? renderLiveBadgeAndBody(match) : null;
  div.innerHTML = `
    ${live ? live.badge : '<span class="badge">Open on Singapore Pools</span>'}
    <div class="league">${match.league || ''}</div>
    <div class="teams">${match.homeTeam} vs ${match.awayTeam}</div>
    ${
      live
        ? live.body
        : `
    <div class="countdown" data-countdown></div>
    <div class="kickoff-time">Kickoff: ${new Date(match.kickoffISO).toLocaleString()}</div>
    ${renderPick(match.topPick)}
    ${renderTipsters(match.tipsterConsensus, selectedTipster)}
    ${renderOdds(match)}
    ${renderSteamMove(match)}`
    }
    <div class="card-hint">Tap for recent form &amp; head-to-head &rarr;</div>
  `;
  return div;
}

function renderBestBet(bestBet) {
  const el = document.getElementById('best-bet');
  if (!bestBet) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <div class="kicker">Strongest tipster consensus on the board</div>
    <div class="headline">${bestBet.label} — ${bestBet.homeTeam} vs ${bestBet.awayTeam}</div>
    <div class="sub">
      ${bestBet.league || ''} · ${bestBet.tipsterCount}/${bestBet.totalTipsters} tipsters agree (${pct(bestBet.agreement)})
      · kickoff ${new Date(bestBet.kickoffISO).toLocaleString()}
    </div>
  `;
}
function coveredBy(match, site) {
  return (match.tipsterConsensus?.picks || []).some((p) => p.site === site);
}

// Live matches surface at the top (each still sorted among themselves by
// kickoff), then everything else in kickoff order — so a card marked
// LIVE is never buried below a long list of not-yet-kicked-off fixtures.
function sortForBoard(matches) {
  return matches.slice().sort((a, b) => {
    if (!!a.live !== !!b.live) return a.live ? -1 : 1;
    return new Date(a.kickoffISO) - new Date(b.kickoffISO);
  });
}

function renderMatches(matches) {
  const shown = sortForBoard(selectedTipster ? matches.filter((m) => coveredBy(m, selectedTipster)) : matches);
  matchesEl.innerHTML = '';
  emptyEl.hidden = shown.length > 0;
  emptyEl.textContent = selectedTipster && matches.length > 0 && shown.length === 0
    ? `${SITE_LABELS[selectedTipster] || selectedTipster} has no picks among the open matches right now.`
    : 'No open Singapore Pools matches right now.';
  shown.forEach((m) => matchesEl.appendChild(renderCard(m)));
  tickCountdowns();
}

function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('.card').forEach((card) => {
    const kickoff = new Date(card.dataset.kickoff).getTime();
    const { text, cls } = formatCountdown(kickoff - now);
    const el = card.querySelector('[data-countdown]');
    if (el) {
      el.textContent = text;
      el.className = `countdown ${cls}`;
    }
  });
  document.querySelectorAll('.card.live [data-liveclock]').forEach((el) => {
    const card = el.closest('.card');
    el.textContent = liveClock(card.dataset.kickoff, card.dataset.livekickoff, card.dataset.livestage);
  });
}

// Flashscore's feed gives us a kickoff timestamp and a coarse stage, but no
// separate second-half-restart timestamp — so raw elapsed time since
// kickoff overcounts the 2nd half by however long the halftime break ran.
// Flashscore's own displayed match minute (like any broadcast clock) pauses
// through that break; without correcting for it, our clock would jump
// straight from "HT" to "~60'" the moment the 2nd half kicks off instead of
// "45'". 15 min is the standard break length — an approximation, since the
// feed doesn't expose the real restart time — clamped so the 2nd half never
// reads below 45'.
const HALFTIME_BREAK_MIN = 15;

// SG Pools' own live feed carries no clock/stage, so a match card's
// prominent clock prefers Flashscore's actual data when matched
// (liveKickoffISO — Flashscore's own recorded kickoff timestamp, which
// can differ from SG Pools' listed one by minutes — plus a coarse stage:
// HT / 1st half / 2nd half / extra time / penalties). Only falls back to
// a rough wall-clock guess off SG Pools' listed kickoff (prefixed "~" to
// mark it as an estimate) when Flashscore hasn't matched this fixture.
function liveClock(kickoffISO, liveKickoffISO, stage) {
  if (stage === 'HT') return 'HT';
  if (stage === 'penalties') return 'Pens';
  if (liveKickoffISO) {
    let mins = Math.floor((Date.now() - new Date(liveKickoffISO).getTime()) / 60000);
    if (mins < 0) return 'kicking off';
    if (stage === 'extra time') return `${mins}' · ET`;
    // Flashscore's own '2nd half' stage code triggers the correction
    // directly; any other/unrecognized in-play stage string (seen in
    // production: a bare "live" when Flashscore's AC code didn't match
    // anything in LIVE_STAGE) falls back to inferring it from elapsed
    // time alone — no real 1st half + stoppage runs past ~52 raw minutes,
    // so past that we're certainly in the second half even without a
    // stage match, and skipping the correction there would show raw
    // elapsed time instead of the actual match minute.
    const pastHalftime = stage === '2nd half' || mins > 52;
    if (pastHalftime) {
      mins = Math.max(45, mins - HALFTIME_BREAK_MIN);
      return stage === '2nd half' ? `${mins}' · 2nd half` : `${mins}'`;
    }
    return `${mins}'`;
  }
  const mins = Math.floor((Date.now() - new Date(kickoffISO).getTime()) / 60000);
  if (mins < 1) return 'kicking off';
  if (mins <= 47) return `~${mins}'`;
  if (mins <= 63) return `HT / ~${mins}'`;
  if (mins <= 100) return `~${mins}'`;
  return `~${mins}' (may have ended)`;
}

async function fetchMatches() {
  try {
    const res = await fetch('/api/matches');
    const data = await res.json();
    // `inPlay` can still list a match that's long finished (a stale
    // snapshot caught it a cycle late) — drop anything further than 135
    // min past its kickoff before merging it in with the open matches.
    const inPlay = (data.inPlay || []).filter(
      (m) => (Date.now() - new Date(m.kickoffISO).getTime()) / 60000 < 135
    );
    currentMatches = [...(data.matches || []), ...inPlay];
    renderMatches(currentMatches);
    renderBestBet(data.bestBet);

    const updated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : '—';
    const mockTag = data.mockMode ? ' [MOCK DATA]' : '';
    const errTag = data.lastError ? ` — error: ${data.lastError}` : '';
    statusEl.textContent = `Updated ${updated}${mockTag}${errTag}`;
  } catch (err) {
    statusEl.textContent = `Failed to load matches: ${err.message}`;
  }
}

setInterval(tickCountdowns, 1000);
setInterval(fetchMatches, REFRESH_MS);
fetchMatches();
