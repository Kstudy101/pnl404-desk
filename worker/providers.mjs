import {MARKETS, JAPAN_SEEDS, US_SEEDS, KOREAN_NAMES, CRYPTO_NAMES, SP500_VERIFIED, emptyItem} from './catalogue.mjs';
import savedCatalogue from './generated-catalogue.mjs';

export const REFRESH_MS = 15 * 60 * 1000;
export const PROVIDER_NOTE = '공개 웹 시세 개발 연결 · 제공처 지연·호출 제한 가능 · 15분 조회 주기는 실시간 시세 보장이 아닙니다.';
export const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && /^-?[\d,.]+$/.test(value) && Number.isFinite(Number(value.replaceAll(',',''))) ? Number(value.replaceAll(',','')) : null;
export const iso = value => { const date = new Date(value); return value != null && Number.isFinite(date.getTime()) ? date.toISOString() : null; };
export const registry = [...new Map([...JAPAN_SEEDS,...US_SEEDS,...savedCatalogue].map(item=>[item.id,item])).values()];
const registryById = new Map(registry.map(item=>[item.id,item]));
const joinUnique = values => [...new Set(values.filter(Boolean))];
export const normalizeQuery = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s._-]/g,'');

async function getJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),12000);
  try {
    const response = await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json','User-Agent':'PNL404-MarketBoard/1.0'}});
    if(!response.ok) throw new Error(`제공처 HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function normalizeNaver(stock, market, group, now) {
  const symbol = market === 'kr' ? `${stock.itemCode}.${group === 'kosdaq' ? 'KQ':'KS'}` : market === 'jp' ? `${String(stock.symbolCode || stock.reutersCode || '').replace(/\.T$/,'')}.T` : String(stock.symbolCode || '').replaceAll('.','-');
  if(!symbol || !/^[A-Z0-9.^=-]{1,30}$/i.test(symbol)) return null;
  const seed = registryById.get(`${market}:${symbol}`);
  return {...emptyItem(market,symbol),name:stock.stockName || seed?.name || symbol,name_en:stock.stockNameEng || seed?.name_en || '',
    aliases:joinUnique([stock.symbolCode,stock.itemCode,stock.reutersCode,stock.stockNameEng,KOREAN_NAMES[symbol],...(seed?.aliases || [])]),
    groups:joinUnique([group,...(market==='us' && SP500_VERIFIED.has(symbol)?['sp500']:[]),...(market==='jp' ? seed?.groups || []:[])]),
    price:numeric(stock.closePriceRaw ?? stock.closePrice),change_pct:numeric(stock.fluctuationsRatioRaw ?? stock.fluctuationsRatio),
    // Only the provider's explicitly base-unit Raw field is accepted. Legacy
    // marketValue uses different units in domestic/overseas feeds.
    market_cap:numeric(stock.marketValueRaw),currency:stock.currencyType?.code || (market==='kr'?'KRW':market==='jp'?'JPY':'USD'),
    updated_at:iso(stock.localTradedAt),fetched_at:iso(now),source:'NAVER Finance (공개 웹)',market_state:stock.marketStatus || null,
    delay_minutes:numeric(stock.delayTime ?? stock.stockExchangeType?.delayTime),history:[]};
}

export function normalizeYahoo(result, seed, now) {
  const meta = result?.meta || {};
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const price = numeric(meta.regularMarketPrice);
  const prior = numeric(meta.chartPreviousClose ?? meta.previousClose);
  const directPct = numeric(meta.regularMarketChangePercent);
  const symbol = seed.symbol;
  return {...seed,name:KOREAN_NAMES[symbol] || (seed.name && seed.name!==symbol.replace(/\.(T|KS|KQ)$/,'') && seed.name!==symbol ? seed.name:null) || meta.longName || meta.shortName || symbol,
    name_en:meta.longName || meta.shortName || seed.name_en || '',
    aliases:joinUnique([symbol.replace(/\.(T|KS|KQ)$/,''),meta.longName,meta.shortName,...(seed.aliases || [])]),
    groups:joinUnique([...(seed.groups || []),...(seed.market==='us' ? /^NMS|NGM|NCM$/.test(meta.exchangeName || '')?['nasdaq']:meta.exchangeName==='NYQ'?['nyse']:[]:[])]),
    currency:meta.currency || seed.currency,price,
    change_pct:directPct ?? (price!==null && prior!==null && prior!==0 ? (price-prior)/prior*100 : null),
    market_cap:numeric(meta.marketCap),updated_at:meta.regularMarketTime ? iso(meta.regularMarketTime*1000):null,
    fetched_at:iso(now),source:'Yahoo Finance (공개 웹)',history:closes.map(numeric).filter(value=>value!==null),
    market_state:null,delay_minutes:numeric(meta.exchangeDataDelayedBy)};
}

export function normalizeCrypto(coin, now) {
  if(!coin?.id || !coin.symbol) return null;
  return {...emptyItem('crypto',String(coin.symbol).toUpperCase()),id:`crypto:${coin.id}`,name:CRYPTO_NAMES[coin.id] || coin.name,
    name_en:coin.name,aliases:joinUnique([coin.id,coin.name,coin.symbol,CRYPTO_NAMES[coin.id]]),groups:['top100'],
    price:numeric(coin.current_price),change_pct:numeric(coin.price_change_percentage_24h),market_cap:numeric(coin.market_cap),
    market_cap_rank:numeric(coin.market_cap_rank),updated_at:iso(coin.last_updated),fetched_at:iso(now),source:'CoinGecko',
    history:(coin.sparkline_in_7d?.price || []).map(numeric).filter(value=>value!==null),market_state:'OPEN',delay_minutes:null};
}

async function fetchYahooBatches(seeds,fetchImpl,now) {
  const items=[],errors=[];
  for(let start=0;start<seeds.length;start+=20) {
    const batch=seeds.slice(start,start+20);
    try {
      const data=await getJson(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(batch.map(item=>item.symbol).join(','))}&range=1d&interval=15m`,fetchImpl);
      const results=new Map((data.spark?.result || []).map(row=>[row.symbol,row.response?.[0]]));
      for(const seed of batch) {
        if(results.get(seed.symbol)) items.push(normalizeYahoo(results.get(seed.symbol),seed,now));
        else {items.push({...seed,price:null,change_pct:null,market_cap:null,history:[],updated_at:null,fetched_at:iso(now),source:'Yahoo Finance (공개 웹)'});errors.push(`${seed.symbol} 시세 미수신`);}
      }
    } catch(error) {
      errors.push(`묶음 시세 ${start+1}–${start+batch.length}: ${error.message}`);
      items.push(...batch.map(seed=>({...seed,price:null,change_pct:null,market_cap:null,history:[],updated_at:null,fetched_at:iso(now),source:'Yahoo Finance (공개 웹)'})));
    }
  }
  return {items,errors};
}

export async function fetchMarket(market, {fetchImpl = fetch, now = Date.now()} = {}) {
  const info = MARKETS.find(item=>item.id===market);
  if(!info) throw new Error('지원하지 않는 시장');
  let items = [], errors = [];
  if(market === 'crypto') {
    const data = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h',fetchImpl);
    if(!Array.isArray(data) || !data.length) throw new Error('CoinGecko 시총 응답 없음');
    items = data.map(coin=>normalizeCrypto(coin,now)).filter(Boolean).filter(item=>item.market_cap_rank>=1 && item.market_cap_rank<=100).sort((a,b)=>a.market_cap_rank-b.market_cap_rank);
    if(items.length<100) errors.push(`시총 100종목 중 ${items.length}종목 수신`);
  } else if(market === 'jp') {
    // TOKYO is the provider's exchange ID (FinanceDataReader's Naver adapter
    // documents this mapping). Quotes also supply searchable Korean names.
    try {
      const data=await getJson('https://api.stock.naver.com/stock/exchange/TOKYO/marketValue?page=1&pageSize=100',fetchImpl);
      items=(data.stocks || []).map(stock=>normalizeNaver(stock,'jp',null,now)).filter(Boolean);
    } catch { /* Yahoo below covers the dated Japanese catalogue. */ }
    const received=new Set(items.map(item=>item.id));
    const seeds=JAPAN_SEEDS.map(item=>registryById.get(item.id) || item).filter(item=>!received.has(item.id));
    const yahoo=await fetchYahooBatches(seeds,fetchImpl,now);
    items.push(...yahoo.items);errors.push(...yahoo.errors);
  } else {
    const groups = market === 'us' ? ['nasdaq','nyse'] : ['kospi','kosdaq'];
    for(const group of groups) {
      const url = market==='us' ? `https://api.stock.naver.com/stock/exchange/${group.toUpperCase()}/marketValue?page=1&pageSize=100` : `https://m.stock.naver.com/api/stocks/marketValue/${group.toUpperCase()}?page=1&pageSize=100`;
      try {
        const data = await getJson(url,fetchImpl);
        if(!Array.isArray(data.stocks) || !data.stocks.length) throw new Error('종목 응답 없음');
        items.push(...data.stocks.map(stock=>normalizeNaver(stock,market,group,now)).filter(Boolean));
      } catch(error) {
        errors.push(`${group}: ${error.message}`);
        items.push(...registry.filter(item=>item.market===market && item.groups.includes(group)).map(item=>({...item,price:null,change_pct:null,market_cap:null,history:[],updated_at:null,fetched_at:iso(now)})));
      }
    }
    if(market==='us') {
      const received=new Set(items.filter(item=>item.price!==null).map(item=>item.id));
      const missing=US_SEEDS.map(item=>registryById.get(item.id) || item).filter(item=>!received.has(item.id));
      const yahoo=await fetchYahooBatches(missing,fetchImpl,now);
      // Successful Yahoo fallback replaces any null quote from a failed list.
      items=[...new Map([...items,...yahoo.items].map(item=>[item.id,item])).values()];
      errors.push(...yahoo.errors);
    }
  }
  if(!items.some(item=>item.price!==null)) throw new Error(errors[0] || '조회 가능한 시세 없음');
  return {items,generated_at:iso(now),next_refresh_at:iso(now+REFRESH_MS),stale:errors.length>0,notes:[PROVIDER_NOTE,...errors],groups:info.groups,
    coverage:{...info.coverage,total:items.length,available:items.filter(item=>item.price!==null).length}};
}

export function localSearch(query, catalogue = registry) {
  const q = normalizeQuery(query);
  if(!q) return [];
  return catalogue.filter(item=>[item.symbol,item.name,item.name_en,item.id,...(item.aliases || [])].some(value=>normalizeQuery(value).includes(q)))
    .sort((a,b)=>Number(normalizeQuery(b.symbol)===q)-Number(normalizeQuery(a.symbol)===q)).slice(0,12);
}

export function stockIdentity(symbol) {
  if(typeof symbol!=='string' || !/^[A-Z0-9][A-Z0-9.^=-]{0,29}$/i.test(symbol)) return null;
  const market = /\.KS$|\.KQ$/i.test(symbol)?'kr':/\.T$/i.test(symbol)?'jp':!symbol.includes('.')?'us':null;
  return market ? {market,symbol:symbol.toUpperCase()} : null;
}

export async function fetchSearch(query,{fetchImpl=fetch,now=Date.now()}={}) {
  const local = localSearch(query);
  let remote = [], notes = [];
  try {
    const data = await getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`,fetchImpl);
    remote = (data.quotes || []).filter(row=>row.quoteType==='EQUITY' || row.quoteType==='ETF').map(row=>{
      const identity = stockIdentity(row.symbol);
      if(!identity) return null;
      const {market,symbol} = identity;
      const seed = registryById.get(`${market}:${symbol}`);
      const groups = market==='kr' ? [symbol.endsWith('.KQ')?'kosdaq':'kospi'] : market==='us' ? (/Nasdaq/i.test(row.exchDisp || '')?['nasdaq']:/NYSE/i.test(row.exchDisp || '')?['nyse']:[]) : [];
      return seed || {...emptyItem(market,symbol,KOREAN_NAMES[symbol] || row.longname || row.shortname || symbol,groups),name_en:row.longname || row.shortname,aliases:[row.shortname,row.longname].filter(Boolean),source:'Yahoo Finance (검색)',fetched_at:iso(now)};
    }).filter(Boolean);
  } catch(error) {notes.push(`온라인 검색 불가: ${error.message}`);}
  return {items:[...new Map([...local,...remote].map(item=>[item.id,item])).values()].slice(0,12),generated_at:iso(now),next_refresh_at:iso(now+REFRESH_MS),stale:notes.length>0,notes};
}

export function parseId(id) {
  if(typeof id!=='string' || id.length>100) return null;
  const match = /^(us|kr|jp|crypto):([A-Za-z0-9][A-Za-z0-9.^=-]*)$/.exec(id);
  if(!match) return null;
  if(match[1]==='crypto') return /^[a-z0-9][a-z0-9-]*$/.test(match[2]) ? {market:'crypto',symbol:match[2],id}:null;
  const stock = stockIdentity(match[2]);
  return stock?.market===match[1] ? {...stock,id:`${stock.market}:${stock.symbol}`} : null;
}

export async function fetchChart(id,range,{fetchImpl=fetch,now=Date.now()}={}) {
  const identity = parseId(id);
  if(!identity || !['7d','14d','21d','28d'].includes(range)) throw new Error('잘못된 차트 요청');
  const days = Number(range.replace('d',''));
  let points = [], source, currency, updated_at;
  if(identity.market==='crypto') {
    const data = await getJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(identity.symbol)}/market_chart?vs_currency=usd&days=35&interval=daily`,fetchImpl);
    const boundary=Math.floor((now-600000)/86400000)*86400000;
    points = (data.prices || []).filter(row=>Array.isArray(row) && numeric(row[0])!==null && numeric(row[1])!==null && numeric(row[0])%86400000===0 && numeric(row[0])<=boundary).map(([time,value])=>({time:iso(numeric(time)),value:numeric(value)})).filter(point=>point.time).slice(-(days+1));
    source='CoinGecko';currency='USD';updated_at=points.at(-1)?.time || null;
  } else {
    const data = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(identity.symbol)}?range=3mo&interval=1d&includePrePost=false`,fetchImpl);
    const result = data.chart?.result?.[0];
    if(!result) throw new Error('차트 응답 없음');
    const closes = result.indicators?.quote?.[0]?.close || [];
    points = (result.timestamp || []).map((time,i)=>({time:iso(time*1000),value:numeric(closes[i])})).filter(point=>point.time && point.value!==null).slice(-(days+1));
    source='Yahoo Finance (공개 웹)';currency=result.meta?.currency || MARKETS.find(item=>item.id===identity.market).currency;updated_at=points.at(-1)?.time || null;
  }
  if(!points.length) throw new Error('이 구간의 차트 값이 없습니다.');
  return {id:identity.id,currency,points,updated_at,fetched_at:iso(now),generated_at:iso(now),next_refresh_at:iso(now+REFRESH_MS),source,stale:false,notes:[PROVIDER_NOTE]};
}
