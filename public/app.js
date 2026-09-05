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

function renderOneXTwo(oneXTwo) {
  if (!oneXTwo || (oneXTwo.home == null && oneXTwo.draw == null && oneXTwo.away == null)) {
    return '<div class="section-label">1X2: no odds available</div>';
  }
  return `
    <div class="section-label">1X2 (best price)</div>
    <table class="odds">
      <thead><tr><th>Home</th><th>Draw</th><th>Away</th></tr></thead>
      <tbody>
        <tr>
          <td class="price">${fmt(oneXTwo.home)}</td>
          <td class="price">${fmt(oneXTwo.draw)}</td>
          <td class="price">${fmt(oneXTwo.away)}</td>
        </tr>
      </tbody>
    </table>`;
}

function renderTotals(totals) {
  if (!totals || totals.length === 0) {
    return '<div class="section-label">Over/Under: no odds available</div>';
  }
  const rows = totals
    .map(
      (t) => `<tr><td>${t.point}</td><td class="price">${fmt(t.over)}</td><td class="price">${fmt(t.under)}</td></tr>`
    )
    .join('');
  return `
    <div class="section-label">Total Goals — Over/Under (best price)</div>
    <table class="odds">
      <thead><tr><th>Line</th><th>Over</th><th>Under</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function fmt(v) {
  return v == null ? '—' : Number(v).toFixed(2);
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
        ${pct(topPick.probability)} consensus probability · ${topPick.bookmakerCount} bookmaker${topPick.bookmakerCount === 1 ? '' : 's'}
        · confidence ${pct(topPick.confidenceScore)}
      </div>
    </div>`;
}

function renderCard(match) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.kickoff = match.kickoffISO;
  div.innerHTML = `
    <span class="badge">Open on Singapore Pools</span>
    <div class="league">${match.league || ''}</div>
    <div class="teams">${match.homeTeam} vs ${match.awayTeam}</div>
    <div class="countdown" data-countdown></div>
    <div class="kickoff-time">Kickoff: ${new Date(match.kickoffISO).toLocaleString()}</div>
    ${renderPick(match.topPick)}
    ${renderOneXTwo(match.oneXTwo)}
    ${renderTotals(match.totals)}
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
    <div class="kicker">Highest confidence bet on the board</div>
    <div class="headline">${bestBet.label} — ${bestBet.homeTeam} vs ${bestBet.awayTeam}</div>
    <div class="sub">
      ${bestBet.league || ''} · ${pct(bestBet.probability)} consensus probability across
      ${bestBet.bookmakerCount} bookmaker${bestBet.bookmakerCount === 1 ? '' : 's'} · confidence
      ${pct(bestBet.confidenceScore)} · kickoff ${new Date(bestBet.kickoffISO).toLocaleString()}
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
