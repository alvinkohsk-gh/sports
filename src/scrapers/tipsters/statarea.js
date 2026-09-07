const cheerio = require('cheerio');
const { fetchHtml } = require('./fetchHtml');

// Statarea publishes a mathematical model's probabilities for every match,
// across a very wide league list (lower divisions, Scandinavia, Asia,
// South America) — the same long tail Singapore Pools carries. The
// predictions page loads a per-day view server-side at
// /predictions/date/<YYYY-MM-DD>/starttime (plain HTTP, no Cloudflare).
//
// Each match is a `div.match[id]` with, inside `.inforow > .coefrow`, a
// row of probability boxes in a fixed order:
//   1  X  2   H1 HX H2   1.5  2.5  3.5   BTS  OTS
// (H* = half-time, 1.5/2.5/3.5 = P(over that many goals), BTS = both
// teams score). A headline tip (`.tip`) carries the text "1" / "X" / "2"
// for a single outcome, or "1X" / "X2" / "12" for a double chance; for a
// double chance, or no tip at all, we fall back to the most likely of the
// 1/X/2 probabilities (always present).
const DAYS = Math.max(1, Number(process.env.STATAREA_DAYS) || 3);
const urlForDay = (d) => `https://www.statarea.com/predictions/date/${d}/starttime`;

function isoDay(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const TIP_TO_PICK = { 1: 'home', X: 'draw', 2: 'away' };
const IDX_TO_PICK = ['home', 'draw', 'away'];

function parseDay(html) {
  const $ = cheerio.load(html);
  const out = [];

  $('div.match[id]').each((_, el) => {
    const m = $(el);
    const home = m.find('.hostteam .name a').first().text().trim();
    const away = m.find('.guestteam .name a').first().text().trim();
    if (!home || !away) return;

    // probability boxes, in the fixed header order above
    const vals = m
      .find('.inforow > .coefrow > .coefbox > .value')
      .map((__, v) => Number($(v).text().trim()))
      .get()
      .filter((n) => Number.isFinite(n));
    if (vals.length < 8) return;
    const [p1, pX, p2] = vals;
    const pOver25 = vals[7];

    // headline single-outcome tip when present ("1"/"X"/"2"), else the
    // most likely 1X2 outcome (double-chance tips fall through to this)
    const tipText = m.find('.tip .value [class^="type"]').first().text().trim();
    let pick = TIP_TO_PICK[tipText] || null;
    if (!pick && [p1, pX, p2].every(Number.isFinite)) {
      const arr = [p1, pX, p2];
      pick = IDX_TO_PICK[arr.indexOf(Math.max(...arr))];
    }

    const totalsPick = Number.isFinite(pOver25)
      ? { selection: pOver25 > 50 ? 'over' : 'under', point: 2.5 }
      : null;

    out.push({
      site: 'statarea',
      homeTeam: home,
      awayTeam: away,
      pick,
      totalsPick,
      rawText: `1X2 ${p1}/${pX}/${p2} · O2.5 ${Number.isFinite(pOver25) ? pOver25 + '%' : '?'}`,
      sourceUrl: urlForDay(isoDay(0)),
    });
  });

  return out;
}

async function fetchStatareaTips() {
  const tips = [];
  const seen = new Set();
  for (let i = 0; i < DAYS; i += 1) {
    let html;
    try {
      html = await fetchHtml('statarea', urlForDay(isoDay(i)));
    } catch (err) {
      console.error(`[tipsters:statarea] day +${i} failed:`, err.message || err);
      continue;
    }
    for (const t of parseDay(html)) {
      const key = `${t.homeTeam.toLowerCase()}|${t.awayTeam.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tips.push(t);
    }
  }
  return tips;
}

module.exports = { fetchStatareaTips, parseDay };
