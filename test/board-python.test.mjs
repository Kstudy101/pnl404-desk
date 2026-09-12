import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizeItem, quoteStatus, chartGeometry } from '../public/modules/board/board-model.mjs';
import { handleRequest } from '../worker/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.MARKET_PYTHON, resolve(root, '.venv-market/Scripts/python.exe'), resolve(root, '.venv-market/bin/python'), 'python3', 'python'].filter(Boolean);
const python = candidates.find(command => (!command.includes('/') && !command.includes('\\') || existsSync(command)) && spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0);
const options = { skip: !python && 'Python is required for the offline collector fixtures; set MARKET_PYTHON or install .venv-market.' };

function fixture(body) {
  const script = `
import sys
sys.dont_write_bytecode = True
import importlib.util, json, pathlib, tempfile, contextlib, io, urllib.request
def reject_network(*args, **kwargs):
    raise AssertionError('Offline fixture attempted network access')
urllib.request.urlopen = reject_network
spec = importlib.util.spec_from_file_location('board_collector', pathlib.Path(sys.argv[1]) / 'scripts/market-refresh.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
fetched = '2026-09-12T15:00:00Z'
old = {'id':'us:AAPL','market':'us','symbol':'AAPL','name':'Apple','currency':'USD','groups':['nasdaq'],'price':90,'change_pct':1,'market_cap':1000,'source':'previous provider','updated_at':'2026-09-09T00:00:00Z','fetched_at':'2026-09-10T15:00:00Z','history':[80,90]}
${body}
`;
  const result = spawnSync(python, ['-c', script, root], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('Python daily-close fixtures cross the JSON/frontend boundary without inventing intraday timestamps', options, () => {
  const [item, history] = fixture(`
item, history = m.normalize_daily(old, [{'date':'2026-09-11','close':'110'},{'date':'2026-09-10','close':100},{'date':'bad','close':300},{'date':'2026-09-12','close':999},{'date':'2026-09-09','close':None}], fetched, 'yfinance (일봉)')
print(json.dumps([item, history], allow_nan=False))
`);
  assert.equal(item.price_basis, 'daily_close');
  assert.equal(item.price, 110);
  assert.ok(Math.abs(item.change_pct - 10) < 1e-9);
  assert.equal(item.updated_at, '2026-09-11T00:00:00Z');
  assert.equal(item.fetched_at, '2026-09-12T15:00:00Z');
  assert.equal(item.market_cap_source, 'previous provider');
  assert.equal(history.interval, '1d');
  assert.deepEqual(history.points.map(point => point.value), [100, 110]);
  assert.equal(normalizeItem(item).price_basis, 'daily_close');
  assert.equal(quoteStatus(normalizeItem(item), Date.parse(item.fetched_at)).kind, 'stale');
  assert.ok(chartGeometry(history.points));
});

test('Python partial stock failures retain previous values and source timestamps visibly stale', options, () => {
  const snapshot = fixture(`
second = {**old, 'id':'us:MSFT','symbol':'MSFT','name':'Microsoft'}
good = m.normalize_daily(old, [{'date':'2026-09-10','close':100},{'date':'2026-09-11','close':110}], fetched, 'yfinance (일봉)')
previous = {'items':[old,second], 'markets':[{'id':'us','coverage':{}}]}
print(json.dumps(m.merge_snapshot(previous, {'us:AAPL':good}, {'us:MSFT':'offline'}, fetched), allow_nan=False))
`);
  assert.equal(snapshot.items.length, 2);
  const retained = snapshot.items.find(item => item.id === 'us:MSFT');
  assert.equal(retained.price, 90);
  assert.equal(retained.updated_at, '2026-09-09T00:00:00Z');
  assert.equal(retained.fetched_at, '2026-09-10T15:00:00Z');
  assert.equal(retained.source, 'previous provider');
  assert.equal(retained.stale, true);
  assert.equal(snapshot.stale, true);
  assert.deepEqual(snapshot.collection, { requested: 2, refreshed: 1, failed: 1 });
});

test('Python rejects forming daily bars until the local close buffer, including US daylight saving time', options, () => {
  const results = fixture(`
cases = [('us','2026-07-01','2026-07-01T20:29:00Z','2026-07-01T20:30:00Z'),('us','2026-01-05','2026-01-05T21:29:00Z','2026-01-05T21:30:00Z'),('kr','2026-09-11','2026-09-11T06:59:00Z','2026-09-11T07:00:00Z'),('jp','2026-09-11','2026-09-11T06:59:00Z','2026-09-11T07:00:00Z')]
result = []
for market, day, before, after in cases:
    previous_day = (m.date.fromisoformat(day)-m.timedelta(days=1)).isoformat()
    rows = [{'date':previous_day,'close':100},{'date':day,'close':200}]
    target = {**old,'market':market}
    result.append([m.normalize_daily(target,rows,before,'fixture')[0]['price'],m.normalize_daily(target,rows,after,'fixture')[0]['price']])
print(json.dumps(result))
`);
  assert.deepEqual(results, [[100, 200], [100, 200], [100, 200], [100, 200]]);
});

test('Python incomplete crypto top100 responses retain failed prior coins with stale state', options, () => {
  const snapshot = fixture(`
coins = [{'id':f'coin-{index}','symbol':f'C{index}','name':f'Coin {index}','current_price':index+1,'market_cap':1000-index,'market_cap_rank':index+1,'last_updated':fetched} for index in range(99)]
previous = {'items':[old]+[{**old,'id':f'crypto:coin-{index}','market':'crypto','symbol':f'C{index}','groups':['top100']} for index in range(100)],'markets':[{'id':'crypto','coverage':{}},{'id':'us','coverage':{}}]}
m.get_json = lambda url: coins
m.load_stock_rows = lambda *args: ({'us:AAPL':[{'date':'2026-09-11','close':110}]}, {})
m.utc_now = lambda: fetched
m.importlib.metadata.version = lambda name: 'fixture'
with tempfile.TemporaryDirectory(prefix='pnl404-python-qa-') as temporary:
    directory = pathlib.Path(temporary).resolve()
    assert directory.parent == pathlib.Path(tempfile.gettempdir()).resolve() and directory.name.startswith('pnl404-python-qa-')
    catalogue = directory / 'catalogue.json'
    output = directory / 'output.json'
    catalogue.write_text(json.dumps(previous), encoding='utf-8')
    with contextlib.redirect_stdout(io.StringIO()):
        status = m.main(['--catalogue',str(catalogue),'--output',str(output),'--history-dir',str(directory/'history'),'--crypto-history-budget','0'])
    assert status == 2, 'retaining failed prior quotes is a partial refresh, not a successful full refresh'
    print(output.read_text(encoding='utf-8'))
`);
  assert.equal(snapshot.items.filter(item => item.market === 'crypto').length, 100);
  const failed = snapshot.items.find(item => item.id === 'crypto:coin-99');
  assert.equal(failed.price, 90);
  assert.equal(failed.fetched_at, '2026-09-10T15:00:00Z');
  assert.equal(failed.stale, true);
  assert.equal(snapshot.stale, true);
});

test('Python all-provider failure keeps existing output byte-for-byte', options, () => {
  const result = fixture(`
m.load_stock_rows = lambda *args: ({}, {'us:AAPL':'offline'})
with tempfile.TemporaryDirectory(prefix='pnl404-python-qa-') as temporary:
    directory = pathlib.Path(temporary).resolve()
    assert directory.parent == pathlib.Path(tempfile.gettempdir()).resolve() and directory.name.startswith('pnl404-python-qa-')
    catalogue = directory / 'catalogue.json'
    output = directory / 'output.json'
    catalogue.write_text(json.dumps({'items':[old],'markets':[]}), encoding='utf-8')
    original = '{"keep":"original bytes"}\\n'
    output.write_text(original, encoding='utf-8')
    with contextlib.redirect_stderr(io.StringIO()):
        status = m.main(['--catalogue',str(catalogue),'--output',str(output),'--history-dir',str(directory/'history'),'--crypto-history-budget','0'])
    print(json.dumps({'status':status,'preserved':output.read_text(encoding='utf-8') == original,'history_written':(directory/'history').exists()}))
`);
  assert.equal(result.status, 1);
  assert.equal(result.preserved, true);
  assert.equal(result.history_written, false);
});

test('Python-produced snapshot and history are served by Worker assets and consumed by the frontend', options, async () => {
  const payload = fixture(`
result = m.normalize_daily(old, [{'date':'2026-09-10','close':100},{'date':'2026-09-11','close':110}], fetched, 'yfinance (일봉)')
snapshot = m.merge_snapshot({'items':[old],'markets':[{'id':'us','coverage':{}}]}, {'us:AAPL':result}, {}, fetched)
print(json.dumps({'snapshot':snapshot,'history':result[1]}, allow_nan=False))
`);
  let calls = 0, now = Date.parse(payload.snapshot.generated_at);
  const assets = new Map([
    ['/modules/board/markets.json', payload.snapshot],
    ['/modules/board/history/us_AAPL.json', payload.history],
  ]);
  const env = { MARKET_DATA_MODE: 'python', ASSETS: { async fetch(request) {
    const asset = assets.get(decodeURIComponent(new URL(request.url).pathname));
    return asset ? new Response(JSON.stringify(asset), { headers: { 'Content-Type': 'application/json' } }) : new Response('missing', { status: 404 });
  } } };
  const overrides = { now: () => now, fetchImpl: async () => { calls++; throw new Error('unexpected web provider'); } };
  const api = async path => {
    const response = await handleRequest(new Request(`https://desk.test${path}`), env, {}, overrides);
    assert.equal(response.status, 200);
    return response.json();
  };
  const market = await api('/api/markets?market=us&group=nasdaq');
  assert.equal(market.items.length, 1);
  assert.equal(normalizeItem(market.items[0]).price, 110);
  assert.equal(market.items[0].price_basis, 'daily_close');
  assert.equal(market.stale, false);
  const chart = await api('/api/chart?id=us:AAPL&range=7d');
  assert.equal(chart.points.length, 2);
  assert.equal(chart.price_basis, 'daily_close');
  assert.equal(chart.source, 'yfinance (일봉)');
  assert.deepEqual(chartGeometry(chart.points).points.map(point => point.value), [100, 110]);
  assert.equal((await api('/api/search?q=Apple')).items[0].id, 'us:AAPL');
  now += 900_000;
  const stale = await api('/api/markets?market=us');
  assert.equal(stale.stale, true);
  assert.equal(stale.generated_at, market.generated_at);
  assert.equal(stale.items[0].updated_at, market.items[0].updated_at);
  assert.equal((await api('/api/chart?id=us:AAPL&range=7d')).stale, true);
  assert.equal(calls, 0, 'Python stock mode consumes assets without silently replacing them with web prices');
});
