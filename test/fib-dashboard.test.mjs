import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { enhanceFibHtml, extractFibData } from '../scripts/enhance-fib.mjs';
import { buildDayDetails, renderDayDetails, renderDashboardShell, dayIndexForKey, mountFibDashboard } from '../public/modules/fib/dashboard-view.mjs';
import { buildZoneRows } from '../public/modules/fib/zone-visualization.mjs';

// Independent original D captured before the dashboard redesign. Compression
// keeps the 85 KB fixture readable around the tests; it is never evaluated.
const ORIGINAL_LITERAL = gunzipSync(Buffer.from('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', 'base64')).toString('utf8');
const originalData = () => JSON.parse(ORIGINAL_LITERAL);
const publishedHtml = () => readFileSync(new URL('../public/modules/fib/index.html', import.meta.url), 'utf8');
const rawHtml = (literal = ORIGINAL_LITERAL) => '<!doctype html><html lang="ko"><head><title>레드존 / 블루존</title><meta http-equiv="refresh" content="300"></head><body><table id="mx"></table><script>const D=' + literal + ';</script></body></html>';
const money = (value, digits = 0) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const date = value => new Date(value).toISOString().slice(5, 10);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, a + ' != ' + b);

test('Fibonacci enhancer preserves the independent original D and 300-second reload exactly once', () => {
  assert.equal(Buffer.byteLength(ORIGINAL_LITERAL), 85718);
  assert.equal(createHash('sha256').update(ORIGINAL_LITERAL).digest('hex'), '5e9199c673a415446c7982571e783494e74a694b5034f670369b1f6fc06d9311');
  const enhanced = enhanceFibHtml(rawHtml());
  assert.equal(extractFibData(enhanced).literal, ORIGINAL_LITERAL);
  assert.equal(enhanceFibHtml(enhanced), enhanced);
  assert.match(enhanced, /http-equiv="refresh" content="300"/);
  for (const asset of ['zone-visualization.mjs', 'zone-visualization.css', 'dashboard-view.mjs', 'dashboard-view.css']) {
    assert.equal(enhanced.split(asset).length - 1, 1, asset);
  }
  assert.equal((enhanced.match(/name="viewport"/g) || []).length, 1);
  assert.match(enhanced, /<title>하단 밴드 \/ 상단 밴드<\/title>/);
  assert.throws(() => enhanceFibHtml('<html><head></head><body>missing</body></html>'));
});

test('data extraction handles quoted braces and escapes without normalizing payload labels', () => {
  const data = { label: '레드존 } { "quoted" \\ 블루존', nested: { rows: [{ name: '#3-6' }] }, price: 120 };
  const literal = JSON.stringify(data), html = rawHtml(literal), extracted = extractFibData(html);
  assert.equal(html.slice(extracted.start, extracted.end), literal);
  assert.deepEqual(extracted.data, data);
  assert.equal(extractFibData(enhanceFibHtml(html)).literal, literal);
  assert.throws(() => extractFibData('const D={"broken": {'));
  assert.throws(() => extractFibData('const D=[];'));
});

test('every original day maps to its exact zone and reference without recalculation or mutation', () => {
  const data = originalData(), before = JSON.stringify(data);
  assert.equal(data.all.length, 90);
  assert.equal(data.groups.length, 5);
  assert.equal(data.groups.reduce((sum, group) => sum + group.n, 0), 90);
  assert.equal(data.distinct.length, 22);
  assert.equal(data.levels.length, 33);
  for (let n = 1; n <= 90; n++) {
    const detail = buildDayDetails(data, String(n)), raw = data.all[n - 1];
    for (const [key, value] of Object.entries(raw)) assert.deepEqual(detail[key], value, n + ':' + key);
    assert.strictEqual(detail.zone, data.zones.find(zone => zone.id === raw.z));
    assert.strictEqual(detail.reference, data.distinct[detail.referenceIndex]);
    assert.ok(n >= detail.reference.from && n <= detail.reference.to);
    assert.equal(detail.low, detail.reference.ref.low);
    assert.equal(detail.high, detail.reference.ref.high);
  }
  assert.equal(buildDayDetails(data, 4).reference.label, '1~4일');
  assert.equal(buildDayDetails(data, 5).reference.label, '5일');
  assert.equal(buildDayDetails(data, 72).reference.label, '72일');
  assert.equal(buildDayDetails(data, 73).reference.label, '73~90일');
  for (const n of [0, 91, NaN, 'unknown']) assert.equal(buildDayDetails(data, n), null);
  assert.equal(JSON.stringify(data), before);
});

test('day details retain prices and dates, unclipped extension positions, missing state and escaped labels', () => {
  const data = originalData();
  for (const n of [1, 5, 72, 90]) {
    const detail = buildDayDetails(data, n), markup = renderDayDetails(detail, data);
    for (const value of [detail.low, detail.high]) assert.ok(markup.includes(money(value, data.dec)));
    for (const stamp of [detail.lowT, detail.highT, detail.reference.ref.fromT, detail.reference.ref.toT]) assert.ok(markup.includes(new Date(stamp).toISOString().slice(0, 10)));
    assert.ok(markup.includes(detail.pct.toFixed(1) + '%'));
    assert.ok(markup.includes(detail.reference.label));
    assert.match(markup, /data-fd-action="band"/);
    assert.match(markup, /data-fd-action="matrix"/);
  }
  const detail = buildDayDetails(data, 1);
  detail.pct = 145.6;
  detail.reference = { ...detail.reference, label: '<img src=x onerror=alert(1)>' };
  detail.zone = { ...detail.zone, name: '레드존 <script>bad()</script>' };
  const escaped = renderDayDetails(detail, data);
  assert.ok(escaped.includes('145.6%'));
  assert.ok(escaped.includes('&lt;img'));
  assert.ok(!escaped.includes('<img'));
  assert.ok(escaped.includes('하단 밴드 &lt;script&gt;'));
  assert.match(renderDayDetails(null, data), /선택할 기준일 데이터가 없습니다/);
  assert.ok(!/NaN|Infinity|undefined/.test(renderDayDetails(null, data)));
});

test('keyboard navigation reaches both edges and never wraps or invents an unavailable day', () => {
  for (const key of ['ArrowLeft', 'ArrowUp', 'Home']) assert.equal(dayIndexForKey(0, key, 90), 0);
  for (const key of ['ArrowRight', 'ArrowDown', 'End']) assert.equal(dayIndexForKey(89, key, 90), 89);
  assert.equal(dayIndexForKey(44, 'ArrowLeft', 90), 43);
  assert.equal(dayIndexForKey(44, 'ArrowDown', 90), 45);
  assert.equal(dayIndexForKey(44, 'Home', 90), 0);
  assert.equal(dayIndexForKey(44, 'End', 90), 89);
  assert.equal(dayIndexForKey(44, 'Enter', 90), 44);
  assert.equal(dayIndexForKey(44, ' ', 90), 44);
  assert.equal(dayIndexForKey(0, 'End', 0), -1);
});

test('the dashboard exposes its six sections, source timestamp, native controls and reload meaning', () => {
  const data = originalData(), shell = renderDashboardShell(data);
  for (const id of ['fib-rise', 'fd-overview', 'fd-heat', 'fd-near', 'fd-distinct', 'fd-matrix']) assert.ok(shell.includes('href="#' + id + '"'));
  assert.equal((shell.match(/<option value=/g) || []).length, 90);
  assert.match(shell, /<label for="fd-day-select">/);
  assert.match(shell, /aria-live="polite"/);
  assert.ok(shell.includes('datetime="' + new Date(data.now).toISOString() + '"'));
  assert.match(shell, /화면 새로고침은 데이터를 재계산하지 않습니다/);
  assert.match(shell, /5분 주기 화면 새로고침/);
  assert.ok(!/NaN|Infinity|undefined/.test(shell));
});

// A small DOM fixture exercises the real classic producer and both real modules.
// It models node movement and event bubbling; visual layout remains browser QA.
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
class FixtureNode {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.doc = doc; this.attrs = {}; this.dataset = {}; this.childNodes = []; this.style = {}; this.listeners = new Map(); this.parentNode = null; this.value = ''; this.offsetLeft = 0; this.offsetWidth = 0; }
  get children() { return this.childNodes.filter(node => node.tagName !== '#TEXT'); }
  get id() { return this.attrs.id || ''; } set id(value) { this.attrs.id = String(value); }
  get className() { return this.attrs.class || ''; } set className(value) { this.attrs.class = String(value); }
  get classList() { const node = this; return { contains(name) { return node.className.split(/\s+/).includes(name); }, add(name) { this.toggle(name, true); }, toggle(name, on) { const names = new Set(node.className.split(/\s+/).filter(Boolean)); if (on ?? !names.has(name)) names.add(name); else names.delete(name); node.className = [...names].join(' '); } }; }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value); if (name === 'disabled') this.disabled = true; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  append(...nodes) { for (const node of nodes) { if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1); node.parentNode = this; this.childNodes.push(node); } }
  insertBefore(node, before) { this.append(node); if (before) { this.childNodes.pop(); this.childNodes.splice(this.childNodes.indexOf(before), 0, node); } }
  before(node) { this.parentNode.insertBefore(node, this); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attr) return this.attrs[attr[1]] !== undefined && (attr[2] === undefined || this.attrs[attr[1]] === attr[2]);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) { const results = []; for (const child of this.children) { if (child.matches(selector)) results.push(child); results.push(...child.querySelectorAll(selector)); } return results; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  get textContent() { return this.tagName === '#TEXT' ? this.text : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.childNodes = []; const text = new FixtureNode('#text', this.doc); text.text = String(value); this.append(text); }
  get innerHTML() { return this._markup || ''; }
  set innerHTML(markup) {
    this._markup = markup; this.childNodes = []; const stack = [this];
    for (const token of markup.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<!--')) continue;
      if (token.startsWith('</')) { const tag = token.slice(2, -1).trim().toUpperCase(); while (stack.length > 1) if (stack.pop().tagName === tag) break; continue; }
      if (token.startsWith('<')) {
        const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
        const node = new FixtureNode(tag, this.doc);
        for (const match of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
        stack.at(-1).append(node);
        if (!['br', 'hr', 'meta', 'link', 'input', 'img'].includes(tag.toLowerCase())) stack.push(node);
      } else { const node = new FixtureNode('#text', this.doc); node.text = decode(token); stack.at(-1).append(node); }
    }
  }
  addEventListener(type, listener) { const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners); }
  dispatchEvent(event) { event.target ||= this; event.currentTarget = this; for (const listener of this.listeners.get(event.type) || []) listener(event); if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event); return !event.defaultPrevented; }
  focus() { this.doc.activeElement = this; }
  scrollIntoView() { this.scrolledIntoView = true; }
}
class FixtureEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
}
function renderedFixture(data = originalData(), search = '') {
  let reloads = 0;
  const doc = { createElement: tag => new FixtureNode(tag, doc), getElementById: id => doc.body.querySelector('#' + id) };
  doc.body = doc.createElement('body');
  const view = { Event: FixtureEvent, location: { href: 'https://fixture.invalid/modules/fib/index.html' + search, search, reload() { reloads++; } }, history: { replaceState(_state, _title, url) { view.location.href = String(url); view.location.search = new URL(url).search; } } };
  doc.defaultView = view;
  const html = publishedHtml(), classic = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => /\bconst D=/.test(script));
  assert.ok(classic, 'original classic producer is present');
  const { start, end } = extractFibData(classic);
  doc.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)[1];
  vm.runInNewContext(classic.slice(0, start) + JSON.stringify(data) + classic.slice(end), { document: doc }, { timeout: 1000 });
  return { doc, data, click(node) { node.dispatchEvent(new FixtureEvent('click', { bubbles: true })); }, change(node, value) { node.value = value; node.dispatchEvent(new FixtureEvent('change', { bubbles: true })); }, key(node, key) { const event = new FixtureEvent('keydown', { key, bubbles: true }); node.dispatchEvent(event); return event; }, get reloads() { return reloads; } };
}

test('the actual classic producer preserves all distribution, nearby, distinct and 726 matrix cells', () => {
  const { doc, data } = renderedFixture();
  assert.equal(doc.getElementById('stack').children.length, 5);
  const groups = doc.getElementById('groups').children;
  for (const [index, group] of data.groups.entries()) {
    assert.ok(groups[index].textContent.includes(group.short));
    assert.ok(groups[index].textContent.includes(group.n + '개 ' + (group.share * 100).toFixed(0) + '%'));
    assert.ok(groups[index].textContent.includes(group.ranges + '일'));
  }
  const below = data.near.filter(row => row.distPct < 0), above = data.near.filter(row => row.distPct >= 0).reverse();
  assert.deepEqual([below.length, above.length], [31, 49]);
  for (const [id, rows] of [['nb', below], ['na', above]]) {
    const rendered = doc.getElementById(id).children;
    assert.equal(rendered.length, rows.length);
    for (const [index, row] of rows.entries()) assert.deepEqual(rendered[index].children.map(node => node.textContent), [money(row.price), (row.distPct >= 0 ? '+' : '') + row.distPct.toFixed(2) + '%', row.name, row.refLabel]);
  }
  const distinctRows = doc.getElementById('dist').querySelectorAll('tr').slice(1);
  assert.equal(distinctRows.length, 22);
  for (const [index, entry] of data.distinct.entries()) {
    const cells = distinctRows[index].children;
    assert.equal(cells.length, 10);
    assert.deepEqual(cells.slice(0, 7).map(cell => cell.textContent), [entry.label, date(entry.ref.fromT) + '~' + date(entry.ref.toT), money(entry.ref.low) + ' ' + date(entry.ref.lowT), money(entry.ref.high) + ' ' + date(entry.ref.highT), money(entry.ref.size), entry.pos.pct.toFixed(1), data.zones.find(zone => zone.id === entry.pos.zoneId).short]);
    assert.ok(cells[8].textContent.includes(entry.pos.below.name + ' ' + money(entry.pos.below.price)));
    assert.ok(cells[9].textContent.includes(entry.pos.above.name + ' ' + money(entry.pos.above.price)));
  }
  const matrixRows = doc.getElementById('mx').querySelectorAll('tr').slice(1);
  assert.equal(matrixRows.length, 33);
  let positive = 0, unavailable = 0;
  for (const [index, name] of data.levels.entries()) {
    const cells = matrixRows[index].children;
    assert.equal(cells.length, 23);
    assert.equal(cells[0].textContent, name);
    for (const [column, entry] of data.distinct.entries()) {
      const raw = entry.rows.find(row => row.name === name), cell = cells[column + 1];
      if (raw.price > 0) { positive++; assert.equal(cell.textContent, money(raw.price)); assert.equal(cell.classList.contains('here'), entry.pos.below?.name === name); }
      else { unavailable++; assert.equal(cell.textContent, '—'); }
    }
  }
  assert.deepEqual([positive, unavailable], [724, 2]);
});

test('mount moves the original data nodes once and preserves all band denominators and matrix values', () => {
  const fixture = renderedFixture(), { doc, data } = fixture, before = JSON.stringify(data);
  const ids = ['stack', 'groups', 'strip', 'axis', 'nb', 'na', 'dist', 'mx'];
  const originalNodes = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
  const matrixValues = originalNodes.mx.querySelectorAll('tr').slice(1).map(row => row.children.map(cell => cell.textContent));
  const app = mountFibDashboard(data, doc), main = doc.getElementById('fib-dashboard');
  assert.ok(app && main);
  for (const id of ids) { assert.strictEqual(doc.getElementById(id), originalNodes[id]); assert.strictEqual(originalNodes[id].closest('main'), main); }
  assert.equal(doc.getElementById('wrap').getAttribute('hidden'), '');
  assert.equal(doc.getElementById('t').getAttribute('hidden'), '');
  assert.deepEqual(originalNodes.mx.querySelectorAll('tr').slice(1).map(row => row.children.map(cell => cell.textContent)), matrixValues);
  assert.equal(main.querySelectorAll('[data-day]').length, 90);
  assert.equal(main.querySelectorAll('[data-reference]').length, 22);
  assert.equal(main.querySelectorAll('[data-fd-reference]').length, 44);
  assert.equal(main.querySelector('#fr-comparison-body').querySelectorAll('tr').length, 22);
  for (const row of buildZoneRows(data)) {
    const raw = data.distinct[row.index].rows, values = ['#1', '#2', '#7', '#8'].map(name => raw.find(level => level.name === name).price);
    assert.deepEqual([row.redLow, row.redHigh, row.blueLow, row.blueHigh], values);
    close(row.rise, (values[2] - values[1]) / values[1] * 100);
    values.forEach((value, index) => close(row.gaps[index], (value - data.price) / data.price * 100));
  }
  assert.equal(mountFibDashboard(data, doc), null);
  assert.equal(doc.body.querySelectorAll('#fib-dashboard').length, 1);
  assert.equal(doc.body.querySelectorAll('#fib-rise').length, 1);
  assert.equal(JSON.stringify(data), before);
});

test('mounted heat navigation restores a deep-linked day, maintains one tab stop and synchronizes the unchanged band module', () => {
  const fixture = renderedFixture(originalData(), '?day=90&keep=1'), { doc, data } = fixture;
  const app = mountFibDashboard(data, doc), main = doc.getElementById('fib-dashboard'), buttons = main.querySelectorAll('[data-day]');
  const assertSelection = n => {
    const detail = buildDayDetails(data, n);
    assert.deepEqual(app.getState(), { day: n, referenceIndex: detail.referenceIndex });
    assert.equal(main.querySelector('#fd-day-select').value, String(n));
    assert.equal(main.querySelector('#fr-reference').value, String(detail.referenceIndex));
    assert.equal(buttons.filter(button => button.getAttribute('tabindex') === '0').length, 1);
    assert.equal(buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(buttons[n - 1].getAttribute('aria-pressed'), 'true');
    assert.equal(new URL(doc.defaultView.location.href).searchParams.get('day'), String(n));
    assert.equal(new URL(doc.defaultView.location.href).searchParams.get('keep'), '1');
    const prices = main.querySelector('#fr-detail').querySelectorAll('b').map(node => node.textContent);
    for (const name of ['#1', '#2', '#7', '#8']) assert.ok(prices.includes(money(detail.reference.rows.find(row => row.name === name).price)));
  };
  assertSelection(90);
  assert.equal(main.querySelector('#fd-day-next').disabled, true);
  assert.equal(fixture.key(buttons[89], 'Home').defaultPrevented, true);
  assertSelection(1); assert.strictEqual(doc.activeElement, buttons[0]);
  assert.equal(main.querySelector('#fd-day-prev').disabled, true);
  fixture.key(buttons[0], 'ArrowRight'); assertSelection(2);
  fixture.key(buttons[1], 'End'); assertSelection(90);
  fixture.key(buttons[89], 'ArrowDown'); assertSelection(90);
  fixture.change(main.querySelector('#fd-day-select'), '5'); assertSelection(5);
  fixture.click(main.querySelector('#fd-day-prev')); assertSelection(4);
  fixture.click(main.querySelector('#fd-day-next')); assertSelection(5);
  assert.equal(buttons[4].tagName, 'BUTTON');
  assert.equal(buttons[4].getAttribute('type'), 'button');
  assert.equal(app.selectDay(999), null); assertSelection(5);
});

test('reference selection survives node movement and detailed actions open, focus and scroll to the correct matrix column', () => {
  const fixture = renderedFixture(), { doc, data } = fixture;
  const app = mountFibDashboard(data, doc), main = doc.getElementById('fib-dashboard');
  fixture.change(main.querySelector('#fr-reference'), '21');
  assert.deepEqual(app.getState(), { day: 73, referenceIndex: 21 });
  const compareButton = main.querySelectorAll('[data-reference]')[2];
  fixture.click(compareButton);
  assert.deepEqual(app.getState(), { day: data.distinct[2].from, referenceIndex: 2 });
  assert.equal(main.querySelector('#fr-reference').value, '2');
  fixture.click(main.querySelectorAll('[data-fd-reference]')[20]);
  assert.deepEqual(app.getState(), { day: 72, referenceIndex: 20 });
  const matrixRows = main.querySelector('#mx').querySelectorAll('tr');
  matrixRows[0].children[21].offsetLeft = 2100; matrixRows[0].children[0].offsetWidth = 100;
  fixture.click(main.querySelector('[data-fd-action="matrix"]'));
  assert.equal(main.querySelector('#mx').closest('details').open, true);
  assert.strictEqual(doc.activeElement, main.querySelector('#fd-matrix'));
  assert.equal(main.querySelector('#mx').closest('.mxwrap').scrollLeft, 2000);
  for (const row of matrixRows) { assert.equal(row.children.filter(cell => cell.classList.contains('fd-selected-column')).length, 1); assert.equal(row.children[21].classList.contains('fd-selected-column'), true); }
  assert.match(main.querySelector('#fd-announcement').textContent, /72일 매트릭스/);
  fixture.click(main.querySelector('[data-fd-action="band"]'));
  assert.strictEqual(doc.activeElement, main.querySelector('#fib-rise'));
  const url = doc.defaultView.location.href;
  fixture.click(main.querySelector('#fd-refresh'));
  assert.equal(fixture.reloads, 1); assert.equal(doc.defaultView.location.href, url);
});

test('missing legacy regions leave the original screen visible and empty day input remains operable', () => {
  const fixture = renderedFixture(), { doc, data } = fixture;
  doc.getElementById('mx').id = 'missing-matrix';
  assert.equal(mountFibDashboard(data, doc), null);
  assert.equal(doc.getElementById('wrap').getAttribute('hidden'), null);
  assert.equal(doc.getElementById('fib-dashboard'), null);
  const empty = originalData(); empty.all = []; empty.distinct = []; empty.groups = []; empty.near = [];
  const emptyFixture = renderedFixture(empty), app = mountFibDashboard(empty, emptyFixture.doc), main = emptyFixture.doc.getElementById('fib-dashboard');
  assert.deepEqual(app.getState(), { day: null, referenceIndex: -1 });
  assert.equal(main.querySelectorAll('[data-day]').length, 0);
  assert.equal(main.querySelector('#fd-day-select').disabled, true);
  assert.match(main.querySelector('#fd-day-detail').textContent, /선택할 기준일 데이터가 없습니다/);
});
