const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = (value, digits = 0) => finite(value) ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(value) : '—';
const pct = (value, signed = false) => finite(value) ? `${signed && value > 0 ? '+' : ''}${new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%` : '—';
const shortSymbol = (value) => String(value || '').replace(/USDT$/, '');
const SYMBOL_NAMES = { BTC: '비트코인', ETH: '이더리움', SOL: '솔라나', XRP: '리플' };
const SYMBOL_SIGNS = { BTC: '₿', ETH: 'Ξ', SOL: '◎', XRP: '×' };
const BIN_COLORS = ['#7f93a5', '#889eb5', '#89aac5', '#8cb8d7', '#e9c07b', '#caa879', '#bc927b', '#ad807a', '#997984'];

export function formatLevelPrice(value, symbol = '') {
  if (!finite(value)) return '—';
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const decimals = Math.max(0, (mantissa.split('.')[1]?.length || 0) - Number(exponent));
  const digits = Math.min(12, Math.max(String(symbol).startsWith('XRP') ? 4 : 2, decimals));
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function durationLabel(hours) {
  if (!finite(hours) || hours < 0) return '—';
  return hours < 48 ? `${number(hours, 1)}시간` : `${number(hours / 24, 1)}일`;
}

export function remainingLabel(row) {
  const available = finite(row?.rem) && row.rem >= 0;
  return { value: available ? row.rem : null, sample: finite(row?.remN) && row.remN >= 0 ? row.remN : null, label: available ? durationLabel(row.rem) : '표본 미제공', available };
}

export function buildLevelRows(data) {
  const symbols = Array.isArray(data?.symbols) ? data.symbols : data?.symbol ? [data] : [];
  return symbols.flatMap((entry) => ['above', 'below'].flatMap((side) => (Array.isArray(entry[side]) ? entry[side] : []).map((row, index) => ({ ...row, id: `${entry.symbol}:${side}:${index}`, symbol: entry.symbol, side, currentPrice: entry.price, snapshotAt: entry.now, barsFrom: entry.barsFrom, barsTo: entry.barsTo }))));
}

export function selectLevels(rows, { symbol = 'all', side = 'all', candidate = 'all', sort = 'distance', modal = 4 } = {}) {
  return rows.filter((row) => (symbol === 'all' || row.symbol === symbol) && (side === 'all' || row.side === side) && (candidate === 'all' || candidate === 'inRange' && row.inRange === true || candidate === 'before' && !row.inRange && row.bucket < modal || candidate === 'past' && !row.inRange && row.bucket > modal)).sort((a, b) => {
    const left = sort === 'age_desc' ? a.h : sort === 'price_desc' ? a.price : Math.abs(a.dist);
    const right = sort === 'age_desc' ? b.h : sort === 'price_desc' ? b.price : Math.abs(b.dist);
    if (!finite(left)) return finite(right) ? 1 : 0;
    if (!finite(right)) return -1;
    return (left - right) * (sort === 'distance' ? 1 : -1) || String(a.id).localeCompare(String(b.id));
  });
}

export function distributionPosition(row, distribution, edges) {
  const bucket = distribution?.buckets?.[row?.bucket], edge = edges?.[row?.bucket];
  if (!bucket || !edge || !finite(row.h)) return null;
  const left = distribution.buckets.slice(0, row.bucket).reduce((sum, item) => sum + item.share * 100, 0);
  const span = edge.hi === null ? Math.max(1, row.h - edge.lo) * 2 : edge.hi - edge.lo;
  const fraction = Math.min(1, Math.max(0, (row.h - edge.lo) / span));
  return Math.min(100, Math.max(0, left + bucket.share * 100 * fraction));
}

export function formatKst(value, { short = false } = {}) {
  const date = new Date(value);
  if (!finite(value) || !Number.isFinite(date.getTime())) return '시각 미제공';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...(short ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) + ' KST';
}

function candidateLabel(row, modal) { return row.inRange ? '★ 사정권' : row.bucket > modal ? '사정권 지남' : '사정권 전'; }
function symbolMark(symbol) { const short = shortSymbol(symbol); return `<span class="sop-symbol-mark" data-symbol="${esc(short)}" aria-hidden="true">${esc(SYMBOL_SIGNS[short] || short.slice(0, 1))}</span>`; }
function positionMarkup(row, data) {
  const position = distributionPosition(row, data.dist, data.edges);
  if (position === null) return '<span class="sop-subtle">분포 위치 미제공</span>';
  return `<span class="sop-position" role="img" aria-label="경과 ${esc(durationLabel(row.h))}, ${esc(data.dist.buckets[row.bucket]?.label)} 구간의 분포 위치">${data.dist.buckets.map((bucket, index) => `<i style="width:${bucket.share * 100}%;background:${BIN_COLORS[index % BIN_COLORS.length]};opacity:${index === row.bucket ? 1 : .22}"></i>`).join('')}<em style="left:${position}%"></em></span>`;
}
function remainingMarkup(row) {
  const remaining = remainingLabel(row);
  return remaining.available ? `<strong>${number(remaining.value, 1)}<span class="sop-unit">시간</span></strong><small>${esc(remaining.label)}<span class="sop-dot">·</span>n=${number(remaining.sample)}</small>` : `<span class="sop-subtle">표본 미제공</span>${remaining.sample !== null ? `<small>n=${number(remaining.sample)}</small>` : ''}`;
}

export function renderLevelTable(rows, data) {
  if (!rows.length) return '<p class="sop-empty-inline">이 조건에 해당하는 미해소 레벨이 없습니다.</p>';
  const touchColumn = data.mode === 'readme';
  return `<table class="sop-level-table"><thead><tr><th scope="col">레벨 가격 <span>/ 괴리율</span></th><th scope="col">발생 시각</th><th scope="col">경과</th>${touchColumn ? '<th scope="col">터치</th>' : ''}<th scope="col">현재 구간 <span>/ 과거 비중</span></th><th scope="col">예상 잔여 <span>(중앙값)</span></th><th scope="col">사정권</th></tr></thead><tbody>${rows.map((row) => {
    const bucket = data.dist?.buckets?.[row.bucket];
    return `<tr data-level-id="${esc(row.id)}" class="${row.inRange ? 'sop-in-range' : ''}"><td class="sop-level-price" data-label="레벨 / 괴리율"><span class="sop-side ${row.side}">${row.side === 'above' ? '↑ 저항' : '↓ 지지'}<span>${esc(row.type)}</span></span><strong>${formatLevelPrice(row.price, row.symbol)}</strong><small class="${row.side}">${pct(row.dist, true)} <span>현재가 대비</span></small></td><td data-label="발생 시각"><time datetime="${finite(row.first) ? new Date(row.first).toISOString() : ''}">${esc(formatKst(row.first).replace(' KST', ''))}</time><small>KST${!touchColumn ? ` · 원본 터치 ${number(row.n)}회` : ''}</small></td><td data-label="경과" title="${number(row.h, 3)}시간"><strong>${esc(durationLabel(row.h))}</strong><small>${number(row.h, 1)}시간</small></td>${touchColumn ? `<td data-label="터치"><strong>${number(row.n)}회</strong></td>` : ''}<td data-label="현재 구간" class="sop-bucket-cell"><strong>${esc(bucket?.label || '구간 미제공')} <span class="sop-bin-share">${finite(bucket?.share) ? number(bucket.share * 100, 1) + '%' : ''}</span></strong>${positionMarkup(row, data)}</td><td data-label="예상 잔여 (중앙값)" class="sop-remaining" data-remaining="${finite(row.rem) ? row.rem : ''}" data-sample="${finite(row.remN) ? row.remN : ''}">${remainingMarkup(row)}</td><td data-label="사정권"><span class="sop-candidate ${row.inRange ? 'active' : ''}">${candidateLabel(row, data.dist.modal)}</span></td></tr>`;
  }).join('')}</tbody></table>`;
}

function renderSymbolSection(entry, rows, data) {
  const above = entry.above?.length || 0, below = entry.below?.length || 0;
  return `<section class="sop-symbol-section" aria-labelledby="sop-symbol-${esc(entry.symbol)}"><div class="sop-symbol-heading"><div class="sop-symbol-identity">${symbolMark(entry.symbol)}<div><h2 id="sop-symbol-${esc(entry.symbol)}">${esc(shortSymbol(entry.symbol))}<span>${esc(SYMBOL_NAMES[shortSymbol(entry.symbol)] || '')}</span></h2><p>저항 ${above}개<span>지지 ${below}개</span><b>${rows.length} / ${above + below} 표시</b></p></div></div><div class="sop-current-price"><span>스냅샷 현재가 <small>USDT</small></span><strong>${formatLevelPrice(entry.price, entry.symbol)}</strong></div></div><div class="sop-level-container">${renderLevelTable(rows, data)}</div><details class="sop-source-detail"><summary>시세 기준과 원본 캔들 범위</summary><dl><div><dt>종목</dt><dd>${esc(entry.symbol)} · 바이낸스 현물 1시간봉</dd></div><div><dt>가격 기준</dt><dd>${esc(formatKst(entry.now))}</dd></div><div><dt>수집된 캔들</dt><dd>${esc(formatKst(entry.barsFrom))} ~ ${esc(formatKst(entry.barsTo))}</dd></div></dl></details></section>`;
}

function renderLevels(data, filters) {
  const rows = selectLevels(buildLevelRows(data), { ...filters, modal: data.dist.modal });
  const symbols = data.symbols.filter((entry) => filters.symbol === 'all' || entry.symbol === filters.symbol);
  if (!rows.length) return '<div class="sop-empty"><span aria-hidden="true">◇</span><h2>조건에 맞는 레벨이 없습니다</h2><p>방향이나 사정권 필터를 바꾸면 다른 미해소 레벨을 확인할 수 있습니다.</p><button type="button" data-reset-filters="true">전체 레벨 보기</button></div>';
  return symbols.map((entry) => renderSymbolSection(entry, rows.filter((row) => row.symbol === entry.symbol), data)).join('');
}

export function renderDistribution(distribution) {
  const scaleTop = Math.max(10, Math.ceil(Math.max(0, ...distribution.buckets.map((bucket) => bucket.share * 100)) / 10) * 10);
  const modal = distribution.buckets[distribution.modal];
  return `<section class="sop-distribution" aria-labelledby="sop-dist-title"><div class="sop-section-heading"><h2 id="sop-dist-title">해소까지 걸린 시간</h2><span>과거 표본 ${number(distribution.n)}건</span></div><p class="sop-description">첫 터치부터 해소까지의 관측 분포</p><div class="sop-hist-axis"><span>0%</span><span>${scaleTop}%</span></div><div class="sop-histogram">${distribution.buckets.map((bucket, index) => `<div class="sop-hist-row ${index === distribution.modal ? 'modal' : ''}" data-bucket="${index}"><span class="sop-hist-label">${esc(bucket.label)}</span><div class="sop-hist-track"><i style="width:${bucket.share * 100 / scaleTop * 100}%;background:${index === distribution.modal ? '#e9c07b' : BIN_COLORS[index % BIN_COLORS.length]}"></i></div><strong>${number(bucket.share * 100, 1)}%</strong><small>${number(bucket.n)}건</small></div>`).join('')}</div><div class="sop-modal-explanation"><span>★ 사정권 기준</span><strong>${esc(modal?.label || '—')}</strong><p>과거 해소 비중이 가장 큰 구간입니다. 현재 경과 시간이 이 구간에 있는 레벨을 사정권으로 표시합니다.</p></div><dl class="sop-stat-list"><div><dt>중앙값</dt><dd>${number(distribution.medianHours, 1)}시간 <small>${esc(durationLabel(distribution.medianHours))}</small></dd></div><div><dt>평균</dt><dd>${number(distribution.meanHours, 1)}시간</dd></div><div><dt>90백분위</dt><dd>${number(distribution.p90Hours, 1)}시간</dd></div><div><dt>24시간 내 해소</dt><dd>${number(distribution.within24h * 100, 1)}%</dd></div><div><dt>30일 내 해소</dt><dd>${number(distribution.within30d * 100, 1)}%</dd></div></dl><p class="sop-dist-source">${esc(distribution.source)}<br>표본 종목 ${esc((distribution.symbols || []).join(' / '))}</p><p class="sop-interpretation">과거 관측값이며 개별 레벨의 해소 시점이나 가능성을 보장하지 않습니다.</p></section>`;
}

function renderConditional(data) {
  const rows = data.dist.conditional || [];
  return `<details class="sop-conditional"><summary><span>잔여 시간의 표본 기준</span><small>조건부 통계 ${rows.length}개</small></summary><div class="sop-conditional-body"><p>이미 일정 시간을 버틴 레벨들에서, 이후 해소까지 더 걸린 시간을 집계했습니다. 각 레벨의 예상 잔여는 원본의 <b>중앙값과 해당 표본 수</b>를 그대로 표시합니다.</p><div class="sop-conditional-scroll" tabindex="0" role="region" aria-label="조건부 잔여 시간 통계 표"><table><thead><tr><th scope="col">이미 경과</th><th scope="col">표본 수</th><th scope="col">잔여 중앙값</th><th scope="col">잔여 평균</th><th scope="col">잔여 90백분위</th></tr></thead><tbody>${rows.map((row, index) => `<tr data-conditional="${index}"><th scope="row">${number(row.survivedHours, 1)}시간</th><td>${number(row.n)}</td><td>${number(row.remainMedianHours, 1)}시간</td><td>${number(row.remainMeanHours, 1)}시간</td><td>${number(row.remainP90Hours, 1)}시간</td></tr>`).join('')}</tbody></table></div></div></details>`;
}

function renderRules(data) {
  const single = data.mode === 'single';
  return `<details class="sop-rules" open><summary>레벨을 읽는 방법 <span>${single ? '단일 봉 규칙' : data.mode === 'readme' ? '3봉 프랙탈 규칙' : esc(data.mode)}</span></summary><div class="sop-rules-body">${single ? '<p><b>발생</b>은 시가를 훼손하지 않고 그대로 움직인 1시간봉의 시가입니다. 상승 봉은 시가=저가로 아래 지지, 하락 봉은 시가=고가로 위 저항을 만듭니다.</p><p><b>해소</b>는 발생 이후 어떤 봉이든 해당 가격에 한 번이라도 닿았을 때입니다. 허용 범위는 ±0.1%이며 그 가격을 넘는 경우도 포함합니다. 여기 남아 있는 가격은 발생 이후 아직 한 번도 되돌아오지 않은 레벨입니다. 진행 중인 현재 봉도 반영합니다.</p>' : '<p><b>발생과 해소</b>는 README 규칙을 따릅니다. 3봉 프랙탈 스윙, 첫 터치 가격 ±0.1%, 5시간 간격, 30일 묶음, 마지막 터치 후 재돌파를 해소로 판단합니다.</p>'}<p><b>괴리율</b>은 (레벨 − 현재가) / 현재가입니다. <b>경과</b>는 발생부터 스냅샷 기준 시각까지의 시간이며, 과거 분포와 같은 척도로 표시합니다.</p><p><b>예상 잔여(중앙값)</b>는 지금과 같은 시간만큼 버틴 과거 레벨들이 이후 해소까지 더 걸린 시간의 중앙값입니다. <b>n</b>은 해당 조건부 표본 수입니다. 날짜를 확정하는 예측값이 아닙니다.</p><p><b>사정권</b>은 과거 해소 비중이 가장 큰 구간에 현재 경과 시간이 들어와 있다는 뜻입니다. 표의 저항·지지는 현재가 위·아래의 위치를 나타냅니다.</p></div></details>`;
}

const DEFAULT_FILTERS = { symbol: 'all', side: 'all', candidate: 'all', sort: 'distance' };
export function renderSopMarkup(data, filters = {}) {
  const state = { ...DEFAULT_FILTERS, ...filters };
  const rows = buildLevelRows(data), shown = selectLevels(rows, { ...state, modal: data.dist.modal });
  return `<a class="sop-skip" href="#sop-levels">미해소 레벨 목록으로 이동</a><header class="sop-header"><div><h1 id="sop-app-title">미해소 레벨</h1><p>${data.mode === 'single' ? '발생 이후 아직 되돌아오지 않은 가격을 추적합니다.' : '원본 규칙에 따라 아직 해소되지 않은 가격을 추적합니다.'}</p></div><div class="sop-snapshot"><span>바이낸스 현물 <b>1시간봉</b></span><time>${esc(formatKst(data.now))}</time><span class="sop-refresh-note">1시간 주기 화면 새로고침 <button type="button" id="sop-refresh" aria-label="저장된 미해소 레벨 화면 새로고침" title="저장된 화면 새로고침">↻</button></span></div></header><nav class="sop-symbol-nav" aria-label="미해소 레벨 종목"><button type="button" data-select-symbol="all" aria-pressed="${state.symbol === 'all'}" class="sop-all-symbols"><span>전체 종목</span><strong>${rows.length}<small>개 레벨</small></strong><span>${data.symbols.length}개 종목 모아보기</span></button>${data.symbols.map((entry) => `<button type="button" data-select-symbol="${esc(entry.symbol)}" aria-pressed="${state.symbol === entry.symbol}">${symbolMark(entry.symbol)}<span class="sop-symbol-nav-name"><b>${esc(shortSymbol(entry.symbol))}</b><small>${esc(SYMBOL_NAMES[shortSymbol(entry.symbol)] || entry.symbol)}</small></span><strong>${formatLevelPrice(entry.price, entry.symbol)}<small>USDT</small></strong><span class="sop-symbol-nav-count">미해소 ${entry.above.length + entry.below.length}개<span>사정권 ${[...entry.above, ...entry.below].filter((row) => row.inRange).length}</span></span></button>`).join('')}</nav><div class="sop-toolbar"><div class="sop-result-heading"><h2>레벨 목록</h2><span id="sop-result-count">${shown.length} / ${rows.length}</span><span id="sop-candidate-count">사정권 ${shown.filter((row) => row.inRange).length}개</span></div><div class="sop-filters"><label>방향<select id="sop-side" name="level-side"><option value="all">지지·저항 전체</option><option value="above">↑ 현재가 위 저항</option><option value="below">↓ 현재가 아래 지지</option></select></label><label>사정권<select id="sop-candidate" name="level-candidate"><option value="all">전체 구간</option><option value="inRange">★ 사정권만</option><option value="before">사정권 전</option><option value="past">사정권 지남</option></select></label><label>정렬<select id="sop-sort" name="level-sort"><option value="distance">현재가 가까운 순</option><option value="age_desc">오래된 순</option><option value="price_desc">가격 높은 순</option></select></label></div></div><div class="sop-workspace"><div class="sop-main-column"><div id="sop-levels" tabindex="-1">${renderLevels(data, state)}</div>${renderRules(data)}${renderConditional(data)}</div><aside class="sop-side-column" aria-label="과거 해소 시간 분포">${renderDistribution(data.dist)}</aside></div><footer class="sop-footer"><span>PNL404 <b>미해소 레벨</b></span><span>원본 파일이 갱신된 경우 새 값이 반영됩니다. 화면 새로고침은 원본을 재계산하지 않습니다.</span></footer><div id="sop-announcement" class="sop-sr-only" aria-live="polite" role="status"></div>`;
}

export function mountSop(data, doc = document) {
  if (!Array.isArray(data?.symbols) || !Array.isArray(data?.dist?.buckets)) return null;
  const state = { ...DEFAULT_FILTERS };
  try {
    const query = new URLSearchParams(doc.defaultView?.location?.search || '');
    if (data.symbols.some((entry) => entry.symbol === query.get('symbol'))) state.symbol = query.get('symbol');
    if (['above', 'below'].includes(query.get('side'))) state.side = query.get('side');
    if (['inRange', 'before', 'past'].includes(query.get('candidate'))) state.candidate = query.get('candidate');
    if (['age_desc', 'price_desc'].includes(query.get('sort'))) state.sort = query.get('sort');
  } catch { /* Missing URL support in a static preview leaves the default view usable. */ }
  doc.getElementById('t')?.setAttribute('hidden', '');
  doc.getElementById('wrap')?.setAttribute('hidden', '');
  let main = doc.getElementById('sop-app');
  if (!main) { main = doc.createElement('main'); main.id = 'sop-app'; doc.body.append(main); }
  main.innerHTML = renderSopMarkup(data, state);
  doc.title = '미해소 레벨 · PNL404';
  const updateUrl = () => {
    try {
      const view = doc.defaultView, url = new URL(view.location.href);
      for (const [key, value] of Object.entries(state)) { if (value === DEFAULT_FILTERS[key]) url.searchParams.delete(key); else url.searchParams.set(key, value); }
      view.history.replaceState(null, '', url);
    } catch { /* The controls still work when embedded without history access. */ }
  };
  const render = () => {
    const rows = buildLevelRows(data), shown = selectLevels(rows, { ...state, modal: data.dist.modal });
    main.querySelector('#sop-levels').innerHTML = renderLevels(data, state);
    main.querySelector('#sop-result-count').textContent = `${shown.length} / ${rows.length}`;
    main.querySelector('#sop-candidate-count').textContent = `사정권 ${shown.filter((row) => row.inRange).length}개`;
    main.querySelectorAll('[data-select-symbol]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.selectSymbol === state.symbol)));
    for (const key of ['side', 'candidate', 'sort']) main.querySelector(`#sop-${key}`).value = state[key];
    main.querySelector('#sop-announcement').textContent = `${state.symbol === 'all' ? '전체 종목' : shortSymbol(state.symbol)} 미해소 레벨 ${shown.length}개 표시`;
    updateUrl();
  };
  main.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.selectSymbol) { state.symbol = button.dataset.selectSymbol; render(); }
    else if (button.dataset.resetFilters) { Object.assign(state, DEFAULT_FILTERS); render(); main.querySelector('[data-select-symbol="all"]').focus(); }
    else if (button.id === 'sop-refresh') doc.defaultView?.location?.reload();
  });
  for (const key of ['side', 'candidate', 'sort']) {
    const input = main.querySelector(`#sop-${key}`); input.value = state[key];
    input.addEventListener('change', () => { state[key] = input.value; render(); });
  }
  return { render, getState: () => ({ ...state }) };
}

// The raw classic script owns the immutable lexical D binding. It is not re-evaluated.
if (typeof document !== 'undefined' && typeof D !== 'undefined') mountSop(D, document);
