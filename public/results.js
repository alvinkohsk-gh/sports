const SITE_LABELS = {
  forebet: 'Forebet', predictz: 'PredictZ', windrawwin: 'WinDrawWin', whoscored: 'WhoScored',
  sportsmole: 'Sports Mole', matchoutlook: 'MatchOutlook', eaglepredict: 'EaglePredict', footystats: 'FootyStats',
  statarea: 'Statarea', footballpredictions: 'FootballPredictions', vitibet: 'Vitibet',
};
const MIN_BEST = 10; // graded (or odds-priced) picks needed before a site can get the 🏆/💰
const statusEl = document.getElementById('status');
const gridEl = document.getElementById('accgrid');
const emptyEl = document.getElementById('empty');
const recentEl = document.getElementById('recent');
const recentWrap = document.getElementById('recent-wrap');
const noteEl = document.getElementById('note');
const fromEl = document.getElementById('from');
const toEl = document.getElementById('to');
const presetsEl = document.getElementById('presets');
const leagueEl = document.getElementById('league');
const marketEl = document.getElementById('market');
const rankEl = document.getElementById('rank');
const rangeNoteEl = document.getElementById('range-note');

function label(s) { return SITE_LABELS[s] || s; }
function pct(n) { return n == null ? '—' : n + '%'; }
const localDay = (x) => new Date(x).toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function metric(name, correct, total, pctVal, cls) {
  const w = total ? Math.round((100 * correct) / total) : 0;
  return `
    <div class="metric">
      <div class="metric-top"><span>${name}</span><b>${pct(pctVal)}</b></div>
      <div class="bar ${cls}"><span style="width:${w}%"></span></div>
      <div class="metric-top"><span></span><span>${correct}/${total}</span></div>
    </div>`;
}

// AH's bar is equity (win=1, half-win=0.75, half-loss=0.25, loss=0),
// not a plain correct/total ratio — the record line spells out the
// actual W/HW/P/HL/L counts instead, since "3/5" would hide which of
// those five outcomes actually happened.
function ahMetric(b) {
  const w = b.ahDecided ? Math.round((100 * b.ahEquitySum) / b.ahDecided) : 0;
  const record = `${b.ahWin}W ${b.ahHalfWin}HW ${b.ahPush}P ${b.ahHalfLoss}HL ${b.ahLoss}L`;
  return `
    <div class="metric">
      <div class="metric-top"><span>Asian Handicap</span><b>${pct(b.ahPct)}</b></div>
      <div class="bar ah"><span style="width:${w}%"></span></div>
      <div class="metric-top"><span></span><span title="Win / Half-win / Push / Half-loss / Loss">${record}</span></div>
    </div>`;
}

// Symbol + CSS class for each Asian Handicap result — a plain
// win/loss tick/cross doesn't capture a push (stake refunded, not a
// win or loss) or a half-win/half-loss (a quarter line splits the bet
// across two adjacent lines — see src/services/asianHandicap.js), so
// this gets its own 5-state marker instead of reusing `mark()`.
const AH_MARK = {
  win: ['✔', 'tick'],
  'half-win': ['½✔', 'half half-win'],
  push: ['P', 'dash'],
  'half-loss': ['½✘', 'half half-loss'],
  loss: ['✘', 'cross'],
};

// Profit on a flat 1-unit stake at the recorded price, in the same
// win/half-win/push/half-loss/loss vocabulary as ahResult. A quarter
// line is two 0.5-unit sub-bets at the same price (see
// src/services/asianHandicap.js), so a half-win banks half the
// odds-profit and a half-loss forfeits half the stake while the other
// half pushes back to zero.
const AH_PROFIT = {
  win: (odd) => odd - 1,
  'half-win': (odd) => (odd - 1) / 2,
  push: () => 0,
  'half-loss': () => -0.5,
  loss: () => -1,
};

// `market` narrows which pick bit(s) a pill shows: '' (default) shows
// every market a site made a pick in; '1x2'/'ou'/'ah' shows just that
// one — same market filter the site leaderboard/sort applies, kept in
// sync so the table and the cards above it always agree on scope.
function pillFor(s, market) {
  const mark = (ok) =>
    ok === null || ok === undefined
      ? '<span class="dash">·</span>'
      : ok
      ? '<span class="tick">✔</span>'
      : '<span class="cross">✘</span>';
  // Odd sits right after the tick/cross — the SG Pools price on that
  // pick as it stood at the moment the pick was captured (its final
  // pre-kickoff call), not today's price. Absent when no odds-history
  // point was recorded for this fixture that early (older samples
  // predate that feature, or the fixture had no SG Pools price yet).
  const bit = (sel, ok, odd) => {
    const oddHtml = typeof odd === 'number'
      ? `<span class="odd" title="SG Pools price on this pick when it was captured">@${odd.toFixed(2)}</span>`
      : '';
    return `<span class="res"><span class="sel">${sel}</span>${mark(ok)}${oddHtml}</span>`;
  };
  const ahBit = (ahStr, ahResult, odd) => {
    const side = ahStr.split(' ')[0][0].toUpperCase(); // "home -0.75" -> "H"
    const [symbol, cls] = AH_MARK[ahResult] || ['·', 'dash'];
    const oddHtml = typeof odd === 'number'
      ? `<span class="odd" title="SG Pools price on this pick when it was captured">@${odd.toFixed(2)}</span>`
      : '';
    return `<span class="res"><span class="sel">${side}</span><span class="${cls}" title="${ahResult || 'pending'}">${symbol}</span>${oddHtml}</span>`;
  };
  const bits = [];
  if (s.pick && market !== 'ou' && market !== 'ah') bits.push(bit(s.pick[0].toUpperCase(), s.oneX2Correct, s.oneX2Odd));
  if (s.ou && market !== '1x2' && market !== 'ah') bits.push(bit(s.ou.split(' ')[0][0].toUpperCase(), s.ouCorrect, s.ouOdd));
  if (s.ah && market !== '1x2' && market !== 'ou') bits.push(ahBit(s.ah, s.ahResult, s.ahOdd));
  return `<span class="pill site-${s.site}${s.pending ? ' pending' : ''}">${label(s.site)}${bits.join('')}</span>`;
}

let allSamples = [];
let allPending = [];
let lastUpdated = null;
let selectedSite = null; // click a card to show only that site's picks

// Asian Handicap has no plain correct/incorrect boolean — a push
// (stake refunded) is neither, and a quarter line can land on a
// half-win/half-loss (see src/services/asianHandicap.js). Pushes are
// excluded from `ahDecided` (same convention the bankroll tracker uses
// for 'void' bets) and equity is accumulated as (value+1)/2 — win=1,
// half-win=0.75, half-loss=0.25, loss=0 — so "AH win rate" reads as the
// fraction of staked equity retained, not a raw win count.
function computePerSite(samples) {
  const per = {};
  for (const s of samples) {
    const b = (per[s.site] = per[s.site] || {
      oneX2Correct: 0, oneX2Total: 0, ouCorrect: 0, ouTotal: 0,
      ahWin: 0, ahHalfWin: 0, ahPush: 0, ahHalfLoss: 0, ahLoss: 0, ahDecided: 0, ahEquitySum: 0,
      oneX2Profit: 0, oneX2Staked: 0, ouProfit: 0, ouStaked: 0, ahProfit: 0, ahStaked: 0,
    });
    if (s.oneX2Correct !== null && s.oneX2Correct !== undefined) {
      b.oneX2Total += 1;
      if (s.oneX2Correct) b.oneX2Correct += 1;
      if (typeof s.oneX2Odd === 'number') {
        b.oneX2Staked += 1;
        b.oneX2Profit += s.oneX2Correct ? s.oneX2Odd - 1 : -1;
      }
    }
    if (s.ouCorrect !== null && s.ouCorrect !== undefined) {
      b.ouTotal += 1;
      if (s.ouCorrect) b.ouCorrect += 1;
      if (typeof s.ouOdd === 'number') {
        b.ouStaked += 1;
        b.ouProfit += s.ouCorrect ? s.ouOdd - 1 : -1;
      }
    }
    if (s.ahResult) {
      if (s.ahResult === 'win') b.ahWin += 1;
      else if (s.ahResult === 'half-win') b.ahHalfWin += 1;
      else if (s.ahResult === 'push') b.ahPush += 1;
      else if (s.ahResult === 'half-loss') b.ahHalfLoss += 1;
      else if (s.ahResult === 'loss') b.ahLoss += 1;
      if (s.ahResult !== 'push') {
        b.ahDecided += 1;
        b.ahEquitySum += (s.ahValue + 1) / 2;
      }
      if (typeof s.ahOdd === 'number' && AH_PROFIT[s.ahResult]) {
        b.ahStaked += 1;
        b.ahProfit += AH_PROFIT[s.ahResult](s.ahOdd);
      }
    }
  }
  for (const b of Object.values(per)) {
    b.oneX2Pct = b.oneX2Total ? Math.round((100 * b.oneX2Correct) / b.oneX2Total) : null;
    b.ouPct = b.ouTotal ? Math.round((100 * b.ouCorrect) / b.ouTotal) : null;
    b.ahTotal = b.ahWin + b.ahHalfWin + b.ahPush + b.ahHalfLoss + b.ahLoss;
    b.ahPct = b.ahDecided ? Math.round((100 * b.ahEquitySum) / b.ahDecided) : null;
    b.graded = b.oneX2Total + b.ouTotal + b.ahDecided;
    b.overall = b.graded ? (b.oneX2Correct + b.ouCorrect + b.ahEquitySum) / b.graded : null;
    // Return on a flat 1-unit stake at the price recorded when each pick
    // was made, over just the picks a price was actually recorded for
    // (older samples, and some fixtures, have none — see oneX2Odd/ouOdd/
    // ahOdd above). This is what "accounting for odds" ranks sites by,
    // as opposed to the plain correct/total accuracy above.
    b.oneX2Roi = b.oneX2Staked ? Math.round((100 * b.oneX2Profit) / b.oneX2Staked) : null;
    b.ouRoi = b.ouStaked ? Math.round((100 * b.ouProfit) / b.ouStaked) : null;
    b.ahRoi = b.ahStaked ? Math.round((100 * b.ahProfit) / b.ahStaked) : null;
    b.roiProfit = b.oneX2Profit + b.ouProfit + b.ahProfit;
    b.roiStaked = b.oneX2Staked + b.ouStaked + b.ahStaked;
    b.roiPct = b.roiStaked ? Math.round((100 * b.roiProfit) / b.roiStaked) : null;
  }
  return per;
}

// `market` narrows the leaderboard to one market's own accuracy: '1x2'
// ranks/best-badges by oneX2Pct alone, 'ou' by ouPct, 'ah' by ahPct
// (equity-based, excluding pushes), '' (default) keeps the combined
// overall across all three. Sites with no graded picks in the chosen
// market are dropped from the leaderboard entirely rather than shown
// at 0/0, and the recent-picks table's pills/rows follow the same
// narrowing so the two sections never disagree on scope.
function marketPct(b, market) {
  if (market === '1x2') return b.oneX2Pct;
  if (market === 'ou') return b.ouPct;
  if (market === 'ah') return b.ahPct;
  return b.overall == null ? null : Math.round(b.overall * 100);
}
function marketCount(b, market) {
  if (market === '1x2') return b.oneX2Total;
  if (market === 'ou') return b.ouTotal;
  if (market === 'ah') return b.ahDecided;
  return b.graded;
}
function marketCorrect(b, market) {
  if (market === '1x2') return b.oneX2Correct;
  if (market === 'ou') return b.ouCorrect;
  if (market === 'ah') return Math.round(b.ahEquitySum * 10) / 10;
  return b.oneX2Correct + b.ouCorrect + Math.round(b.ahEquitySum * 10) / 10;
}

// Same narrowing as marketPct/marketCount, but for the odds-adjusted
// return (see computePerSite) instead of raw accuracy — `roi` is the
// "Sort by" filter's value, '' (accuracy, default) or 'roi'.
function marketRoi(b, market) {
  if (market === '1x2') return b.oneX2Roi;
  if (market === 'ou') return b.ouRoi;
  if (market === 'ah') return b.ahRoi;
  return b.roiPct;
}
function marketRoiStaked(b, market) {
  if (market === '1x2') return b.oneX2Staked;
  if (market === 'ou') return b.ouStaked;
  if (market === 'ah') return b.ahStaked;
  return b.roiStaked;
}
function marketRoiProfit(b, market) {
  if (market === '1x2') return b.oneX2Profit;
  if (market === 'ou') return b.ouProfit;
  if (market === 'ah') return b.ahProfit;
  return b.roiProfit;
}

// The value/sample-size pair the "Sort by" filter ranks site cards on:
// plain accuracy (marketPct/marketCount) by default, or the
// odds-adjusted return (marketRoi/marketRoiStaked) when rank === 'roi'.
function rankValue(b, market, rank) { return rank === 'roi' ? marketRoi(b, market) : marketPct(b, market); }
function rankCount(b, market, rank) { return rank === 'roi' ? marketRoiStaked(b, market) : marketCount(b, market); }

function roiMetric(b, market) {
  const roi = marketRoi(b, market);
  const staked = marketRoiStaked(b, market);
  const profit = marketRoiProfit(b, market);
  const sign = (n) => (n > 0 ? '+' : '');
  const cls = roi == null ? '' : roi > 0 ? 'roi-pos' : roi < 0 ? 'roi-neg' : '';
  return `
    <div class="metric roi-metric">
      <div class="metric-top"><span>Return (odds-adjusted)</span><b class="${cls}">${roi == null ? '—' : sign(roi) + roi + '%'}</b></div>
      <div class="metric-top"><span></span><span>${staked ? `${sign(profit)}${profit.toFixed(2)}u on ${staked} pick${staked === 1 ? '' : 's'} with a recorded price` : 'no picks with a recorded price yet'}</span></div>
    </div>`;
}

function render(perSite, tableSamples, singleDay, market, rank) {
  let siteEntries = Object.entries(perSite);
  if (market) siteEntries = siteEntries.filter(([, b]) => marketCount(b, market) > 0);
  const sites = siteEntries.sort((a, b) => {
    const va = rankValue(a[1], market, rank);
    const vb = rankValue(b[1], market, rank);
    return (vb ?? -Infinity) - (va ?? -Infinity) || rankCount(b[1], market, rank) - rankCount(a[1], market, rank);
  });

  const overallLabel = market === '1x2' ? '1X2' : market === 'ou' ? 'Over/Under' : market === 'ah' ? 'Asian Handicap' : 'Overall';

  if (!sites.length) {
    gridEl.innerHTML = '';
    recentWrap.hidden = true;
    noteEl.textContent = '';
    emptyEl.hidden = false;
    emptyEl.textContent = market
      ? `No graded ${overallLabel} picks yet — this fills in as SG Pools fixtures finish.`
      : allSamples.length + allPending.length
      ? 'No finished Singapore Pools fixtures in this date range.'
      : 'No results yet — this fills in as SG Pools fixtures finish.';
    return;
  }
  emptyEl.hidden = true;

  const bestSite = sites.find(([, b]) => rankCount(b, market, rank) >= MIN_BEST)?.[0] || null;
  const crown = rank === 'roi' ? '💰 best return' : '🏆 most accurate';
  gridEl.classList.toggle('has-selection', !!selectedSite);
  gridEl.classList.toggle('market-1x2', market === '1x2');
  gridEl.classList.toggle('market-ou', market === 'ou');
  gridEl.classList.toggle('market-ah', market === 'ah');
  gridEl.innerHTML = sites
    .map(
      ([site, b]) => `
    <div class="acccard site-${site}${site === bestSite ? ' best' : ''}${site === selectedSite ? ' selected' : ''}"
         data-site="${site}" role="button" tabindex="0"
         aria-pressed="${site === selectedSite}" title="Show only ${label(site)}'s picks">
      <h3>${site === bestSite ? `<span class="crown">${crown}</span>` : ''}${label(site)}</h3>
      <div class="metric-block market-block-1x2">${metric('1X2 (home/draw/away)', b.oneX2Correct, b.oneX2Total, b.oneX2Pct, 'x12')}</div>
      <div class="metric-block market-block-ou">${metric('Over / Under goals', b.ouCorrect, b.ouTotal, b.ouPct, 'ou')}</div>
      <div class="metric-block market-block-ah">${ahMetric(b)}</div>
      <div class="metric-top"><span>${overallLabel}</span><span>${marketPct(b, market) == null ? '—' : marketPct(b, market) + '%'} · ${marketCorrect(b, market)}/${marketCount(b, market)}</span></div>
      ${roiMetric(b, market)}
    </div>`
    )
    .join('');

  const byMatch = new Map();
  for (const s of tableSamples) {
    if (selectedSite && s.site !== selectedSite) continue;
    if (market === '1x2' && !s.pick) continue;
    if (market === 'ou' && !s.ou) continue;
    if (market === 'ah' && !s.ah) continue;
    if (!byMatch.has(s.matchKey))
      byMatch.set(s.matchKey, { fixture: s.fixture, score: null, kickoffISO: s.kickoffISO, picks: [] });
    const row = byMatch.get(s.matchKey);
    if (s.score) row.score = s.score;
    row.picks.push(s);
  }
  const matchRows = [...byMatch.values()].sort((a, b) => new Date(b.kickoffISO) - new Date(a.kickoffISO));
  let pendingMatches = 0;
  recentWrap.hidden = matchRows.length === 0;
  recentEl.querySelector('tbody').innerHTML = matchRows
    .slice(0, 100)
    .map((m) => {
      if (!m.score) pendingMatches += 1;
      return `
      <tr>
        <td>${new Date(m.kickoffISO).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${m.fixture}</td>
        <td>${m.score || '<span class="dash">result pending</span>'}</td>
        <td><div class="pillrow">${m.picks
          .slice()
          .sort((a, b) => (a.pending === b.pending ? 0 : a.pending ? 1 : -1))
          .map((s) => pillFor(s, market))
          .join('')}</div></td>
      </tr>`;
    })
    .join('');
  const parts = [];
  if (matchRows.length > 100) parts.push(`Showing the 100 most recent of ${matchRows.length} matches.`);
  if (selectedSite) parts.push(`Filtered to ${label(selectedSite)} — click its card again (or "show all") to clear.`);
  else parts.push(`Click a site card to filter the table to just that site's picks.`);
  if (pendingMatches) parts.push(`${pendingMatches} match${pendingMatches === 1 ? '' : 'es'} finished but not gradable yet — no full-time score available (·).`);
  noteEl.textContent = parts.join(' ');
}

// rebuild the league <select> from whatever's in the current date range
function refreshLeagues(graded, pending) {
  if (document.activeElement === leagueEl) return; // don't yank it mid-interaction
  const counts = new Map();
  for (const s of graded.concat(pending)) {
    const lg = s.league || '(no league)';
    counts.set(lg, (counts.get(lg) || 0) + 1);
  }
  const prev = leagueEl.value;
  const opts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  leagueEl.innerHTML =
    `<option value="">All leagues (${graded.length + pending.length})</option>` +
    opts.map(([lg, c]) => `<option value="${lg.replace(/"/g, '&quot;')}">${lg} (${c})</option>`).join('');
  leagueEl.value = counts.has(prev) ? prev : '';
}

function apply() {
  const from = fromEl.value || '0000-01-01';
  const to = toEl.value || '9999-12-31';
  const inRange = (s) => { const d = localDay(s.kickoffISO); return d >= from && d <= to; };
  const gradedInRange = allSamples.filter(inRange);
  const pendingInRange = allPending.filter(inRange);
  refreshLeagues(gradedInRange, pendingInRange);

  const lg = leagueEl.value;
  const inLeague = (s) => !lg || (s.league || '(no league)') === lg;
  const graded = gradedInRange.filter(inLeague);
  const pending = pendingInRange.filter(inLeague);

  const singleDay = fromEl.value && fromEl.value === toEl.value;
  const perSite = computePerSite(graded);
  if (selectedSite && !perSite[selectedSite]) selectedSite = null; // nothing for it in this scope
  const market = marketEl.value; // '' | '1x2' | 'ou' | 'ah'
  const rank = rankEl.value; // '' (accuracy) | 'roi'
  render(perSite, graded.concat(pending), singleDay, market, rank);

  const rangeLabel = fromEl.value && toEl.value
    ? (singleDay ? fromEl.value : `${fromEl.value} → ${toEl.value}`)
    : 'all dates';
  const marketLabel = market === '1x2' ? '1X2' : market === 'ou' ? 'Over/Under' : market === 'ah' ? 'Asian Handicap' : null;
  const best = Object.entries(perSite)
    .filter(([, b]) => rankCount(b, market, rank) >= MIN_BEST)
    .sort((a, b) => (rankValue(b[1], market, rank) ?? -Infinity) - (rankValue(a[1], market, rank) ?? -Infinity))[0];
  const bestLabel = best
    ? rank === 'roi'
      ? `${rankValue(best[1], market, rank) > 0 ? '+' : ''}${rankValue(best[1], market, rank)}% return`
      : `${rankValue(best[1], market, rank)}%`
    : null;
  rangeNoteEl.innerHTML =
    `${rangeLabel}${lg ? ` · ${lg}` : ''}${marketLabel ? ` · ${marketLabel} only` : ''} · ${graded.length} graded pick${graded.length === 1 ? '' : 's'}` +
    (best ? ` · best: ${label(best[0])} ${bestLabel}` : '') +
    (selectedSite ? ` · <b>${label(selectedSite)} only</b> <button class="clear-site" id="clear-site">show all</button>` : '');
  const clearBtn = document.getElementById('clear-site');
  if (clearBtn) clearBtn.addEventListener('click', () => { selectedSite = null; apply(); });
  statusEl.textContent = lastUpdated ? `updated ${new Date(lastUpdated).toLocaleString()}` : '';
}

function pickSite(site) {
  selectedSite = selectedSite === site ? null : site;
  apply();
}
gridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.acccard');
  if (card && card.dataset.site) pickSite(card.dataset.site);
});
gridEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.acccard');
  if (card && card.dataset.site) { e.preventDefault(); pickSite(card.dataset.site); }
});

function setPreset(name) {
  [...presetsEl.children].forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
  const today = new Date();
  if (name === 'all') { fromEl.value = ''; toEl.value = ''; }
  else if (name === 'today') { fromEl.value = toEl.value = localDay(today); }
  else if (name === 'yesterday') { fromEl.value = toEl.value = localDay(addDays(today, -1)); }
  else if (name === '7') { fromEl.value = localDay(addDays(today, -6)); toEl.value = localDay(today); }
  else if (name === '30') { fromEl.value = localDay(addDays(today, -29)); toEl.value = localDay(today); }
  apply();
}

presetsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) setPreset(btn.dataset.preset);
});
[fromEl, toEl].forEach((el) =>
  el.addEventListener('change', () => {
    [...presetsEl.children].forEach((b) => b.classList.remove('active'));
    apply();
  })
);
leagueEl.addEventListener('change', apply);
marketEl.addEventListener('change', apply);
rankEl.addEventListener('change', apply);

async function load() {
  try {
    const res = await fetch('/api/accuracy');
    if (res.status === 503) {
      statusEl.textContent = 'No accuracy data yet';
      emptyEl.hidden = false;
      gridEl.innerHTML = '';
      return;
    }
    const data = await res.json();
    allSamples = data.samples || [];
    allPending = data.pending || [];
    lastUpdated = data.updatedAt || null;
    if (data.availableDates) fromEl.min = toEl.min = data.availableDates.min;
    apply();
  } catch (err) {
    statusEl.textContent = `Failed to load: ${err.message}`;
  }
}

load();
setInterval(load, 60000);
