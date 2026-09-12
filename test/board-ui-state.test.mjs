import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as model from '../public/modules/board/board-model.mjs';

// Execute the real frontend request/state code against a small DOM surface.
// This verifies async state boundaries; visual and native interaction QA still
// requires the browser and is explicitly separate from these tests.
function frontend() {
  const elements = new Map(), timers = new Map(), requests = [], storage = new Map(), windowEvents = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: '', textContent: '', hidden: false, value: '', open: false, dataset: {}, events: {}, attributes: {},
      classList: { add() {}, remove() {} },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener(key, fn) { this.events[key] = fn; },
      insertAdjacentHTML(_position, value) { this.innerHTML += value; },
      scrollIntoView() {}, focus() { document.activeElement = this; },
    });
    return elements.get(id);
  };
  const document = { activeElement: null, visibilityState: 'hidden', getElementById: element, querySelectorAll: () => [], addEventListener() {} };
  let timerId = 0;
  const context = createContext({ model, document, window: { addEventListener(key, callback) { windowEvents[key] = callback; } }, localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); } }, AbortController, URLSearchParams, Intl, Date, console,
    setInterval: () => 0, setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    fetch(url) { return new Promise((resolve, reject) => requests.push({ url: String(url), resolve: value => resolve({ ok: true, json: async () => value }), reject })); },
  });
  const source = readFileSync(new URL('../public/modules/board/board.mjs', import.meta.url), 'utf8').replace(/^import \{([^}]+)\} from '\.\/board-model\.mjs';/, (_match, members) => `const {${members.replace('escapeHtml as html', 'escapeHtml: html')}} = model;`);
  runInContext(source, context, { filename: 'board.mjs' });
  const state = runInContext('state', context);
  state.loading = false;
  state.catalog = { markets: [] };
  return { context, state, elements, element, document, requests, storage, windowEvents,
    call(name, ...args) { context.__args = args; return runInContext(`${name}(...__args)`, context); },
    runSearchTimer() { const entry = [...timers].find(([, timer]) => timer.delay === 220); assert.ok(entry, 'search debounce scheduled'); timers.delete(entry[0]); return entry[1].fn(); },
  };
}

const item = (id, symbol, name = symbol) => model.normalizeItem({ id, market: id.split(':')[0], symbol, name, currency: 'USD', groups: ['nasdaq'], price: 200, updated_at: '2026-09-11T20:00:00Z', fetched_at: '2026-09-12T14:00:00Z', source: 'fixture' });

test('a stale HTTP200 response cannot erase a previously displayed valid market quote', async () => {
  const app = frontend(), previous = item('us:AAPL', 'AAPL', '애플');
  app.state.items.set(previous.id, previous);
  app.state.universe.set('us', new Set([previous.id]));
  const pending = app.call('loadMarket', 'us');
  app.requests.find(request => request.url.startsWith('/api/markets')).resolve({ items: [{ ...previous, price: null, updated_at: null, fetched_at: null }], stale: true, generated_at: null, notes: ['upstream unavailable'] });
  await pending;
  const kept = app.state.items.get(previous.id);
  assert.equal(kept.price, previous.price);
  assert.equal(kept.updated_at, previous.updated_at);
  assert.equal(kept.fetched_at, previous.fetched_at);
  assert.equal(model.quoteStatus(kept, Date.now()).kind, 'stale');
});

test('an earlier chart response cannot replace a later selected instrument and range', async () => {
  const app = frontend();
  for (const row of [item('us:AAPL', 'AAPL'), item('us:MSFT', 'MSFT')]) app.state.items.set(row.id, row);
  app.state.detailId = 'us:AAPL'; app.state.range = '7d';
  const first = app.call('loadChart');
  app.state.detailId = 'us:MSFT'; app.state.range = '28d';
  const second = app.call('loadChart');
  const payload = (id, value) => ({ id, currency: 'USD', points: [{ time: '2026-09-10T00:00:00Z', value: 100 }, { time: '2026-09-11T00:00:00Z', value }], source: id, updated_at: '2026-09-11T00:00:00Z' });
  const requests = app.requests.filter(request => request.url.startsWith('/api/chart'));
  requests[1].resolve(payload('us:MSFT', 202)); await second;
  requests[0].resolve(payload('us:AAPL', 999)); await first;
  assert.equal(app.state.activeChart.id, 'us:MSFT');
  assert.equal(app.state.activeGeometry.points.at(-1).value, 202);
  assert.ok(app.element('chart-meta').innerHTML.includes('us:MSFT'));
  assert.ok(!app.element('chart-meta').innerHTML.includes('us:AAPL'));
});

test('an earlier remote search response cannot replace the results for a new query', async () => {
  const app = frontend(), search = app.element('search');
  app.document.activeElement = search;
  search.value = 'Apple'; app.call('performSearch'); const first = app.runSearchTimer();
  search.value = 'Microsoft'; app.call('performSearch'); const second = app.runSearchTimer();
  const requests = app.requests.filter(request => request.url.startsWith('/api/search'));
  requests[1].resolve({ items: [item('us:MSFT', 'MSFT', 'Microsoft')] }); await second;
  requests[0].resolve({ items: [item('us:AAPL', 'AAPL', 'Apple')] }); await first;
  assert.equal(app.state.searchResults.length, 1);
  assert.equal(app.state.searchResults[0].id, 'us:MSFT');
  assert.ok(app.element('search-results').innerHTML.includes('Microsoft'));
});

test('initial ArrowUp selects the final autocomplete suggestion', () => {
  const app = frontend(), search = app.element('search');
  app.document.activeElement = search; search.value = 'a';
  app.state.searchResults = [item('us:A', 'A'), item('us:AB', 'AB'), item('us:ABC', 'ABC')];
  app.state.searchIndex = -1;
  search.events.keydown({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(app.state.searchIndex, 2);
});

test('ambiguous same-symbol crypto identities do not share a legacy swing score', () => {
  const app = frontend();
  const bitcoin = item('crypto:bitcoin', 'BTC', 'Bitcoin'), other = item('crypto:other-bitcoin', 'BTC', 'Other Bitcoin');
  app.state.items.set(bitcoin.id, bitcoin); app.state.items.set(other.id, other);
  app.state.legacy = { generated_at: '2026-09-11T00:00:00Z', candle_closed: true, items: [{ symbol: 'BTCUSDT', display: 'BTC', score: 99, direction: 'long' }] };
  app.call('renderLegacy', other);
  assert.ok(!app.element('legacy-score').innerHTML.includes('99'), 'a matching ticker is insufficient identity evidence');
});

test('period selection updates the list, detail, chart request and saved preference together', () => {
  const app = frontend(), row = item('us:AAPL', 'AAPL', 'Apple');
  row.momentum = { basis: 'trading_days', periods: { 7: { status: 'ok', return_pct: 20 }, 14: { status: 'ok', return_pct: -10 }, 21: { status: 'gap', return_pct: null }, 28: { status: 'ok', return_pct: 5 } } };
  app.state.items.set(row.id, row); app.state.universe.set('us', new Set([row.id]));
  app.state.detailId = row.id; app.element('detail-dialog').open = true;
  app.call('choosePeriod', 14);
  assert.equal(app.state.period, 14);
  assert.equal(app.state.range, '14d');
  assert.ok(app.element('instrument-list').innerHTML.includes('-10.00%'));
  assert.ok(app.element('detail-momentum').innerHTML.includes('14거래일'));
  assert.ok(app.element('detail-momentum').innerHTML.includes('-10.00%'));
  assert.equal(new URL(app.requests.at(-1).url, 'https://fixture.test').searchParams.get('range'), '14d');
  assert.equal(JSON.parse(app.storage.get(model.PREFERENCES_KEY)).period, 14);
  const count = app.requests.length;
  app.call('choosePeriod', 35);
  assert.equal(app.state.period, 14);
  assert.equal(app.requests.length, count);
  app.call('choosePeriod', 21);
  assert.ok(app.element('detail-momentum').innerHTML.includes('데이터 부족'));
  assert.ok(!app.element('detail-momentum').innerHTML.includes('0.00%'));
});

test('closing detail, changing sort and syncing favorites retain the selected 21-day period', () => {
  const app = frontend(), first = item('us:FIRST', 'FIRST'), second = item('us:SECOND', 'SECOND');
  first.momentum = { periods: { 7: { status: 'ok', return_pct: 70 }, 21: { status: 'ok', return_pct: -21 } } };
  second.momentum = { periods: { 7: { status: 'ok', return_pct: -70 }, 21: { status: 'ok', return_pct: 21 } } };
  for (const row of [first, second]) app.state.items.set(row.id, row);
  app.state.universe.set('us', new Set([first.id, second.id]));
  app.state.detailId = first.id; app.element('detail-dialog').open = true;
  app.call('choosePeriod', 21);
  app.element('detail-dialog').open = false;
  app.element('detail-dialog').events.close();
  assert.equal(app.state.detailId, null);
  app.element('sort').value = 'momentum_desc';
  app.element('sort').events.change();
  app.windowEvents.storage({ key: model.FAVORITES_KEY, newValue: model.serializeFavorites([first]) });
  assert.equal(app.state.period, 21);
  assert.equal(app.state.range, '21d');
  assert.equal(JSON.parse(app.storage.get(model.PREFERENCES_KEY)).period, 21);
  assert.equal(app.state.favorites.has(first.id), true);
  const markup = app.element('instrument-list').innerHTML;
  assert.ok(markup.indexOf('SECOND') < markup.indexOf('FIRST'), 'sort uses 21-day returns, whose ordering is opposite the 7-day returns');
  assert.ok(markup.includes('+21.00%') && markup.includes('-21.00%'));
  assert.ok(!markup.includes('70.00%'));
});

test('the shared hourly refresh reloads legacy scores once, updates open detail and retains prior values on failure', async () => {
  const app = frontend(), bitcoin = item('crypto:bitcoin', 'BTC', 'Bitcoin');
  app.state.market = 'crypto'; app.state.items.set(bitcoin.id, bitcoin); app.state.universe.set('crypto', new Set([bitcoin.id]));
  app.state.detailId = bitcoin.id; app.element('detail-dialog').open = true;
  const snapshot = (score, generated_at) => ({ generated_at, candle_closed: true, items: [{ symbol: 'BTCUSDT', display: 'BTC', score, direction: 'long' }] });
  const old = snapshot(11, '2026-09-12T00:00:00Z'), updated = snapshot(72, '2026-09-13T03:05:00Z');
  app.state.legacy = old;
  assert.equal(app.requests.filter(request => request.url === './data.json').length, 0, 'startup does not race a separate one-off legacy fetch');
  async function refresh(payload, fail = false) {
    const offset = app.requests.length, pending = app.call('refreshController.run');
    await Promise.resolve();
    const requests = app.requests.slice(offset), legacy = requests.filter(request => request.url === './data.json');
    assert.equal(legacy.length, 1);
    const sameRun = app.call('refreshController.run'); assert.strictEqual(sameRun, pending);
    requests.filter(request => request.url.startsWith('/api/markets')).forEach(request => request.resolve({ items: [bitcoin], generated_at: updated.generated_at, stale: false, notes: [] }));
    if (fail) legacy[0].reject(new Error('fixture unavailable')); else legacy[0].resolve(payload);
    for (let i = 0; i < 20 && !app.requests.slice(offset).some(request => request.url.startsWith('/api/chart')); i++) await Promise.resolve();
    const chart = app.requests.slice(offset).find(request => request.url.startsWith('/api/chart'));
    assert.ok(chart, 'the same refresh also reloads the open price chart');
    chart.resolve({ id: bitcoin.id, currency: 'USD', points: [{ time: '2026-09-11T00:00:00Z', value: 100 }, { time: '2026-09-12T00:00:00Z', value: 200 }], source: 'fixture' });
    await pending;
  }
  await refresh(updated);
  assert.equal(app.state.legacy.generated_at, updated.generated_at); assert.equal(app.state.legacy.items[0].score, 72);
  assert.ok(app.element('legacy-score').innerHTML.includes('72 롱')); assert.equal(app.state.legacyError, false);
  await refresh(null, true);
  assert.strictEqual(app.state.legacy, updated); assert.equal(app.state.legacyError, true);
  assert.ok(app.element('legacy-score').innerHTML.includes('72 롱'));
  assert.match(app.element('announcer').textContent, /갱신 확인에 실패.*마지막 데이터를 유지/);
  await refresh({ items: null });
  assert.strictEqual(app.state.legacy, updated); assert.equal(app.state.legacyError, true);
});
