import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/index.mjs';

function memoryCache() {
  const values = new Map();
  return {
    async match(request) { return values.get(request.url)?.clone(); },
    async put(request, response) { values.set(request.url, response.clone()); },
  };
}

const chartRequest = () => new Request('https://desk.test/api/chart?id=us%3AAAPL&range=7d');
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('chart API expires after 900 seconds and a failed refresh preserves quote history and its age', async () => {
  let now = Date.parse('2026-09-12T15:00:00Z'), calls = 0, fail = false;
  const cache = memoryCache();
  const fetchImpl = async () => {
    calls++;
    if (fail) return new Response('unavailable', { status: 503 });
    return json({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: [(now - 60_000) / 1000, now / 1000], indicators: { quote: [{ close: [200, 200 + calls] }] } }] } });
  };
  const load = async () => (await handleRequest(chartRequest(), {}, {}, { cache, fetchImpl, now: () => now })).json();
  const first = await load();
  assert.equal(first.points.at(-1).value, 201);
  assert.equal(first.stale, false);
  assert.equal(Date.parse(first.next_refresh_at) - Date.parse(first.generated_at), 900_000);
  now += 899_999;
  assert.deepEqual(await load(), first);
  assert.equal(calls, 1);
  now++;
  const second = await load();
  assert.equal(calls, 2);
  assert.equal(second.points.at(-1).value, 202);
  assert.notEqual(second.generated_at, first.generated_at);
  now += 900_000;
  fail = true;
  const stale = await load();
  assert.equal(calls, 3);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.points, second.points);
  assert.equal(stale.generated_at, second.generated_at);
  assert.equal(stale.updated_at, second.updated_at);
  assert.equal(stale.fetched_at, second.fetched_at);
  assert.equal(stale.checked_at, new Date(now).toISOString());
  assert.ok(stale.notes.some(note => note.includes('갱신 실패')));
  await load();
  assert.equal(calls, 3, 'failed provider is not retried on every browser request');
});

test('an unavailable initial chart has explicit empty data instead of invented fresh prices', async () => {
  const response = await handleRequest(chartRequest(), {}, {}, {
    cache: memoryCache(), now: () => Date.parse('2026-09-12T15:00:00Z'),
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  });
  assert.equal(response.status, 200);
  const chart = await response.json();
  assert.equal(chart.id, 'us:AAPL');
  assert.equal(chart.currency, 'USD');
  assert.deepEqual(chart.points, []);
  assert.equal(chart.generated_at, null);
  assert.equal(chart.updated_at, null);
  assert.equal(chart.stale, true);
  assert.ok(chart.notes.some(note => note.includes('연결하지 못했습니다')));
});

test('invalid market, group, identity, range and mutation routes are rejected before provider access', async () => {
  let calls = 0;
  const overrides = { cache: memoryCache(), fetchImpl: async () => { calls++; throw new Error('unexpected request'); } };
  for (const suffix of ['/api/markets?market=unknown', '/api/markets?market=jp&group=kospi', '/api/chart?id=kr:AAPL', '/api/chart?id=us:AAPL&range=999y', '/api/chart?id=us:AAPL&range=1mo', '/api/chart?id=us:AAPL&range=1y', '/api/chart?id=us:AAPL&range=29d']) {
    assert.equal((await handleRequest(new Request(`https://desk.test${suffix}`), {}, {}, overrides)).status, 400);
  }
  assert.equal((await handleRequest(new Request('https://desk.test/api/markets', { method: 'POST' }), {}, {}, overrides)).status, 405);
  assert.equal(calls, 0);
});

test('static page requests are forwarded to the configured asset binding', async () => {
  const original = new Request('https://desk.test/modules/board/');
  let received;
  const response = await handleRequest(original, { ASSETS: { async fetch(request) { received = request; return new Response('board html'); } } });
  assert.equal(received, original);
  assert.equal(await response.text(), 'board html');
});
