// Bounded read-only integration probe; does not write data or deploy.
import {fetchChart,fetchSearch} from '../worker/providers.mjs';
for(const id of ['us:AAPL','kr:005930.KS','jp:7203.T','crypto:bitcoin']) {
  const result=await fetchChart(id,'7d');
  console.log(JSON.stringify({id,currency:result.currency,points:result.points.length,updated_at:result.updated_at,source:result.source,valid:result.points.every(point=>typeof point.value==='number' && Number.isFinite(Date.parse(point.time)))}));
}
for(const query of ['삼성전자','AAPL','Nintendo']) {
  const result=await fetchSearch(query);
  console.log(JSON.stringify({query,count:result.items.length,ids:result.items.slice(0,3).map(item=>item.id),stale:result.stale}));
}
