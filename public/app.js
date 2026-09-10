const REFRESH_MS = 15000;
const matchesEl = document.getElementById('matches');
const emptyEl = document.getElementById('empty');
const statusEl = document.getElementById('status');
const inplayEl = document.getElementById('inplay');
const tipsterSelectEl = document.getElementById('tipster-select');
const modalEl = document.getElementById('match-modal');
const modalBodyEl = document.getElementById('modal-body');
const modalCloseEl = document.getElementById('modal-close');

let currentMatches = [];
let currentInPlay = [];
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
    renderInPlay(currentInPlay);
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
  const ouMajority = filterSite
    ? `${SITE_LABELS[filterSite] || filterSite} picks ${ouPicks[0].totalsPick.selection.toUpperCase()} ${ouPicks[0].totalsPick.point}`
    : tipsterConsensus.totalsMajorityPick
      ? `${tipsterConsensus.totalsMajorityCount}/${tipsterConsensus.totalTotalsTipsters} tipsters pick ${tipsterConsensus.totalsMajorityPick.toUpperCase()} ${tipsterConsensus.totalsMajorityPoint}`
      : 'no clear majority';
  const ouSection = ouPicks.length
    ? `<div class="section-label">Tipster O/U picks (${ouMajority})</div><div class="tip-chips">${ouChips}</div>`
    : '';

  return `
    <div class="section-label">Tipster picks (${majority})</div>
    <div class="tip-chips">${chips}</div>
    ${ouSection}`;
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
        <td class="teams">${r.homeTeamName ? escapeHtml(r.homeTeamName) : 'Home'} <span class="vs">v</span> ${r.awayTeamName ? escapeHtml(r.awayTeamName) : 'Away'}</td>
        <td class="num${resultClass(r.result)}">${r.homeGoals} – ${r.awayGoals}</td>
      </tr>`
    )
    .join('');
  return `<table class="h2h-table"><tbody>${rows}</tbody></table>`;
}

function renderFixturesTable(fixtures) {
  if (!fixtures || !fixtures.length) return '<div class="detail-muted">No recent fixtures available.</div>';
  const rows = fixtures
    .map(
      (r) => `
      <tr>
        <td>${r.date ? escapeHtml(r.date) : ''}</td>
        <td class="num${resultClass(r.result)}">${r.homeGoals} – ${r.awayGoals}</td>
        <td>${r.opponent ? escapeHtml(r.opponent) : ''}</td>
      </tr>`
    )
    .join('');
  return `<table class="h2h-table"><tbody>${rows}</tbody></table>`;
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

function renderCard(match) {
  const div = document.createElement('div');
  div.className = 'card clickable';
  div.id = `match-${match.id}`;
  div.dataset.kickoff = match.kickoffISO;
  div.addEventListener('click', () => openMatchDetail(match));
  div.innerHTML = `
    <span class="badge">Open on Singapore Pools</span>
    <div class="league">${match.league || ''}</div>
    <div class="teams">${match.homeTeam} vs ${match.awayTeam}</div>
    <div class="countdown" data-countdown></div>
    <div class="kickoff-time">Kickoff: ${new Date(match.kickoffISO).toLocaleString()}</div>
    ${renderPick(match.topPick)}
    ${renderTipsters(match.tipsterConsensus, selectedTipster)}
    ${renderOdds(match)}
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

function renderMatches(matches) {
  const shown = selectedTipster ? matches.filter((m) => coveredBy(m, selectedTipster)) : matches;
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
    el.textContent = liveClock(el.closest('.card').dataset.kickoff);
  });
}

// Rough elapsed since kickoff — SG Pools' live feed carries no clock, so
// this is wall-clock time and doesn't know about half-time or stoppage.
function liveClock(kickoffISO) {
  const mins = Math.floor((Date.now() - new Date(kickoffISO).getTime()) / 60000);
  if (mins < 1) return 'kicking off';
  if (mins <= 47) return `~${mins}'`;
  if (mins <= 63) return `HT / ~${mins}'`;
  if (mins <= 100) return `~${mins}'`;
  return `~${mins}' (may have ended)`;
}

function renderInPlayCard(m) {
  const div = document.createElement('div');
  div.className = 'card live clickable';
  div.id = `match-${m.id}`;
  div.dataset.kickoff = m.kickoffISO;
  div.addEventListener('click', () => openMatchDetail(m));
  const odds = m.odds && m.odds.oneX2;
  const oddsRow = odds
    ? `<div class="section-label">Live SG Pools 1X2: <b>${Number(odds.home).toFixed(2)}</b> / <b>${Number(odds.draw).toFixed(2)}</b> / <b>${Number(odds.away).toFixed(2)}</b></div>`
    : '';
  // Real running score from Flashscore when we could match it; otherwise
  // the O/U-line estimate ("~N goals so far").
  const scoreRow = m.liveScore
    ? `<div class="live-score">${m.liveScore.replace('-', ' - ')}</div>
       <div class="kickoff-time">${m.liveStage ? m.liveStage + ' · ' : ''}kicked off ${new Date(m.kickoffISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · score via Flashscore</div>`
    : `<div class="kickoff-time">Kicked off ${new Date(m.kickoffISO).toLocaleString()}${
        m.goalsSoFar != null ? ` · ~${m.goalsSoFar} goal${m.goalsSoFar === 1 ? '' : 's'} so far (est.)` : ''
      }</div>`;
  div.innerHTML = `
    <span class="badge live-badge">● LIVE</span>
    <div class="league">${m.league || ''}</div>
    <div class="teams">${m.homeTeam} vs ${m.awayTeam}</div>
    <div class="live-clock" data-liveclock>${liveClock(m.kickoffISO)}</div>
    ${scoreRow}
    ${renderPick(m.topPick)}
    ${renderTipsters(m.tipsterConsensus, selectedTipster)}
    ${oddsRow}
  `;
  return div;
}

function renderInPlay(list) {
  currentInPlay = list || [];
  // drop anything that must be long finished (a stale snapshot can still
  // list a match that ended ~10 min ago)
  let live = currentInPlay.filter(
    (m) => (Date.now() - new Date(m.kickoffISO).getTime()) / 60000 < 135
  );
  if (selectedTipster) live = live.filter((m) => coveredBy(m, selectedTipster));
  if (!inplayEl) return;
  if (!live.length) {
    inplayEl.hidden = true;
    inplayEl.innerHTML = '';
    return;
  }
  inplayEl.hidden = false;
  const anyCarried = live.some((m) => (m.tipsterConsensus?.picks || []).some((p) => p.carriedForward));
  inplayEl.innerHTML = `<h2 class="inplay-head">● In play now <span>(${live.length}) — picks made before kickoff; time/score approximate${
    anyCarried ? '; <b>ᴾ</b> = pre-match pick from a site that stopped listing the live match' : ''
  }</span></h2><div class="matches" id="inplay-grid"></div>`;
  const grid = inplayEl.querySelector('#inplay-grid');
  live
    .sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO))
    .forEach((m) => grid.appendChild(renderInPlayCard(m)));
}

async function fetchMatches() {
  try {
    const res = await fetch('/api/matches');
    const data = await res.json();
    currentMatches = data.matches || [];
    renderInPlay(data.inPlay || []);
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
