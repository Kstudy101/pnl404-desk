import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NIKKEI_CODES,SP500_VERIFIED} from '../worker/catalogue.mjs';
import {normalizeNaver,normalizeYahoo,parseId,fetchMarket,numeric,localSearch} from '../worker/providers.mjs';

test('dated index catalogues contain all known unique share classes',()=>{
  assert.equal(NIKKEI_CODES.length,225);
  assert.equal(new Set(NIKKEI_CODES).size,225);
  assert.equal(SP500_VERIFIED.size,503);
  assert.ok(SP500_VERIFIED.has('BRK-B'));
});

test('NAVER uses currency base-unit raw market cap and preserves source quote time',()=>{
  const now=Date.parse('2026-09-12T12:00:00Z');
  const item=normalizeNaver({itemCode:'005930',stockName:'삼성전자',closePrice:'259,500',fluctuationsRatio:'-3.53',marketValue:'16,000',marketValueRaw:'1500000000000',localTradedAt:'2026-09-11T15:30:00+09:00'},'kr','kospi',now);
  assert.equal(item.id,'kr:005930.KS');assert.equal(item.currency,'KRW');
  assert.equal(item.price,259500);assert.equal(item.market_cap,1500000000000);
  assert.equal(item.updated_at,'2026-09-11T06:30:00.000Z');
  assert.equal(item.fetched_at,'2026-09-12T12:00:00.000Z');
  assert.equal(normalizeNaver({symbolCode:'AAPL',marketValue:'123456'},'us','nasdaq',now).market_cap,null);
});

test('absent prices and invalid numeric inputs never become zero',()=>{
  for(const input of [undefined,null,'','N/A',NaN,Infinity]) assert.equal(numeric(input),null);
  const item=normalizeYahoo({meta:{symbol:'AAPL'},indicators:{quote:[{close:[null,1,null]}]}},{market:'us',symbol:'AAPL',name:'애플',groups:[],aliases:[],currency:'USD'},Date.now());
  assert.equal(item.price,null);assert.equal(item.change_pct,null);assert.equal(item.updated_at,null);
  assert.deepEqual(item.history,[1]);
});

test('chart identifiers cannot cross market boundaries or escape provider path',()=>{
  for(const id of ['us:005930.KS','kr:AAPL','jp:AAPL','crypto:../../etc','crypto:BTC/USDT','us:https://example.com','crypto:Bitcoin']) assert.equal(parseId(id),null,id);
  assert.equal(parseId('crypto:bitcoin').id,'crypto:bitcoin');
  assert.equal(parseId('jp:285A.T').symbol,'285A.T');
  assert.equal(parseId('us:BRK-B').symbol,'BRK-B');
});

test('snapshot search supports Korean names, symbols and English aliases',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../public/modules/board/markets.json',import.meta.url),'utf8'));
  assert.ok(localSearch('삼성전자',snapshot.items).some(item=>item.id==='kr:005930.KS'));
  assert.ok(localSearch('apple',snapshot.items).some(item=>item.id==='us:AAPL'));
  assert.ok(localSearch('7203',snapshot.items).some(item=>item.id==='jp:7203.T'));
  assert.ok(localSearch('비트코인',snapshot.items).some(item=>item.id==='crypto:bitcoin'));
  assert.equal(new Set(snapshot.items.map(item=>item.id)).size,snapshot.items.length);
  assert.equal(snapshot.items.filter(item=>item.market==='crypto').length,100);
});

test('CoinGecko top100 uses provider rank and reports partial coverage',async()=>{
  const coins=[{id:'bitcoin',symbol:'btc',name:'Bitcoin',current_price:500,market_cap:1000,market_cap_rank:1,last_updated:'2026-09-12T12:00:00Z'},
    {id:'outside',symbol:'btc',name:'Outside',current_price:1,market_cap:1,market_cap_rank:101}];
  const result=await fetchMarket('crypto',{fetchImpl:async()=>Response.json(coins),now:Date.parse('2026-09-12T12:10:00Z')});
  assert.deepEqual(result.items.map(item=>item.id),['crypto:bitcoin']);
  assert.equal(result.coverage.total,1);assert.equal(result.stale,true);
  assert.match(result.notes.join(' '),/100종목 중 1종목/);
});

test('complete provider failure rejects rather than creating a fresh blank snapshot',async()=>{
  await assert.rejects(fetchMarket('crypto',{fetchImpl:async()=>new Response('{}',{status:429})}),/HTTP 429/);
});
