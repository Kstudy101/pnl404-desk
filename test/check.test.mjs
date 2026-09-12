import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkProject } from "../scripts/check.mjs";
import { resolveSources } from "../scripts/source-paths.mjs";
import { enhanceFibHtml } from "../scripts/enhance-fib.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsOnly = { harness: false, assets: true };
const sourcesOnly = { harness: false, assets: false, sources: true };

function fixture(t) {
  const base = resolve(tmpdir());
  const sandbox = mkdtempSync(join(base, "pnl404-check-"));
  const root = join(sandbox, "repo");
  mkdirSync(root);
  for (const path of ["public", ".claude", "docs", "AGENTS.md", "CLAUDE.md"]) {
    cpSync(join(sourceRoot, path), join(root, path), { recursive: true });
  }
  writeFileSync(join(root, "source-projects.json"), JSON.stringify({
    pivot: join(sandbox, "Desktop/피봇스윙매매"),
    board: join(sandbox, "Desktop/스윙전광판"),
  }));
  t.after(() => {
    // Only remove this test's verified, uniquely created temporary directory.
    const rel = relative(base, sandbox);
    assert.ok(rel.startsWith("pnl404-check-") && !rel.includes(sep) && resolve(sandbox) !== base);
    rmSync(sandbox, { recursive: true, force: true });
  });
  return root;
}

function modifyJson(root, path, change) {
  const full = join(root, path);
  const value = JSON.parse(readFileSync(full, "utf8"));
  change(value);
  writeFileSync(full, JSON.stringify(value));
}

const dataPath = "public/modules/board/data.json";
const configPath = "public/modules/board/signal_config.json";

test("checked-in harness and assets pass without rewriting the snapshot", (t) => {
  const root = fixture(t);
  const before = readFileSync(join(root, dataPath));
  assert.deepEqual(checkProject(root).errors, []);
  assert.deepEqual(readFileSync(join(root, dataPath)), before);
});

test("broken tab target is reported even when the old iframe still exists", (t) => {
  const root = fixture(t), path = join(root, "public/index.html");
  writeFileSync(path, readFileSync(path, "utf8").replace('src: "/modules/fib/index.html"', 'src: "/modules/missing/index.html"'));
  assert.ok(checkProject(root, assetsOnly).errors.some((e) => e.includes("missing link target: /modules/missing/index.html")));
});

test("a broken entrypoint skill link fails the harness check", (t) => {
  const root = fixture(t), path = join(root, "AGENTS.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(".claude/skills/pnl404-orchestrator/SKILL.md", ".claude/skills/missing/SKILL.md"));
  assert.ok(checkProject(root, { assets: false }).errors.some((e) => e.includes("AGENTS.md: missing link target")));
});

test("removing all routing links does not silently disconnect the harness", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "AGENTS.md"), "# Local instructions without a route\n");
  const agent = join(root, ".claude/agents/pnl404-ui.md");
  writeFileSync(agent, readFileSync(agent, "utf8").replace(/\[pnl404-ui\]\([^)]+\)/, "pnl404-ui"));
  const { errors } = checkProject(root, { assets: false });
  assert.ok(errors.some((e) => e.includes("missing orchestrator entrypoint link")));
  assert.ok(errors.some((e) => e.includes("agent has no linked skill")));
});

test("malformed description quotes fail local frontmatter validation", (t) => {
  const root = fixture(t), path = join(root, ".claude/skills/pnl404-ui/SKILL.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/^description: .*$/m, 'description: "unterminated'));
  assert.ok(checkProject(root, { assets: false }).errors.some((e) => e.includes("double-quoted single-line string")));
});

test("malformed JSON and invalid classic JavaScript are both reported", (t) => {
  const root = fixture(t), path = join(root, "public/index.html");
  writeFileSync(join(root, dataPath), "{");
  writeFileSync(path, readFileSync(path, "utf8").replace("const TABS =", "const ="));
  const { errors } = checkProject(root, assetsOnly);
  assert.ok(errors.some((e) => e.includes("invalid JSON")));
  assert.ok(errors.some((e) => e.includes("inline script")));
});

test("numeric strings in detail points fail before the UI calls toFixed", (t) => {
  const root = fixture(t);
  modifyJson(root, dataPath, (data) => { Object.values(data.details)[0].components[0].points_long = "1.5"; });
  assert.ok(checkProject(root, assetsOnly).errors.some((e) => e.includes("numeric points")));
});

test("legacy snapshots without details and empty snapshots remain supported", (t) => {
  const root = fixture(t);
  modifyJson(root, dataPath, (data) => { delete data.details; });
  assert.deepEqual(checkProject(root, assetsOnly).errors, []);
  modifyJson(root, dataPath, (data) => { data.items = []; data.universe_size = 0; });
  const result = checkProject(root, assetsOnly);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((line) => line.includes("empty snapshot")));
});

test("unknown band and duplicate symbol expose data/display mismatch", (t) => {
  const root = fixture(t);
  modifyJson(root, dataPath, (data) => { data.items[0].band = "missing-band"; data.items.push(data.items[0]); });
  const { errors } = checkProject(root, assetsOnly);
  assert.ok(errors.some((e) => e.includes("absent from display.color_bands")));
  assert.ok(errors.some((e) => e.includes("unique")));
});

test("malformed collection settings report errors without crashing the checker", (t) => {
  const root = fixture(t);
  modifyJson(root, configPath, (cfg) => { cfg.display.color_bands = [null]; cfg.display.sort.options = {}; });
  modifyJson(root, dataPath, (data) => { data.items = {}; data.details = []; });
  const result = checkProject(root, assetsOnly);
  assert.ok(result.errors.some((e) => e.includes("invalid color band")));
  assert.ok(result.errors.some((e) => e.includes("items must be an array")));
  assert.ok(result.errors.some((e) => e.includes("details must be an object")));
});

test("missing refresh sources fail separately from valid static assets", (t) => {
  const root = fixture(t);
  assert.deepEqual(checkProject(root).errors, []);
  const result = checkProject(root, sourcesOnly);
  assert.equal(result.errors.filter((e) => e.includes("missing publish input")).length, 3);
  assert.ok(result.warnings.some((e) => e.includes("Snapshot refresh unavailable")));
  assert.equal(existsSync(resolveSources(root).pivot), false);
});

test("source checks warn about snapshot reuse without running a producer", (t) => {
  const root = fixture(t);
  const raw = resolveSources(root);
  for (const path of [raw.fibHtml, raw.sopHtml, raw.signalConfig]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "fixture input only");
  }
  const before = readFileSync(join(root, dataPath));
  const result = checkProject(root, sourcesOnly);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((line) => line.includes("reuse existing data.json")));
  assert.deepEqual(readFileSync(join(root, dataPath)), before);
});

test("publish uses configured raw projects from an unrelated working directory", (t) => {
  const root = fixture(t), raw = resolveSources(root);
  mkdirSync(join(root, "scripts"));
  for (const script of ["publish.mjs", "source-paths.mjs", "enhance-fib.mjs"]) cpSync(join(sourceRoot, "scripts", script), join(root, "scripts", script));
  const copies = [
    [raw.fibHtml, "public/modules/fib/index.html", '<html><head></head><body>configured fib<table id="mx"></table><script>const D={};</script></body></html>'],
    [raw.sopHtml, "public/modules/sop/index.html", "configured sop"],
    [raw.signalConfig, "public/modules/board/signal_config.json", "configured board config"],
  ];
  for (const [path, , content] of copies) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const before = readFileSync(join(root, dataPath));
  const result = spawnSync(process.execPath, [join(root, "scripts/publish.mjs")], { cwd: dirname(root), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  for (const [input, output, content] of copies) {
    assert.equal(readFileSync(join(root, output), "utf8"), input === raw.fibHtml ? enhanceFibHtml(content) : content);
    assert.equal(readFileSync(input, "utf8"), content);
  }
  assert.deepEqual(readFileSync(join(root, dataPath)), before);
});

test("relative source configuration is rooted at the checkout", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "source-projects.json"), JSON.stringify({ pivot: "../Desktop/피봇스윙매매", board: "../Desktop/스윙전광판" }));
  const raw = resolveSources(root);
  assert.equal(raw.pivot, resolve(root, "../Desktop/피봇스윙매매"));
  assert.equal(raw.backend, resolve(root, "../Desktop/스윙전광판/backend"));
});

test("invalid source configuration fails rather than falling back to a sibling project", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "source-projects.json"), JSON.stringify({ pivot: "../Desktop/피봇스윙매매", board: "" }));
  assert.ok(checkProject(root, sourcesOnly).errors.some((e) => e.includes("board must be a nonempty path")));
});

test("unknown command-line flags fail instead of silently skipping checks", () => {
  const result = spawnSync(process.execPath, [join(sourceRoot, "scripts/check.mjs"), "--asset"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
