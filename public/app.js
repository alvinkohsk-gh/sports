const REFRESH_MS = 15000;
const matchesEl = document.getElementById('matches');
const emptyEl = document.getElementById('empty');
const statusEl = document.getElementById('status');
const inplayEl = document.getElementById('inplay');

let currentMatches = [];
let currentInPlay = [];

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

function renderTipsters(tipsterConsensus) {
  if (!tipsterConsensus || tipsterConsensus.totalTipsters === 0) {
    return '<div class="section-label">Tipster picks: none found</div>';
  }
  const chips = tipsterConsensus.picks
    .map((p) => {
      const label = SITE_LABELS[p.site] || p.site;
      const pickText = p.pick ? p.pick.toUpperCase() : '?';
      return `<span class="tip-chip site-${p.site}" title="${escapeHtml(p.rawText || '')}">${label}: <span class="tc-pick">${pickText}</span></span>`;
    })
    .join('');
  const majority = tipsterConsensus.majorityPick
    ? `${tipsterConsensus.majorityCount}/${tipsterConsensus.totalTipsters} tipsters pick ${tipsterConsensus.majorityPick.toUpperCase()}`
    : 'no clear majority';

  const ouChips = tipsterConsensus.picks
    .filter((p) => p.totalsPick)
    .map((p) => {
      const label = SITE_LABELS[p.site] || p.site;
      const sel = p.totalsPick.selection.toUpperCase();
      return `<span class="tip-chip site-${p.site}" title="${escapeHtml(p.rawText || '')}">${label}: <span class="tc-pick">${sel} ${p.totalsPick.point}</span></span>`;
    })
    .join('');
  const ouMajority = tipsterConsensus.totalsMajorityPick
    ? `${tipsterConsensus.totalsMajorityCount}/${tipsterConsensus.totalTotalsTipsters} tipsters pick ${tipsterConsensus.totalsMajorityPick.toUpperCase()} ${tipsterConsensus.totalsMajorityPoint}`
    : 'no clear majority';
  const ouSection = tipsterConsensus.totalTotalsTipsters
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

const OUTCOME_LABEL = { home: 'H', draw: 'D', away: 'A', over: 'O2.5', under: 'U2.5' };

function signedPct(v) {
  if (v == null) return '—';
  const s = (v * 100).toFixed(1);
  return `${v >= 0 ? '+' : ''}${s}%`;
}

// One market's odds row, highlighting any outcome flagged as value.
function renderOddsRow(label, assessment, rawOdds, keys) {
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
      return `<span class="odds-cell${isVal ? ' is-value' : ''}" title="${escapeHtml(tip)}"><span class="o-lab">${OUTCOME_LABEL[k]}</span>${Number(odd).toFixed(2)}</span>`;
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
  const rows = [
    renderOddsRow('1X2', v && v.oneX2, o && o.oneX2, ['home', 'draw', 'away']),
    renderOddsRow('O/U 2.5', v && v.ou25, o && o.ou25, ['over', 'under']),
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

function renderCard(match) {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = `match-${match.id}`;
  div.dataset.kickoff = match.kickoffISO;
  div.innerHTML = `
    <span class="badge">Open on Singapore Pools</span>
    <div class="league">${match.league || ''}</div>
    <div class="teams">${match.homeTeam} vs ${match.awayTeam}</div>
    <div class="countdown" data-countdown></div>
    <div class="kickoff-time">Kickoff: ${new Date(match.kickoffISO).toLocaleString()}</div>
    ${renderPick(match.topPick)}
    ${renderTipsters(match.tipsterConsensus)}
    ${renderOdds(match)}
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
function renderMatches(matches) {
  matchesEl.innerHTML = '';
  emptyEl.hidden = matches.length > 0;
  matches.forEach((m) => matchesEl.appendChild(renderCard(m)));
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
  div.className = 'card live';
  div.id = `match-${m.id}`;
  div.dataset.kickoff = m.kickoffISO;
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
    ${renderTipsters(m.tipsterConsensus)}
    ${oddsRow}
  `;
  return div;
}

function renderInPlay(list) {
  currentInPlay = list || [];
  // drop anything that must be long finished (a stale snapshot can still
  // list a match that ended ~10 min ago)
  const live = currentInPlay.filter(
    (m) => (Date.now() - new Date(m.kickoffISO).getTime()) / 60000 < 135
  );
  if (!inplayEl) return;
  if (!live.length) {
    inplayEl.hidden = true;
    inplayEl.innerHTML = '';
    return;
  }
  inplayEl.hidden = false;
  inplayEl.innerHTML = `<h2 class="inplay-head">● In play now <span>(${live.length}) — picks made before kickoff; time/score approximate</span></h2><div class="matches" id="inplay-grid"></div>`;
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
