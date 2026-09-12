const pct = (from, to) => (to - from) / from * 100;
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const signed = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

/** Use the matrix's existing prices; do not derive new extension-zone rules. */
export function buildZoneRows(data) {
  if (!Number.isFinite(data?.price) || data.price <= 0) return [];
  return (data.distinct || []).flatMap((entry, index) => {
    const prices = ["#1", "#2", "#7", "#8"].map((name) => entry.rows?.find((row) => row.name === name)?.price);
    if (!prices.every((value, i) => Number.isFinite(value) && value > 0 && (!i || value > prices[i - 1]))) return [];
    const [redLow, redHigh, blueLow, blueHigh] = prices;
    const price = data.price;
    const state = price < redLow ? "하단 밴드 아래" : price < redHigh ? "하단 밴드 내" : price < blueLow ? "상승 구간" : price < blueHigh ? "상단 밴드 내" : "상단 밴드 위";
    return [{ index, label: entry.label, redLow, redHigh, blueLow, blueHigh, price, state,
      rise: pct(redHigh, blueLow), riseAmount: blueLow - redHigh,
      gaps: prices.map((value) => pct(price, value)),
      progress: (price - redHigh) / (blueLow - redHigh) * 100,
    }];
  });
}

export function mountZoneView(data, doc = document) {
  const rows = buildZoneRows(data), wrap = doc.getElementById("wrap");
  if (!wrap || doc.getElementById("fib-rise")) return;
  const section = doc.createElement("section");
  section.id = "fib-rise";
  section.className = "card full";
  section.setAttribute("aria-labelledby", "fib-rise-title");
  wrap.insertBefore(section, wrap.children[2] || null);
  if (!rows.length) {
    section.innerHTML = '<h2 id="fib-rise-title">하단 밴드 → 상단 밴드</h2><p>표시할 유효한 기준 구간이 없습니다.</p>';
    return;
  }
  const format = (value) => value.toLocaleString("en-US", { minimumFractionDigits: data.dec, maximumFractionDigits: data.dec });
  const money = (value) => esc(format(value));
  section.innerHTML = `
    <div class="fr-heading"><div><p class="fr-eyebrow">FIBONACCI · PRICE RANGE</p><h2 id="fib-rise-title">하단 밴드 <span aria-hidden="true">↗</span> 상단 밴드</h2>
      <p class="fr-subtitle">하단 밴드 상단 #2에서 상단 밴드 하단 #7까지 · 기본 구간</p></div>
      <label class="fr-picker">기준 기간<select id="fr-reference">${rows.map((row) => `<option value="${row.index}">${esc(row.label)}</option>`).join("")}</select></label></div>
    <div id="fr-detail" aria-live="polite"></div>
    <details class="fr-compare"><summary>전체 ${rows.length}개 기준 비교</summary>
      <p class="fr-hint">같은 가격 축으로 비교 · 흰 선은 현재가 · 기준을 선택하면 위 상세에 반영됩니다.</p>
      <div class="fr-comparison-scroll"><table class="fr-comparison"><thead><tr><th scope="col">기준</th><th scope="col">하단 밴드 → 상단 밴드 / USDT</th><th scope="col" class="fr-number">밴드 간 상승폭</th><th scope="col" class="fr-number">상단 밴드까지 괴리율</th></tr></thead><tbody id="fr-comparison-body"></tbody></table></div>
    </details>`;

  const allPrices = rows.flatMap((row) => [row.redLow, row.blueHigh, row.price]);
  const minimum = Math.min(...allPrices), maximum = Math.max(...allPrices);
  const commonX = (price) => 4 + (price - minimum) / (maximum - minimum) * 92;
  section.querySelector("#fr-comparison-body").innerHTML = rows.map((row) => `
    <tr><th scope="row"><button type="button" class="fr-ref-button" data-reference="${row.index}" aria-pressed="false">${esc(row.label)}</button></th>
    <td><div class="fr-mini" role="img" aria-label="${esc(row.label)}: 하단 밴드 ${money(row.redLow)}~${money(row.redHigh)}, 상단 밴드 ${money(row.blueLow)}~${money(row.blueHigh)}, 현재가 ${money(row.price)}">
      <span class="fr-mini-route" style="left:${commonX(row.redHigh)}%;width:${commonX(row.blueLow) - commonX(row.redHigh)}%"></span>
      <span class="fr-mini-red" style="left:${commonX(row.redLow)}%;width:${commonX(row.redHigh) - commonX(row.redLow)}%"></span>
      <span class="fr-mini-blue" style="left:${commonX(row.blueLow)}%;width:${commonX(row.blueHigh) - commonX(row.blueLow)}%"></span>
      <span class="fr-mini-now" style="left:${commonX(row.price)}%"></span></div><div class="fr-mini-prices"><span>${money(row.redHigh)}</span><span>${money(row.blueLow)}</span></div></td>
    <td class="fr-number">${signed(row.rise)}</td><td class="fr-number ${row.gaps[2] < 0 ? "fr-negative" : "fr-positive"}">${signed(row.gaps[2])}</td></tr>`).join("");

  function render(index) {
    const row = rows.find((value) => value.index === index) || rows[0];
    section.querySelector("#fr-reference").value = String(row.index);
    section.querySelectorAll("[data-reference]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.reference) === row.index)));
    const values = [row.redLow, row.redHigh, row.blueLow, row.blueHigh];
    const minimum = Math.min(row.redLow, row.price), maximum = Math.max(row.blueHigh, row.price);
    const x = (price) => 8 + (price - minimum) / (maximum - minimum) * 84;
    const position = row.progress < 0 ? `#2 아래 · ${signed(row.progress)}` : row.progress > 100 ? `#7 위 · ${row.progress.toFixed(1)}%` : `구간 내 ${row.progress.toFixed(1)}%`;
    section.querySelector("#fr-detail").innerHTML = `
      <div class="fr-metrics"><div class="fr-metric"><span>밴드 간 상승폭</span><strong class="fr-positive">${signed(row.rise)}</strong><small>+${money(row.riseAmount)} USDT</small></div>
        <div class="fr-metric"><span>상단 밴드까지 괴리율</span><strong class="${row.gaps[2] < 0 ? "fr-negative" : "fr-positive"}">${signed(row.gaps[2])}</strong><small>상단 밴드 하단 ${money(row.blueLow)}</small></div>
        <div class="fr-metric fr-current"><span>현재가 · ${esc(row.state)}</span><strong>${money(row.price)} <small>USDT</small></strong><small>${position}</small></div></div>
      <div class="fr-route-header"><span class="fr-red-text">하단 밴드 <b>#1~#2</b></span><span class="fr-blue-text">상단 밴드 <b>#7~#8</b></span></div>
      <div class="fr-route" role="img" aria-label="${esc(row.label)} 상승 구간: 하단 밴드 상단 ${money(row.redHigh)}에서 상단 밴드 하단 ${money(row.blueLow)}까지 ${signed(row.rise)}. 현재가 ${money(row.price)}, ${esc(row.state)}">
        <div class="fr-price-line"></div>
        <div class="fr-zone fr-red-zone" style="left:${x(row.redLow)}%;width:${x(row.redHigh) - x(row.redLow)}%"></div>
        <div class="fr-travel" style="left:${x(row.redHigh)}%;width:${x(row.blueLow) - x(row.redHigh)}%"><span aria-hidden="true">→</span></div>
        <div class="fr-zone fr-blue-zone" style="left:${x(row.blueLow)}%;width:${x(row.blueHigh) - x(row.blueLow)}%"></div>
        <div class="fr-now" style="left:${x(row.price)}%"><span>현재가 ${money(row.price)}</span><i></i></div>
        <span class="fr-axis-label" style="left:${x(row.redLow)}%">#1</span><span class="fr-axis-label" style="left:${x(row.redHigh)}%">#2</span>
        <span class="fr-axis-label" style="left:${x(row.blueLow)}%">#7</span><span class="fr-axis-label" style="left:${x(row.blueHigh)}%">#8</span>
      </div>
      <div class="fr-levels">${values.map((price, i) => `<div class="fr-level ${i < 2 ? "fr-red-level" : "fr-blue-level"}"><span>${["하단 밴드 하단 #1", "하단 밴드 상단 #2", "상단 밴드 하단 #7", "상단 밴드 상단 #8"][i]}</span><b>${money(price)}</b><small class="${row.gaps[i] < 0 ? "fr-negative" : "fr-positive"}">현재가 대비 ${signed(row.gaps[i])}</small></div>`).join("")}</div>`;
  }
  section.querySelector("#fr-reference").addEventListener("change", (event) => render(Number(event.target.value)));
  section.querySelectorAll("[data-reference]").forEach((button) => button.addEventListener("click", () => render(Number(button.dataset.reference))));
  render(rows[0].index);
}

// D is the existing classic-script matrix payload, available before modules execute.
if (typeof document !== "undefined" && typeof D !== "undefined") mountZoneView(D);
