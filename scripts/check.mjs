/** Offline harness and static-asset checks. Does not refresh data or deploy. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { resolveSources } from "./source-paths.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string" && value.length > 0;
const external = (value) => /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);

function filesUnder(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : entry.isFile() ? [child] : [];
  });
}

export function checkProject(root = ROOT, { harness = true, assets = true, sources = false } = {}) {
  root = resolve(root);
  const errors = [], warnings = [], info = [];
  const error = (path, message) => errors.push(`${path}: ${message}`);
  const requireThat = (condition, path, message) => { if (!condition) error(path, message); };
  const read = (path) => {
    try { return readFileSync(resolve(root, path), "utf8"); }
    catch (e) { error(path, e.code || e.message); return null; }
  };
  const json = (path) => {
    const text = read(path);
    if (text === null) return null;
    try { return JSON.parse(text); }
    catch (e) { error(path, `invalid JSON (${e.message})`); return null; }
  };
  const localLink = (from, link, base, allowDirectoryIndex) => {
    if (!link || external(link)) return;
    try {
      const clean = decodeURIComponent(link.split(/[?#]/)[0]);
      if (!clean) return;
      const target = clean.startsWith("/")
        ? resolve(base, `.${clean}`) : resolve(dirname(from), clean);
      const rel = relative(base, target);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        error(relative(root, from), `link escapes allowed root: ${link}`);
        return;
      }
      const candidate = allowDirectoryIndex && existsSync(target) && statSync(target).isDirectory()
        ? join(target, "index.html") : target;
      requireThat(existsSync(candidate), relative(root, from), `missing link target: ${link}`);
    } catch (e) { error(relative(root, from), `invalid link ${link} (${e.message})`); }
  };

  if (harness) {
    const orchestrator = join(root, ".claude/skills/pnl404-orchestrator/SKILL.md");
    const agentFiles = filesUnder(join(root, ".claude/agents")).filter((p) => p.endsWith(".md"));
    const skillFiles = filesUnder(join(root, ".claude/skills")).filter((p) => p.endsWith(`${sep}SKILL.md`));
    requireThat(agentFiles.length > 0, ".claude/agents", "no agent definitions");
    requireThat(skillFiles.length > 0, ".claude/skills", "no skill definitions");
    const documents = new Set([
      ...filesUnder(join(root, ".claude")).filter((p) => p.endsWith(".md")),
      join(root, "AGENTS.md"), join(root, "CLAUDE.md"),
      orchestrator,
    ]);
    for (const file of documents) {
      const path = relative(root, file), text = read(path);
      if (text === null) continue;
      const linkedFiles = [];
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        localLink(file, match[1], root, false);
        if (!external(match[1])) linkedFiles.push(resolve(dirname(file), match[1].split(/[?#]/)[0]));
      }
      if ([join(root, "AGENTS.md"), join(root, "CLAUDE.md")].includes(file)) {
        requireThat(linkedFiles.includes(orchestrator), path, "missing orchestrator entrypoint link");
      }
      if (file === orchestrator) {
        for (const agent of agentFiles) requireThat(linkedFiles.includes(agent), path, `unregistered agent: ${relative(root, agent)}`);
      }
      if (agentFiles.includes(file)) requireThat(linkedFiles.some((p) => skillFiles.includes(p)), path, "agent has no linked skill");
      if (!agentFiles.includes(file) && !skillFiles.includes(file)) continue;
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!frontmatter) { error(path, "missing frontmatter"); continue; }
      // Project convention: single-line name/description (not a general YAML parser).
      const name = frontmatter[1].match(/^name: ([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m)?.[1];
      const description = frontmatter[1].match(/^description: (.+)$/m)?.[1]?.trim();
      const expected = skillFiles.includes(file) ? dirname(file).split(sep).at(-1) : file.split(sep).at(-1).slice(0, -3);
      requireThat(name === expected && name.length < 64, path, "name must match file/folder (under 64 characters)");
      let validDescription = false;
      try { validDescription = string(JSON.parse(description)); } catch { /* Report the local scalar convention below. */ }
      requireThat(validDescription, path, "description must be a nonempty, double-quoted single-line string");
      if (agentFiles.includes(file)) requireThat(/^model: (?:opus|"opus")\s*$/m.test(frontmatter[1]), path, "Claude agent must declare model: opus");
      if (skillFiles.includes(file)) requireThat(text.split(/\r?\n/).length <= 500, path, "move long skill details into references");
    }
    info.push(`Harness: ${agentFiles.length} agents, ${skillFiles.length} skills`);
  }

  if (assets) {
    const publicRoot = join(root, "public");
    const htmlFiles = filesUnder(publicRoot).filter((p) => extname(p) === ".html");
    requireThat(htmlFiles.length > 0, "public", "no HTML assets");
    for (const file of htmlFiles) {
      const path = relative(root, file), text = read(path);
      if (text === null) continue;
      for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        localLink(file, match[1], publicRoot, true);
      }
      let scriptIndex = 0;
      for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        scriptIndex++;
        const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
        if (type === "module") { warnings.push(`${path}: module script ${scriptIndex} needs a browser syntax check`); continue; }
        if (type && !["text/javascript", "application/javascript"].includes(type)) continue;
        try { new Script(match[2], { filename: `${path}#script-${scriptIndex}` }); }
        catch (e) { error(path, `inline script ${scriptIndex}: ${e.message}`); }
      }
    }
    const shell = read("public/index.html");
    if (shell !== null) {
      for (const match of shell.matchAll(/\bsrc\s*:\s*["']([^"']+)["']/g)) {
        localLink(join(publicRoot, "index.html"), match[1], publicRoot, true);
      }
    }
    const boardHtml = read("public/modules/board/index.html");
    if (boardHtml !== null) {
      for (const match of boardHtml.matchAll(/\bfetch\(\s*["']([^"']+)["']/g)) {
        localLink(join(publicRoot, "modules/board/index.html"), match[1], publicRoot, false);
      }
    }
    const dataPath = "public/modules/board/data.json", configPath = "public/modules/board/signal_config.json";
    const data = json(dataPath), cfg = json(configPath);
    requireThat(object(data), dataPath, "expected a snapshot object");
    requireThat(object(cfg?.display), configPath, "expected display settings");
    if (object(data) && object(cfg?.display)) {
      const display = cfg.display, bands = display.color_bands;
      requireThat(Array.isArray(bands) && bands.length > 0, configPath, "display.color_bands must be a nonempty array");
      for (const key of ["sort", "filter"]) {
        requireThat(Array.isArray(display[key]?.options) && display[key].options.every(string), configPath, `display.${key}.options must be a string array`);
      }
      requireThat(object(display.tile?.direction_arrow), configPath, "display.tile.direction_arrow must be an object");
      const validBands = Array.isArray(bands) ? bands.filter(object) : [];
      for (const [i, band] of (Array.isArray(bands) ? bands : []).entries()) {
        requireThat(object(band) && ["name", "label", "long_bg", "short_bg", "text"].every((k) => string(band[k]))
          && Number.isFinite(band.min) && Number.isFinite(band.max) && band.min <= band.max,
        configPath, `invalid color band at ${i}`);
      }
      requireThat(Array.isArray(data.items), dataPath, "items must be an array");
      requireThat(string(data.generated_at) && Number.isFinite(Date.parse(data.generated_at)), dataPath, "generated_at must be a valid timestamp");
      for (const key of ["candle_closed", "degraded"]) requireThat(typeof data[key] === "boolean", dataPath, `${key} must be boolean`);
      requireThat(Number.isInteger(data.universe_size) && data.universe_size >= 0, dataPath, "universe_size must be a nonnegative integer");
      if (data.notes !== undefined) requireThat(Array.isArray(data.notes) && data.notes.every(string), dataPath, "notes must be a string array");
      const seen = new Set();
      for (const [i, item] of (Array.isArray(data.items) ? data.items : []).entries()) {
        const where = `${dataPath} items[${i}]`;
        if (!object(item)) { error(where, "expected an object"); continue; }
        requireThat(string(item.symbol) && !seen.has(item.symbol), where, "symbol must be nonempty and unique");
        seen.add(item.symbol);
        requireThat(string(item.display), where, "display must be a string");
        requireThat(Number.isFinite(item.score), where, "score must be a number");
        requireThat(["long", "short", "neutral"].includes(item.direction), where, "invalid direction");
        requireThat(validBands.some((b) => b.name === item.band), where, "band is absent from display.color_bands");
      }
      // Legacy snapshots intentionally support missing details; present components must be numeric.
      if (data.details != null) {
        requireThat(object(data.details), dataPath, "details must be an object when present");
        for (const [symbol, detail] of Object.entries(object(data.details) ? data.details : {})) {
          const where = `${dataPath} details.${symbol}`;
          if (!object(detail)) { error(where, "expected a detail object"); continue; }
          requireThat(seen.has(symbol), where, "detail has no matching item");
          if (detail.components != null) {
            requireThat(Array.isArray(detail.components), where, "components must be an array");
            for (const [i, c] of (Array.isArray(detail.components) ? detail.components : []).entries()) {
              requireThat(object(c) && string(c.label) && ["points_long", "points_short", "points_max"].every((k) => Number.isFinite(c[k])), where, `component ${i} needs a label and numeric points`);
            }
          }
        }
      }
      if (data.items?.length === 0) warnings.push(`${dataPath}: empty snapshot (verify the requested data state)`);
      info.push(`Snapshot: ${Array.isArray(data.items) ? data.items.length : "invalid"} items, generated_at=${data.generated_at}`);
    }
    info.push(`Assets: ${htmlFiles.length} HTML files; classic inline JavaScript syntax checked, not executed`);
  }

  if (sources) {
    try {
      const raw = resolveSources(root);
      info.push(`Raw projects: pivot=${raw.pivot}; board=${raw.board}`);
      for (const target of [raw.fibHtml, raw.sopHtml, raw.signalConfig]) {
        requireThat(existsSync(target) && statSync(target).isFile(), "source-projects.json", `missing publish input: ${target}`);
      }
      if (!existsSync(raw.python)) {
        warnings.push(`Snapshot refresh unavailable: ${raw.python}; publish would reuse existing data.json`);
        requireThat(existsSync(join(root, "public/modules/board/data.json")), "public/modules/board/data.json", "no Python environment and no existing snapshot");
      }
    } catch (e) {
      error("source-projects.json", e.message);
    }
    info.push("Sources: presence checks only; no copy, Python, API, or deployment executed");
  }
  return { errors, warnings, info };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--harness", "--assets", "--sources"].includes(arg))) {
    console.error("Usage: node scripts/check.mjs [--harness | --assets | --sources] (no flags: harness + assets)");
    process.exitCode = 2;
  } else {
    const result = checkProject(ROOT, {
      harness: args.length === 0 || args.includes("--harness"),
      assets: args.length === 0 || args.includes("--assets"),
      sources: args.includes("--sources"),
    });
    for (const line of result.info) console.log(line);
    for (const line of result.warnings) console.warn(`WARN ${line}`);
    for (const line of result.errors) console.error(`FAIL ${line}`);
    console.log(result.errors.length ? `FAILED: ${result.errors.length} issue(s)` : "PASS: requested offline checks");
    process.exitCode = result.errors.length ? 1 : 0;
  }
}
