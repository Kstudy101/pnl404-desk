/**
 * 로컬에서 세 모듈 산출물을 public/ 으로 모은 뒤, --deploy 이면 Cloudflare Pages 에 올린다.
 *
 *   node scripts/publish.mjs
 *   node scripts/publish.mjs --deploy
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveSources } from "./source-paths.mjs";
import { enhanceFibHtml } from "./enhance-fib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = resolveSources(ROOT);
const deploy = process.argv.includes("--deploy");

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`없음: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log(`copy ${from} -> ${to}`);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: "inherit", shell: false });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 종료 ${r.status}`);
}

const fibHtml = enhanceFibHtml(readFileSync(sources.fibHtml, "utf8"));
const fibOutput = resolve(ROOT, "public/modules/fib/index.html");
mkdirSync(dirname(fibOutput), { recursive: true });
writeFileSync(fibOutput, fibHtml);
console.log(`copy ${sources.fibHtml} -> ${fibOutput} (상승 구간 시각화 포함)`);
copy(
  sources.sopHtml,
  resolve(ROOT, "public/modules/sop/index.html"),
);
copy(
  sources.signalConfig,
  resolve(ROOT, "public/modules/board/signal_config.json"),
);

const py = sources.python;
const outJson = resolve(ROOT, "public/modules/board/data.json");
if (existsSync(py)) {
  console.log("snapshot board…");
  run(py, [resolve(ROOT, "scripts/snapshot-board.py"), outJson], sources.backend);
} else if (!existsSync(outJson)) {
  console.warn("board snapshot skipped: venv 없음, 기존 data.json 도 없음");
} else {
  console.warn("board snapshot skipped: 기존 data.json 유지");
}

if (deploy) {
  run("npx", ["--yes", "wrangler", "deploy"], ROOT);
}
