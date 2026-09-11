const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed } = require('../src/results/flashscoreResults');

// Builds a synthetic `¬`/`÷` feed record matching the real Flashscore feed
// shape (see flashscoreResults.js's header comment).
function record(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${k}÷${v}`)
    .join('¬');
}

function feed(records) {
  return records.map((r) => record(r)).join('¬');
}

const KICKOFF_TS = 1789000200; // 2026-09-10T00:30:00.000Z

test('parseFeed (live): a recognized AC code maps to its stage label', () => {
  const text = feed([
    { AA: 'id1', AB: '2', AC: '13', AD: KICKOFF_TS, AE: 'Team A', AF: 'Team B', AG: '1', AH: '0' },
  ]);
  const [row] = parseFeed(text, 'live');
  assert.equal(row.stage, '2nd half');
  assert.equal(row.kickoffISO, new Date(KICKOFF_TS * 1000).toISOString());
});

test('parseFeed (live): AC="38" maps to "2nd half" (an undocumented Flashscore variant seen in production)', () => {
  const text = feed([
    { AA: 'id1', AB: '2', AC: '38', AD: KICKOFF_TS, AE: 'Ind. del Valle', AF: 'Flamengo', AG: '0', AH: '0' },
  ]);
  const [row] = parseFeed(text, 'live');
  assert.equal(row.stage, '2nd half');
});

test('parseFeed (live): a truly unrecognized AC code falls back to a generic "live" stage rather than throwing', () => {
  const text = feed([
    { AA: 'id1', AB: '2', AC: '99', AD: KICKOFF_TS, AE: 'Team A', AF: 'Team B', AG: '0', AH: '0' },
  ]);
  const [row] = parseFeed(text, 'live');
  assert.equal(row.stage, 'live');
});

test('parseFeed (live): HT, 1st half, extra time, and penalties codes all map correctly', () => {
  const text = feed([
    { AA: 'id1', AB: '2', AC: '11', AD: KICKOFF_TS, AE: 'A', AF: 'B', AG: '0', AH: '0' },
    { AA: 'id2', AB: '2', AC: '12', AD: KICKOFF_TS, AE: 'C', AF: 'D', AG: '0', AH: '0' },
    { AA: 'id3', AB: '2', AC: '40', AD: KICKOFF_TS, AE: 'E', AF: 'F', AG: '0', AH: '0' },
    { AA: 'id4', AB: '2', AC: '41', AD: KICKOFF_TS, AE: 'G', AF: 'H', AG: '0', AH: '0' },
    { AA: 'id5', AB: '2', AC: '50', AD: KICKOFF_TS, AE: 'I', AF: 'J', AG: '0', AH: '0' },
  ]);
  const rows = parseFeed(text, 'live');
  assert.deepEqual(rows.map((r) => r.stage), ['HT', '1st half', 'extra time', 'extra time', 'penalties']);
});
