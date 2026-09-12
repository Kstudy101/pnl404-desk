import { mountZoneView } from './zone-visualization.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const displayName = value => String(value ?? '').replace(/레드\s?존/g, '하단 밴드').replace(/블루\s?존/g, '상단 밴드');
const price = (value, digits = 0) => finite(value) ? new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : '—';
const percent = value => finite(value) ? `${value.toFixed(1)}%` : '—';
const utcDate = value => finite(value) ? new Date(value).toISOString().slice(0, 10) : '날짜 미제공';
export const snapshotTime = value => finite(value) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value) + ' KST' : '기준 시각 미제공';

/** Join existing day, zone and reference records. No price or band recalculation. */
export function buildDayDetails(data, n) {
  const day = data?.all?.find(row => row.n === Number(n));
  if (!day) return null;
  const referenceIndex = (data.distinct || []).findIndex(row => day.n >= row.from && day.n <= row.to);
  return { ...day, zone: data.zones?.find(zone => zone.id === day.z) || null, referenceIndex, reference: data.distinct?.[referenceIndex] || null };
}

export function dayIndexForKey(index, key, count) {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(count - 1, index + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, index - 1);
  return index;
}

export function renderDayDetails(detail, data) {
  if (!detail) return '<p class="fd-note">선택할 기준일 데이터가 없습니다.</p>';
  return `<div class="fd-day-heading"><h3>${detail.n}일 기준</h3><span class="fd-zone-label">${esc(displayName(detail.zone?.short || '구간 미제공'))}</span></div><dl class="fd-grid fd-day-metrics"><div><dt>범위 안 현재가 위치</dt><dd>${percent(detail.pct)}</dd></div><div><dt>연결된 고유 기준</dt><dd>${esc(detail.reference?.label || '기준 미제공')}</dd></div><div><dt>기준 저가 · 0</dt><dd>${price(detail.low, data.dec)} <small>USDT</small></dd><dd class="fd-muted">${utcDate(detail.lowT)} UTC 일봉</dd></div><div><dt>기준 고가 · 100</dt><dd>${price(detail.high, data.dec)} <small>USDT</small></dd><dd class="fd-muted">${utcDate(detail.highT)} UTC 일봉</dd></div></dl><p class="fd-note">${esc(displayName(detail.zone?.name || '구간 설명 미제공'))}${detail.reference ? `<br>연결된 고유 기준의 일봉 범위 ${utcDate(detail.reference.ref?.fromT)} ~ ${utcDate(detail.reference.ref?.toT)} (UTC)` : ''}</p><div class="fd-day-actions"><button type="button" data-fd-action="band"${detail.referenceIndex < 0 ? ' disabled' : ''}>이 기준의 밴드 보기 <span aria-hidden="true">↗</span></button><button type="button" data-fd-action="matrix"${detail.referenceIndex < 0 ? ' disabled' : ''}>매트릭스 열 보기 <span aria-hidden="true">↗</span></button></div>`;
}

export function renderDashboardShell(data) {
  const count = data.all?.length || 0, references = data.distinct?.length || 0;
  return `<a class="fd-skip" href="#fib-rise">밴드 분석으로 이동</a><header class="fd-header"><div class="fd-title"><p class="fd-eyebrow">FIBONACCI · ${esc(data.symbol)}</p><h1>피보나치</h1><p class="fd-muted">같은 현재가를 서로 다른 기준 기간에서 살펴봅니다.</p></div><div class="fd-snapshot"><div class="fd-price"><span>${esc(data.symbol)} · 스냅샷 현재가</span><strong>${price(data.price, data.dec)} <small>USDT</small></strong></div><time datetime="${finite(data.now) ? new Date(data.now).toISOString() : ''}">${esc(snapshotTime(data.now))}</time><button type="button" id="fd-refresh" aria-label="저장된 피보나치 화면 새로고침">↻ 화면 새로고침</button></div></header><nav class="fd-nav" aria-label="피보나치 화면 탐색"><a href="#fib-rise">밴드 분석</a><a href="#fd-overview">구간 분포</a><a href="#fd-heat">기준일 탐색</a><a href="#fd-near">근접 레벨</a><a href="#fd-distinct">고유 기준</a><a href="#fd-matrix">매트릭스</a></nav><div class="fd-note fd-method">기준 = 최근 N개 <b>완성 일봉</b>의 저가(0)와 고가(100) · ${count}개 기준일 · ${references}개 고유 기준</div><div data-fd-slot="band"></div><div class="fd-layout"><section id="fd-overview" class="fd-panel fd-overview" aria-labelledby="fd-overview-title"><div class="fd-panel-heading"><h2 id="fd-overview-title">구간별 분포</h2><span>기준 1~<b id="mx-n">${data.maxLookback}</b>일</span></div><p class="fd-muted">각 기준에서 현재가가 놓인 구간의 비중</p><div data-fd-slot="distribution"></div></section><section id="fd-heat" class="fd-panel fd-heat" aria-labelledby="fd-heat-title"><div class="fd-panel-heading"><h2 id="fd-heat-title">기준일 탐색</h2><span><b id="mx-n2">${count}</b>개 기준일</span></div><p id="fd-heat-help" class="fd-muted">색은 구간, 숫자는 기준일입니다. 날짜 선택 후 방향키 또는 이전·다음 버튼으로 탐색하세요.</p><div class="fd-day-toolbar"><button type="button" id="fd-day-prev" aria-label="이전 기준일">← 이전</button><label for="fd-day-select">기준일<select id="fd-day-select">${(data.all || []).map(day => `<option value="${day.n}">${day.n}일 기준</option>`).join('')}</select></label><button type="button" id="fd-day-next" aria-label="다음 기준일">다음 →</button></div><div data-fd-slot="heat"></div><div id="fd-day-detail" class="fd-day-details" aria-live="polite" aria-atomic="true"></div></section></div><section id="fd-near" class="fd-panel fd-near" aria-labelledby="fd-near-title"><div class="fd-panel-heading"><h2 id="fd-near-title">근접 레벨 합류</h2><span>현재가 ±<b id="tol">${data.nearTolPct}</b>% · <span id="nearcnt"></span></span></div><p class="fd-muted">서로 다른 기준의 레벨이 현재가 주변에 모인 위치입니다.</p><div data-fd-slot="near"></div></section><section id="fd-distinct" class="fd-panel fd-distinct" aria-labelledby="fd-distinct-title"><div class="fd-panel-heading"><h2 id="fd-distinct-title">고유 기준 구간</h2><span>${references}개 기준</span></div><p class="fd-muted">저가·고가가 같은 기준은 하나로 묶었습니다. 흰 선은 기준 저가(0)~고가(100) 안의 현재가 위치입니다. 기준을 선택하면 밴드와 매트릭스가 연결됩니다.</p><div class="fd-table-scroll" tabindex="0" role="region" aria-label="고유 기준 구간 전체 표" data-fd-slot="distinct"></div></section><section id="fd-matrix" class="fd-panel fd-matrix" aria-labelledby="fd-matrix-title"><div class="fd-panel-heading"><h2 id="fd-matrix-title">레벨 매트릭스</h2><span>고유 기준 × 확장 3층</span></div><p class="fd-muted">${data.levels?.length || 0}개 레벨과 ${references}개 기준을 비교합니다. 선택한 기준의 열은 강조되어 있습니다.</p><div data-fd-slot="matrix"></div></section><footer class="fd-footer"><span>PNL404 · 피보나치</span><span>1시간 주기 화면 새로고침 · 원본 파일이 갱신되면 새 값을 표시합니다. 화면 새로고침은 데이터를 재계산하지 않습니다.</span></footer><div id="fd-announcement" class="fd-sr-only" role="status" aria-live="polite"></div>`;
}

function normalizeDisplayText(root, doc) {
  if (!doc.createTreeWalker) return;
  const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT; scripts remain in the original document.
  while (walker.nextNode()) {
    const node = walker.currentNode, normalized = displayName(node.nodeValue);
    if (normalized !== node.nodeValue) node.nodeValue = normalized;
  }
}

/** Move rendered source nodes so the producer remains the only table/calculation owner. */
export function mountFibDashboard(data, doc = document) {
  if (!Array.isArray(data?.all) || !Array.isArray(data?.distinct) || doc.getElementById('fib-dashboard')) return null;
  const oldWrap = doc.getElementById('wrap');
  const ids = ['stack', 'groups', 'strip', 'axis', 'nb', 'na', 'dist', 'mx'];
  const old = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
  if (!oldWrap || ids.some(id => !old[id])) return null;
  mountZoneView(data, doc);
  const band = doc.getElementById('fib-rise');
  if (!band) return null;
  const near = old.nb.closest('.near2'), matrix = old.mx.closest('details');
  if (!near || !matrix) return null;
  const main = doc.createElement('main'); main.id = 'fib-dashboard';
  main.innerHTML = renderDashboardShell(data);
  const slot = name => main.querySelector(`[data-fd-slot="${name}"]`);
  slot('band').append(band);
  slot('distribution').append(old.stack, old.groups);
  slot('heat').append(old.strip, old.axis);
  slot('heat').before(main.querySelector('#fd-day-detail'));
  slot('near').append(near);
  slot('distinct').append(old.dist);
  slot('matrix').append(matrix);
  matrix.querySelector('summary').textContent = `전체 ${data.levels.length}개 레벨 × ${data.distinct.length}개 기준 펼치기`;
  const matrixScroll = old.mx.closest('.mxwrap');
  matrixScroll?.classList.add('fd-table-scroll');
  matrixScroll?.setAttribute('tabindex', '0');
  matrixScroll?.setAttribute('role', 'region');
  matrixScroll?.setAttribute('aria-label', '전체 레벨 매트릭스 가로 세로 탐색');
  const oldCount = doc.getElementById('nearcnt')?.textContent;
  main.querySelector('#nearcnt').textContent = oldCount || `아래 ${data.near.filter(row => row.distPct < 0).length} / 위 ${data.near.filter(row => row.distPct >= 0).length}개`;
  // These labels are replaced by the new headings, avoiding duplicate IDs in the hidden shell.
  for (const id of ['mx-n', 'mx-n2', 'tol', 'nearcnt']) doc.getElementById(id)?.removeAttribute('id');
  doc.getElementById('t')?.setAttribute('hidden', '');
  oldWrap.setAttribute('hidden', '');
  doc.body.append(main);
  doc.title = `${data.symbol} 피보나치 · PNL404`;
  normalizeDisplayText(main, doc);

  old.strip.removeAttribute('style'); old.axis.removeAttribute('style');
  old.strip.setAttribute('role', 'region'); old.strip.setAttribute('tabindex', '0'); old.strip.setAttribute('aria-label', '기준일별 현재가 구간 · 스크롤하여 전체 기준일 탐색'); old.strip.setAttribute('aria-describedby', 'fd-heat-help');
  old.axis.setAttribute('aria-hidden', 'true');
  old.strip.innerHTML = data.all.map(day => {
    const zone = data.zones.find(zone => zone.id === day.z), color = /^#[0-9a-f]{6}$/i.test(zone?.color) ? zone.color : '#65758a';
    return `<button type="button" class="fd-day-button" data-day="${day.n}" style="--fd-zone-color:${color}" aria-label="${day.n}일 기준 · ${esc(displayName(zone?.short || '구간 미제공'))} · 위치 ${percent(day.pct)}" aria-pressed="false" tabindex="-1">${day.n}</button>`;
  }).join('');

  const distinctRows = [...old.dist.querySelectorAll('tr')];
  distinctRows[0]?.querySelectorAll('th').forEach(cell => cell.setAttribute('scope', 'col'));
  distinctRows.slice(1).forEach((row, index) => {
    row.dataset.referenceIndex = String(index);
    const first = row.querySelector('td');
    if (first) first.innerHTML = `<button type="button" class="fd-reference-button" data-fd-reference="${index}">${esc(data.distinct[index]?.label || '')}</button>`;
  });
  const matrixRows = [...old.mx.querySelectorAll('tr')];
  matrixRows[0]?.querySelectorAll('th').forEach((cell, index) => {
    cell.setAttribute('scope', 'col');
    if (index) cell.innerHTML = `<button type="button" class="fd-reference-button" data-fd-reference="${index - 1}">${esc(data.distinct[index - 1]?.label || '')}</button>`;
  });

  const buttons = [...old.strip.querySelectorAll('[data-day]')];
  const referenceSelect = main.querySelector('#fr-reference');
  let selectedIndex = 0, syncingReference = false;
  const highlightReference = index => {
    distinctRows.slice(1).forEach((row, i) => row.classList.toggle('fd-selected-reference', i === index));
    matrixRows.forEach(row => [...row.children].forEach((cell, i) => cell.classList.toggle('fd-selected-column', i === index + 1)));
    main.querySelectorAll('[data-fd-reference]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.fdReference) === index)));
  };
  const syncBand = index => {
    highlightReference(index);
    if (!referenceSelect || index < 0 || referenceSelect.value === String(index)) return;
    referenceSelect.value = String(index);
    syncingReference = true;
    referenceSelect.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    syncingReference = false;
  };
  const selectDay = (n, { focus = false, sync = true } = {}) => {
    const index = data.all.findIndex(day => day.n === Number(n));
    if (index < 0) return null;
    selectedIndex = index;
    const detail = buildDayDetails(data, n);
    main.querySelector('#fd-day-detail').innerHTML = renderDayDetails(detail, data);
    main.querySelector('#fd-day-select').value = String(detail.n);
    main.querySelector('#fd-day-prev').disabled = index === 0;
    main.querySelector('#fd-day-next').disabled = index === data.all.length - 1;
    buttons.forEach((button, i) => { button.setAttribute('aria-pressed', String(i === index)); button.setAttribute('tabindex', i === index ? '0' : '-1'); });
    if (sync) syncBand(detail.referenceIndex); else highlightReference(detail.referenceIndex);
    if (focus) { buttons[index]?.focus({ preventScroll: true }); buttons[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); }
    try { const view = doc.defaultView, url = new URL(view.location.href); url.searchParams.set('day', String(detail.n)); view.history.replaceState(null, '', url); } catch { /* Preview or restricted embedding still works. */ }
    return detail;
  };
  const goTo = (element, message) => {
    if (!element) return;
    element.setAttribute('tabindex', '-1'); element.focus({ preventScroll: true }); element.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    main.querySelector('#fd-announcement').textContent = message;
  };
  main.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.day) selectDay(button.dataset.day);
    else if (button.id === 'fd-day-prev') selectDay(data.all[Math.max(0, selectedIndex - 1)]?.n);
    else if (button.id === 'fd-day-next') selectDay(data.all[Math.min(data.all.length - 1, selectedIndex + 1)]?.n);
    else if (button.id === 'fd-refresh') doc.defaultView?.location?.reload();
    else if (button.dataset.fdReference !== undefined) selectDay(data.distinct[Number(button.dataset.fdReference)]?.from);
    else if (button.dataset.reference !== undefined) selectDay(data.distinct[Number(button.dataset.reference)]?.from, { sync: false });
    else if (button.dataset.fdAction) {
      const detail = buildDayDetails(data, data.all[selectedIndex]?.n); if (!detail || detail.referenceIndex < 0) return;
      if (button.dataset.fdAction === 'band') goTo(band, `${detail.reference.label} 밴드 분석으로 이동했습니다.`);
      else {
        matrix.open = true;
        goTo(main.querySelector('#fd-matrix'), `${detail.reference.label} 매트릭스 열로 이동했습니다.`);
        const header = matrixRows[0]?.children[detail.referenceIndex + 1];
        if (matrixScroll && header) matrixScroll.scrollLeft = Math.max(0, header.offsetLeft - (matrixRows[0]?.children[0]?.offsetWidth || 0));
      }
    }
  });
  old.strip.addEventListener('keydown', event => {
    if (!event.target.closest('[data-day]') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = dayIndexForKey(selectedIndex, event.key, data.all.length);
    selectDay(data.all[next]?.n, { focus: true });
  });
  main.querySelector('#fd-day-select').addEventListener('change', event => selectDay(event.target.value));
  referenceSelect?.addEventListener('change', event => { if (!syncingReference) selectDay(data.distinct[Number(event.target.value)]?.from, { sync: false }); });
  let initialDay = data.all[0]?.n;
  try { const stored = Number(new URLSearchParams(doc.defaultView?.location?.search || '').get('day')); if (data.all.some(day => day.n === stored)) initialDay = stored; } catch { /* Use the first stored day. */ }
  if (initialDay !== undefined) selectDay(initialDay);
  else { main.querySelector('#fd-day-detail').innerHTML = renderDayDetails(null, data); main.querySelector('#fd-day-prev').disabled = true; main.querySelector('#fd-day-next').disabled = true; main.querySelector('#fd-day-select').disabled = true; }
  return { selectDay, getState: () => ({ day: data.all[selectedIndex]?.n ?? null, referenceIndex: buildDayDetails(data, data.all[selectedIndex]?.n)?.referenceIndex ?? -1 }) };
}

// The static import above guarantees the unchanged band module initializes first.
if (typeof document !== 'undefined' && typeof D !== 'undefined') mountFibDashboard(D, document);
