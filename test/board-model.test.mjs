import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS as apiMarkets } from '../worker/catalogue.mjs';
import { normalizeCrypto, normalizeNaver } from '../worker/providers.mjs';
import { MARKETS, REFRESH_INTERVAL, normalizeItem, normalizeSearch, rankSearchResults, selectItems, parseFavorites, serializeFavorites, quoteStatus, chartGeometry, createRefreshController } from '../public/modules/board/board-model.mjs';

const now = Date.parse('2026-09-12T15:00:00Z');
const stock = (market, symbol, name, extras = {}) => normalizeItem({ id: `${market}:${symbol}`, market, symbol, name, price: 100, change_pct: 0, market_cap: 1000, ...extras });
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

test('all displayed market and group identifiers are accepted by the API', () => {
  assert.deepEqual(Object.keys(MARKETS).sort(), apiMarkets.map(market => market.id).sort());
  for (const [id, market] of Object.entries(MARKETS)) {
    const api = apiMarkets.find(item => item.id === id);
    assert.equal(market.currency, api.currency);
    for (const group of market.groups) assert.ok(api.groups.some(item => item.id === group.id), `${id}/${group.id}`);
  }
});

test('autocomplete matches Korean spacing, related names and full-width tickers across markets', () => {
  const items = [
    stock('us', 'AAPL', '애플', { name_en: 'Apple Inc.', aliases: ['아이폰'] }),
    stock('kr', '005930.KS', '삼성전자', { aliases: ['Samsung Electronics'] }),
    stock('jp', '7203.T', '도요타 자동차', { name_en: 'Toyota Motor' }),
    stock('us', 'AAP', '어드밴스 오토 파츠', { name_en: 'Advance Auto Parts' }),
  ];
  assert.equal(normalizeSearch(' ＡＡＰＬ '), 'aapl');
  for (const query of ['ＡＡＰＬ', 'apple', '아이폰']) assert.equal(rankSearchResults(items, query)[0].id, 'us:AAPL');
  assert.equal(rankSearchResults(items, '삼성 전자')[0].id, 'kr:005930.KS');
  assert.equal(rankSearchResults(items, '005930')[0].id, 'kr:005930.KS');
  assert.equal(rankSearchResults(items, 'toyota')[0].id, 'jp:7203.T');
  assert.equal(rankSearchResults(items, 'aap')[0].id, 'us:AAP', 'exact ticker precedes longer ticker prefix');
  assert.deepEqual(rankSearchResults(items, 'unmatched'), []);
  assert.deepEqual(rankSearchResults(items, '  '), []);
});

test('favorites preserve metadata across reload, deduplicate ids and include all markets', () => {
  const first = stock('us', 'ABC', 'US ABC', { groups: ['nyse'], history: [1, 2, 3] });
  const second = stock('jp', '1234.T', 'Japan ABC', { symbol: 'ABC', groups: ['prime'] });
  const third = stock('kr', '005930.KS', '삼성전자', { groups: ['kospi'] });
  const saved = parseFavorites(serializeFavorites([first, second, first, third]));
  assert.equal(saved.length, 3);
  assert.deepEqual(saved[0].history, [], 'persist metadata without large price history');
  const selected = selectItems(saved, { market: 'favorites', group: 'kosdaq', favoriteIds: new Set([first.id, second.id]) });
  assert.deepEqual(selected.map(item => item.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(parseFavorites('{bad json'), []);
  assert.deepEqual(parseFavorites('{"fake":true}'), []);
  assert.deepEqual(parseFavorites('[null, 3, {"market":"wrong","id":"wrong:x","symbol":"x"}]'), []);
});

test('market/group filtering and missing-last sorting retain source order and real zero values', () => {
  const items = [
    stock('us', 'MISSING', 'Missing', { groups: ['nasdaq'], change_pct: null }),
    stock('us', 'ZERO', 'Zero', { groups: ['nasdaq'], change_pct: 0 }),
    stock('us', 'DOWN', 'Down', { groups: ['nasdaq'], change_pct: -5 }),
    stock('us', 'OTHER', 'Other', { groups: ['nyse'], change_pct: -10 }),
    stock('kr', '005930.KS', '삼성전자', { groups: ['kospi'], change_pct: 20 }),
  ];
  const original = items.map(item => item.id);
  assert.deepEqual(selectItems(items, { market: 'us', group: 'nasdaq', sort: 'change_asc' }).map(item => item.symbol), ['DOWN', 'ZERO', 'MISSING']);
  assert.deepEqual(items.map(item => item.id), original);
  assert.equal(normalizeItem({ ...items[1], price: '100', market_cap: Infinity }).price, null);
});

test('provider output reaches frontend without treating old quotes as freshly fetched data', () => {
  const provider = normalizeNaver({ symbolCode: 'AAPL', stockName: '애플', closePrice: '200', localTradedAt: '2026-09-11T20:00:00Z' }, 'us', 'nasdaq', now);
  const item = normalizeItem(provider);
  assert.equal(item.price, 200);
  assert.equal(quoteStatus(item, now).kind, 'stale');
  assert.equal(quoteStatus({ ...item, price: null }, now).kind, 'unavailable');
  assert.equal(quoteStatus({ ...item, updated_at: null }, now).kind, 'unknown');
  assert.equal(quoteStatus({ ...item, updated_at: new Date(now).toISOString(), stale: true }, now).kind, 'stale');
});

test('provider crypto ids remain distinct through normalization, storage and selection', () => {
  const items = ['first-coin', 'second-coin'].map(id => normalizeItem(normalizeCrypto({ id, symbol: 'same', name: id, current_price: 1, market_cap_rank: 50, last_updated: new Date(now).toISOString() }, now)));
  const saved = parseFavorites(serializeFavorites(items));
  assert.equal(saved.length, 2);
  assert.equal(quoteStatus(saved[0], now).kind, 'available');
  assert.equal(selectItems(saved, { market: 'favorites', favoriteIds: new Set(['crypto:second-coin']) })[0].id, 'crypto:second-coin');
});

test('chart geometry uses chronological real values and handles flat/missing/duplicate data', () => {
  const geometry = chartGeometry([{ time: now, value: 15 }, { time: now - 60_000, value: 10 }, { time: now, value: 20 }, { time: 'bad', value: 1 }, { time: now + 60_000, value: null }]);
  assert.deepEqual(geometry.points.map(point => point.value), [10, 20]);
  assert.ok(geometry.points[0].x < geometry.points[1].x);
  assert.ok(geometry.points[0].y > geometry.points[1].y);
  const flat = chartGeometry([{ time: now, value: 1 }, { time: now + 60_000, value: 1 }]);
  assert.ok(flat.max > flat.min);
  assert.ok(flat.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.equal(chartGeometry([{ time: now, value: 1 }]), null);
});

test('timer/manual refreshes share one request and failures release the controller for retry', async () => {
  let clock = now, calls = 0, active = deferred();
  const controller = createRefreshController(() => { calls++; return active.promise; }, { now: () => clock });
  assert.equal(controller.nextRefreshAt, now + REFRESH_INTERVAL);
  await controller.tick();
  assert.equal(calls, 0);
  clock += REFRESH_INTERVAL;
  const timed = controller.tick(), manual = controller.run();
  assert.equal(timed, manual);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(controller.busy, true);
  active.resolve('loaded');
  await timed;
  assert.equal(controller.busy, false);
  assert.equal(controller.nextRefreshAt, clock + REFRESH_INTERVAL);
  active = deferred();
  const failure = controller.run();
  active.reject(new Error('offline'));
  await assert.rejects(failure, /offline/);
  assert.equal(controller.busy, false);
  active = deferred();
  const retry = controller.run();
  active.resolve('recovered');
  assert.equal(await retry, 'recovered');
  assert.equal(calls, 3);
});
