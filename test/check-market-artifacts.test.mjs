import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMarketArtifacts} from '../scripts/check-market-artifacts.mjs';

function fixture() {
  const item = {id:'us:AAPL',market:'us',currency:'USD',price:110,price_basis:'daily_close',updated_at:'2026-09-11T00:00:00Z',fetched_at:'2026-09-12T14:00:00Z'};
  const history = {id:item.id,currency:item.currency,points:[{time:'2026-09-10T00:00:00Z',value:100},{time:item.updated_at,value:item.price}]};
  return {snapshot:{collector:'python-finance-packages',generated_at:item.fetched_at,items:[item]},history};
}

test('artifact validation accepts consistent output and rejects quote/history divergence', () => {
  const {snapshot,history} = fixture();
  assert.deepEqual(validateMarketArtifacts(snapshot, () => history), []);
  snapshot.items[0].price = 999;
  assert.ok(validateMarketArtifacts(snapshot, () => history).some(error => error.includes('disagree')));
});

test('duplicate IDs and unsafe history paths fail without reading an unsafe path', () => {
  const {snapshot,history} = fixture();
  snapshot.items.push({...snapshot.items[0]});
  assert.ok(validateMarketArtifacts(snapshot, () => history).some(error => error.includes('Duplicate')));
  snapshot.items = [{...snapshot.items[0],id:'us:../../private'}];
  const errors = validateMarketArtifacts(snapshot, () => { throw new Error('unsafe read'); });
  assert.ok(errors.some(error => error.includes('Invalid ID')));
  assert.ok(!errors.some(error => error.includes('unsafe read')));
});

test('future or duplicate daily observations cannot be published as valid history', () => {
  const {snapshot,history} = fixture();
  history.points[0].time = '2026-10-01T00:00:00Z';
  assert.ok(validateMarketArtifacts(snapshot, () => history).some(error => error.includes('unordered')));
  history.points[0].time = history.points[1].time;
  assert.ok(validateMarketArtifacts(snapshot, () => history).some(error => error.includes('unordered')));
});

test('publication rejects missing, unknown or numerically inconsistent momentum', () => {
  const {snapshot,history} = fixture();
  const strict = {requireMomentum:true};
  assert.ok(validateMarketArtifacts(snapshot, () => history, strict).some(error => error.includes('missing momentum')));
  const item = snapshot.items[0];
  history.points = Array.from({length:8}, (_, index) => ({time:`2026-09-${String(index + 4).padStart(2,'0')}T00:00:00Z`,value:100 + index * 10}));
  item.price = 170;
  const missing = days => ({status:'insufficient',sessions:days,observations:8,required_observations:days + 1,return_pct:null,direction:null,start_close:null,end_close:null});
  const valid = {...missing(7),status:'ok',return_pct:70,direction:'up',start_close:100,end_close:170,start_at:history.points[0].time,end_at:history.points.at(-1).time};
  snapshot.momentum_config = {windows:[7,14,21,28],default_window:7};
  snapshot.momentum_calculated_at = item.fetched_at;
  item.momentum = {basis:'trading_days',price_basis:'daily_close',calculated_at:item.fetched_at,stale:false,periods:{7:valid,14:missing(14),21:missing(21),28:missing(28)},blocks:[missing(7),missing(7),missing(7),{...valid}]};
  assert.deepEqual(validateMarketArtifacts(snapshot, () => history, strict), []);
  valid.status = 'unrecognised';
  assert.ok(validateMarketArtifacts(snapshot, () => history, strict).some(error => error.includes('unknown momentum status')));
  valid.status = 'ok';
  valid.return_pct = 7;
  assert.ok(validateMarketArtifacts(snapshot, () => history, strict).some(error => error.includes('incorrect momentum return')));
  valid.return_pct = 70;
  valid.start_at = history.points[1].time;
  assert.ok(validateMarketArtifacts(snapshot, () => history, strict).some(error => error.includes('momentum and history disagree')));
});
