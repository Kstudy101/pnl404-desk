import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { enhanceSopHtml } from '../scripts/enhance-sop.mjs';
import { buildLevelRows, selectLevels, formatLevelPrice, remainingLabel, durationLabel, distributionPosition, renderSopMarkup, mountSop } from '../public/modules/sop/levels-view.mjs';

// Captured before redesign from the original SOP HTML. This fixture stays
// independent of the new renderer and does not require the user's raw projects.
const ORIGINAL_LITERAL = "{\"symbols\":[{\"symbol\":\"BTCUSDT\",\"now\":1789218302216,\"price\":77336.01,\"above\":[{\"type\":\"EQH\",\"price\":93673.14,\"dist\":21.124867962544236,\"first\":1768780800000,\"n\":1,\"h\":5677.083948888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":95498.6,\"dist\":23.485294883974504,\"first\":1768777200000,\"n\":1,\"h\":5678.083948888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":105039.99,\"dist\":35.82287216524361,\"first\":1762956000000,\"n\":1,\"h\":7295.083948888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"below\":[{\"type\":\"EQL\",\"price\":74510.77,\"dist\":-3.6532011413570356,\"first\":1787284800000,\"n\":1,\"h\":537.0839488888889,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":73027.02,\"dist\":-5.571776976857212,\"first\":1787270400000,\"n\":1,\"h\":541.0839488888889,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":51951.01,\"dist\":-32.824294917723314,\"first\":1722866400000,\"n\":1,\"h\":18431.08394888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQL\",\"price\":43615.47,\"dist\":-43.60263737423226,\"first\":1707336000000,\"n\":1,\"h\":22745.08394888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQL\",\"price\":41021.65,\"dist\":-46.95659887289245,\"first\":1706277600000,\"n\":1,\"h\":23039.08394888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"barsFrom\":1702771200000,\"barsTo\":1789214400000},{\"symbol\":\"ETHUSDT\",\"now\":1789218302934,\"price\":2535.89,\"above\":[{\"type\":\"EQH\",\"price\":3865.12,\"dist\":52.41670577193807,\"first\":1762131600000,\"n\":1,\"h\":7524.084148333333,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":3940.43,\"dist\":55.3864718106858,\"first\":1761811200000,\"n\":1,\"h\":7613.084148333333,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":4271.16,\"dist\":68.42844129674394,\"first\":1760396400000,\"n\":1,\"h\":8006.084148333333,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":4454.69,\"dist\":75.66574259924523,\"first\":1759989600000,\"n\":1,\"h\":8119.084148333333,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"below\":[{\"type\":\"EQL\",\"price\":2341.05,\"dist\":-7.683298565789514,\"first\":1787284800000,\"n\":1,\"h\":537.0841483333334,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":2281.24,\"dist\":-10.041839354230667,\"first\":1787238000000,\"n\":1,\"h\":550.0841483333334,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":2102.02,\"dist\":-17.109180603259603,\"first\":1787169600000,\"n\":1,\"h\":569.0841483333334,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838}],\"barsFrom\":1702771200000,\"barsTo\":1789214400000},{\"symbol\":\"SOLUSDT\",\"now\":1789218303342,\"price\":102.11,\"above\":[{\"type\":\"EQH\",\"price\":116.79,\"dist\":14.376652629517196,\"first\":1769857200000,\"n\":1,\"h\":5378.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":127.35,\"dist\":24.71844089707178,\"first\":1769608800000,\"n\":1,\"h\":5447.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":133.03,\"dist\":30.281069434923126,\"first\":1768888800000,\"n\":1,\"h\":5647.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":137.87,\"dist\":35.02105572421898,\"first\":1768780800000,\"n\":1,\"h\":5677.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":142.86,\"dist\":39.90794241504261,\"first\":1768777200000,\"n\":1,\"h\":5678.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":147.53,\"dist\":44.481441582607,\"first\":1768424400000,\"n\":1,\"h\":5776.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":162.99,\"dist\":59.62197630006857,\"first\":1762873200000,\"n\":1,\"h\":7318.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":258.95,\"dist\":153.59905983743022,\"first\":1737878400000,\"n\":1,\"h\":14261.084261666667,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"below\":[{\"type\":\"EQL\",\"price\":87.23,\"dist\":-14.572519831554201,\"first\":1787266800000,\"n\":1,\"h\":542.0842616666666,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":83.72,\"dist\":-18.009989227303887,\"first\":1787173200000,\"n\":1,\"h\":568.0842616666666,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":64.23,\"dist\":-37.09724806581138,\"first\":1782396000000,\"n\":1,\"h\":1895.0842616666666,\"bucket\":6,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQL\",\"price\":63.67,\"dist\":-37.64567623151503,\"first\":1781139600000,\"n\":1,\"h\":2244.084261666667,\"bucket\":7,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQL\",\"price\":63.19,\"dist\":-38.11575751640388,\"first\":1781136000000,\"n\":1,\"h\":2245.084261666667,\"bucket\":7,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"barsFrom\":1702771200000,\"barsTo\":1789214400000},{\"symbol\":\"XRPUSDT\",\"now\":1789218303460,\"price\":1.369,\"above\":[{\"type\":\"EQH\",\"price\":1.7022,\"dist\":24.338933528122713,\"first\":1769860800000,\"n\":1,\"h\":5377.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":1.7071,\"dist\":24.69685902118335,\"first\":1769857200000,\"n\":1,\"h\":5378.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":2.072,\"dist\":51.35135135135136,\"first\":1768683600000,\"n\":1,\"h\":5704.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":2.5029,\"dist\":82.82688093498903,\"first\":1763046000000,\"n\":1,\"h\":7270.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":3.1165,\"dist\":127.6479181884587,\"first\":1758222000000,\"n\":1,\"h\":8610.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":3.2554,\"dist\":137.79401022644265,\"first\":1755158400000,\"n\":1,\"h\":9461.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":3.4504,\"dist\":152.03798392987585,\"first\":1753272000000,\"n\":1,\"h\":9985.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":3.4923,\"dist\":155.0986121256392,\"first\":1753250400000,\"n\":1,\"h\":9991.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"below\":[{\"type\":\"EQL\",\"price\":0.514,\"dist\":-62.45434623813002,\"first\":1730851200000,\"n\":1,\"h\":16213.084294444445,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"barsFrom\":1702771200000,\"barsTo\":1789214400000}],\"symbol\":\"BTCUSDT\",\"now\":1789218302216,\"price\":77336.01,\"mode\":\"single\",\"dist\":{\"source\":\"아티팩트 원장(동일점 규칙)\",\"symbols\":[\"BTC\",\"ETH\",\"SOL\",\"XRP\"],\"n\":3700,\"buckets\":[{\"label\":\"\\u003c1일\",\"lo\":0,\"hi\":24,\"n\":168,\"share\":0.04540540540540541},{\"label\":\"1~3일\",\"lo\":24,\"hi\":72,\"n\":406,\"share\":0.10972972972972973},{\"label\":\"3~7일\",\"lo\":72,\"hi\":168,\"n\":582,\"share\":0.1572972972972973},{\"label\":\"7~14일\",\"lo\":168,\"hi\":336,\"n\":703,\"share\":0.19},{\"label\":\"14~30일\",\"lo\":336,\"hi\":720,\"n\":1350,\"share\":0.36486486486486486},{\"label\":\"30~60일\",\"lo\":720,\"hi\":1440,\"n\":322,\"share\":0.08702702702702703},{\"label\":\"60~90일\",\"lo\":1440,\"hi\":2160,\"n\":60,\"share\":0.016216216216216217},{\"label\":\"90~180일\",\"lo\":2160,\"hi\":4320,\"n\":75,\"share\":0.02027027027027027},{\"label\":\"180일+\",\"lo\":4320,\"hi\":null,\"n\":34,\"share\":0.009189189189189189}],\"modal\":4,\"medianHours\":334,\"meanHours\":498.26405405405404,\"p90Hours\":782,\"within24h\":0.04540540540540541,\"within30d\":0.8672972972972973,\"conditional\":[{\"survivedHours\":0,\"n\":3700,\"remainMedianHours\":334,\"remainMeanHours\":498.26405405405404,\"remainP90Hours\":782},{\"survivedHours\":1,\"n\":3700,\"remainMedianHours\":333,\"remainMeanHours\":497.26405405405404,\"remainP90Hours\":781},{\"survivedHours\":2,\"n\":3700,\"remainMedianHours\":332,\"remainMeanHours\":496.26405405405404,\"remainP90Hours\":780},{\"survivedHours\":3,\"n\":3700,\"remainMedianHours\":331,\"remainMeanHours\":495.26405405405404,\"remainP90Hours\":779},{\"survivedHours\":6,\"n\":3698,\"remainMedianHours\":328,\"remainMeanHours\":492.5302866414278,\"remainP90Hours\":776},{\"survivedHours\":12,\"n\":3652,\"remainMedianHours\":328,\"remainMeanHours\":492.68236582694414,\"remainP90Hours\":774},{\"survivedHours\":24,\"n\":3522,\"remainMedianHours\":335,\"remainMeanHours\":498.6391254968768,\"remainP90Hours\":784},{\"survivedHours\":48,\"n\":3303,\"remainMedianHours\":348,\"remainMeanHours\":506.94035725098394,\"remainP90Hours\":784},{\"survivedHours\":72,\"n\":3120,\"remainMedianHours\":352,\"remainMeanHours\":511.96666666666664,\"remainP90Hours\":795},{\"survivedHours\":168,\"n\":2541,\"remainMedianHours\":335,\"remainMeanHours\":522.0287288469107,\"remainP90Hours\":853},{\"survivedHours\":336,\"n\":1838,\"remainMedianHours\":273,\"remainMeanHours\":522.0337323177366,\"remainP90Hours\":1021},{\"survivedHours\":720,\"n\":488,\"remainMedianHours\":336,\"remainMeanHours\":1027.2684426229507,\"remainP90Hours\":2800},{\"survivedHours\":1440,\"n\":169,\"remainMedianHours\":1284,\"remainMeanHours\":1882.491124260355,\"remainP90Hours\":4102}]},\"edges\":[{\"label\":\"\\u003c1일\",\"lo\":0,\"hi\":24},{\"label\":\"1~3일\",\"lo\":24,\"hi\":72},{\"label\":\"3~7일\",\"lo\":72,\"hi\":168},{\"label\":\"7~14일\",\"lo\":168,\"hi\":336},{\"label\":\"14~30일\",\"lo\":336,\"hi\":720},{\"label\":\"30~60일\",\"lo\":720,\"hi\":1440},{\"label\":\"60~90일\",\"lo\":1440,\"hi\":2160},{\"label\":\"90~180일\",\"lo\":2160,\"hi\":4320},{\"label\":\"180일+\",\"lo\":4320,\"hi\":null}],\"above\":[{\"type\":\"EQH\",\"price\":93673.14,\"dist\":21.124867962544236,\"first\":1768780800000,\"n\":1,\"h\":5677.083948888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":95498.6,\"dist\":23.485294883974504,\"first\":1768777200000,\"n\":1,\"h\":5678.083948888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQH\",\"price\":105039.99,\"dist\":35.82287216524361,\"first\":1762956000000,\"n\":1,\"h\":7295.083948888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"below\":[{\"type\":\"EQL\",\"price\":74510.77,\"dist\":-3.6532011413570356,\"first\":1787284800000,\"n\":1,\"h\":537.0839488888889,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":73027.02,\"dist\":-5.571776976857212,\"first\":1787270400000,\"n\":1,\"h\":541.0839488888889,\"bucket\":4,\"inRange\":true,\"rem\":273,\"remN\":1838},{\"type\":\"EQL\",\"price\":51951.01,\"dist\":-32.824294917723314,\"first\":1722866400000,\"n\":1,\"h\":18431.08394888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQL\",\"price\":43615.47,\"dist\":-43.60263737423226,\"first\":1707336000000,\"n\":1,\"h\":22745.08394888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169},{\"type\":\"EQL\",\"price\":41021.65,\"dist\":-46.95659887289245,\"first\":1706277600000,\"n\":1,\"h\":23039.08394888889,\"bucket\":8,\"inRange\":false,\"rem\":1284,\"remN\":169}],\"barsFrom\":1702771200000,\"barsTo\":1789214400000}";
const originalData = () => JSON.parse(ORIGINAL_LITERAL);
const literalIn = html => html.match(/const D=(.*?);const f=/s)?.[1];
const originalHtml = () => '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>SOP fixture</title><meta http-equiv="refresh" content="600"></head><body><h1 id="t"></h1><div id="wrap"><div id="dist"></div><div id="stats"></div><div id="sections"></div><div id="foot"></div></div><script>const D=' + ORIGINAL_LITERAL + ';const f=x=>x;</script></body></html>';
const numberIn = value => Number(String(value).replace(/,/g, ''));

test('SOP publishing preserves independent original data and timestamps while normalizing hourly reload exactly once', () => {
  assert.equal(createHash('sha256').update(ORIGINAL_LITERAL).digest('hex'), '30ce2ba1d3d97a9bc615354cb6263fd591a371ccafb934051d6e28b0fd2dee75');
  const raw = originalHtml(), enhanced = enhanceSopHtml(raw);
  assert.equal(literalIn(enhanced), ORIGINAL_LITERAL);
  assert.equal(enhanceSopHtml(enhanced), enhanced);
  assert.match(enhanced, /http-equiv="refresh" content="3600"/);
  assert.equal((enhanced.match(/levels-view\.mjs/g) || []).length, 1);
  assert.equal((enhanced.match(/levels-view\.css/g) || []).length, 1);
  assert.equal((enhanced.match(/name="viewport"/g) || []).length, 1);
  assert.match(enhanced, /미해소 레벨/);
  assert.throws(() => enhanceSopHtml('<html><head></head><body>No SOP data</body></html>'));
});

test('all 37 original levels retain every raw field and belong to the correct symbol and side', () => {
  const data = originalData(), before = JSON.stringify(data), rows = buildLevelRows(data);
  assert.equal(rows.length, 37);
  assert.equal(new Set(rows.map(row => row.id)).size, 37);
  assert.deepEqual(data.symbols.map(symbol => rows.filter(row => row.symbol === symbol.symbol).length), [8, 7, 13, 9]);
  for (const symbol of data.symbols) for (const side of ['above', 'below']) for (const [index, raw] of symbol[side].entries()) {
    const row = rows.find(row => row.id === symbol.symbol + ':' + side + ':' + index);
    assert.ok(row);
    for (const [key, value] of Object.entries(raw)) assert.deepEqual(row[key], value, row.id + ':' + key);
    assert.equal(row.side, side);
    assert.equal(row.currentPrice, symbol.price);
    assert.equal(row.snapshotAt, symbol.now);
    assert.equal(row.barsFrom, symbol.barsFrom);
    assert.equal(row.barsTo, symbol.barsTo);
  }
  assert.equal(JSON.stringify(data), before);
});

test('filters are reversible, include every side and candidate, and sorting never mutates source rows', () => {
  const rows = buildLevelRows(originalData()), before = JSON.stringify(rows);
  assert.equal(selectLevels(rows, {}).length, 37);
  assert.equal(selectLevels(rows, { side: 'above' }).length, 23);
  assert.equal(selectLevels(rows, { side: 'below' }).length, 14);
  assert.equal(selectLevels(rows, { candidate: 'inRange', modal: 4 }).length, 7);
  assert.equal(selectLevels(rows, { candidate: 'before', modal: 4 }).length, 0);
  assert.equal(selectLevels(rows, { candidate: 'past', modal: 4 }).length, 30);
  assert.equal(selectLevels(rows, { symbol: 'BTCUSDT', side: 'below', candidate: 'inRange', modal: 4 }).length, 2);
  assert.deepEqual(selectLevels(rows, { symbol: 'XRPUSDT', candidate: 'inRange', modal: 4 }), []);
  assert.equal(selectLevels(rows, { symbol: 'all', side: 'all', candidate: 'all' }).length, 37);
  const nearest = selectLevels(rows, { sort: 'distance' });
  assert.equal(nearest[0].price, 74510.77);
  assert.ok(nearest.every((row, index) => !index || Math.abs(nearest[index - 1].dist) <= Math.abs(row.dist)));
  const oldest = selectLevels(rows, { sort: 'age_desc' });
  assert.equal(oldest[0].price, 41021.65);
  assert.ok(oldest.every((row, index) => !index || oldest[index - 1].h >= row.h));
  const highest = selectLevels(rows, { sort: 'price_desc' });
  assert.equal(highest[0].price, 105039.99);
  assert.equal(JSON.stringify(rows), before);
});

test('price precision preserves XRP and small prices and missing values never become zero', () => {
  for (const [price, symbol] of [[1.7022, 'XRPUSDT'], [1.369, 'XRPUSDT'], [77336.01, 'BTCUSDT'], [0.000123, 'TEST']]) {
    assert.equal(numberIn(formatLevelPrice(price, symbol)), price);
  }
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.ok(!/[0-9]/.test(formatLevelPrice(value, 'XRPUSDT')));
    assert.ok(!/NaN|Infinity/.test(formatLevelPrice(value, 'XRPUSDT')));
  }
});

test('remaining time retains conditional sample counts and distinguishes missing values from a real zero', () => {
  const rows = buildLevelRows(originalData());
  for (const row of rows) {
    const remaining = remainingLabel(row);
    assert.equal(remaining.value, row.rem);
    assert.equal(remaining.sample, row.remN);
    assert.equal(remaining.available, true);
    assert.ok(remaining.label.length > 0);
  }
  const candidate = remainingLabel(rows.find(row => row.inRange));
  assert.equal(candidate.value, 273);
  assert.equal(candidate.sample, 1838);
  assert.equal(remainingLabel({ rem: 0, remN: 2 }).available, true);
  for (const value of [null, undefined, NaN]) {
    assert.equal(remainingLabel({ rem: value, remN: 2 }).available, false);
  }
  assert.ok(!/NaN|Infinity/.test(durationLabel(null)));
});

test('rendered tables retain all levels, timestamps, nine bins and thirteen conditional statistics without shifted columns', () => {
  const data = originalData(), markup = renderSopMarkup(data);
  assert.equal((markup.match(/data-level-id=/g) || []).length, 37);
  assert.equal((markup.match(/data-bucket=/g) || []).length, 9);
  assert.equal((markup.match(/data-conditional=/g) || []).length, 13);
  for (const row of buildLevelRows(data)) {
    const body = markup.match(new RegExp('<tr data-level-id="' + row.id + '"[\\s\\S]*?</tr>'))?.[0];
    assert.ok(body, row.id);
    assert.equal((body.match(/<td\b/g) || []).length, 6);
    assert.ok(body.includes('data-remaining="' + row.rem + '"'));
    assert.ok(body.includes('data-sample="' + row.remN + '"'));
    assert.ok(body.includes('datetime="' + new Date(row.first).toISOString() + '"'));
    assert.ok(body.includes(formatLevelPrice(row.price, row.symbol)));
  }
  const format = (value, digits = 1) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(value);
  for (const [index, row] of data.dist.conditional.entries()) {
    const body = markup.match(new RegExp('<tr data-conditional="' + index + '">([\\s\\S]*?)</tr>'))?.[1];
    assert.ok(body);
    const values = [...body.matchAll(/<(?:th|td)[^>]*>(.*?)<\/(?:th|td)>/g)].map(match => match[1]);
    assert.deepEqual(values, [format(row.survivedHours) + '시간', format(row.n, 0), format(row.remainMedianHours) + '시간', format(row.remainMeanHours) + '시간', format(row.remainP90Hours) + '시간']);
  }
  for (const value of [data.dist.medianHours, data.dist.meanHours, data.dist.p90Hours]) assert.ok(markup.includes(format(value) + '시간'));
  assert.ok(markup.includes('과거 표본 3,700건'));
  assert.match(markup, /원본 파일이 갱신된 경우 새 값이 반영/);
  assert.match(markup, /화면 새로고침은 원본을 재계산하지 않습니다/);
  assert.ok(!/NaN|Infinity|undefined/.test(markup));
});

test('readme mode retains its touch column and rules, while text and attributes are escaped', () => {
  const data = originalData(); data.mode = 'readme'; data.symbols[0].above[0].n = 4;
  const markup = renderSopMarkup(data);
  assert.equal((markup.match(/data-level-id=/g) || []).length, 37);
  for (const row of markup.matchAll(/<tr data-level-id="[^"]+"[\s\S]*?<\/tr>/g)) assert.equal((row[0].match(/<td\b/g) || []).length, 7);
  assert.match(markup, /<th scope="col">터치<\/th>/);
  assert.match(markup, /<strong>4회<\/strong>/);
  for (const text of ['3봉 프랙탈', '5시간 간격', '30일 묶음', '마지막 터치 후 재돌파', '±0.1%']) assert.ok(markup.includes(text));
  data.dist.source = '<img src=x onerror=alert(1)>';
  data.symbols[0].symbol = 'BTC" onclick="alert(1)';
  const escaped = renderSopMarkup(data);
  assert.ok(!escaped.includes('<img src=x'));
  assert.ok(!escaped.includes('data-select-symbol="BTC" onclick='));
  assert.ok(escaped.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('distribution position preserves weighted bucket placement and the open-ended tail convention', () => {
  const distribution = { buckets: [{ share: .2 }, { share: .5 }, { share: .3 }] };
  const edges = [{ lo: 0, hi: 10 }, { lo: 10, hi: 20 }, { lo: 20, hi: null }];
  assert.equal(distributionPosition({ bucket: 1, h: 15 }, distribution, edges), 45);
  assert.equal(distributionPosition({ bucket: 1, h: 10 }, distribution, edges), 20);
  assert.equal(distributionPosition({ bucket: 1, h: 20 }, distribution, edges), 70);
  assert.equal(distributionPosition({ bucket: 2, h: 20 }, distribution, edges), 70);
  assert.equal(distributionPosition({ bucket: 2, h: 100 }, distribution, edges), 85);
  assert.equal(distributionPosition({ bucket: 9, h: 100 }, distribution, edges), null);
});

test('mounted controls restore deep-linked filters, announce empty results, reset and retain snapshot data', () => {
  const data = originalData(), before = JSON.stringify(data), nodes = new Map();
  let reloads = 0;
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', value: '', dataset: {}, attrs: {}, events: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      focus() { this.focused = true; },
    });
    return nodes.get(key);
  };
  const buttons = ['all', ...data.symbols.map(entry => entry.symbol)].map(symbol => {
    const button = node('[data-select-symbol="' + symbol + '"]'); button.dataset.selectSymbol = symbol; return button;
  });
  const main = node('sop-app');
  main.querySelector = node;
  main.querySelectorAll = () => buttons;
  const view = { location: { href: 'https://fixture.invalid/modules/sop/index.html?symbol=XRPUSDT&side=below', search: '?symbol=XRPUSDT&side=below', reload() { reloads++; } }, history: { replaceState(_state, _title, url) { view.location.href = String(url); view.location.search = new URL(url).search; } } };
  const doc = { defaultView: view, getElementById: node, createElement: () => main, body: { append() {} } };
  const app = mountSop(data, doc);
  assert.deepEqual(app.getState(), { symbol: 'XRPUSDT', side: 'below', candidate: 'all', sort: 'distance' });
  assert.equal(node('#sop-side').value, 'below');
  app.render();
  assert.equal(node('#sop-result-count').textContent, '1 / 37');
  node('#sop-candidate').value = 'inRange'; node('#sop-candidate').events.change();
  assert.equal(node('#sop-result-count').textContent, '0 / 37');
  assert.match(node('#sop-levels').innerHTML, /전체 레벨 보기/);
  assert.match(node('#sop-announcement').textContent, /0개 표시/);
  assert.equal(new URL(view.location.href).searchParams.get('candidate'), 'inRange');
  main.events.click({ target: { closest: () => ({ dataset: { resetFilters: 'true' } }) } });
  assert.equal(node('#sop-result-count').textContent, '37 / 37');
  assert.equal(node('[data-select-symbol="all"]').focused, true);
  assert.equal(node('[data-select-symbol="all"]').attrs['aria-pressed'], 'true');
  assert.equal(new URL(view.location.href).search, '');
  main.events.click({ target: { closest: () => buttons[1] } });
  assert.equal(node('#sop-result-count').textContent, '8 / 37');
  node('#sop-sort').value = 'age_desc'; node('#sop-sort').events.change();
  assert.ok(node('#sop-levels').innerHTML.indexOf('data-level-id="BTCUSDT:below:4"') < node('#sop-levels').innerHTML.indexOf('data-level-id="BTCUSDT:above:0"'));
  main.events.click({ target: { closest: () => ({ id: 'sop-refresh', dataset: {} }) } });
  assert.equal(reloads, 1);
  assert.equal(JSON.stringify(data), before);
});
