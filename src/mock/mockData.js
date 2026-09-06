const fs = require('fs');
const path = require('path');

const sampleFixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sample-fixtures.json'), 'utf8')
);
const sampleTipsters = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sample-tipsters.json'), 'utf8')
);

function inMinutes(mins) {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

function getMockSgpFixtures() {
  return sampleFixtures.map((f) => ({
    sgpMatchId: f.sgpMatchId,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    league: f.league,
    kickoffISO: inMinutes(f.kickoffInMinutes),
    source: 'singaporepools.com.sg (mock)',
  }));
}

function getMockTipsterPicks() {
  return sampleTipsters.map((t) => ({
    site: t.site,
    homeTeam: t.homeTeam,
    awayTeam: t.awayTeam,
    pick: t.pick,
    totalsPick: t.totalsPick || null,
    rawText: t.rawText,
    sourceUrl: `https://${t.site}.example (mock)`,
  }));
}

module.exports = { getMockSgpFixtures, getMockTipsterPicks };
