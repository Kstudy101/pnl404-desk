import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildZoneRows } from "../public/modules/fib/zone-visualization.mjs";
import { enhanceFibHtml } from "../scripts/enhance-fib.mjs";

const html = readFileSync(new URL("../public/modules/fib/index.html", import.meta.url), "utf8");
const data = JSON.parse(html.match(/^const D=(.*);$/m)[1]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
function sample(price = 120) {
  return { price, distinct: [{ label: "1~4일", rows: [
    { name: "#1", price: 100 }, { name: "#2", price: 110 },
    { name: "#7", price: 150 }, { name: "#8", price: 160 },
    { name: "#1-1", price: 200 },
  ] }] };
}

test("rise and signed current-price gaps use different denominators", () => {
  const row = buildZoneRows(sample())[0];
  close(row.rise, 40 / 110 * 100);
  close(row.riseAmount, 40);
  close(row.gaps[1], -10 / 120 * 100);
  close(row.gaps[2], 30 / 120 * 100);
  close(row.progress, 25);
});

test("prices before, within, and beyond the zones retain signed gaps and unclipped progress", () => {
  for (const [price, state] of [[90, "하단 밴드 아래"], [100, "하단 밴드 내"], [110, "상승 구간"], [150, "상단 밴드 내"], [160, "상단 밴드 위"], [200, "상단 밴드 위"]]) {
    assert.equal(buildZoneRows(sample(price))[0].state, state);
  }
  assert.ok(buildZoneRows(sample(90))[0].progress < 0);
  const above = buildZoneRows(sample(200))[0];
  assert.ok(above.progress > 100);
  assert.ok(above.gaps.every((value) => value < 0));
  assert.equal(buildZoneRows(sample(150))[0].gaps[2], 0);
});

test("all displayed zone prices match the original matrix without creating extension zones", () => {
  const rows = buildZoneRows(data);
  assert.equal(rows.length, data.distinct.length);
  for (const row of rows) {
    const original = data.distinct[row.index];
    assert.equal(row.label, original.label);
    const expected = ["#1", "#2", "#7", "#8"].map((name) => original.rows.find((level) => level.name === name).price);
    assert.deepEqual([row.redLow, row.redHigh, row.blueLow, row.blueHigh], expected);
    expected.forEach((price, i) => close(row.gaps[i], (price - data.price) / data.price * 100));
  }
});

test("missing, invalid, or reversed levels cannot produce an invented range", () => {
  for (const price of [0, -1, NaN, Infinity]) assert.deepEqual(buildZoneRows(sample(price)), []);
  const missing = sample();
  missing.distinct[0].rows = missing.distinct[0].rows.filter((row) => row.name !== "#7");
  assert.deepEqual(buildZoneRows(missing), []);
  const reversed = sample();
  reversed.distinct[0].rows.find((row) => row.name === "#7").price = 109;
  assert.deepEqual(buildZoneRows(reversed), []);
});

test("publishing adds the visualizer once and preserves matrix data and markup", () => {
  const raw = '<html><head><title>fib</title></head><body><table id="mx"></table><script>const D={"price":120};</script></body></html>';
  const enhanced = enhanceFibHtml(raw);
  assert.equal(enhanceFibHtml(enhanced), enhanced);
  assert.ok(enhanced.includes('<table id="mx"></table><script>const D={"price":120};</script>'));
  assert.equal((enhanced.match(/zone-visualization\.mjs/g) || []).length, 1);
  assert.equal((enhanced.match(/zone-visualization\.css/g) || []).length, 1);
  assert.equal((enhanced.match(/name="viewport"/g) || []).length, 1);
});

test("incompatible raw HTML fails before replacing the published module", () => {
  assert.throws(() => enhanceFibHtml('<html><head></head><body>missing matrix</body></html>'), /레벨 매트릭스/);
});
