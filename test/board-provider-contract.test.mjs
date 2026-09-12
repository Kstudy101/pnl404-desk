import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyItem } from '../worker/catalogue.mjs';
import { fetchChart, normalizeCrypto, normalizeNaver, normalizeYahoo, parseId } from '../worker/providers.mjs';

const now = Date.parse('2026-09-12T15:00:00Z');
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('provider quote time remains distinct from a successful recent fetch', () => {
  const tradedAt = '2026-09-11T16:00:00-04:00';
  const stock = normalizeNaver({ symbolCode: 'AAPL', stockName: '애플', closePrice: '229.10', localTradedAt: tradedAt }, 'us', 'nasdaq', now);
  assert.equal(stock.updated_at, '2026-09-11T20:00:00.000Z');
  assert.equal(stock.fetched_at, '2026-09-12T15:00:00.000Z');
  assert.equal(stock.price, 229.1);
  const unavailable = normalizeNaver({ symbolCode: 'AAPL', stockName: '애플' }, 'us', 'nasdaq', now);
  assert.equal(unavailable.price, null);
  assert.equal(unavailable.updated_at, null);
});

test('crypto symbols can collide without merging identities or favorite/chart keys', () => {
  const base = { symbol: 'same', current_price: 1, market_cap_rank: 50, last_updated: '2026-09-12T14:55:00Z' };
  const items = [normalizeCrypto({ ...base, id: 'first-coin', name: 'First' }, now), normalizeCrypto({ ...base, id: 'second-coin', name: 'Second' }, now)];
  assert.equal(items[0].symbol, items[1].symbol);
  assert.equal(new Set(items.map(item => item.id)).size, 2);
  for (const item of items) assert.equal(parseId(item.id).id, item.id);
});

test('Japanese provider names replace catalogue code placeholders', () => {
  const seed = emptyItem('jp', '4151.T', '4151', ['nikkei225', 'prime']);
  const stock = normalizeYahoo({ meta: { longName: 'Kyowa Kirin Co., Ltd.', regularMarketPrice: 2100, chartPreviousClose: 2000, regularMarketTime: 1789110000, currency: 'JPY' }, indicators: { quote: [{ close: [2000, null, 2100] }] } }, seed, now);
  assert.equal(stock.name, 'Kyowa Kirin Co., Ltd.');
  assert.equal(stock.change_pct, 5);
  assert.deepEqual(stock.history, [2000, 2100]);
  assert.notEqual(stock.updated_at, stock.fetched_at);
});

test('crypto chart contract returns usable numeric points and valid times', async () => {
  const boundary = Date.parse('2026-09-12T00:00:00Z');
  const payload = await fetchChart('crypto:first-coin', '7d', {
    now,
    fetchImpl: async () => json({ prices: [[boundary - 86_400_000, '12.5'], [boundary, 13], [now, 99], ['not-a-time', 99], [boundary, null]] }),
  });
  assert.deepEqual(payload.points, [
    { time: '2026-09-11T00:00:00.000Z', value: 12.5 },
    { time: '2026-09-12T00:00:00.000Z', value: 13 },
  ]);
  assert.equal(payload.updated_at, '2026-09-12T00:00:00.000Z');
});
