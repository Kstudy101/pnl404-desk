import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFRESH_INTERVAL, createRefreshController } from '../public/modules/board/board-model.mjs';
import { REFRESH_MS } from '../worker/providers.mjs';
import { packageFreshness } from '../worker/index.mjs';
import { enhanceFibHtml, extractFibData } from '../scripts/enhance-fib.mjs';
import { enhanceSopHtml, extractSopData } from '../scripts/enhance-sop.mjs';
import { buildRefreshPlan, runRefresh, acquireLock, executeStep, validateStaged, promoteGenerated, pruneRunArtifacts, RUN_TIMEOUT_MS } from '../scripts/refresh-all.mjs';
import { publish } from '../scripts/publish.mjs';

const HOUR = 3_600_000;
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(t) {
  const base = resolve(tmpdir()), root = mkdtempSync(join(base, 'pnl404-hourly-qa-'));
  t.after(() => { const path = relative(base, root); assert.ok(path.startsWith('pnl404-hourly-qa-') && !path.includes(sep) && resolve(root) !== base); rmSync(root, { recursive: true, force: true }); });
  const sources = { pivot: join(root, 'raw projects/pivot'), board: join(root, 'raw projects/board'), backend: join(root, 'raw projects/board/backend'), python: join(root, 'raw projects/board/backend/.venv/Scripts/python.exe') };
  const events = [], logs = [], started = Date.parse('2026-09-13T03:05:00Z');
  let clock = started, releases = 0;
  return { root, sources, events, logs, started, get releases() { return releases; }, advance(ms) { clock += ms; },
    options: { root, sources, now: () => clock, log: message => logs.push(message),
      acquire: () => { events.push('acquire'); return () => { releases++; events.push('release'); }; },
      prepare: () => events.push('prepare'),
      execute: async step => { events.push(step.id); return { code: 0 }; },
      validate: () => { events.push('validate'); return { items: 1, generated_at: new Date(clock).toISOString() }; },
      promote: () => { events.push('promote'); return { files: 1 }; },
    },
  };
}

test('the browser controller and server freshness share one hour, including the exact expiration boundary', async () => {
  assert.equal(REFRESH_INTERVAL, HOUR);
  assert.equal(REFRESH_MS, HOUR);
  const started = Date.parse('2026-09-13T03:05:00Z'), snapshot = { generated_at: new Date(started).toISOString(), stale: false };
  let now = started, calls = 0;
  const controller = createRefreshController(async () => { calls++; }, { now: () => now });
  now += HOUR - 1;
  assert.equal(packageFreshness(snapshot, now), false);
  await controller.tick(); assert.equal(calls, 0);
  now++;
  assert.equal(packageFreshness(snapshot, now), true);
  await controller.tick(); assert.equal(calls, 1);
  assert.equal(controller.nextRefreshAt, now + HOUR);
  assert.equal(packageFreshness({ ...snapshot, stale: true }, started), true);
  assert.equal(packageFreshness({ generated_at: null }, started), true);
});

test('both enhancers migrate old or absent reload metadata to one hourly tag while preserving newly generated data', () => {
  for (const [enhance, extract, base] of [
    [enhanceFibHtml, extractFibData, { symbol: 'BTCUSDT', price: 123.45, now: 1789268700000 }],
    [enhanceSopHtml, extractSopData, { symbols: [], dist: { buckets: [] }, now: 1789268700000 }],
  ]) {
    for (const meta of ['', '<meta http-equiv="refresh" content="300">', "<META content='600' HTTP-EQUIV='refresh'>", '<meta http-equiv="refresh" content="300"><meta http-equiv="refresh" content="600">']) {
      const data = { ...base, label: '원본 수집 시각과 새 가격 123.45 보존', nested: { note: '레드존 { } \\"' } }, literal = JSON.stringify(data);
      const html = '<html><head>' + meta + '</head><body><table id="mx"></table><script>const D=' + literal + ';</script></body></html>';
      const enhanced = enhance(html), head = enhanced.match(/<head>([\s\S]*?)<\/head>/i)[1];
      const refresh = head.match(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*>/gi) || [];
      assert.equal(refresh.length, 1, meta || 'absent refresh tag');
      assert.match(refresh[0], /content=["']3600["']/i);
      assert.equal(extract(enhanced).literal, literal);
      assert.equal(enhance(enhanced), enhanced);
    }
  }
});

test('published reload metadata and scheduler configurations express one hourly owner', () => {
  for (const module of ['fib', 'sop']) {
    const head = read('public/modules/' + module + '/index.html').split('</head>')[0];
    assert.match(head, /http-equiv=["']refresh["']\s+content=["']3600["']/i);
  }
  const cloudflare = read('wrangler.toml'), workflow = read('.github/workflows/refresh-markets.yml');
  assert.match(cloudflare, /crons\s*=\s*\["5 \* \* \* \*"\]/);
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+schedule:/m, 'market-only remote publishing must not race the local all-module owner');
  const deployment = read('.github/workflows/deploy.yml');
  assert.match(deployment, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(deployment, /^\s+(?:push|schedule):/m, 'a code push must not overwrite fresher hourly assets with checked-in snapshots');
});

test('the plan uses the configured checkout and raw projects with staged outputs and a pinned deploy command', t => {
  const f = fixture(t), stageRoot = join(f.root, 'staged');
  const plan = buildRefreshPlan({ root: f.root, stageRoot, sources: f.sources, deploy: true });
  assert.deepEqual(plan.map(step => step.id), ['sources', 'fib', 'sop', 'markets', 'publish', 'deploy']);
  assert.ok(plan.every(step => step.timeoutMs > 0 && step.timeoutMs <= RUN_TIMEOUT_MS));
  assert.equal(plan[1].cwd, f.sources.pivot); assert.equal(plan[2].cwd, f.sources.pivot);
  assert.ok(plan[1].args.includes('--out=' + resolve(stageRoot, 'raw/fib.html')));
  assert.ok(plan[2].args.includes('--out=' + resolve(stageRoot, 'raw/sop.html')));
  for (const id of ['markets', 'publish', 'deploy']) assert.equal(plan.find(step => step.id === id).cwd, f.root);
  const markets = plan.find(step => step.id === 'markets'), publishing = plan.find(step => step.id === 'publish');
  assert.equal(markets.args[markets.args.indexOf('--output') + 1], resolve(stageRoot, 'public/modules/board/markets.json'));
  assert.equal(publishing.args[publishing.args.indexOf('--output-root') + 1], stageRoot);
  assert.deepEqual(markets.allowedCodes, [0, 2]); assert.deepEqual(publishing.allowedCodes, [0, 2]);
  assert.ok(plan.at(-1).args.includes('wrangler@4.131.1'));
  assert.ok(plan.every(step => !JSON.stringify(step).includes('Desktop/pnl404-desk')));
});

test('successful and partial runs validate before promotion and deployment and persist truthful final status', async t => {
  for (const partialStage of [null, 'markets', 'publish']) {
    const f = fixture(t);
    const state = await runRefresh({ ...f.options, deploy: true, execute: async step => { f.events.push(step.id); return { code: step.id === partialStage ? 2 : 0 }; } });
    assert.deepEqual(f.events, ['acquire', 'prepare', 'sources', 'fib', 'sop', 'markets', 'publish', 'validate', 'promote', 'deploy', 'release']);
    assert.equal(state.status, partialStage ? 'partial' : 'complete');
    assert.equal(state.exitCode, partialStage ? 2 : 0); assert.equal(state.deployed, true); assert.equal(f.releases, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, '_workspace/hourly-refresh/latest.json'), 'utf8')), state);
    assert.ok(f.logs.some(line => line.includes('RESULT ' + state.status)));
    if (partialStage) assert.ok(f.logs.some(line => line.includes('PARTIAL ' + partialStage)));
  }
});

test('every failed producer, signal or timeout stops before validation, promotion and deployment', async t => {
  for (const [stage, result] of [...['sources', 'fib', 'sop', 'markets', 'publish'].map(id => [id, { code: 1 }]), ['markets', { code: 0, timedOut: true }], ['publish', { code: 0, signal: 'SIGTERM' }]]) {
    const f = fixture(t);
    const state = await runRefresh({ ...f.options, deploy: true, execute: async step => { f.events.push(step.id); return step.id === stage ? result : { code: 0 }; } });
    assert.equal(state.status, 'failed'); assert.equal(state.exitCode, 1); assert.equal(state.deployed, false);
    assert.ok(state.error.includes(stage)); assert.equal(state.steps.at(-1).id, stage);
    assert.ok(!f.events.some(event => ['validate', 'promote', 'deploy'].includes(event))); assert.equal(f.releases, 1);
  }
});

test('invalid staged output, preparation failure and total deadline prevent publication and always release the lock', async t => {
  for (const phase of ['prepare', 'validate', 'deadline']) {
    const f = fixture(t), overrides = {};
    if (phase === 'deadline') overrides.execute = async step => { f.events.push(step.id); f.advance(RUN_TIMEOUT_MS); return { code: 0 }; };
    else overrides[phase] = () => { f.events.push(phase); throw new Error('fixture ' + phase + ' failure'); };
    const state = await runRefresh({ ...f.options, ...overrides, deploy: true });
    assert.equal(state.status, 'failed'); assert.equal(state.deployed, false); assert.equal(f.releases, 1);
    assert.ok(!f.events.includes('promote')); assert.ok(!f.events.includes('deploy'));
  }
  const f = fixture(t), state = await runRefresh({ ...f.options, deploy: true, execute: async step => { f.events.push(step.id); return { code: step.id === 'deploy' ? 7 : 0 }; } });
  assert.equal(state.status, 'failed'); assert.equal(state.deployed, false); assert.match(state.error, /deploy/); assert.equal(f.releases, 1);
});

test('lock ownership blocks overlap without expiring a live owner or deleting another run lock', async t => {
  const f = fixture(t), metadata = { runId: 'first', started_at: '2000-01-01T00:00:00Z' }, release = acquireLock(f.root, metadata);
  const path = join(f.root, '_workspace/hourly-refresh/refresh.lock'), original = readFileSync(path, 'utf8');
  assert.throws(() => acquireLock(f.root, { runId: 'second' }), /already running/);
  const state = await runRefresh({ ...f.options, acquire: acquireLock, deploy: true });
  assert.equal(state.status, 'skipped'); assert.equal(state.exitCode, 3);
  assert.deepEqual(f.events, []); assert.equal(readFileSync(path, 'utf8'), original);
  writeFileSync(path, JSON.stringify({ pid: process.pid, runId: 'replacement' }));
  release(); assert.equal(existsSync(path), true);
});

test('a failure to create the run log directory still releases an acquired lock', async t => {
  const f = fixture(t), runId = new Date(f.started).toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const directory = join(f.root, '_workspace/hourly-refresh/runs', runId);
  mkdirSync(dirname(directory), { recursive: true }); writeFileSync(directory, 'not a directory');
  await runRefresh(f.options).catch(() => {});
  assert.equal(f.releases, 1);
});

test('the actual child runner reports process output and nonzero exit without shell interpretation', async t => {
  const f = fixture(t), output = [];
  const result = await executeStep({ id: 'fixture', command: process.execPath, args: ['-e', 'console.log("fixture output");process.exitCode=7'], cwd: f.root, timeoutMs: 5000 }, { log: line => output.push(line) });
  assert.equal(result.code, 7); assert.equal(result.timedOut, false); assert.ok(output.join('').includes('fixture output'));
});

test('staged validation rejects newly copied old source timestamps and changed published data', t => {
  const f = fixture(t), stageRoot = join(f.root, 'staged'), startedAt = Date.now();
  const write = (path, value) => { const target = join(stageRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); };
  const html = data => '<html><head></head><body><script>const D=' + JSON.stringify(data) + ';</script></body></html>';
  const install = (fib, sop) => { for (const [name, data] of [['fib', fib], ['sop', sop]]) { write('raw/' + name + '.html', html(data)); write('public/modules/' + name + '/index.html', html(data)); } };
  install({ now: startedAt - HOUR }, { symbols: [{ now: startedAt }] });
  assert.throws(() => validateStaged({ root: f.root, stageRoot, startedAt }), /fib.*stale source timestamps/);
  install({ now: startedAt }, { symbols: [{ now: startedAt }, { now: startedAt - HOUR }] });
  assert.throws(() => validateStaged({ root: f.root, stageRoot, startedAt }), /sop.*stale source timestamps/);
  install({ now: startedAt, price: 100 }, { symbols: [{ now: startedAt }] });
  write('public/modules/fib/index.html', html({ now: startedAt, price: 101 }));
  assert.throws(() => validateStaged({ root: f.root, stageRoot, startedAt }), /Published fib data differs/);
});

test('actual staged artifact validation accepts valid contracts but blocks malformed market data before promotion', t => {
  const f = fixture(t), stageRoot = join(f.root, 'staged');
  cpSync(join(sourceRoot, 'public'), join(stageRoot, 'public'), { recursive: true });
  mkdirSync(join(stageRoot, 'raw'), { recursive: true });
  const fib = readFileSync(join(stageRoot, 'public/modules/fib/index.html'), 'utf8'), sop = readFileSync(join(stageRoot, 'public/modules/sop/index.html'), 'utf8');
  writeFileSync(join(stageRoot, 'raw/fib.html'), fib); writeFileSync(join(stageRoot, 'raw/sop.html'), sop);
  const snapshotPath = join(stageRoot, 'public/modules/board/markets.json'), snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const startedAt = Math.min(extractFibData(fib).data.now, ...extractSopData(sop).data.symbols.map(item => item.now), Date.parse(snapshot.generated_at));
  assert.equal(validateStaged({ root: sourceRoot, stageRoot, startedAt }).items, snapshot.items.length);
  snapshot.items[0].momentum.periods['7'].return_pct = 123456;
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  assert.throws(() => validateStaged({ root: sourceRoot, stageRoot, startedAt }), /momentum/);
});

test('promotion changes generated files only and restores earlier files when a later replacement fails', t => {
  for (const fail of [false, true]) {
    const f = fixture(t), stageRoot = join(f.root, 'staged'), runDirectory = join(f.root, 'run');
    const generated = ['modules/fib/index.html', 'modules/sop/index.html', 'modules/board/signal_config.json', 'modules/board/data.json', 'modules/board/markets.json', 'modules/board/history/us_TEST.json'];
    const write = (base, path, contents) => { const target = join(base, 'public', path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, contents); };
    for (const name of generated) { write(f.root, name, 'old ' + name); if (!fail || name !== 'modules/board/markets.json') write(stageRoot, name, 'new ' + name); }
    write(f.root, 'modules/fib/dashboard-view.mjs', 'current code'); write(stageRoot, 'modules/fib/dashboard-view.mjs', 'old staged code');
    if (fail) assert.throws(() => promoteGenerated({ root: f.root, stageRoot, runDirectory }));
    else assert.equal(promoteGenerated({ root: f.root, stageRoot, runDirectory }).files, generated.length);
    for (const name of generated) assert.equal(readFileSync(join(f.root, 'public', name), 'utf8'), (fail ? 'old ' : 'new ') + name);
    assert.equal(readFileSync(join(f.root, 'public/modules/fib/dashboard-view.mjs'), 'utf8'), 'current code');
  }
});

test('publishing retains failed legacy bytes with partial status and leaves every published file intact when no valid prior snapshot exists', t => {
  const f = fixture(t), raw = join(f.root, 'raw'), outputRoot = join(f.root, 'output');
  mkdirSync(raw); mkdirSync(f.sources.board, { recursive: true });
  writeFileSync(join(f.root, 'source-projects.json'), JSON.stringify({ pivot: f.sources.pivot, board: f.sources.board }));
  writeFileSync(join(f.sources.board, 'signal_config.json'), '{}');
  const fibInput = join(raw, 'fib.html'), sopInput = join(raw, 'sop.html');
  writeFileSync(fibInput, '<html><head></head><body><table id="mx"></table><script>const D={"price":123,"now":1789268700000};</script></body></html>');
  writeFileSync(sopInput, '<html><head></head><body><script>const D={"symbols":[],"dist":{"buckets":[]}};</script></body></html>');
  const oldPath = join(outputRoot, 'public/modules/board/data.json'), oldBytes = '{"generated_at":"2026-09-12T00:00:00Z","items":[]}\n';
  mkdirSync(dirname(oldPath), { recursive: true }); writeFileSync(oldPath, oldBytes);
  const logs = [], result = publish({ root: f.root, outputRoot, fibInput, sopInput, log: value => logs.push(value) });
  assert.equal(result.status, 'partial'); assert.equal(result.exitCode, 2); assert.equal(result.legacy, 'retained');
  assert.equal(readFileSync(oldPath, 'utf8'), oldBytes); assert.ok(logs.some(value => value.includes('PARTIAL legacy')));
  assert.equal(extractFibData(readFileSync(join(outputRoot, 'public/modules/fib/index.html'), 'utf8')).data.price, 123);
  const emptyOutput = join(f.root, 'empty-output');
  assert.throws(() => publish({ root: f.root, outputRoot: emptyOutput, fibInput, sopInput, log() {} }), /no prior snapshot/);
  assert.equal(existsSync(join(emptyOutput, 'public/modules/fib/index.html')), false);
  assert.equal(existsSync(join(emptyOutput, 'public/modules/sop/index.html')), false);
});

test('retention removes only old completed artifact folders while keeping active runs, logs and junction targets', t => {
  const f = fixture(t), runs = join(f.root, '_workspace/hourly-refresh/runs');
  for (let index = 0; index <= 6; index++) {
    const directory = join(runs, 'run' + index);
    for (const folder of ['staged', 'previous']) { mkdirSync(join(directory, folder), { recursive: true }); writeFileSync(join(directory, folder, 'artifact'), 'fixture'); }
    writeFileSync(join(directory, 'run.log'), 'keep log');
    writeFileSync(join(directory, 'status.json'), JSON.stringify({ runId: 'run' + index, status: index === 6 ? 'running' : index % 2 ? 'partial' : 'complete', finished_at: new Date(f.started + index * 1000).toISOString() }));
  }
  const outside = join(f.root, 'unrelated-data'); mkdirSync(outside); writeFileSync(join(outside, 'keep'), 'never delete');
  const linked = join(runs, 'run2/staged'); rmSync(linked, { recursive: true });
  symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const result = pruneRunArtifacts({ root: f.root, activeRunId: 'run1', keep: 3 });
  assert.deepEqual(result.retained, ['run5', 'run4', 'run3']);
  assert.equal(result.removed.length, 3);
  for (const id of ['run1', 'run3', 'run4', 'run5', 'run6']) assert.equal(existsSync(join(runs, id, 'staged/artifact')), true);
  assert.equal(existsSync(join(runs, 'run0/staged')), false); assert.equal(existsSync(join(runs, 'run0/previous')), false);
  assert.equal(readFileSync(join(runs, 'run0/run.log'), 'utf8'), 'keep log'); assert.equal(existsSync(join(runs, 'run0/status.json')), true);
  assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'never delete'); assert.equal(existsSync(linked), true);
});

test('cleanup failures remain explicit warnings and cannot mislabel a successful collection or retain its lock', async t => {
  const f = fixture(t), state = await runRefresh({ ...f.options, cleanup() { throw new Error('fixture cleanup failure'); } });
  assert.equal(state.status, 'complete'); assert.equal(state.exitCode, 0); assert.equal(f.releases, 1);
  assert.match(state.retention_error, /fixture cleanup failure/);
  assert.ok(f.logs.some(line => line.includes('WARN') && line.includes('cleanup')));
});
