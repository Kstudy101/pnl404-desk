import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Keep desk-specific visualization when fresh raw HTML is published. */
export function enhanceFibHtml(html) {
  if (!/\bconst\s+D\s*=/.test(html) || !/id=["']mx["']/.test(html) || !/<\/head>/i.test(html) || !/<\/body>/i.test(html)) {
    throw new Error("피보나치 원본의 D 데이터 또는 레벨 매트릭스를 찾을 수 없습니다.");
  }
  // Normalize display names in both markup and embedded labels on every publish.
  html = html.replaceAll("레드존", "하단 밴드").replaceAll("블루존", "상단 밴드");
  if (!/name=["']viewport["']/.test(html)) html = html.replace(/<\/head>/i, '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>');
  if (!html.includes('id="pnl404-fib-rise-style"')) html = html.replace(/<\/head>/i, '<link id="pnl404-fib-rise-style" rel="stylesheet" href="./zone-visualization.css">\n</head>');
  if (!html.includes('id="pnl404-fib-rise-script"')) html = html.replace(/<\/body>/i, '<script id="pnl404-fib-rise-script" type="module" src="./zone-visualization.mjs"></script>\n</body>');
  return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../public/modules/fib/index.html");
  writeFileSync(file, enhanceFibHtml(readFileSync(file, "utf8")));
  console.log("피보나치 상승 구간 시각화 연결 완료");
}
