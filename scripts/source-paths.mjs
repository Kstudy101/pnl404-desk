import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve the raw-data projects from the checkout's explicit local configuration. */
export function resolveSources(root) {
  const config = JSON.parse(readFileSync(resolve(root, "source-projects.json"), "utf8"));
  for (const key of ["pivot", "board"]) {
    if (typeof config?.[key] !== "string" || !config[key].trim()) {
      throw new Error(`source-projects.json: ${key} must be a nonempty path`);
    }
  }
  const pivot = resolve(root, config.pivot);
  const board = resolve(root, config.board);
  const backend = resolve(board, "backend");
  return {
    pivot,
    board,
    backend,
    fibHtml: resolve(pivot, "out/fib/fibdash_BTCUSDT.html"),
    sopHtml: resolve(pivot, "out/sop/sop_all.html"),
    signalConfig: resolve(board, "signal_config.json"),
    python: resolve(backend, ".venv/Scripts/python.exe"),
  };
}
