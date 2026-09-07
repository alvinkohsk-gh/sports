const REFRESH_MS = 15000;
const matchesEl = document.getElementById('matches');
const emptyEl = document.getElementById('empty');
const statusEl = document.getElementById('status');

let currentMatches = [];

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
      return `<span class="tip-chip tip-${p.pick || 'unknown'}" title="${escapeHtml(p.rawText || '')}">${label}: ${pickText}</span>`;
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
      return `<span class="tip-chip tip-${p.totalsPick.selection}" title="${escapeHtml(p.rawText || '')}">${label}: ${sel} ${p.totalsPick.point}</span>`;
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

// Every VALUE-flagged outcome across the board, highest EV first.
function collectValueBets(matches) {
  const bets = [];
  for (const m of matches) {
    const v = m.value;
    if (!v) continue;
    for (const [market, a] of [['1X2', v.oneX2], ['O/U 2.5', v.ou25]]) {
      if (!a || !a.outcomes) continue;
      for (const o of a.outcomes) {
        if (o.value) {
          bets.push({
            ...o,
            market,
            matchId: m.id,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            league: m.league,
            kickoffISO: m.kickoffISO,
          });
        }
      }
    }
  }
  return bets.sort((a, b) => b.ev - a.ev);
}

function renderValueBets(matches) {
  const el = document.getElementById('value-bets');
  if (!el) return;
  const bets = collectValueBets(matches);
  if (!bets.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;

  const rows = bets
    .map((b) => {
      const ko = new Date(b.kickoffISO).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="vb-row" data-match="${b.matchId}">
          <div>
            <div class="vb-match">${b.homeTeam} vs ${b.awayTeam}</div>
            <div class="vb-sub">${b.league || ''} · ${ko}</div>
          </div>
          <div class="vb-pick">${b.market}<br />${b.label} @ ${b.odd.toFixed(2)}</div>
          <div class="vb-metric vb-ev"><span class="vb-lab">EV</span>${signedPct(b.ev)}</div>
          <div class="vb-metric vb-fair"><span class="vb-lab">fair / price</span>${pct(b.refProb)} / ${pct(b.impliedProb)}</div>
          <div class="vb-metric"><span class="vb-lab">¼-Kelly</span>${pct(b.quarterKelly)}</div>
        </div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="vb-head">
      <span class="vb-title">⚡ Value bets — ${bets.length}</span>
      <span class="vb-note">Singapore Pools price implies a lower win chance than the tipster consensus (positive EV by that reference — a soft signal, not a sharp line). Stake = fraction of bankroll.</span>
    </div>
    <div class="vb-list">${rows}</div>`;

  el.querySelectorAll('.vb-row').forEach((row) => {
    row.addEventListener('click', () => {
      const card = document.getElementById(`match-${row.dataset.match}`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('vb-flash');
      void card.offsetWidth;
      card.classList.add('vb-flash');
    });
  });
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
    el.textContent = text;
    el.className = `countdown ${cls}`;
  });
}

async function fetchMatches() {
  try {
    const res = await fetch('/api/matches');
    const data = await res.json();
    currentMatches = data.matches || [];
    renderMatches(currentMatches);
    renderValueBets(currentMatches);
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
