const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAh,
  parseHcapValue,
  parseOu,
  parseH1,
  parseOe,
  parseBtts,
  parseFirstGoal,
  parseGoalHandicap,
  parseHandicap1X2,
} = require('../src/scrapers/singaporePools/odds');

// Real shape verified via a live betType=AH capture (2026-09-12): each
// event carries a plain "Asian Handicap" market plus a "Half Time Asian
// Handicap" one at the same minorCode ('AH') — must filter by exact name,
// not just minorCode. Outcome prices carry the actual settlement line(s)
// in `hcapValue` (comma-separated for a quarter line), which is what's
// trusted here — NOT the market's own top-level `handicapValue`, which was
// seen stale/unrelated to the real per-outcome line in that capture.
function ahEvent({ id = '1', homeHcap = '-0.50,-1.00,', awayHcap = '0.50,1.00,', homePrice = '1.87', awayPrice = '1.90', includeHalfTime = true }) {
  const markets = [
    {
      minorCode: 'AH',
      name: 'Asian Handicap',
      handicapValue: '-3.0', // deliberately mismatched vs the real per-outcome line, per the real capture
      outcomes: [
        { minorCode: 'H', name: 'Home -0.75', prices: [{ decimal: homePrice, hcapValue: homeHcap }] },
        { minorCode: 'A', name: 'Away +0.75', prices: [{ decimal: awayPrice, hcapValue: awayHcap }] },
      ],
    },
  ];
  if (includeHalfTime) {
    markets.push({
      minorCode: 'AH',
      name: 'Half Time Asian Handicap',
      handicapValue: '-1.0',
      outcomes: [
        { minorCode: 'H', name: 'Home -0.25', prices: [{ decimal: '1.82', hcapValue: '0.00,-0.50,' }] },
        { minorCode: 'A', name: 'Away +0.25', prices: [{ decimal: '1.95', hcapValue: '0.00,0.50,' }] },
      ],
    });
  }
  return { id, markets };
}

test('parseHcapValue: averages a comma-separated quarter-line split', () => {
  assert.equal(parseHcapValue('-0.50,-1.00,'), -0.75);
  assert.equal(parseHcapValue('0.50,1.00,'), 0.75);
});

test('parseHcapValue: a single value (whole/half line) returns itself', () => {
  assert.equal(parseHcapValue('-1.00,'), -1);
  assert.equal(parseHcapValue('-0.50,'), -0.5);
});

test('parseHcapValue: empty/garbage input returns null', () => {
  assert.equal(parseHcapValue(''), null);
  assert.equal(parseHcapValue(null), null);
});

test('parseAh: reads the real "Asian Handicap" market, deriving the line from hcapValue not the market\'s own handicapValue', () => {
  const byId = parseAh([ahEvent({ id: '144368' })]);
  const ah = byId.get('144368');
  assert.deepEqual(ah, { point: -0.75, home: 1.87, away: 1.9 });
});

test('parseAh: ignores the "Half Time Asian Handicap" market at the same minorCode', () => {
  const byId = parseAh([ahEvent({ id: '1', includeHalfTime: true })]);
  // only one entry produced per event (the full-time market), not two
  assert.equal(byId.size, 1);
});

test('parseAh: whole and half lines (no split needed in hcapValue) parse correctly', () => {
  const byId = parseAh([ahEvent({ id: '2', homeHcap: '-1.00,', awayHcap: '1.00,', includeHalfTime: false })]);
  assert.equal(byId.get('2').point, -1);
  const byId2 = parseAh([ahEvent({ id: '3', homeHcap: '-0.50,', awayHcap: '0.50,', includeHalfTime: false })]);
  assert.equal(byId2.get('3').point, -0.5);
});

test('parseAh: no Asian Handicap market on the event -> not included', () => {
  const byId = parseAh([{ id: '4', markets: [{ minorCode: 'MR', name: '1X2', outcomes: [] }] }]);
  assert.equal(byId.size, 0);
});

test('parseAh: empty/missing events array -> empty map, no throw', () => {
  assert.equal(parseAh([]).size, 0);
  assert.equal(parseAh(null).size, 0);
});

test('parseOu: still works (regression guard for the shared priceOf/num helpers)', () => {
  const byId = parseOu([
    {
      id: '5',
      markets: [
        {
          name: 'Total Goals Over/Under 2.5',
          outcomes: [
            { minorCode: 'H', prices: [{ decimal: '1.9' }] },
            { minorCode: 'L', prices: [{ decimal: '1.9' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('5'), { point: 2.5, over: 1.9, under: 1.9 });
});

// ---- the rest of SG Pools' bet types — shapes below modeled directly on
// a live capture of each betType (2026-09-13, see debug-tipsters/
// sgpools-betTypes-probe.json in that session's throwaway debug branch). ----

test('parseH1: reads Halftime 1X2 (home/draw/away, same minorCode convention as 1X2)', () => {
  const byId = parseH1([
    {
      id: '144457',
      markets: [
        {
          minorCode: 'H1',
          name: 'Halftime 1X2',
          outcomes: [
            { minorCode: 'H', name: 'Sangmu', prices: [{ decimal: '3.30' }] },
            { minorCode: 'D', name: 'Draw', prices: [{ decimal: '1.97' }] },
            { minorCode: 'A', name: 'Gangwon', prices: [{ decimal: '3.20' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('144457'), { home: 3.3, draw: 1.97, away: 3.2 });
});

test('parseOe: reads Total Goals Odd/Even, matching by outcome name (minorCode is just "1"/"2")', () => {
  const byId = parseOe([
    {
      id: '144457',
      markets: [
        {
          minorCode: 'OE',
          name: 'Total Goals Odd/Even',
          outcomes: [
            { minorCode: '1', name: 'Odd', prices: [{ decimal: '1.85' }] },
            { minorCode: '2', name: 'Even', prices: [{ decimal: '1.80' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('144457'), { odd: 1.85, even: 1.8 });
});

test('parseOe: ignores the "Halftime Total Goals Odd/Even" market at the same minorCode', () => {
  const byId = parseOe([
    {
      id: '1',
      markets: [
        {
          minorCode: 'OE',
          name: 'Halftime Total Goals Odd/Even',
          outcomes: [
            { minorCode: '1', name: 'Odd', prices: [{ decimal: '1.9' }] },
            { minorCode: '2', name: 'Even', prices: [{ decimal: '1.9' }] },
          ],
        },
      ],
    },
  ]);
  assert.equal(byId.size, 0);
});

test('parseBtts: reads Will Both Teams Score (Y/N minorCodes)', () => {
  const byId = parseBtts([
    {
      id: '1',
      markets: [
        {
          minorCode: 'BG',
          name: 'Will Both Teams Score',
          outcomes: [
            { minorCode: 'Y', name: 'Yes', prices: [{ decimal: '1.87' }] },
            { minorCode: 'N', name: 'No', prices: [{ decimal: '1.77' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('1'), { yes: 1.87, no: 1.77 });
});

test('parseFirstGoal: reads Team to Score 1st Goal (home/away/no-goal)', () => {
  const byId = parseFirstGoal([
    {
      id: '1',
      markets: [
        {
          minorCode: 'NGN',
          name: 'Team to Score 1st Goal',
          outcomes: [
            { minorCode: 'H', name: 'Tokyo Verdy', prices: [{ decimal: '1.82' }] },
            { minorCode: 'A', name: 'JEF Utd Chiba', prices: [{ decimal: '2.35' }] },
            { minorCode: 'N', name: 'No 1st Goal', prices: [{ decimal: '8.00' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('1'), { home: 1.82, away: 2.35, none: 8 });
});

test('parseGoalHandicap: reads "1/2 Goal", deriving the line from hcapValue like AH', () => {
  const byId = parseGoalHandicap([
    {
      id: '1',
      markets: [
        {
          minorCode: 'WH',
          name: '1/2 Goal',
          handicapValue: '1.5',
          outcomes: [
            { minorCode: 'H', name: 'Sangmu +1.5', prices: [{ decimal: '1.07', hcapValue: '1.5,' }] },
            { minorCode: 'A', name: 'Gangwon -1.5', prices: [{ decimal: '6.00', hcapValue: '-1.5,' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('1'), { point: 1.5, home: 1.07, away: 6 });
});

test('parseGoalHandicap: ignores the "Half Time 1/2 Goal" market at the same minorCode', () => {
  const byId = parseGoalHandicap([
    {
      id: '1',
      markets: [
        {
          minorCode: 'WH',
          name: 'Half Time 1/2 Goal',
          handicapValue: '0.5',
          outcomes: [
            { minorCode: 'H', prices: [{ decimal: '1.8', hcapValue: '0.5,' }] },
            { minorCode: 'A', prices: [{ decimal: '1.9', hcapValue: '-0.5,' }] },
          ],
        },
      ],
    },
  ]);
  assert.equal(byId.size, 0);
});

test('parseHandicap1X2: reads "Handicap 1X2" — draw outcome is minorCode "L", not "D"', () => {
  const byId = parseHandicap1X2([
    {
      id: '1',
      markets: [
        {
          minorCode: 'MH',
          name: 'Handicap 1X2',
          handicapValue: '2.0',
          outcomes: [
            { minorCode: 'H', name: 'Young Lions (+2.0)', prices: [{ decimal: '2.70', hcapValue: '2.0,' }] },
            { minorCode: 'L', name: 'Draw (+2.0)', prices: [{ decimal: '3.70', hcapValue: '2.0,' }] },
            { minorCode: 'A', name: 'FC Jurong (-2.0)', prices: [{ decimal: '1.97', hcapValue: '-2.0,' }] },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(byId.get('1'), { point: 2, home: 2.7, draw: 3.7, away: 1.97 });
});
