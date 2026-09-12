import { MARKETS, REFRESH_INTERVAL, FAVORITES_KEY, PREFERENCES_KEY, MOMENTUM_PERIODS, isNumber, escapeHtml as html, normalizeItem, reconcileMarketItems, findLegacySignal, rankSearchResults, selectItems, parseFavorites, serializeFavorites, formatPrice, formatCompact, formatChange, formatTime, formatDate, periodLabel, momentumFor, momentumBlocks, completedBarDate, quoteStatus, chartGeometry, createRefreshController } from './board-model.mjs';

const $ = (id) => document.getElementById(id);
const star = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9Z"/></svg>';
const chartIcon = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 5v22h23M9 20l6-7 5 4 7-10"/></svg>';
const safeRead = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const safeWrite = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
let preferences = {};
try { preferences = JSON.parse(safeRead(PREFERENCES_KEY) || '{}') || {}; } catch { /* A damaged preference must not prevent rendering. */ }
const favorites = parseFavorites(safeRead(FAVORITES_KEY));
const state = {
  market: Object.hasOwn(MARKETS, preferences.market) || preferences.market === 'favorites' ? preferences.market : 'us', group: 'all', sort: ['market_cap', 'momentum_desc', 'momentum_asc', 'name', 'price_desc'].includes(preferences.sort) ? preferences.sort : 'market_cap', view: preferences.view === 'cards' ? 'cards' : 'list', period: MOMENTUM_PERIODS.includes(Number(preferences.period)) ? Number(preferences.period) : 7, limit: 100,
  items: new Map(favorites.map((item) => [item.id, item])), favorites: new Map(favorites.map((item) => [item.id, item])), universe: new Map(), extras: new Set(), meta: new Map(), apiLoaded: new Set(), pendingMarkets: new Map(), catalog: null, catalogPromise: null, loading: true,
  searchResults: [], searchIndex: -1, searchSequence: 0, searchTimer: null, searchAbort: null, composing: false,
  detailId: null, range: '7d', chartSequence: 0, chartAbort: null, chartCache: new Map(), activeGeometry: null, activeChart: null, chartPointIndex: 0, legacy: null, legacyError: false,
};

function announce(message) { $('announcer').textContent = message; }
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2900); }
function persistPreferences() { safeWrite(PREFERENCES_KEY, JSON.stringify({ market: state.market, sort: state.sort, view: state.view, period: state.period })); }
function allItems() { return [...state.items.values()]; }
function displayItems() {
  const items = state.market === 'favorites' ? allItems() : allItems().filter((item) => state.universe.get(state.market)?.has(item.id) || state.extras.has(item.id));
  return selectItems(items, { market: state.market, group: state.group, sort: state.sort, favoriteIds: new Set(state.favorites.keys()), period: state.period });
}
function avatarText(item) { return /^[0-9]/.test(item.symbol) ? Array.from(item.name).slice(0, 1).join('') : item.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2); }
function avatar(item) { return `<span class="instrument-avatar" data-market="${html(item.market)}" aria-hidden="true">${html(avatarText(item))}</span>`; }
function identity(item) { return `${avatar(item)}<span class="instrument-identity"><span class="instrument-name">${html(item.name)}</span><span class="instrument-symbol">${html(item.symbol)} <span aria-hidden="true">·</span> ${html(MARKETS[item.market].short)}</span></span>`; }
function changeClass(value) { return !isNumber(value) || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative'; }
function selectedMomentum(item) { const result = momentumFor(item, state.period); return { ...result, stale: result.stale || Boolean(state.meta.get(item.market)?.error) }; }
function quoteAsOf(item, { short = false } = {}) { return item.price_basis === 'daily_close' ? formatDate(item.momentum?.last_bar_date || item.bar_date || completedBarDate(item.updated_at, item.market), { short }) : formatTime(item.updated_at, { short }); }
function momentumMarkup(item, { showStale = true } = {}) {
  const momentum = selectedMomentum(item);
  if (!momentum.available) return '<span class="momentum-missing">데이터 부족</span>';
  return `<span class="momentum-value ${changeClass(momentum.return_pct)}">${formatChange(momentum.return_pct)}<span class="momentum-direction">${momentum.direction.arrow} ${momentum.direction.label}</span></span>${showStale && momentum.stale ? '<span class="momentum-stale">이전 계산</span>' : ''}`;
}
function priceMarkup(item) { return `<span class="price-value${isNumber(item.price) ? '' : ' unavailable-value'}">${html(formatPrice(item.price, item.currency))}</span>`; }
function favoriteButton(item) { const saved = state.favorites.has(item.id); return `<button class="icon-button favorite-button" type="button" data-favorite="${html(item.id)}" aria-label="${html(item.name)} 관심종목 ${saved ? '해제' : '추가'}" aria-pressed="${saved}" title="관심종목 ${saved ? '해제' : '추가'}">${star}</button>`; }
function statusFor(item) {
  const base = quoteStatus({ ...item, stale: item.stale || state.meta.get(item.market)?.error });
  if (item.price_basis === 'daily_close' && isNumber(item.price)) return { ...base, label: state.meta.get(item.market)?.error ? '이전 일봉 종가' : '일봉 종가' };
  if (base.kind === 'stale' && !state.meta.get(item.market)?.error && ['CLOSE', 'CLOSED', 'POST', 'PRE'].includes(item.market_state)) return { ...base, label: '장 마감 시세' };
  return base;
}
function sparkline(item) {
  const values = item.history.map((value) => isNumber(value) ? value : value?.value).filter(isNumber).slice(-(state.period + 1));
  if (!selectedMomentum(item).available || values.length < state.period + 1) return '<span class="spark-empty">이력 부족</span>';
  const lo = Math.min(...values), hi = Math.max(...values), delta = hi - lo || 1;
  const path = values.map((value, index) => `${index ? 'L' : 'M'}${(index / (values.length - 1) * 100).toFixed(2)},${(26 - (value - lo) / delta * 22).toFixed(2)}`).join(' ');
  const direction = values.at(-1) < values[0] ? 'negative' : 'positive';
  return `<svg class="sparkline ${direction}" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="${html(item.name)} 최근 ${periodLabel(state.period, item.market)}의 일봉 종가 추이"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function marketDefinition(key) { return state.catalog?.markets?.find((market) => market.id === key) || MARKETS[key]; }
function groupsFor(key) { return marketDefinition(key)?.groups || MARKETS[key]?.groups || []; }

function renderNavigation() {
  $('market-tabs').innerHTML = Object.entries(MARKETS).map(([key, market]) => `<button class="market-tab" type="button" data-market="${key}" aria-pressed="${state.market === key}"><span class="market-symbol" aria-hidden="true">${market.mark}</span>${market.label}<span class="tab-count">${state.universe.get(key)?.size || ''}</span></button>`).join('') + `<button class="market-tab favorites-tab" type="button" data-market="favorites" aria-pressed="${state.market === 'favorites'}">${star} 관심종목 <span class="tab-count">${state.favorites.size}</span></button>`;
  if (state.market === 'favorites') {
    $('group-tabs').innerHTML = '<button type="button" aria-pressed="true">전체 시장</button>';
    $('group-hint').textContent = '이 브라우저에 저장한 나의 관심종목';
  } else {
    $('group-tabs').innerHTML = groupsFor(state.market).map((group) => `<button type="button" data-group="${html(group.id)}" aria-pressed="${state.group === group.id}">${html(state.market === 'crypto' && group.id === 'all' ? '시총 TOP 100' : group.label)}</button>`).join('');
    $('group-hint').textContent = state.market === 'jp' ? '자스닥(JASDAQ)은 2022년 재편 · 현재 프라임·스탠더드·그로스' : state.market === 'kr' ? '코스피 · 코스닥 각 시총 상위 100종목' : state.market === 'us' ? 'S&P 500 구성종목 · 나스닥 · NYSE 시총 상위 종목' : '시가총액 상위 100 · 스테이블·랩트 토큰 포함';
  }
  $('sort').value = state.sort;
  $('view-list').setAttribute('aria-pressed', String(state.view === 'list'));
  $('view-cards').setAttribute('aria-pressed', String(state.view === 'cards'));
  document.querySelectorAll('[data-period]').forEach((button) => { button.setAttribute('aria-pressed', String(Number(button.dataset.period) === state.period)); button.textContent = periodLabel(button.dataset.period, state.market); });
  document.querySelectorAll('[data-range]').forEach((button) => { button.setAttribute('aria-pressed', String(Number.parseInt(button.dataset.range) === state.period)); button.textContent = periodLabel(Number.parseInt(button.dataset.range), state.items.get(state.detailId)?.market || state.market); });
  $('momentum-basis').textContent = state.market === 'crypto' ? '주말 포함 · 완료된 UTC 일봉의 종가 수익률' : state.market === 'favorites' ? '주식은 거래일 · 암호화폐는 주말 포함 일수 기준' : '거래일 기준 · 완료된 일봉의 종가 수익률';
  $('movers-period').textContent = periodLabel(state.period, state.market) + ' 기준';
}

function renderSummary(items) {
  const available = items.filter((item) => selectedMomentum(item).available);
  const rises = available.filter((item) => selectedMomentum(item).return_pct > 0).length;
  const falls = available.filter((item) => selectedMomentum(item).return_pct < 0).length;
  const missing = items.length - available.length;
  const latest = available.map((item) => Date.parse(selectedMomentum(item).end_date)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const groupLabel = groupsFor(state.market).find((group) => group.id === state.group)?.label || '전체 시장';
  const statusCount = available.filter((item) => selectedMomentum(item).stale).length;
  $('market-summary').innerHTML = `<div class="summary-stat"><p class="stat-label">${state.market === 'favorites' ? '나의 관심종목' : html(MARKETS[state.market].label) + ' · ' + html(groupLabel)}</p><p class="stat-value">${items.length.toLocaleString()}<small>종목</small></p><p class="stat-caption">${state.market === 'favorites' ? '모든 시장에서 모아보기' : '선택한 범위의 등록 종목'}</p></div><div class="summary-stat"><p class="stat-label">모멘텀 상승 / 하락</p><p class="stat-value"><span class="positive">${rises}</span><span class="stat-divider">/</span><span class="negative">${falls}</span></p><p class="stat-caption">${periodLabel(state.period, state.market)} 기준 · 중립 ${available.length - rises - falls}종목</p></div><div class="summary-stat"><p class="stat-label">모멘텀 제공</p><p class="stat-value">${available.length.toLocaleString()}<small>/ ${items.length.toLocaleString()}</small></p><p class="stat-caption">${missing ? `일봉 이력 부족 ${missing}종목` : statusCount ? `이전 계산 ${statusCount}종목 포함` : '완료된 일봉 종가로 계산'}</p></div><div class="summary-stat"><p class="stat-label">가장 최근 일봉 기준</p><p class="stat-value date">${latest ? html(formatDate(latest)) : '—'}</p><p class="stat-caption">실제 수집 시각은 종목 상세에 표시</p></div>`;
}

function renderNotice(items) {
  const markets = state.market === 'favorites' ? [...new Set(items.map((item) => item.market))] : [state.market];
  const errors = markets.filter((market) => state.meta.get(market)?.error);
  const stale = markets.filter((market) => state.meta.get(market)?.stale);
  const messages = [];
  if (errors.length) messages.push('새 데이터 확인에 실패하여 마지막 저장 데이터를 표시합니다. 기준 시각을 확인해 주세요.');
  else if (stale.length) messages.push('제공처의 마지막 저장 데이터를 표시하고 있습니다. 시세의 기준 시각은 종목별로 다릅니다.');
  const missing = items.filter((item) => !isNumber(item.price)).length;
  if (missing) messages.push(`${missing}개 종목은 시세가 아직 제공되지 않습니다.`);
  if (state.market === 'jp' && ['standard', 'growth'].includes(state.group)) messages.push('현재 이 시장은 일부 등록 종목을 제공합니다. 검색은 등록된 종목 범위에서 지원합니다.');
  $('status-notice').hidden = !messages.length;
  $('status-notice').innerHTML = messages.length ? `<span class="notice-icon" aria-hidden="true">ⓘ</span><span>${html(messages.join(' '))}</span>` : '';
}

function renderList(items) {
  const marketLabel = state.market === 'favorites' ? '관심종목' : MARKETS[state.market].label;
  $('list-title').textContent = marketLabel;
  $('result-count').textContent = String(items.length);
  $('instrument-list').setAttribute('aria-busy', String(state.loading && !items.length));
  if (!items.length) {
    const loading = state.loading || state.pendingMarkets.has(state.market);
    $('instrument-list').innerHTML = loading ? '<div class="empty-state"><span class="loading-mark" aria-hidden="true"></span><h3>시장을 불러오는 중입니다</h3><p>종목 목록과 시세 제공 상태를 확인합니다.</p></div>' : state.market === 'favorites' ? '<div class="empty-state"><span class="empty-icon" aria-hidden="true">☆</span><h3>다음에 볼 종목, 여기 모아두세요</h3><p>종목 옆의 별을 누르면 시장에 관계없이 관심종목에 저장됩니다.</p><button type="button" data-market="us">미국주식 살펴보기</button></div>' : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">↗</span><h3>표시할 종목이 없습니다</h3><p>다른 하위 카테고리를 선택하거나 종목명으로 검색해 보세요.</p><button type="button" data-retry="true">데이터 다시 확인</button></div>';
  } else if (state.view === 'cards') {
    $('instrument-list').innerHTML = '<div class="instrument-cards">' + items.slice(0, state.limit).map((item) => { const status = statusFor(item); return `<article class="instrument-card"><div class="card-top"><button class="instrument-name-button" type="button" data-detail="${html(item.id)}" aria-label="${html(item.name)} 상세 모멘텀과 차트">${identity(item)}</button>${favoriteButton(item)}</div><div class="card-quote"><div>${priceMarkup(item)}<span class="currency-label">${html(item.currency)} · ${status.label}</span></div><div class="card-momentum"><p class="card-period">${periodLabel(state.period, item.market)} 모멘텀</p>${momentumMarkup(item)}</div></div><div class="card-chart">${sparkline(item)}</div><div class="card-bottom"><span>시총 ${html(formatCompact(item.market_cap, item.currency))}</span><span>기준 ${html(quoteAsOf(item, { short: true }))}</span></div></article>`; }).join('') + '</div>';
  } else {
    $('instrument-list').innerHTML = `<table class="instrument-table"><thead><tr><th class="favorite-cell"><span class="sr-only">관심종목</span></th><th class="name-cell" scope="col">종목명 / 티커</th><th scope="col">가격</th><th class="momentum-column" scope="col">${periodLabel(state.period, state.market)} 모멘텀</th><th class="chart-column" scope="col">선택 기간 추이</th><th class="cap-column" scope="col">시가총액</th><th class="updated-column" scope="col">가격 기준</th></tr></thead><tbody>` + items.slice(0, state.limit).map((item) => { const status = statusFor(item); return `<tr data-instrument="${html(item.id)}"><td class="favorite-cell">${favoriteButton(item)}</td><td class="name-cell"><button class="instrument-name-button" type="button" data-detail="${html(item.id)}" aria-label="${html(item.name)} 상세 모멘텀과 차트">${identity(item)}</button></td><td>${priceMarkup(item)}<span class="currency-label">${html(item.currency)}${status.kind !== 'available' ? ' · ' + status.label : ''}</span></td><td>${momentumMarkup(item)}</td><td class="chart-column">${sparkline(item)}</td><td class="cap-column"><span class="cap-value">${html(formatCompact(item.market_cap, item.currency))}</span></td><td class="updated-column updated-value">${html(quoteAsOf(item))}<span class="quote-tag ${status.kind}">${status.label}</span></td></tr>`; }).join('') + '</tbody></table>';
  }
  if (items.length > state.limit) $('instrument-list').insertAdjacentHTML('beforeend', `<button type="button" class="load-more" data-load-more="true">${Math.min(100, items.length - state.limit)}개 더 보기 <span aria-hidden="true">↓</span> · ${state.limit} / ${items.length}</button>`);
  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))];
  $('list-source').textContent = sources.length ? '출처: ' + sources.join(' · ') + (state.market === 'favorites' ? ' · 시총·가격은 통화별 정렬' : '') : '제공된 시세가 없습니다';
}

function railItem(item) { return `<button class="rail-item" type="button" data-detail="${html(item.id)}">${identity(item)}${momentumMarkup(item, { showStale: false })}</button>`; }
function renderRails(items) {
  const saved = [...state.favorites.keys()].map((id) => state.items.get(id) || state.favorites.get(id));
  $('favorite-preview').innerHTML = saved.length ? saved.slice(0, 4).map(railItem).join('') : '<p class="rail-empty">아직 저장한 종목이 없어요.<br>관심 있는 종목에 별을 눌러보세요.</p>';
  const movers = items.filter((item) => selectedMomentum(item).available).sort((a, b) => Math.abs(selectedMomentum(b).return_pct) - Math.abs(selectedMomentum(a).return_pct)).slice(0, 4);
  $('movers').innerHTML = movers.length ? movers.map(railItem).join('') : '<p class="rail-empty">선택한 기간의 일봉이 모이면<br>모멘텀 변동이 큰 종목을 보여드립니다.</p>';
}
function render() {
  const focused = document.activeElement;
  const focusKey = ['market', 'group', 'favorite', 'detail'].find((key) => focused?.dataset?.[key]);
  const focusValue = focusKey ? focused.dataset[focusKey] : null;
  const items = displayItems(); renderNavigation(); renderSummary(items); renderNotice(items); renderList(items); renderRails(items);
  if (focusKey && !focused.isConnected) document.querySelector(`[data-${focusKey}="${CSS.escape(focusValue)}"]`)?.focus({ preventScroll: true });
}

function mergeItems(items, { overwrite = false, staticOnly = false } = {}) {
  for (const raw of items || []) {
    const item = normalizeItem(raw);
    if (!item || staticOnly && state.apiLoaded.has(item.market)) continue;
    const prior = state.items.get(item.id);
    if (!prior || overwrite || !isNumber(prior.price) || isNumber(item.price) && (Date.parse(item.updated_at || '') || 0) >= (Date.parse(prior.updated_at || '') || 0)) state.items.set(item.id, item);
  }
}
async function fetchJson(url, { signal, timeout = 22000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function loadCatalog() {
  if (state.catalogPromise) return state.catalogPromise;
  state.catalogPromise = fetchJson('./markets.json').then((data) => {
    if (!Array.isArray(data.items)) throw new Error('종목 데이터 형식 오류');
    state.catalog = data;
    mergeItems(data.items, { staticOnly: true });
    for (const market of Object.keys(MARKETS)) {
      if (state.apiLoaded.has(market)) continue;
      state.universe.set(market, new Set(data.items.filter((item) => item.market === market).map((item) => item.id)));
      state.meta.set(market, { ...data, items: undefined, mode: 'snapshot', coverage: data.markets?.find((entry) => entry.id === market)?.coverage });
    }
    state.loading = false;
    render();
    return data;
  }).catch((error) => { state.catalogPromise = null; throw error; });
  return state.catalogPromise;
}
async function loadMarket(market) {
  if (!MARKETS[market]) return;
  if (state.pendingMarkets.has(market)) return state.pendingMarkets.get(market);
  const task = (async () => {
    try {
      const data = await fetchJson('/api/markets?' + new URLSearchParams({ market, group: 'all' }));
      if (!Array.isArray(data.items)) throw new Error('시세 형식 오류');
      const valid = data.items.map(normalizeItem).filter((item) => item?.market === market);
      const previous = [...(state.universe.get(market) || [])].map((id) => state.items.get(id)).filter(Boolean);
      const degraded = Boolean(data.degraded || data.partial || valid.length === 0);
      const reconciled = reconcileMarketItems(previous, valid, { stale: Boolean(data.stale), degraded });
      mergeItems(reconciled, { overwrite: true });
      state.universe.set(market, new Set(reconciled.map((item) => item.id)));
      state.meta.set(market, { ...data, items: undefined, mode: 'api', error: valid.length === 0, stale: Boolean(data.stale || degraded) });
      state.apiLoaded.add(market);
    } catch {
      if (!state.catalog) { try { await loadCatalog(); } catch { /* The error state below keeps any saved favorites usable. */ } }
      state.meta.set(market, { ...state.meta.get(market), error: true, stale: true });
    } finally {
      state.pendingMarkets.delete(market);
      state.loading = false;
      for (const id of state.favorites.keys()) if (state.items.has(id)) state.favorites.set(id, state.items.get(id));
      safeWrite(FAVORITES_KEY, serializeFavorites([...state.favorites.values()]));
      render();
      if (state.detailId && state.items.get(state.detailId)?.market === market) renderDetailQuote();
    }
  })();
  state.pendingMarkets.set(market, task);
  return task;
}
async function loadLegacy() {
  try {
    const data = await fetchJson('./data.json');
    if (!Array.isArray(data?.items)) throw new Error('기존 점수 형식 오류');
    state.legacy = data;
    state.legacyError = false;
    return true;
  } catch {
    state.legacyError = true;
    return false;
  } finally {
    const item = state.items.get(state.detailId);
    if (item && $('detail-dialog').open) renderLegacy(item);
  }
}
const refreshController = createRefreshController(async () => {
  $('refresh').disabled = true;
  $('refresh').classList.add('is-refreshing');
  updateCountdown();
  try {
    const markets = new Set([...state.apiLoaded, ...[...state.favorites.values()].map((item) => item.market), ...(state.market === 'favorites' ? [] : [state.market])]);
    await Promise.allSettled([...markets].map(loadMarket).concat(loadLegacy()));
    if (state.detailId && $('detail-dialog').open) await loadChart({ force: true });
    const errors = [...markets].filter((market) => state.meta.get(market)?.error);
    announce(errors.length || state.legacyError ? '일부 자료의 갱신 확인에 실패했습니다. 마지막 데이터를 유지합니다.' : '갱신 확인을 마쳤습니다. 시세와 점수의 기준 시각을 확인해 주세요.');
  } finally { $('refresh').disabled = false; $('refresh').classList.remove('is-refreshing'); }
});
function updateCountdown() {
  const seconds = Math.max(0, Math.ceil((refreshController.nextRefreshAt - Date.now()) / 1000));
  $('countdown').textContent = refreshController.busy ? '새 데이터 확인 중…' : `다음 확인 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function chooseMarket(market) {
  if (!MARKETS[market] && market !== 'favorites') return;
  state.market = market; state.group = 'all'; state.limit = 100;
  closeSearch(); persistPreferences(); render();
  if (market === 'favorites') Promise.allSettled([...new Set([...state.favorites.values()].map((item) => item.market))].filter((key) => !state.apiLoaded.has(key)).map(loadMarket));
  else if (!state.apiLoaded.has(market)) loadMarket(market);
}
function toggleFavorite(id) {
  const item = state.items.get(id);
  if (!item) return;
  const saved = state.favorites.has(id);
  if (saved) state.favorites.delete(id); else state.favorites.set(id, item);
  const persisted = safeWrite(FAVORITES_KEY, serializeFavorites([...state.favorites.values()]));
  render();
  if (state.detailId === id) updateDetailFavorite();
  toast(persisted ? `${item.name} 관심종목 ${saved ? '해제' : '저장'}` : '브라우저 저장이 제한되어 이번 방문에만 유지됩니다.');
}

function closeSearch() {
  clearTimeout(state.searchTimer); state.searchAbort?.abort(); state.searchSequence++;
  $('search-popover').hidden = true; $('search').setAttribute('aria-expanded', 'false'); $('search').removeAttribute('aria-activedescendant'); state.searchIndex = -1;
}
function renderSearch(message = '') {
  const query = $('search').value.trim();
  if (!query || document.activeElement !== $('search')) return;
  $('search-popover').hidden = false; $('search').setAttribute('aria-expanded', 'true');
  $('search-results').innerHTML = state.searchResults.map((item, index) => `<li id="search-option-${index}" class="search-option" role="option" aria-selected="${state.searchIndex === index}" data-result-index="${index}">${identity(item)}<span class="search-market">${html(MARKETS[item.market].label)}</span></li>`).join('');
  $('search-message').hidden = state.searchResults.length > 0 && !message;
  $('search-message').textContent = message || '관련 종목이 없습니다. 다른 이름이나 티커를 입력해 보세요.';
  if (state.searchIndex >= 0) $('search').setAttribute('aria-activedescendant', `search-option-${state.searchIndex}`); else $('search').removeAttribute('aria-activedescendant');
}
function performSearch() {
  if (state.composing) return;
  clearTimeout(state.searchTimer); state.searchAbort?.abort();
  const query = $('search').value.trim();
  const sequence = ++state.searchSequence;
  state.searchIndex = -1;
  if (!query) { closeSearch(); return; }
  state.searchResults = rankSearchResults(allItems(), query);
  renderSearch(state.searchResults.length ? '' : '관련 종목을 찾고 있습니다…');
  state.searchTimer = setTimeout(async () => {
    const controller = new AbortController(); state.searchAbort = controller;
    try {
      const data = await fetchJson('/api/search?' + new URLSearchParams({ q: query }), { signal: controller.signal, timeout: 12000 });
      if (sequence !== state.searchSequence || query !== $('search').value.trim()) return;
      const remote = (data.items || []).map(normalizeItem).filter(Boolean);
      const pool = [...new Map([...allItems(), ...remote].map((item) => [item.id, item])).values()];
      const activeId = state.searchResults[state.searchIndex]?.id;
      state.searchResults = rankSearchResults(pool, query);
      state.searchIndex = activeId ? state.searchResults.findIndex((item) => item.id === activeId) : -1;
      renderSearch();
      announce(`관련 종목 ${state.searchResults.length}개`);
    } catch {
      if (sequence !== state.searchSequence) return;
      renderSearch(state.searchResults.length ? '' : '검색 서버에 연결하지 못했습니다. 저장된 종목에서 다른 이름이나 티커를 찾아보세요.');
    }
  }, 220);
}
function chooseSearchResult(index) {
  const item = state.searchResults[index]; if (!item) return;
  mergeItems([item]); state.extras.add(item.id); $('search').value = item.name;
  chooseMarket(item.market); openDetail(item.id);
}

function updateDetailFavorite() {
  const item = state.items.get(state.detailId); if (!item) return;
  const saved = state.favorites.has(item.id);
  $('detail-favorite').innerHTML = star;
  $('detail-favorite').setAttribute('aria-label', `${item.name} 관심종목 ${saved ? '해제' : '추가'}`);
  $('detail-favorite').setAttribute('aria-pressed', String(saved));
}
function renderDetailQuote() {
  const item = state.items.get(state.detailId); if (!item) return;
  const status = statusFor(item);
  $('detail-title').textContent = item.name;
  $('detail-symbol').textContent = `${item.symbol} · ${MARKETS[item.market].label}`;
  $('detail-avatar').textContent = avatarText(item); $('detail-avatar').dataset.market = item.market;
  $('detail-quote').innerHTML = `<div><div class="detail-price">${html(formatPrice(item.price, item.currency))}<span class="currency">${html(item.currency)}</span></div><div class="detail-price-change"><span class="${changeClass(item.change_pct)}">${formatChange(item.change_pct)}</span><span class="label">${item.price_basis === 'daily_close' ? '직전 일봉 종가 대비' : item.market === 'crypto' ? '24시간 대비' : '전일 종가 대비'}</span></div></div><div class="detail-price-status"><span class="quote-tag ${status.kind}">${status.label}${isNumber(item.delay_minutes) && item.delay_minutes > 0 ? ` · ${item.delay_minutes}분 지연` : ''}</span><span>${item.price_basis === 'daily_close' ? '일봉 날짜' : '시세 기준'} ${html(quoteAsOf(item))}</span><br><span>수집 ${html(formatTime(item.fetched_at))}</span></div>`;
  const groups = item.groups.map((id) => groupsFor(item.market).find((group) => group.id === id)?.label || id).join(' · ');
  $('detail-facts').innerHTML = `<dl><dt>시가총액</dt><dd>${html(formatCompact(item.market_cap, item.currency))}${isNumber(item.market_cap_rank) ? ' · ' + item.market_cap_rank + '위' : ''}</dd></dl><dl><dt>소속 시장 / 지수</dt><dd>${html(groups || MARKETS[item.market].label)}</dd></dl><dl><dt>시세 제공처${item.price_basis === 'daily_close' ? ' · 일봉 종가' : ''}</dt><dd>${html(item.source)}</dd></dl>`;
  updateDetailFavorite(); renderMomentumDetail(item); renderLegacy(item);
}
function renderMomentumDetail(item) {
  const momentum = selectedMomentum(item);
  const dates = momentum.start_date && momentum.end_date ? `${formatDate(momentum.start_date)} ~ ${formatDate(momentum.end_date)}` : '계산 기준 날짜 미제공';
  const observationNote = !momentum.available ? momentum.status === 'gap' ? '해당 기간의 일봉이 일부 누락되었습니다.' : isNumber(momentum.observations) ? `일봉 ${momentum.observations}개 제공 · ${momentum.required_observations || state.period + 1}개 필요` : '완료된 일봉이 충분히 모이면 수익률을 표시합니다.' : '기간 시작 종가 대비 마지막 종가의 변화';
  $('detail-momentum').innerHTML = `<div><p class="detail-momentum-label">최근 ${periodLabel(state.period, item.market)} 누적 모멘텀</p>${momentumMarkup(item)}<p class="price-observed">${html(observationNote)}</p>${momentum.available && isNumber(momentum.start_close) && isNumber(momentum.end_close) ? `<p class="price-observed">기준 종가 ${html(formatPrice(momentum.start_close, item.currency))} → ${html(formatPrice(momentum.end_close, item.currency))}</p>` : ''}</div><div class="detail-momentum-meta"><span>계산 기준 ${html(dates)}</span><br><span>데이터 수집 ${html(formatTime(momentum.fetched_at))}</span><br><span>모멘텀 계산 ${html(formatTime(momentum.calculated_at))}</span></div>`;
  const blocks = momentumBlocks(item);
  const unit = item.market === 'crypto' ? '일' : '거래일';
  $('momentum-blocks').innerHTML = `<div class="momentum-blocks-heading"><h3>${periodLabel(7, item.market)} 구간별 모멘텀</h3><span>이전 구간 → 최근 구간 · 4개 구간 비교</span></div><div class="momentum-block-grid">${blocks.map((block, index) => `<article class="momentum-block${index === 3 ? ' is-latest' : ''}"><h4>${index === 3 ? `최근 7${unit}` : `${28 - index * 7} → ${21 - index * 7}${unit} 전`}</h4>${block.available ? `<span class="momentum-value ${changeClass(block.return_pct)}">${formatChange(block.return_pct)}<span class="momentum-direction">${block.direction.arrow} ${block.direction.label}</span></span>` : `<span class="momentum-missing">${block.status === 'gap' ? '일봉 누락' : '데이터 부족'}</span>`}<p class="block-dates">${block.start_date && block.end_date ? `${html(formatDate(block.start_date, { short: true }))} ~ ${html(formatDate(block.end_date, { short: true }))}` : isNumber(block.observations) ? `일봉 ${block.observations}개 · ${block.required_observations || 8}개 필요` : '기준 날짜 미제공'}</p></article>`).join('')}</div><p class="block-caption">서로 이어지는 4개 ${periodLabel(7, item.market)} 구간의 종가 수익률입니다. ${item.market === 'crypto' ? 'UTC 00:00 완료 경계의 가격을 직전 날짜 일봉 종가로 표시합니다.' : '주말과 휴장일은 거래일 수에 포함하지 않습니다.'}</p>`;
}
function renderLegacy(item) {
  const legacy = state.legacy;
  const matched = findLegacySignal(item, allItems(), legacy);
  if (!matched) { $('legacy-score').innerHTML = ''; return; }
  const detail = legacy.details?.[matched.symbol];
  const time = detail?.calculated_at || legacy.generated_at;
  const closed = detail?.candle_closed ?? legacy.candle_closed;
  const degraded = detail?.degraded ?? matched.degraded ?? legacy.degraded;
  const number = (value) => isNumber(value) ? value.toFixed(1) : '—';
  const direction = matched.direction === 'long' ? '롱' : matched.direction === 'short' ? '숏' : '중립';
  $('legacy-score').innerHTML = `<details class="legacy-panel"><summary>과거 4시간봉 스윙 점수 <b>${html(matched.score)} ${direction}</b>${closed ? '' : '<span class="badge">당시 잠정 봉</span>'} ${degraded ? '<span class="badge">결측 보정</span>' : ''}</summary><div class="legacy-meta"><span>과거 계산 시각 ${html(formatTime(time))}</span><span>·</span><span>${closed ? '완성된 봉' : '당시 진행 중인 봉의 잠정 점수'}</span>${degraded ? '<span class="badge">결측 보정</span>' : ''}</div>${detail ? `<table class="legacy-table"><thead><tr><th scope="col">항목</th><th scope="col">롱</th><th scope="col">숏</th><th scope="col">배점</th></tr></thead><tbody>${(detail.components || []).map((component) => `<tr><td>${html(component.label)}${component.degraded ? ' · 보정' : ''}</td><td>${number(component.points_long)}</td><td>${number(component.points_short)}</td><td>${number(component.points_max)}</td></tr>`).join('')}</tbody></table>` : '<p class="legacy-note">이 스냅샷에는 항목별 배점이 없습니다.</p>'}<p class="legacy-note">이전 4시간봉 계산기의 보관 스냅샷입니다. 현재 일봉 모멘텀은 위의 기간 수익률로 확인하세요. 시세 새로고침은 이 점수를 재계산하지 않습니다.</p></details>`;
  if (state.legacyError) $('legacy-score').insertAdjacentHTML('afterbegin', '<p class="legacy-note">점수 갱신 확인 실패 · 이전 점수와 계산 시각을 유지합니다.</p>');
}
function openDetail(id) {
  if (!state.items.has(id)) return;
  state.detailId = id; state.range = state.period + 'd'; renderDetailQuote();
  document.querySelectorAll('[data-range]').forEach((button) => { button.setAttribute('aria-pressed', String(button.dataset.range === state.range)); button.textContent = periodLabel(Number.parseInt(button.dataset.range), state.items.get(id).market); });
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
  loadChart();
}
function choosePeriod(period) {
  if (!MOMENTUM_PERIODS.includes(Number(period))) return;
  state.period = Number(period); state.range = state.period + 'd'; state.limit = 100;
  persistPreferences(); render();
  if (state.detailId && $('detail-dialog').open) { renderDetailQuote(); loadChart(); }
  announce(`${periodLabel(state.period, state.market)} 모멘텀으로 변경했습니다.`);
}
function chartEmpty(title, message) { return `<div class="chart-empty">${chartIcon}<strong>${html(title)}</strong><p>${html(message)}</p></div>`; }
async function loadChart({ force = false } = {}) {
  const id = state.detailId, range = state.range;
  if (!id) return;
  state.chartAbort?.abort();
  const controller = new AbortController(); state.chartAbort = controller;
  const sequence = ++state.chartSequence, key = id + '|' + range;
  const cached = state.chartCache.get(key);
  state.activeGeometry = null;
  if (cached) renderChart(cached.data, cached.error);
  else { $('chart').innerHTML = '<div class="chart-empty"><span class="loading-mark" aria-hidden="true"></span><strong>가격 추이를 불러오고 있습니다</strong></div>'; $('chart-meta').textContent = ''; }
  if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL) return;
  $('chart').setAttribute('aria-busy', 'true');
  try {
    const data = await fetchJson('/api/chart?' + new URLSearchParams({ id, range }), { signal: controller.signal });
    if (sequence !== state.chartSequence || state.detailId !== id || state.range !== range) return;
    if (!Array.isArray(data.points) || data.id && data.id !== id) throw new Error('차트 형식 오류');
    if (data.stale && data.points.length < 2 && cached?.data?.points?.length >= 2) { cached.error = true; renderChart(cached.data, true); return; }
    state.chartCache.set(key, { data, fetchedAt: Date.now(), error: false });
    renderChart(data);
  } catch {
    if (sequence !== state.chartSequence || state.detailId !== id || state.range !== range) return;
    if (cached) { cached.error = true; renderChart(cached.data, true); }
    else { $('chart').innerHTML = chartEmpty('가격 추이를 불러오지 못했습니다', '시세 제공처의 응답을 확인할 수 없습니다. 다른 기간을 선택하거나 새로고침해 주세요.'); $('chart-meta').textContent = '마지막 시세는 위의 기준 시각으로 유지됩니다.'; }
  } finally { if (sequence === state.chartSequence) $('chart').setAttribute('aria-busy', 'false'); }
}
function renderChart(data, error = false) {
  const geometry = chartGeometry(data.points);
  const currency = data.currency || state.items.get(state.detailId)?.currency || 'USD';
  state.activeGeometry = geometry; state.activeChart = { ...data, currency };
  const notes = Array.isArray(data.notes) ? data.notes.filter((note) => typeof note === 'string') : [];
  const item = state.items.get(state.detailId);
  const warning = error ? '새 차트를 확인하지 못해 이전 차트와 기존 기준 날짜를 유지합니다.' : data.stale ? '이전 차트 데이터입니다. 마지막 일봉 날짜를 확인해 주세요.' : '';
  const barDate = data.last_bar_date || completedBarDate(data.updated_at || (geometry ? new Date(geometry.end).toISOString() : null), item?.market);
  $('chart-meta').innerHTML = `<span>일봉 종가 · ${html(data.source || '제공처 미확인')}</span><span>마지막 일봉 ${html(formatDate(barDate))}</span><span>수집 ${html(formatTime(data.fetched_at))}</span>${warning ? `<span class="chart-warning">${html(warning)}</span>` : ''}${notes.length ? `<span>${html(notes.join(' · '))}</span>` : ''}`;
  if (!geometry) { $('chart').innerHTML = chartEmpty('이 기간의 가격 이력이 없습니다', '제공된 유효 가격이 2개 이상일 때 차트를 표시합니다. 다른 기간을 선택해 보세요.'); return; }
  const { width, height, left, top, plotWidth, plotHeight, min, max } = geometry;
  const grid = Array.from({ length: 4 }, (_, index) => { const fraction = index / 3; const y = top + fraction * plotHeight; return `<line class="chart-grid" x1="${left}" x2="${left + plotWidth}" y1="${y}" y2="${y}"/><text class="chart-axis" x="${left + plotWidth + 10}" y="${y + 4}">${html(formatPrice(max - (max - min) * fraction, currency))}</text>`; }).join('');
  const labels = [0, .5, 1].map((fraction) => `<text class="chart-axis" x="${left + fraction * plotWidth}" y="${height - 8}" text-anchor="${fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}">${html(formatDate(completedBarDate(geometry.start + (geometry.end - geometry.start) * fraction, item?.market), { short: true }))}</text>`).join('');
  const falling = geometry.points.at(-1).value < geometry.points[0].value;
  const area = geometry.path + ` L${left + plotWidth},${top + plotHeight} L${left},${top + plotHeight} Z`;
  state.chartPointIndex = geometry.points.length - 1;
  $('chart').innerHTML = `<svg id="price-chart-svg" viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${html(item?.name)} ${periodLabel(Number.parseInt(state.range), item?.market)} 일봉 종가 추이. ${geometry.points.length}개 가격 관측. 시작 ${html(formatPrice(geometry.points[0].value, currency))}, 마지막 ${html(formatPrice(geometry.points.at(-1).value, currency))}. 좌우 방향키로 날짜별 종가를 확인하세요."><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${falling ? '#f19692' : '#9beaaf'}" stop-opacity=".12"/><stop offset="100%" stop-color="${falling ? '#f19692' : '#9beaaf'}" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#chart-fill)"/><path class="chart-line${falling ? ' negative' : ''}" d="${geometry.path}"/>${labels}<g id="chart-cursor" visibility="hidden"><line class="chart-crosshair" y1="${top}" y2="${top + plotHeight}"/><circle class="chart-point" r="4"/></g></svg><div id="chart-tooltip" class="chart-tooltip" role="status" aria-live="off" hidden></div>`;
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (target?.dataset.market) chooseMarket(target.dataset.market);
  else if (target?.dataset.group) { state.group = target.dataset.group; state.limit = 100; render(); }
  else if (target?.dataset.favorite) toggleFavorite(target.dataset.favorite);
  else if (target?.dataset.detail) openDetail(target.dataset.detail);
  else if (target?.dataset.loadMore) { state.limit += 100; renderList(displayItems()); }
  else if (target?.dataset.retry) refreshController.run();
  else if (target?.dataset.period) choosePeriod(target.dataset.period);
  else if (target?.dataset.range) choosePeriod(Number.parseInt(target.dataset.range));
  if (!event.target.closest('#search-wrap')) closeSearch();
});
$('search').addEventListener('input', performSearch);
$('search').addEventListener('focus', performSearch);
$('search').addEventListener('compositionstart', () => { state.composing = true; });
$('search').addEventListener('compositionend', () => { state.composing = false; performSearch(); });
$('search').addEventListener('keydown', (event) => {
  if (event.isComposing || state.composing) return;
  if (event.key === 'Escape') { event.preventDefault(); closeSearch(); return; }
  if (event.key === 'Tab') { closeSearch(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  if (event.key === 'Enter') { if (state.searchResults.length && !$('search-popover').hidden) { event.preventDefault(); chooseSearchResult(Math.max(0, state.searchIndex)); } return; }
  event.preventDefault();
  if (!state.searchResults.length) return;
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  state.searchIndex = state.searchIndex < 0 ? delta > 0 ? 0 : state.searchResults.length - 1 : (state.searchIndex + delta + state.searchResults.length) % state.searchResults.length;
  renderSearch(); document.getElementById(`search-option-${state.searchIndex}`)?.scrollIntoView({ block: 'nearest' });
});
$('search-results').addEventListener('mousedown', (event) => event.preventDefault());
$('search-results').addEventListener('click', (event) => { const option = event.target.closest('[data-result-index]'); if (option) chooseSearchResult(Number(option.dataset.resultIndex)); });
document.addEventListener('keydown', (event) => { if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) && !$('detail-dialog').open) { event.preventDefault(); $('search').focus(); } });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; persistPreferences(); render(); });
for (const view of ['list', 'cards']) $(`view-${view}`).addEventListener('click', () => { state.view = view; persistPreferences(); render(); });
$('show-favorites').addEventListener('click', () => chooseMarket('favorites'));
$('refresh').addEventListener('click', () => refreshController.run());
$('detail-favorite').addEventListener('click', () => toggleFavorite(state.detailId));
$('detail-close').addEventListener('click', () => $('detail-dialog').close());
$('detail-dialog').addEventListener('click', (event) => { if (event.target === $('detail-dialog')) { const rect = $('detail-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('detail-dialog').close(); } });
$('detail-dialog').addEventListener('close', () => { state.detailId = null; state.chartSequence++; state.chartAbort?.abort(); });
function showChartPoint(index, speak = false) {
  const geometry = state.activeGeometry;
  if (!geometry || !$('chart-cursor')) return;
  state.chartPointIndex = Math.max(0, Math.min(geometry.points.length - 1, index));
  const point = geometry.points[state.chartPointIndex];
  const cursor = $('chart-cursor'); cursor.setAttribute('visibility', 'visible');
  const line = cursor.querySelector('line'); line.setAttribute('x1', point.x); line.setAttribute('x2', point.x);
  const circle = cursor.querySelector('circle'); circle.setAttribute('cx', point.x); circle.setAttribute('cy', point.y);
  $('chart-tooltip').setAttribute('aria-live', speak ? 'polite' : 'off');
  $('chart-tooltip').innerHTML = `<span>${html(formatDate(completedBarDate(point.time, state.items.get(state.detailId)?.market)))}</span><b>${html(formatPrice(point.value, state.activeChart.currency))}</b>`;
  $('chart-tooltip').hidden = false;
}
$('chart').addEventListener('pointermove', (event) => {
  const geometry = state.activeGeometry, svg = $('price-chart-svg'); if (!geometry || !svg) return;
  const matrix = svg.getScreenCTM(); if (!matrix) return;
  const location = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const point = geometry.points.reduce((nearest, candidate) => Math.abs(candidate.x - location.x) < Math.abs(nearest.x - location.x) ? candidate : nearest);
  showChartPoint(geometry.points.indexOf(point));
});
$('chart').addEventListener('keydown', (event) => { if (!state.activeGeometry || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); showChartPoint(event.key === 'Home' ? 0 : event.key === 'End' ? state.activeGeometry.points.length - 1 : state.chartPointIndex + (event.key === 'ArrowRight' ? 1 : -1), true); });
$('chart').addEventListener('pointerleave', () => { $('chart-cursor')?.setAttribute('visibility', 'hidden'); if ($('chart-tooltip')) $('chart-tooltip').hidden = true; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { updateCountdown(); refreshController.tick(); } });
window.addEventListener('storage', (event) => { if (event.key !== FAVORITES_KEY) return; const items = parseFavorites(event.newValue); state.favorites = new Map(items.map((item) => [item.id, item])); mergeItems(items); render(); updateDetailFavorite(); });
setInterval(() => { updateCountdown(); if (document.visibilityState === 'visible') refreshController.tick(); }, 1000);
render();
loadCatalog().catch(() => { state.loading = false; render(); }).finally(() => refreshController.run());
