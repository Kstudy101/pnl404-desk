/**
 * 로컬에서 세 모듈 산출물을 public/ 으로 모은 뒤, --deploy 이면 Cloudflare Pages 에 올린다.
 *
 *   node scripts/publish.mjs
 *   node scripts/publish.mjs --deploy
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = resolve(ROOT, "..");
const PIVOT = resolve(DESKTOP, "피봇스윙매매");
const BOARD = resolve(DESKTOP, "스윙전광판");
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

copy(
  resolve(PIVOT, "out/fib/fibdash_BTCUSDT.html"),
  resolve(ROOT, "public/modules/fib/index.html"),
);
copy(
  resolve(PIVOT, "out/sop/sop_all.html"),
  resolve(ROOT, "public/modules/sop/index.html"),
);
copy(
  resolve(BOARD, "signal_config.json"),
  resolve(ROOT, "public/modules/board/signal_config.json"),
);

const py = resolve(BOARD, "backend/.venv/Scripts/python.exe");
const outJson = resolve(ROOT, "public/modules/board/data.json");
if (existsSync(py)) {
  console.log("snapshot board…");
  run(py, [resolve(ROOT, "scripts/snapshot-board.py"), outJson], resolve(BOARD, "backend"));
} else if (!existsSync(outJson)) {
  console.warn("board snapshot skipped: venv 없음, 기존 data.json 도 없음");
} else {
  console.warn("board snapshot skipped: 기존 data.json 유지");
}

if (deploy) {
  run("npx", ["--yes", "wrangler", "deploy"], ROOT);
}
