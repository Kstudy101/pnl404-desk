import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../worker/index.mjs';

function fixtureAssets(files) {
  return {async fetch(request){const value=files[new URL(request.url).pathname];return value?Response.json(value):new Response('missing',{status:404});}};
}
const item={id:'us:AAPL',market:'us',symbol:'AAPL',name:'애플',groups:['sp500','nasdaq'],currency:'USD',price:200,updated_at:'2026-09-11T00:00:00Z',source:'yfinance (일봉)',price_basis:'daily_close'};

test('Python assets are the stock source of truth and a new artifact is visible immediately',async()=>{
  let now=Date.parse('2026-09-12T14:00:00Z'),calls=0;
  const files={'/modules/board/markets.json':{collector:'python-finance-packages',items:[item],generated_at:new Date(now).toISOString(),stale:false,notes:[]},
    '/modules/board/history/us_AAPL.json':{id:item.id,currency:'USD',points:[{time:'2026-09-10T00:00:00Z',value:190},{time:'2026-09-11T00:00:00Z',value:200}],generated_at:new Date(now).toISOString(),updated_at:item.updated_at,source:item.source,interval:'1d',price_basis:'daily_close',notes:[]}};
  const env={ASSETS:fixtureAssets(files),MARKET_DATA_MODE:'python'};
  const options={now:()=>now,fetchImpl:async()=>{calls++;throw new Error('Stock provider should not be contacted');}};
  const load=path=>handleRequest(new Request(`https://desk.test${path}`),env,{},options).then(response=>response.json());
  const first=await load('/api/markets?market=us');
  assert.equal(first.items[0].price,200);assert.equal(first.stale,false);
  files['/modules/board/markets.json'].items=[{...item,price:201}];
  assert.equal((await load('/api/markets?market=us')).items[0].price,201);
  const chart=await load('/api/chart?id=us:AAPL&range=7d');
  assert.equal(chart.source,'yfinance (일봉)');assert.equal(chart.points.length,2);assert.equal(chart.stale,false);
  now+=900001;
  const old=await load('/api/chart?id=us:AAPL&range=7d');
  assert.equal(old.stale,true);assert.equal(old.generated_at,chart.generated_at);assert.equal(old.updated_at,chart.updated_at);
  assert.equal(calls,0);
});

test('a missing Python stock history remains visibly unavailable instead of changing collector',async()=>{
  const env={MARKET_DATA_MODE:'python',ASSETS:fixtureAssets({'/modules/board/markets.json':{collector:'python-finance-packages',items:[item],generated_at:new Date().toISOString()}})};
  const result=await (await handleRequest(new Request('https://desk.test/api/chart?id=us:AAPL&range=7d'),env,{}, {fetchImpl:()=>{throw new Error('No fallback');}})).json();
  assert.deepEqual(result.points,[]);assert.equal(result.stale,true);assert.equal(result.updated_at,null);
});

test('Python mode refuses an unprepared web snapshot without silently using JS collection',async()=>{
  const env={MARKET_DATA_MODE:'python',ASSETS:fixtureAssets({'/modules/board/markets.json':{items:[item],generated_at:new Date().toISOString()}})};
  const response=await handleRequest(new Request('https://desk.test/api/markets?market=us'),env,{}, {fetchImpl:()=>{throw new Error('No fallback');}});
  assert.equal(response.status,503);assert.equal((await response.json()).stale,true);
});
