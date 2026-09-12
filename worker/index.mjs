import {MARKETS, emptyItem} from './catalogue.mjs';
import {REFRESH_MS, PROVIDER_NOTE, registry, fetchMarket, fetchSearch, fetchChart, parseId, iso,localSearch} from './providers.mjs';

const CACHE_VERSION = 'v1';
const RETAIN_SECONDS = 86400;
const ERROR_RETRY_MS = 60000;
const pending = new Map();
const cacheKey = key => new Request(`https://pnl404-desk.market-cache.invalid/${CACHE_VERSION}/${key}`);

function blankResult(key, now, error) {
  const [kind,market] = key.split('/');
  const info = MARKETS.find(item=>item.id===market);
  return {items:kind==='market'?registry.filter(item=>item.market===market).map(item=>({...item,price:null,change_pct:null,market_cap:null,history:[],updated_at:null,fetched_at:null})):[],
    generated_at:null,next_refresh_at:iso(now+ERROR_RETRY_MS),checked_at:iso(now),stale:true,
    notes:[`시세 제공처에 연결하지 못했습니다: ${error.message}`,PROVIDER_NOTE],...(info?{groups:info.groups,coverage:{...info.coverage,total:registry.filter(item=>item.market===market).length,available:0}}:{})};
}

/** Explicit cache seam for offline expiry/error tests and the local dev server.
 * Cloudflare's Cache API is datacenter-local, so the cron warms its own location.
 * Other locations fetch on access after 15 minutes. Cache retention is 24 hours;
 * freshness is checked independently because Cache API has no stale-if-error.
 */
export function createMarketService({fetchImpl = fetch, cache = globalThis.caches?.default, now = Date.now} = {}) {
  async function read(key) {
    try {return cache ? await (await cache.match(cacheKey(key)))?.json() : null;} catch {return null;}
  }
  async function put(key,envelope) {
    if(!cache) return;
    try {await cache.put(cacheKey(key),new Response(JSON.stringify(envelope),{headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${RETAIN_SECONDS}`}}));} catch { /* cache eviction is not provider failure */ }
  }
  async function cached(key,loader,{force=false}={}) {
    const old = await read(key);
    const time = now();
    if(!force && old && time < old.retry_at) return old.value;
    // Deduplicate only within the same cache/service instance. The platform does
    // not guarantee isolate persistence or global request collapse.
    const active = pending.get(cache)?.get(key);
    if(active) return active;
    if(!pending.has(cache)) pending.set(cache,new Map());
    const task = (async()=>{
      try {
        let value = await loader(time);
        if(value.stale && old?.value?.items) {
          const previous = new Map(old.value.items.map(item=>[item.id,item]));
          value = {...value,items:value.items.map(item=>item.price===null && previous.get(item.id)?.price!==null && previous.has(item.id)?{...previous.get(item.id),stale:true}:item)};
        }
        const retry_at = time + (value.stale ? ERROR_RETRY_MS:REFRESH_MS);
        value = {...value,next_refresh_at:iso(retry_at)};
        await put(key,{value,retry_at});
        return value;
      } catch(error) {
        const value = old?.value ? {...old.value,stale:true,checked_at:iso(time),next_refresh_at:iso(time+ERROR_RETRY_MS),notes:[`갱신 실패 · 이전 수신값 표시: ${error.message}`,...(old.value.notes || [])].slice(0,8)} : blankResult(key,time,error);
        await put(key,{value,retry_at:time+ERROR_RETRY_MS});
        return value;
      } finally {pending.get(cache)?.delete(key);}
    })();
    pending.get(cache).set(key,task);
    return task;
  }
  return {
    market:(market,options)=>cached(`market/${market}`,time=>fetchMarket(market,{fetchImpl,now:time}),options),
    search:query=>cached(`search/${encodeURIComponent(query.toLocaleLowerCase())}`,time=>fetchSearch(query,{fetchImpl,now:time})),
    chart:(id,range)=>cached(`chart/${encodeURIComponent(id)}/${range}`,time=>fetchChart(id,range,{fetchImpl,now:time})),
  };
}

function json(body,status=200) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

async function packageAsset(env,path) {
  if(!env.ASSETS) return null;
  try {
    const response=await env.ASSETS.fetch(new Request(`https://pnl404-assets.invalid/modules/board/${path}`));
    if(!response.ok) return null;
    return await response.json();
  }catch{return null;}
}

export function packageFreshness(snapshot,now=Date.now()) {
  const generated=Date.parse(snapshot?.generated_at);
  return !Number.isFinite(generated) || now-generated>=REFRESH_MS || !!snapshot?.stale;
}

function packageNotes(snapshot,stale) {
  return [...(snapshot.notes || []),...(stale?['Python 수집의 다음 정상 갱신을 기다리는 중입니다. 이전 수신 시각과 값을 유지합니다.']:[])];
}

async function packageChart(env,snapshot,identity,range,now) {
  const filename=`${identity.id.replace(':','_')}.json`;
  const artifact=await packageAsset(env,`history/${encodeURIComponent(filename)}`);
  const item=snapshot.items?.find(row=>row.id===identity.id);
  const empty={id:identity.id,currency:item?.currency || MARKETS.find(row=>row.id===identity.market).currency,points:[],updated_at:null,generated_at:null,source:null,stale:true,interval:'1d',price_basis:'daily_close',notes:['Python 수집의 이 종목 일봉 파일이 아직 없습니다.']};
  if(artifact?.id!==identity.id || !Array.isArray(artifact.points)) return empty;
  let points=artifact.points.filter(point=>typeof point.value==='number' && Number.isFinite(point.value) && Number.isFinite(Date.parse(point.time)));
  const days=Number(range.replace('d',''));
  points=points.slice(-(days+1));
  const selected=item?.momentum?.periods?.[String(days)];
  const historyOutdated=identity.market==='crypto' ? !!artifact.stale : packageFreshness(artifact,now);
  const stale=packageFreshness(snapshot,now) || historyOutdated || !!item?.stale || !!item?.momentum?.stale;
  return {...artifact,points,stale,range,market:identity.market,momentum:item?.momentum,selected_momentum:selected,
    notes:[...(artifact.notes || []),`최근 ${days}${identity.market==='crypto'?'일':'거래일'} 변화율에는 종가 ${days+1}개가 필요합니다.`,
      ...(selected && selected.status!=='ok'?['선택 구간의 일봉이 부족하거나 날짜가 끊겨 모멘텀을 계산할 수 없습니다.']:[]),
      ...(stale?['이전 수신값입니다. 가격과 모멘텀의 기준 시각을 확인하세요.']:[])]};
}

export async function handleRequest(request,env={},ctx={},overrides={}) {
  const url = new URL(request.url);
  if(!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request):new Response('Not found',{status:404});
  if(request.method!=='GET' && request.method!=='HEAD') return json({error:'GET 요청만 지원합니다.'},405);
  const service = createMarketService(overrides);
  // No API cache hides a newer deployed Python artifact. Asset service itself
  // serves the current deployment version; provider fallback remains available
  // only for the original web collector mode and crypto historical charts.
  const candidate=await packageAsset(env,'markets.json');
  const snapshot=candidate?.collector==='python-finance-packages' ? candidate:null;
  const packageMode=!!snapshot || env.MARKET_DATA_MODE==='python';
  const time=overrides.now?overrides.now():Date.now();
  if(packageMode && !snapshot) return json({items:[],points:[],generated_at:null,stale:true,notes:['Python 시세 산출물이 아직 준비되지 않았습니다.']},503);
  let result;
  if(url.pathname==='/api/markets') {
    const market = url.searchParams.get('market') || 'us';
    const group = url.searchParams.get('group') || 'all';
    const info = MARKETS.find(item=>item.id===market);
    if(!info || !info.groups.some(item=>item.id===group)) return json({error:'지원하지 않는 시장 또는 분류입니다.'},400);
    if(snapshot) {
      const stale=packageFreshness(snapshot,time);
      result={items:snapshot.items.filter(item=>item.market===market),generated_at:snapshot.generated_at,next_refresh_at:snapshot.next_refresh_at,stale,
        notes:packageNotes(snapshot,stale),groups:info.groups,coverage:snapshot.markets?.find(item=>item.id===market)?.coverage,collector:snapshot.collector};
    }else result = await service.market(market);
    result = {...result,market,group,items:result.items.filter(item=>group==='all' || item.groups.includes(group))};
  } else if(url.pathname==='/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if(query.length>80) return json({error:'검색어는 80자 이하로 입력하세요.'},400);
    result = query ? snapshot?{items:localSearch(query,snapshot.items),generated_at:snapshot.generated_at,next_refresh_at:snapshot.next_refresh_at,stale:packageFreshness(snapshot,time),notes:[]}:await service.search(query) : {items:[],stale:false,notes:[]};
  } else if(url.pathname==='/api/chart') {
    const identity = parseId(url.searchParams.get('id'));
    const range = url.searchParams.get('range') || '7d';
    if(!identity || !['7d','14d','21d','28d'].includes(range)) return json({error:'7·14·21·28일 기간만 지원합니다.'},400);
    result = snapshot ? await packageChart(env,snapshot,identity,range,time) : await service.chart(identity.id,range);
    // Error responses retain the chart contract even with no previous cache.
    result = {id:identity.id,currency:MARKETS.find(item=>item.id===identity.market).currency,points:[],updated_at:null,source:null,...result};
  } else return json({error:'없는 API 경로입니다.'},404);
  return request.method==='HEAD' ? new Response(null,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}):json(result);
}

export default {
  fetch:handleRequest,
  async scheduled(controller,env,ctx) {
    const snapshot=await packageAsset(env,'markets.json');
    if(env.MARKET_DATA_MODE==='python' || snapshot?.collector==='python-finance-packages') {
      console.log(JSON.stringify({event:'python_market_artifact_check',generated_at:snapshot?.generated_at || null,stale:packageFreshness(snapshot)}));
      return;
    }
    const service = createMarketService();
    // Current dated catalogues fit within 50 upstream fetches per cron. Charts are
    // fetched on demand and each range independently expires after 900 seconds.
    const work = (async()=>{
      for(const market of MARKETS) {
        const result = await service.market(market.id,{force:true});
        if(result.stale) console.warn(JSON.stringify({event:'market_refresh_partial',market:market.id,notes:result.notes}));
      }
    })();
    ctx.waitUntil(work);
    await work;
  },
};
