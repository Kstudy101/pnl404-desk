export const REFRESH_INTERVAL = 60 * 60 * 1000;
export const FAVORITES_KEY = 'pnl404:watchlist:v1';
export const PREFERENCES_KEY = 'pnl404:board:view:v1';
export const MOMENTUM_PERIODS = [7, 14, 21, 28];
export const MARKETS = {
  us: { label: '미국주식', short: '미국', mark: 'US', currency: 'USD', groups: [{ id: 'all', label: '전체' }, { id: 'sp500', label: 'S&P 500' }, { id: 'nasdaq', label: '나스닥' }, { id: 'nyse', label: '뉴욕증권거래소' }] },
  kr: { label: '한국주식', short: '한국', mark: 'KR', currency: 'KRW', groups: [{ id: 'all', label: '전체' }, { id: 'kospi', label: '코스피' }, { id: 'kosdaq', label: '코스닥' }] },
  jp: { label: '일본주식', short: '일본', mark: 'JP', currency: 'JPY', groups: [{ id: 'all', label: '전체' }, { id: 'nikkei225', label: '닛케이 225' }, { id: 'prime', label: '프라임' }, { id: 'standard', label: '스탠더드' }, { id: 'growth', label: '그로스' }] },
  crypto: { label: '암호화폐', short: '크립토', mark: '₿', currency: 'USD', groups: [{ id: 'all', label: '시총 TOP 100' }] },
};
export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const normalizeSearch = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s.\-_/]/g, '');
export function periodLabel(period = 7, market) { return `${MOMENTUM_PERIODS.includes(Number(period)) ? Number(period) : 7}${market && market !== 'crypto' && market !== 'favorites' ? '거래일' : '일'}`; }
export function momentumDirection(value) {
  if (!isNumber(value)) return { key: 'missing', label: '데이터 부족', arrow: '—' };
  return value > 0 ? { key: 'up', label: '상승', arrow: '↑' } : value < 0 ? { key: 'down', label: '하락', arrow: '↓' } : { key: 'neutral', label: '중립', arrow: '→' };
}
export function completedBarDate(value, market) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (market === 'crypto') date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function momentumFor(item, period = 7) {
  const validPeriod = MOMENTUM_PERIODS.includes(Number(period)) ? Number(period) : 7;
  const published = item?.momentum?.periods?.[String(validPeriod)];
  const value = published?.status === 'ok' && isNumber(published?.return_pct) ? published.return_pct : null;
  return { ...published, return_pct: value, available: isNumber(value), direction: momentumDirection(value), period: validPeriod, basis: item?.momentum?.basis || (item?.market === 'crypto' ? 'calendar_days' : 'trading_days'), start_date: published?.start_bar_date || published?.start_date || completedBarDate(published?.start_at, item?.market), end_date: published?.end_bar_date || published?.end_date || completedBarDate(published?.end_at, item?.market), calculated_at: item?.momentum?.calculated_at || null, fetched_at: item?.momentum?.data_fetched_at || item?.fetched_at || null, stale: Boolean(item?.stale || item?.momentum?.stale) };
}
export function momentumBlocks(item) {
  const blocks = Array.isArray(item?.momentum?.blocks) ? item.momentum.blocks : [];
  return Array.from({ length: 4 }, (_, index) => {
    const block = blocks[index];
    const value = block?.status === 'ok' && isNumber(block?.return_pct) ? block.return_pct : null;
    return { ...block, return_pct: value, available: isNumber(value), direction: momentumDirection(value), start_date: block?.start_bar_date || block?.start_date || completedBarDate(block?.start_at, item?.market), end_date: block?.end_bar_date || block?.end_date || completedBarDate(block?.end_at, item?.market), index };
  });
}
export function normalizeItem(item) {
  if (!item || !Object.hasOwn(MARKETS, item.market) || typeof item.id !== 'string' || !item.id.startsWith(item.market + ':') || typeof item.symbol !== 'string') return null;
  return { ...item, name: typeof item.name === 'string' ? item.name : item.symbol, currency: typeof item.currency === 'string' ? item.currency : MARKETS[item.market].currency, aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias) => typeof alias === 'string') : [], groups: Array.isArray(item.groups) ? item.groups.filter((group) => typeof group === 'string') : [], price: isNumber(item.price) ? item.price : null, change_pct: isNumber(item.change_pct) ? item.change_pct : null, market_cap: isNumber(item.market_cap) ? item.market_cap : null, updated_at: typeof item.updated_at === 'string' ? item.updated_at : null, source: typeof item.source === 'string' ? item.source : '제공처 미연결', history: Array.isArray(item.history) ? item.history : [] };
}
export function reconcileMarketItems(previous, incoming, { stale = false, degraded = false } = {}) {
  const prior = new Map(previous.map(normalizeItem).filter(Boolean).map((item) => [item.id, item]));
  const normalized = incoming.map(normalizeItem).filter(Boolean);
  const partial = stale || degraded || normalized.length === 0 || normalized.some((item) => !isNumber(item.price));
  const result = new Map(partial ? [...prior].map(([id, item]) => [id, { ...item, stale: true }]) : []);
  for (const item of normalized) {
    const older = prior.get(item.id);
    if (!isNumber(item.price) && isNumber(older?.price)) result.set(item.id, { ...older, stale: true });
    else result.set(item.id, { ...item, stale: Boolean(item.stale || stale) });
  }
  return [...result.values()];
}
export function findLegacySignal(item, items, legacy) {
  if (item?.market !== 'crypto' || !Array.isArray(legacy?.items)) return null;
  const symbol = String(item.symbol).toUpperCase();
  const matchingIds = new Set(items.filter((candidate) => candidate.market === 'crypto' && String(candidate.symbol).toUpperCase() === symbol).map((candidate) => candidate.id));
  if (matchingIds.size > 1) return null;
  return legacy.items.find((row) => row.display === symbol || row.symbol === symbol + 'USDT') || null;
}
export function rankSearchResults(items, query, limit = 12) {
  const needle = normalizeSearch(query);
  if (!needle) return [];
  return items.map((item) => {
    const fields = [item.symbol, item.name, item.name_en, ...(item.aliases || [])].map(normalizeSearch).filter(Boolean);
    const score = fields.some((field) => field === needle) ? 0 : fields.some((field) => field.startsWith(needle)) ? 1 : fields.some((field) => field.includes(needle)) ? 2 : 9;
    return { item, score };
  }).filter(({ score }) => score < 9).sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name, 'ko')).slice(0, limit).map(({ item }) => item);
}
function missingLast(a, b, direction = -1) {
  if (!isNumber(a)) return isNumber(b) ? 1 : 0;
  if (!isNumber(b)) return -1;
  return (a - b) * direction;
}
export function selectItems(items, { market = 'crypto', group = 'all', sort = 'market_cap', favoriteIds = new Set(), period = 7 } = {}) {
  const filtered = items.filter((item) => market === 'favorites' ? favoriteIds.has(item.id) : item.market === market && (group === 'all' || item.groups.includes(group)));
  return filtered.sort((a, b) => {
    let comparison = 0;
    if (sort === 'name') comparison = a.name.localeCompare(b.name, 'ko');
    else if (sort === 'momentum_desc' || sort === 'momentum_asc') comparison = missingLast(momentumFor(a, period).return_pct, momentumFor(b, period).return_pct, sort === 'momentum_asc' ? 1 : -1);
    else if (sort === 'change_desc' || sort === 'change_asc') comparison = missingLast(a.change_pct, b.change_pct, sort === 'change_asc' ? 1 : -1);
    else if (sort === 'price_desc') comparison = a.currency.localeCompare(b.currency) || missingLast(a.price, b.price);
    else comparison = a.currency.localeCompare(b.currency) || missingLast(a.market_cap, b.market_cap) || missingLast(a.market_cap_rank, b.market_cap_rank, 1);
    return comparison || a.name.localeCompare(b.name, 'ko');
  });
}
export function parseFavorites(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Map(parsed.slice(0, 500).map(normalizeItem).filter(Boolean).map((item) => [item.id, item])).values()];
  } catch { return []; }
}
export function serializeFavorites(items) { return JSON.stringify(items.map(normalizeItem).filter(Boolean).map(({ history, ...item }) => item)); }
export function formatPrice(value, currency = 'USD') {
  if (!isNumber(value)) return '—';
  const digits = currency === 'KRW' || currency === 'JPY' ? (Math.abs(value) < 1 ? 4 : 0) : Math.abs(value) < 0.01 && value !== 0 ? 6 : Math.abs(value) < 1 && value !== 0 ? 4 : 2;
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
  catch { return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(value) + ' ' + currency; }
}
export function formatCompact(value, currency = 'USD') {
  if (!isNumber(value)) return '—';
  const units = [{ value: 1e12, label: '조' }, { value: 1e8, label: '억' }, { value: 1e4, label: '만' }];
  const unit = units.find((entry) => Math.abs(value) >= entry.value);
  const symbol = ({ USD: '$', KRW: '₩', JPY: '¥', USDT: '₮' })[currency] || currency + ' ';
  return unit ? symbol + (value / unit.value).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + unit.label : formatPrice(value, currency);
}
export function formatChange(value) { return isNumber(value) ? (value > 0 ? '+' : '') + value.toFixed(2) + '%' : '—'; }
export function formatDate(value, { short = false } = {}) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '날짜 미제공';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', ...(short ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit' }).format(date);
}
export function formatTime(value, { short = false } = {}) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '기준 시각 없음';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...(short ? {} : { month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false }).format(date) + ' KST';
}
export function quoteStatus(item, now = Date.now()) {
  if (!isNumber(item.price)) return { label: '시세 연결 전', kind: 'unavailable' };
  const date = Date.parse(item.updated_at || '');
  if (!Number.isFinite(date)) return { label: '기준 시각 미제공', kind: 'unknown' };
  if (item.stale || now - date > REFRESH_INTERVAL * 2) return { label: '이전 시세', kind: 'stale' };
  return { label: '시세 확인', kind: 'available' };
}
export function chartGeometry(points, width = 760, height = 260) {
  const sorted = (Array.isArray(points) ? points : []).filter((point) => point && typeof point === 'object').map((point) => ({ time: typeof point.time === 'number' ? point.time < 1e12 ? point.time * 1000 : point.time : Date.parse(point.time), value: point.value })).filter((point) => Number.isFinite(point.time) && isNumber(point.value)).sort((a, b) => a.time - b.time);
  const valid = [...new Map(sorted.map((point) => [point.time, point])).values()];
  if (valid.length < 2) return null;
  const values = valid.map((point) => point.value), low = Math.min(...values), high = Math.max(...values);
  const padding = high === low ? Math.max(Math.abs(high) * 0.01, 0.01) : (high - low) * 0.12;
  const min = low - padding, max = high + padding, start = valid[0].time, end = valid.at(-1).time;
  if (start === end) return null;
  const left = 14, right = 91, top = 16, bottom = 30;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const mapped = valid.map((point) => ({ ...point, x: left + (point.time - start) / (end - start) * plotWidth, y: top + (max - point.value) / (max - min) * plotHeight }));
  return { points: mapped, path: mapped.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '), min, max, start, end, left, top, plotWidth, plotHeight, width, height };
}
// One clock and one in-flight request, shared by timer, manual and visibility refreshes.
export function createRefreshController(refresh, { now = Date.now, interval = REFRESH_INTERVAL } = {}) {
  let inFlight = null, due = now() + interval;
  return {
    get nextRefreshAt() { return due; },
    get busy() { return Boolean(inFlight); },
    run() {
      if (inFlight) return inFlight;
      inFlight = Promise.resolve().then(refresh).finally(() => { due = now() + interval; inFlight = null; });
      return inFlight;
    },
    tick() { return now() >= due ? this.run() : Promise.resolve(false); },
  };
}
