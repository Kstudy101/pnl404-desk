import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Find the embedded JSON without executing the producer's classic script. */
export function extractFibData(html) {
  const declaration = /\bconst\s+D\s*=\s*/.exec(html);
  if (!declaration) throw new Error("피보나치 원본의 D 데이터 또는 레벨 매트릭스를 찾을 수 없습니다.");
  const start = declaration.index + declaration[0].length;
  if (html[start] !== "{") throw new Error("피보나치 D 데이터가 JSON 객체가 아닙니다.");
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      const literal = html.slice(start, index + 1);
      return { data: JSON.parse(literal), literal, start, end: index + 1 };
    }
  }
  throw new Error("피보나치 D 데이터의 끝을 찾을 수 없습니다.");
}

/** Keep desk-specific visualization when fresh raw HTML is published. */
export function enhanceFibHtml(html) {
  if (!/\bconst\s+D\s*=/.test(html) || !/id=["']mx["']/.test(html) || !/<\/head>/i.test(html) || !/<\/body>/i.test(html)) {
    throw new Error("피보나치 원본의 D 데이터 또는 레벨 매트릭스를 찾을 수 없습니다.");
  }
  const original = extractFibData(html);
  // Display terminology may change; the embedded data literal must never change.
  const displayNames = (text) => text.replaceAll("레드존", "하단 밴드").replaceAll("블루존", "상단 밴드");
  html = displayNames(html.slice(0, original.start)) + original.literal + displayNames(html.slice(original.end));
  if (!/name=["']viewport["']/.test(html)) html = html.replace(/<\/head>/i, '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>');
  if (!html.includes('id="pnl404-fib-rise-style"')) html = html.replace(/<\/head>/i, '<link id="pnl404-fib-rise-style" rel="stylesheet" href="./zone-visualization.css">\n</head>');
  if (!html.includes('id="pnl404-fib-rise-script"')) html = html.replace(/<\/body>/i, '<script id="pnl404-fib-rise-script" type="module" src="./zone-visualization.mjs"></script>\n</body>');
  if (!html.includes('id="pnl404-fib-dashboard-style"')) html = html.replace(/<\/head>/i, '<link id="pnl404-fib-dashboard-style" rel="stylesheet" href="./dashboard-view.css">\n</head>');
  if (!html.includes('id="pnl404-fib-dashboard-script"')) html = html.replace(/<\/body>/i, '<script id="pnl404-fib-dashboard-script" type="module" src="./dashboard-view.mjs"></script>\n</body>');
  if (extractFibData(html).literal !== original.literal) throw new Error("피보나치 화면 연결 중 원본 D가 변경되었습니다.");
  return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../public/modules/fib/index.html");
  writeFileSync(file, enhanceFibHtml(readFileSync(file, "utf8")));
  console.log("피보나치 대시보드 연결 완료 · 원본 D 보존");
}
