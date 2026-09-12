// Fetch a real, dated local preview snapshot. No legacy score recalculation,
// deployment, account creation, or original project modification is performed.
import {writeFile,rename} from 'node:fs/promises';
import {MARKETS} from '../worker/catalogue.mjs';
import {fetchMarket,REFRESH_MS,iso} from '../worker/providers.mjs';

const now=Date.now(),results=[];
let requestCount=0;
const fetchImpl=(...args)=>{requestCount++;return fetch(...args);};
for(const market of MARKETS) {
  try {
    const result=await fetchMarket(market.id,{fetchImpl,now});
    results.push({id:market.id,...result});
    console.log(`${market.id}: ${result.items.length} items, ${result.items.filter(item=>item.price!==null).length} quotes, stale=${result.stale}`);
    if(result.stale) console.warn(result.notes.slice(1).join('\n'));
  } catch(error) {
    throw new Error(`${market.id} refresh failed; existing snapshot preserved: ${error.message}`);
  }
}
const payload={schema_version:1,generated_at:iso(now),next_refresh_at:iso(now+REFRESH_MS),stale:results.some(result=>result.stale),
  notes:[...new Set(results.flatMap(result=>result.notes))],items:results.flatMap(result=>result.items),
  markets:MARKETS.map(market=>({...market,coverage:results.find(result=>result.id===market.id).coverage}))};
const output=new URL('../public/modules/board/markets.json',import.meta.url);
const temporary=new URL('../public/modules/board/markets.json.tmp',import.meta.url);
await writeFile(temporary,`${JSON.stringify(payload,null,2)}\n`);
await rename(temporary,output);
const catalogue=payload.items.map(({id,market,symbol,name,name_en,aliases,groups,currency})=>({id,market,symbol,name,name_en,aliases,groups,currency,price:null,change_pct:null,market_cap:null,updated_at:null,fetched_at:null,source:null,history:[]}));
await writeFile(new URL('../worker/generated-catalogue.mjs',import.meta.url),`// Fetched ${iso(now)} by scripts/market-refresh.mjs. Identifiers only, no quotes.\nexport default ${JSON.stringify(catalogue,null,2)};\n`);
console.log(`Wrote ${payload.items.length} real snapshot rows; ${requestCount} provider requests; generated_at=${payload.generated_at}`);
