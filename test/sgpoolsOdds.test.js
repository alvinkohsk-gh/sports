const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAh, parseHcapValue, parseOu } = require('../src/scrapers/singaporePools/odds');

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
