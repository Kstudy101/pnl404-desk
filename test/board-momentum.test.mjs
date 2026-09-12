import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { handleRequest } from '../worker/index.mjs';
import { normalizeItem, momentumFor, momentumBlocks, selectItems } from '../public/modules/board/board-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = [process.env.MARKET_PYTHON, resolve(root, '.venv-market/Scripts/python.exe'), resolve(root, '.venv-market/bin/python'), 'python3', 'python'].filter(Boolean).find(command => (!command.includes('/') && !command.includes('\\') || existsSync(command)) && spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0);
const options = { skip: !python && 'Set MARKET_PYTHON or install .venv-market for the offline momentum fixtures.' };
const expectedReturns = { 7: -25, 14: 12.5, 21: -10, 28: -1 };
const almostEqual = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

// Fixed time and external-call-free fixtures follow the selected Python testing
// skill. Expected values below are independent endpoint ratios, not a second
// implementation of the production momentum algorithm.
function calculate(body = '') {
  const script = `
import sys
sys.dont_write_bytecode = True
import importlib.util, json, pathlib
from datetime import date, timedelta
spec = importlib.util.spec_from_file_location('momentum_under_test', pathlib.Path(sys.argv[1]) / 'scripts/market-momentum.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = '2026-09-12T15:00:00Z'
stock = {'id':'us:AAPL','market':'us','symbol':'AAPL','name':'Apple','currency':'USD','price_basis':'daily_close'}
crypto = {'id':'crypto:first-coin','market':'crypto','symbol':'SAME','name':'First Coin','currency':'USD','price_basis':'aggregate_spot'}
levels = [100,110,88,132,99]
values = [levels[index//7] + (levels[index//7+1]-levels[index//7])*(index%7)/7 if index < 28 else 99 for index in range(29)]
day = date(2026,9,11)
trading_dates = []
while len(trading_dates)<29:
    if day.weekday()<5 and day!=date(2026,9,7): trading_dates.append(day)
    day -= timedelta(days=1)
trading_dates.reverse()
# A crypto midnight observation is the close boundary of the preceding UTC day.
calendar_dates = [date(2026,9,12)-timedelta(days=28-index) for index in range(29)]
def make_history(item, dates, closes):
    return {'id':item['id'],'currency':item['currency'],'price_basis':'daily_close','interval':'1d','source':'isolated fixture','fetched_at':NOW,'generated_at':NOW,'updated_at':dates[-1].isoformat()+'T00:00:00Z','points':[{'time':day.isoformat()+'T00:00:00Z','value':close} for day,close in zip(dates,closes)]}
stock_history = make_history(stock,trading_dates,values)
crypto_history = make_history(crypto,calendar_dates,values)
${body || "print(json.dumps({'stock':m.calculate_momentum(stock,stock_history,NOW),'crypto':m.calculate_momentum(crypto,crypto_history,NOW)},allow_nan=False))"}
`;
  const result = spawnSync(python, ['-c', script, root], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('momentum uses N+1 completed closes for every supported stock and crypto period', options, () => {
  const data = calculate();
  assert.equal(data.stock.basis, 'trading_days');
  assert.equal(data.crypto.basis, 'calendar_days');
  for (const momentum of Object.values(data)) {
    assert.deepEqual(Object.keys(momentum.periods).sort((a, b) => a - b), ['7', '14', '21', '28']);
    for (const [period, expected] of Object.entries(expectedReturns)) {
      const value = momentum.periods[period];
      assert.equal(value.status, 'ok');
      assert.equal(value.sessions, Number(period));
      assert.equal(value.required_observations, Number(period) + 1);
      almostEqual(value.return_pct, expected);
      almostEqual((value.end_close / value.start_close - 1) * 100, expected);
      assert.equal(value.direction, expected > 0 ? 'up' : 'down');
      assert.ok(Date.parse(value.start_at) < Date.parse(value.end_at));
    }
  }
  assert.ok(Date.parse(data.stock.periods['7'].end_at) - Date.parse(data.stock.periods['7'].start_at) > 7 * 86400_000, 'stock period crosses weekends and the fixture holiday');
  assert.equal(Date.parse(data.crypto.periods['7'].end_at) - Date.parse(data.crypto.periods['7'].start_at), 7 * 86400_000);
});

test('four seven-day blocks share only boundary closes and compound to the 28-period return', options, () => {
  for (const momentum of Object.values(calculate())) {
    assert.equal(momentum.blocks.length, 4);
    const expected = [10, -20, 50, -25];
    for (const [index, block] of momentum.blocks.entries()) {
      assert.equal(block.status, 'ok');
      assert.equal(block.sessions, 7);
      assert.equal(block.required_observations, 8);
      almostEqual(block.return_pct, expected[index]);
      if (index) assert.equal(block.start_at, momentum.blocks[index - 1].end_at);
    }
    assert.equal(momentum.blocks[0].start_at, momentum.periods['28'].start_at);
    assert.equal(momentum.blocks.at(-1).end_at, momentum.periods['7'].end_at);
    const compounded = (momentum.blocks.reduce((product, block) => product * (1 + block.return_pct / 100), 1) - 1) * 100;
    almostEqual(compounded, momentum.periods['28'].return_pct);
  }
});

test('current and future daily observations cannot change completed momentum', options, () => {
  const data = calculate(`
result = {}
for item,history in [(stock,stock_history),(crypto,crypto_history)]:
    before = m.calculate_momentum(item,history,NOW)
    current = '2026-09-12T12:00:00Z' if item['market']=='crypto' else '2026-09-12T00:00:00Z'
    history['points'] += [{'time':current,'value':9999},{'time':'2026-09-13T00:00:00Z','value':99999}]
    result[item['market']] = [before,m.calculate_momentum(item,history,NOW)]
print(json.dumps(result,allow_nan=False))
`);
  for (const [before, after] of Object.values(data)) {
    assert.deepEqual(after.periods, before.periods);
    assert.deepEqual(after.blocks, before.blocks);
    assert.equal(after.as_of, before.as_of);
  }
});

test('insufficient history and zero denominators are unavailable rather than neutral momentum', options, () => {
  const data = calculate(`
short = {**stock_history,'points':stock_history['points'][-7:]}
zero = {**stock_history,'points':[dict(point) for point in stock_history['points']]}
zero['points'][0]['value']=0
flat = make_history(stock,trading_dates,[100]*29)
print(json.dumps({'short':m.calculate_momentum(stock,short,NOW),'zero':m.calculate_momentum(stock,zero,NOW),'flat':m.calculate_momentum(stock,flat,NOW)},allow_nan=False))
`);
  assert.equal(data.short.periods['7'].status, 'insufficient');
  assert.equal(data.short.periods['7'].return_pct, null);
  assert.equal(data.short.periods['7'].direction, null);
  assert.equal(data.short.periods['7'].required_observations, 8);
  assert.equal(data.zero.periods['28'].status, 'invalid');
  assert.equal(data.zero.periods['28'].return_pct, null);
  for (const period of Object.values(data.flat.periods)) {
    assert.equal(period.status, 'ok');
    assert.equal(period.return_pct, 0);
    assert.equal(period.direction, 'flat');
  }
});

test('crypto calendar gaps affect only periods containing the missing day', options, () => {
  const data = calculate(`
early = {'time':(calendar_dates[0]-timedelta(days=1)).isoformat()+'T00:00:00Z','value':100}
recent_gap = {**crypto_history,'points':[early]+[point for index,point in enumerate(crypto_history['points']) if index!=25]}
old_gap = {**crypto_history,'points':[early]+[point for index,point in enumerate(crypto_history['points']) if index!=2]}
print(json.dumps({'recent':m.calculate_momentum(crypto,recent_gap,NOW),'old':m.calculate_momentum(crypto,old_gap,NOW)},allow_nan=False))
`);
  for (const period of Object.values(data.recent.periods)) {
    assert.equal(period.status, 'gap');
    assert.equal(period.return_pct, null);
  }
  assert.equal(data.old.periods['7'].status, 'ok');
  assert.equal(data.old.periods['14'].status, 'ok');
  assert.equal(data.old.periods['21'].status, 'ok');
  assert.equal(data.old.periods['28'].status, 'gap');
});

test('conflicting duplicate dates and mismatched same-symbol history files cannot produce momentum', options, () => {
  const data = calculate(`
import tempfile
duplicate = {**crypto_history,'points':crypto_history['points']+[{'time':crypto_history['points'][-1]['time'],'value':999}]}
wrong_item = {**crypto,'id':'crypto:second-coin','name':'Second Coin'}
with tempfile.TemporaryDirectory(prefix='pnl404-momentum-qa-') as temporary:
    directory=pathlib.Path(temporary).resolve()
    assert directory.parent==pathlib.Path(tempfile.gettempdir()).resolve() and directory.name.startswith('pnl404-momentum-qa-')
    (directory/m.filename(wrong_item['id'])).write_text(json.dumps(crypto_history),encoding='utf-8')
    rejected=m.read_history(directory,wrong_item)
    assert rejected=={}
    print(json.dumps({'duplicate':m.calculate_momentum(crypto,duplicate,NOW),'identity':m.calculate_momentum(wrong_item,crypto_history,NOW),'file_identity':m.calculate_momentum(wrong_item,rejected,NOW)},allow_nan=False))
`);
  for (const [kind, momentum] of Object.entries(data)) for (const period of Object.values(momentum.periods)) {
    assert.equal(period.status, kind === 'file_identity' ? 'insufficient' : 'invalid');
    assert.equal(period.return_pct, null);
    assert.equal(period.direction, null);
  }
});

test('crypto history bootstrap keeps same-symbol IDs separate and fetches once per completed UTC boundary', options, () => {
  const data = calculate(`
import tempfile
other = {**crypto,'id':'crypto:second-coin','name':'Second Coin'}
calls = []
prices = [[m.instant(point['time']).timestamp()*1000,point['value']] for point in crypto_history['points']]
prices += [[m.instant('2026-09-12T15:00:00Z').timestamp()*1000,9999],[m.instant('2026-09-13T00:00:00Z').timestamp()*1000,105]]
def fetcher(identifier):
    calls.append(identifier)
    return {'prices':prices}
with tempfile.TemporaryDirectory(prefix='pnl404-momentum-qa-') as temporary:
    directory=pathlib.Path(temporary).resolve()
    assert directory.parent==pathlib.Path(tempfile.gettempdir()).resolve() and directory.name.startswith('pnl404-momentum-qa-')
    first=m.refresh_crypto_histories([crypto,other],directory,NOW,fetcher=fetcher,sleeper=lambda seconds:None)
    original=m.read_history(directory,crypto)
    repeat=m.refresh_crypto_histories([crypto,other],directory,'2026-09-12T15:15:00Z',fetcher=fetcher,sleeper=lambda seconds:None)
    before=m.refresh_crypto_histories([crypto,other],directory,'2026-09-13T00:09:59Z',fetcher=fetcher,sleeper=lambda seconds:None)
    after=m.refresh_crypto_histories([crypto,other],directory,'2026-09-13T00:10:00Z',fetcher=fetcher,sleeper=lambda seconds:None)
    final=[m.read_history(directory,item) for item in [crypto,other]]
    print(json.dumps({'first':first,'repeat':repeat,'before':before,'after':after,'original':original,'final':final,'calls':calls},allow_nan=False))
`);
  assert.equal(data.first.updated, 2);
  assert.equal(data.repeat.attempted, 0);
  assert.equal(data.before.attempted, 0);
  assert.equal(data.after.updated, 2);
  assert.equal(data.calls.length, 4);
  assert.deepEqual(data.final.map(history => history.id), ['crypto:first-coin', 'crypto:second-coin']);
  assert.equal(data.original.points.at(-1).time, '2026-09-12T00:00:00Z');
  assert.equal(data.original.points.at(-1).bar_date, '2026-09-11');
  assert.equal(data.final[0].points.at(-1).time, '2026-09-13T00:00:00Z');
  assert.equal(data.final[0].points.at(-1).value, 105);
  assert.ok(!data.final[0].points.some(point => point.value === 9999));
});

test('crypto history rate limiting stops the batch and retains old prices and fetch times', options, () => {
  const data = calculate(`
import tempfile, urllib.error
other = {**crypto,'id':'crypto:second-coin','name':'Second Coin'}
prices = [[m.instant(point['time']).timestamp()*1000,point['value']] for point in crypto_history['points']]
calls=[]
def limited(identifier):
    calls.append(identifier)
    raise urllib.error.HTTPError('https://fixture.invalid',429,'rate limited',{},None)
with tempfile.TemporaryDirectory(prefix='pnl404-momentum-qa-') as temporary:
    directory=pathlib.Path(temporary).resolve()
    assert directory.parent==pathlib.Path(tempfile.gettempdir()).resolve() and directory.name.startswith('pnl404-momentum-qa-')
    for item in [crypto,other]:m.atomic_json(directory/m.filename(item['id']),m.daily_crypto_history(item,{'prices':prices},NOW))
    before=m.read_history(directory,crypto)
    result=m.refresh_crypto_histories([crypto,other],directory,'2026-09-13T00:10:00Z',fetcher=limited,sleeper=lambda seconds:None)
    print(json.dumps({'report':result,'calls':calls,'before':before,'after':m.read_history(directory,crypto)},allow_nan=False))
`);
  assert.equal(data.report.attempted, 1);
  assert.equal(data.report.failed, 1);
  assert.equal(data.report.deferred, 1);
  assert.equal(data.calls.length, 1);
  assert.deepEqual(data.after.points, data.before.points);
  assert.equal(data.after.updated_at, data.before.updated_at);
  assert.equal(data.after.fetched_at, data.before.fetched_at);
  assert.equal(data.after.stale, true);
});

test('a new calculation cannot make failed stock input or deferred old crypto history look current', options, () => {
  const data = calculate(`
old_crypto={**crypto_history,'points':crypto_history['points'][:-1],'fetched_at':'2026-09-11T15:00:00Z','stale':False}
failed_stock={**stock,'stale':True}
print(json.dumps({'stock':m.calculate_momentum(failed_stock,stock_history,NOW),'crypto':m.calculate_momentum(crypto,old_crypto,NOW)},allow_nan=False))
`);
  assert.equal(data.stock.stale, true);
  assert.equal(data.crypto.stale, true);
  assert.equal(data.crypto.data_fetched_at, '2026-09-11T15:00:00Z');
  assert.equal(data.crypto.as_of, '2026-09-11T00:00:00Z');
  assert.equal(data.crypto.calculated_at, '2026-09-12T15:00:00Z');
});

test('Python annotations preserve selected-period returns across Worker and frontend consumers', options, async () => {
  const data = calculate(`
import tempfile
stock['price']=99
crypto['price']=1000
with tempfile.TemporaryDirectory(prefix='pnl404-momentum-qa-') as temporary:
    directory=pathlib.Path(temporary).resolve()
    assert directory.parent==pathlib.Path(tempfile.gettempdir()).resolve() and directory.name.startswith('pnl404-momentum-qa-')
    m.atomic_json(directory/m.filename(stock['id']),stock_history)
    m.atomic_json(directory/m.filename(crypto['id']),crypto_history)
    original={'schema_version':1,'collector':'python-finance-packages','generated_at':NOW,'next_refresh_at':'2026-09-12T15:15:00Z','items':[stock,crypto],'markets':[]}
    snapshot=m.annotate_snapshot(original,directory,NOW,crypto_history_budget=0)
    print(json.dumps({'snapshot':snapshot,'histories':{stock['id']:stock_history,crypto['id']:crypto_history}},allow_nan=False))
`);
  const assets = new Map([['/modules/board/markets.json', data.snapshot], ...Object.entries(data.histories).map(([id, history]) => ['/modules/board/history/' + id.replace(':', '_') + '.json', history])]);
  let externalCalls = 0;
  const env = { MARKET_DATA_MODE: 'python', ASSETS: { async fetch(request) {
    const content = assets.get(decodeURIComponent(new URL(request.url).pathname));
    return content ? new Response(JSON.stringify(content), { headers: { 'Content-Type': 'application/json' } }) : new Response('missing', { status: 404 });
  } } };
  const overrides = { now: () => Date.parse('2026-09-12T15:00:00Z'), fetchImpl: async () => { externalCalls++; throw new Error('unexpected live request'); } };
  for (const market of ['us', 'crypto']) {
    const response = await handleRequest(new Request('https://fixture.test/api/markets?market=' + market), env, {}, overrides);
    assert.equal(response.status, 200);
    const item = normalizeItem((await response.json()).items[0]);
    for (const [period, expected] of Object.entries(expectedReturns)) {
      const momentum = momentumFor(item, Number(period));
      assert.equal(momentum.available, true);
      almostEqual(momentum.return_pct, expected);
      assert.equal(momentum.direction.key, expected > 0 ? 'up' : 'down');
      assert.equal(momentum.end_date, '2026-09-11');
      const chartResponse = await handleRequest(new Request('https://fixture.test/api/chart?' + new URLSearchParams({ id: item.id, range: period + 'd' })), env, {}, overrides);
      assert.equal(chartResponse.status, 200);
      const chart = await chartResponse.json();
      assert.equal(chart.points.length, Number(period) + 1);
      almostEqual(chart.selected_momentum.return_pct, expected);
      almostEqual((chart.points.at(-1).value / chart.points[0].value - 1) * 100, expected);
      assert.equal(chart.points[0].time, chart.selected_momentum.start_at);
      assert.equal(chart.points.at(-1).time, chart.selected_momentum.end_at);
    }
    momentumBlocks(item).forEach((block, index) => almostEqual(block.return_pct, [10, -20, 50, -25][index]));
    if (market === 'crypto') assert.equal(item.price, 1000, 'spot quote remains separate from the daily momentum endpoint of 99');
  }
  assert.equal(externalCalls, 0);
});

test('frontend momentum sorting follows the selected period and rejects unconfirmed result statuses', () => {
  const make = (id, periods) => normalizeItem({ id, market: 'us', symbol: id.split(':')[1], name: id, groups: [], momentum: { periods } });
  const first = make('us:FIRST', { 7: { status: 'ok', return_pct: 20 }, 14: { status: 'ok', return_pct: -10 } });
  const second = make('us:SECOND', { 7: { status: 'ok', return_pct: -5 }, 14: { status: 'ok', return_pct: 30 } });
  const missing = make('us:MISSING', { 7: { status: 'gap', return_pct: 999 }, 14: { status: 'invalid', return_pct: 999 } });
  assert.deepEqual(selectItems([missing, first, second], { market: 'us', sort: 'momentum_desc', period: 7 }).map(item => item.id), ['us:FIRST', 'us:SECOND', 'us:MISSING']);
  assert.deepEqual(selectItems([missing, first, second], { market: 'us', sort: 'momentum_desc', period: 14 }).map(item => item.id), ['us:SECOND', 'us:FIRST', 'us:MISSING']);
  for (const status of ['insufficient', 'gap', 'invalid', 'pending', undefined]) {
    const item = make('us:BAD', { 7: { status, return_pct: 99 } });
    item.momentum.blocks = [{ status, return_pct: 99 }];
    assert.equal(momentumFor(item, 7).available, false);
    assert.equal(momentumFor(item, 7).direction.key, 'missing');
    assert.equal(momentumBlocks(item)[0].available, false);
  }
  assert.equal(momentumFor(make('us:FLAT', { 7: { status: 'ok', return_pct: 0 } }), 7).direction.key, 'neutral');
});

test('a fresh spot snapshot cannot hide a deferred stale crypto daily chart', async () => {
  const id = 'crypto:first-coin', now = Date.parse('2026-09-12T15:00:00Z');
  const history = { id, currency: 'USD', source: 'CoinGecko (UTC 일봉)', generated_at: '2026-09-11T15:00:00Z', updated_at: '2026-09-11T00:00:00Z', stale: false, price_basis: 'daily_close', points: Array.from({ length: 8 }, (_, index) => ({ time: new Date(Date.parse('2026-09-04T00:00:00Z') + index * 86400_000).toISOString(), value: 100 + index })) };
  const snapshot = { collector: 'python-finance-packages', generated_at: new Date(now).toISOString(), stale: false, items: [{ id, market: 'crypto', currency: 'USD', price: 999, stale: false, momentum: { stale: true, periods: { 7: { status: 'ok', return_pct: 7 } } } }] };
  const env = { MARKET_DATA_MODE: 'python', ASSETS: { async fetch(request) { return new Response(JSON.stringify(new URL(request.url).pathname.endsWith('markets.json') ? snapshot : history), { headers: { 'Content-Type': 'application/json' } }); } } };
  const response = await handleRequest(new Request('https://fixture.test/api/chart?id=' + id + '&range=7d'), env, {}, { now: () => now });
  assert.equal(response.status, 200);
  const chart = await response.json();
  assert.equal(chart.stale, true);
  assert.equal(chart.updated_at, history.updated_at);
  assert.deepEqual(chart.points, history.points);
});

test('stock momentum rolls every supported window when the next trading close arrives and replaces corrected dates', options, () => {
  const data = calculate(`
refresh_spec=importlib.util.spec_from_file_location('refresh_under_test',pathlib.Path(sys.argv[1])/'scripts/market-refresh.py')
refresh=importlib.util.module_from_spec(refresh_spec)
refresh_spec.loader.exec_module(refresh)
rows=[{'date':day.isoformat(),'close':100+index} for index,day in enumerate(trading_dates)]
next_rows=rows+[{'date':'2026-09-14','close':129}]
original_item,original=refresh.normalize_daily(stock,rows,NOW,'fixture')
forming_item,forming=refresh.normalize_daily(stock,next_rows,'2026-09-14T20:29:59Z','fixture')
rolled_item,rolled=refresh.normalize_daily(stock,next_rows,'2026-09-14T20:30:00Z','fixture')
corrected_item,corrected=refresh.normalize_daily(stock,next_rows+[{'date':'2026-09-14','close':130}],'2026-09-14T20:45:00Z','fixture')
print(json.dumps({name:{'points':history['points'],'momentum':m.calculate_momentum(item,history,stamp)} for name,item,history,stamp in [('original',original_item,original,NOW),('forming',forming_item,forming,'2026-09-14T20:29:59Z'),('rolled',rolled_item,rolled,'2026-09-14T20:30:00Z'),('corrected',corrected_item,corrected,'2026-09-14T20:45:00Z')]},allow_nan=False))
`);
  assert.deepEqual(data.forming.points, data.original.points, 'weekend and forming Monday do not add a close');
  assert.deepEqual(data.forming.momentum.periods, data.original.momentum.periods);
  for (const key of ['rolled', 'corrected']) {
    assert.equal(data[key].points.length, 30);
    assert.equal(new Set(data[key].points.map(point => point.time)).size, 30);
    for (const n of [7, 14, 21, 28]) {
      const period = data[key].momentum.periods[n];
      assert.equal(period.status, 'ok');
      assert.ok(Date.parse(period.start_at) > Date.parse(data.original.momentum.periods[n].start_at));
      assert.equal(period.end_at, '2026-09-14T00:00:00Z');
      assert.equal(period.observations, n + 1);
      almostEqual(period.return_pct, ((key === 'rolled' ? 129 : 130) / (129 - n) - 1) * 100);
    }
  }
  assert.equal(data.corrected.momentum.periods[7].start_at, data.rolled.momentum.periods[7].start_at, 'a correction changes a close, not the window date');
});

test('crypto momentum rolls across weekends at the completed UTC boundary and deduplicates revised closes', options, () => {
  const data = calculate(`
prices=[[m.instant(day.isoformat()+'T00:00:00Z').timestamp()*1000,100+index] for index,day in enumerate(calendar_dates)]
original=m.daily_crypto_history(crypto,{'prices':prices},NOW)
next_price=[m.instant('2026-09-13T00:00:00Z').timestamp()*1000,129]
forming=m.daily_crypto_history(crypto,{'prices':prices+[next_price]},'2026-09-13T00:09:59Z',original)
rolled=m.daily_crypto_history(crypto,{'prices':[next_price]},'2026-09-13T00:10:00Z',original)
corrected=m.daily_crypto_history(crypto,{'prices':[[next_price[0],130]]},'2026-09-13T00:25:00Z',rolled)
print(json.dumps({name:{'points':history['points'],'momentum':m.calculate_momentum(crypto,history,stamp)} for name,history,stamp in [('original',original,NOW),('forming',forming,'2026-09-13T00:09:59Z'),('rolled',rolled,'2026-09-13T00:10:00Z'),('corrected',corrected,'2026-09-13T00:25:00Z')]},allow_nan=False))
`);
  assert.deepEqual(data.forming.points, data.original.points);
  assert.deepEqual(data.forming.momentum.periods, data.original.momentum.periods);
  for (const key of ['rolled', 'corrected']) {
    assert.equal(data[key].points.length, 30);
    assert.equal(new Set(data[key].points.map(point => point.time)).size, 30);
    assert.equal(data[key].momentum.last_bar_date, '2026-09-12', 'Saturday contributes a completed crypto daily close');
    for (const n of [7, 14, 21, 28]) {
      const period = data[key].momentum.periods[n];
      assert.equal(period.status, 'ok');
      assert.equal(Date.parse(period.start_at) - Date.parse(data.original.momentum.periods[n].start_at), 86400_000);
      assert.equal(period.end_at, '2026-09-13T00:00:00Z');
      assert.equal(period.observations, n + 1);
      almostEqual(period.return_pct, ((key === 'rolled' ? 129 : 130) / (129 - n) - 1) * 100);
    }
  }
  assert.equal(data.corrected.momentum.periods[7].start_at, data.rolled.momentum.periods[7].start_at);
});
