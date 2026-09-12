/** Validate published Python data without network access or recalculation. */
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateMarketArtifacts(snapshot, readHistory, {requireMomentum = false} = {}) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(snapshot?.collector === 'python-finance-packages', 'Python collector snapshot required');
  check(timestamp(snapshot?.generated_at), 'Invalid generated_at');
  check(Array.isArray(snapshot?.items) && snapshot.items.length > 0, 'Empty market snapshot');
  if (requireMomentum) {
    check(JSON.stringify(snapshot?.momentum_config?.windows) === '[7,14,21,28]' && snapshot.momentum_config.default_window === 7, 'Invalid momentum windows');
    check(timestamp(snapshot.momentum_calculated_at), 'Invalid momentum calculation timestamp');
  }
  const ids = new Set();
  for (const item of snapshot?.items || []) {
    const validId = /^(us|kr|jp|crypto):[A-Za-z0-9][A-Za-z0-9.^=-]{0,90}$/.test(item.id);
    check(validId && item.id.startsWith(`${item.market}:`), `Invalid ID ${item.id}`);
    check(!ids.has(item.id), `Duplicate ID ${item.id}`);
    ids.add(item.id);
    check(item.price === null || finite(item.price) && item.price >= 0, `${item.id}: invalid price`);
    check(timestamp(item.fetched_at) && timestamp(item.updated_at), `${item.id}: invalid source timestamps`);
    if (!validId) continue;
    const momentum = item.momentum;
    if (requireMomentum) check(Boolean(momentum), `${item.id}: missing momentum`);
    let history;
    try {
      const needsHistory = item.market !== 'crypto' && item.price_basis === 'daily_close' ||
        Object.values(momentum?.periods || {}).some(period => period.status === 'ok');
      if (needsHistory) {
        history = readHistory(item.id.replace(':', '_') + '.json');
        check(history.id === item.id && history.currency === item.currency, `${item.id}: history identity mismatch`);
        check(Array.isArray(history.points) && history.points.length > 0, `${item.id}: empty history`);
        let previous = -Infinity;
        for (const point of history.points || []) {
          const current = Date.parse(point.time);
          check(Number.isFinite(current) && current > previous && current <= Date.parse(history.fetched_at || item.fetched_at) && finite(point.value) && point.value > 0, `${item.id}: invalid or unordered observation`);
          previous = current;
        }
        const last = history.points?.at(-1);
        if (item.market !== 'crypto') check(last?.value === item.price && last?.time === item.updated_at, `${item.id}: latest history and quote disagree`);
      }
    } catch (error) {
      check(false, `${item.id}: unreadable history (${error.message})`);
    }
    if (!momentum) continue;
    check(momentum.basis === (item.market === 'crypto' ? 'calendar_days' : 'trading_days') && momentum.price_basis === 'daily_close', `${item.id}: invalid momentum basis`);
    check(timestamp(momentum.calculated_at) && typeof momentum.stale === 'boolean', `${item.id}: invalid momentum metadata`);
    const verifyWindow = (period, days, label) => {
      const prefix = `${item.id}: ${label}`;
      check(period && ['ok','insufficient','gap','invalid'].includes(period.status), `${prefix}: unknown momentum status`);
      if (!period) return;
      check(period.sessions === days && period.required_observations === days + 1, `${prefix}: incorrect observation requirement`);
      if (period.status !== 'ok') {
        check(['return_pct','direction','start_close','end_close'].every(key => period[key] === null), `${prefix}: unavailable momentum has a value`);
        return;
      }
      const expected = (period.end_close / period.start_close - 1) * 100;
      check(finite(period.start_close) && period.start_close > 0 && finite(period.end_close) && period.end_close > 0 && finite(period.return_pct) && Math.abs(period.return_pct - expected) < 1e-9, `${prefix}: incorrect momentum return`);
      check(period.direction === (expected > 0 ? 'up' : expected < 0 ? 'down' : 'flat'), `${prefix}: incorrect direction`);
      const points = history?.points?.filter(point => Date.parse(point.time) >= Date.parse(period.start_at) && Date.parse(point.time) <= Date.parse(period.end_at)) || [];
      check(period.observations === days + 1 && points.length === days + 1 && points[0]?.value === period.start_close && points.at(-1)?.value === period.end_close, `${prefix}: momentum and history disagree`);
      if (item.market === 'crypto') check(points.every((point, index) => !index || Date.parse(point.time) - Date.parse(points[index - 1].time) === 86400000), `${prefix}: crypto calendar gap`);
    };
    for (const days of [7,14,21,28]) verifyWindow(momentum.periods?.[days], days, `${days} days`);
    check(Array.isArray(momentum.blocks) && momentum.blocks.length === 4, `${item.id}: four momentum blocks required`);
    for (const [index, block] of (momentum.blocks || []).entries()) verifyWindow(block, 7, `block ${index + 1}`);
  }
  const crypto = snapshot?.items?.filter(item => item.market === 'crypto') || [];
  if (crypto.length) check(crypto.length === 100 && new Set(crypto.map(item => item.market_cap_rank)).size === 100 && crypto.every(item => Number.isInteger(item.market_cap_rank) && item.market_cap_rank >= 1 && item.market_cap_rank <= 100), 'Crypto top100 is incomplete');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = resolve(root, 'public/modules/board');
    const snapshot = JSON.parse(readFileSync(resolve(directory, 'markets.json'), 'utf8'));
    const errors = validateMarketArtifacts(snapshot, name => JSON.parse(readFileSync(resolve(directory, 'history', name), 'utf8')), {requireMomentum: true});
    if (errors.length) throw new Error(errors.slice(0, 20).join('\n'));
    console.log(`PASS: ${snapshot.items.length} market items, daily histories and 7/14/21/28 momentum contracts`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
