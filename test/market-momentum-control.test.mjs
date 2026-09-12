import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const candidates=[process.env.MARKET_PYTHON,resolve(root,'.venv-market/Scripts/python.exe'),resolve(root,'.venv-market/bin/python'),'python3','python'].filter(Boolean);
const python=candidates.find(command=>(!command.includes('/')&&!command.includes('\\')||existsSync(command))&&spawnSync(command,['--version'],{encoding:'utf8'}).status===0);
const options={skip:!python&&'Python required for offline rate-limit fixtures'};
function fixture(body){
  const script=`
import sys
sys.dont_write_bytecode=True
import importlib.util, pathlib, json, tempfile, urllib.error, urllib.request, contextlib, io
ROOT=pathlib.Path(sys.argv[1])
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
m=load('market-momentum')
NOW='2026-09-12T15:00:00Z'
item={'id':'crypto:first','market':'crypto','symbol':'SAME','name':'First','currency':'USD','price':100}
other={**item,'id':'crypto:second'}
def no_network(*args,**kwargs):raise AssertionError('Offline fixture attempted network')
urllib.request.urlopen=no_network
${body}
`;
  const result=spawnSync(python,['-c',script,root],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  return JSON.parse(result.stdout);
}

test('HTTP Retry-After seconds and dates are respected; absent headers use exponential application backoff',options,()=>{
  const data=fixture(`
with tempfile.TemporaryDirectory(prefix='pnl404-rate-') as temporary:
    directory=pathlib.Path(temporary)
    def limited(identifier):raise urllib.error.HTTPError('https://fixture.invalid',429,'rate limited',{'Retry-After':'600'},None)
    first=m.refresh_crypto_histories([item,other],directory,NOW,fetcher=limited,sleeper=lambda _:None)
    def headerless(identifier):raise urllib.error.HTTPError('https://fixture.invalid',429,'rate limited',{},None)
    second=m.refresh_crypto_histories([item,other],directory,'2026-09-12T15:11:00Z',fetcher=headerless,sleeper=lambda _:None,previous_collection=first)
    print(json.dumps({'first':first,'second':second,'parsed':[m.retry_after_seconds(value,NOW) for value in ['300','Sat, 12 Sep 2026 15:05:00 GMT','bad','-3','0']]}))
`);
  assert.deepEqual(data.parsed,[300,300,null,null,0]);
  assert.equal(data.first.status,'partial');
  assert.equal(data.first.cooldown_until,'2026-09-12T15:10:00Z');
  assert.equal(data.first.retry_after_seconds,600);
  assert.equal(data.first.failed,1);
  assert.equal(data.first.deferred,1);
  assert.equal(data.second.cooldown_until,'2026-09-12T15:15:00Z');
  assert.equal(data.second.cooldown_source,'application_backoff');
  assert.equal(data.second.consecutive_rate_limits,2);
});

test('a persisted cooldown makes no requests and retains every existing history byte',options,()=>{
  const data=fixture(`
with tempfile.TemporaryDirectory(prefix='pnl404-rate-') as temporary:
    directory=pathlib.Path(temporary)
    original={'id':item['id'],'points':[{'time':'2026-09-11T00:00:00Z','value':90}],'fetched_at':'2026-09-11T15:00:00Z'}
    target=directory/m.filename(item['id'])
    m.atomic_json(target,original)
    before=target.read_bytes()
    previous={'cooldown_until':'2026-09-12T15:10:00Z','consecutive_rate_limits':1}
    report=m.refresh_crypto_histories([item,other],directory,NOW,fetcher=no_network,previous_collection=previous)
    print(json.dumps({'report':report,'preserved':target.read_bytes()==before}))
`);
  assert.equal(data.report.status,'cooldown');
  assert.equal(data.report.attempted,0);
  assert.equal(data.report.deferred,2);
  assert.equal(data.report.cooldown_remaining_seconds,600);
  assert.equal(data.report.min_interval_seconds,16);
  assert.equal(data.preserved,true);
});

test('the primary collector reports successful prices separately from failed momentum and exits partial',options,()=>{
  const data=fixture(`
c=load('market-refresh')
c.load_stock_rows=lambda *args: ({},{})
c.load_crypto=lambda *args,**kwargs: ({item['id']:({**item,'fetched_at':NOW,'updated_at':NOW,'stale':False},None)}, {})
c.importlib.metadata.version=lambda _: 'fixture'
def limited(*args,**kwargs):raise urllib.error.HTTPError('https://fixture.invalid',429,'rate limited',{},None)
urllib.request.urlopen=limited
with tempfile.TemporaryDirectory(prefix='pnl404-rate-') as temporary:
    directory=pathlib.Path(temporary)
    catalogue=directory/'catalogue.json'
    output=directory/'output.json'
    catalogue.write_text(json.dumps({'items':[item],'markets':[]}),encoding='utf-8')
    stream=io.StringIO()
    with contextlib.redirect_stdout(stream):
        code=c.main(['--catalogue',str(catalogue),'--output',str(output),'--history-dir',str(directory/'history'),'--crypto-history-budget','1'])
    print(json.dumps({'code':code,'summary':json.loads(stream.getvalue()),'output_exists':output.exists()}))
`);
  assert.equal(data.code,2);
  assert.equal(data.summary.status,'partial');
  assert.equal(data.summary.price_collection.refreshed,1);
  assert.equal(data.summary.price_collection.failed,0);
  assert.equal(data.summary.momentum_collection.failed,1);
  assert.equal(data.summary.momentum_collection.available_7,0);
  assert.equal(data.summary.momentum_collection.status,'partial');
  assert.ok(data.summary.duration_seconds>=0);
  assert.equal(data.output_exists,true);
});
