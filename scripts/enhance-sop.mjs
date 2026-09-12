import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locate the JSON literal without executing any generator or inline JavaScript. */
export function extractSopData(html) {
  const declaration = /\bconst\s+D\s*=\s*/.exec(html);
  if (!declaration) throw new Error('미해소 레벨 원본의 D 데이터를 찾을 수 없습니다.');
  const start = declaration.index + declaration[0].length;
  if (html[start] !== '{') throw new Error('미해소 레벨 D 데이터가 JSON 객체가 아닙니다.');
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      const literal = html.slice(start, index + 1);
      const data = JSON.parse(literal);
      if (!Array.isArray(data.symbols) || !Array.isArray(data.dist?.buckets)) throw new Error('미해소 레벨 종목 또는 분포 데이터가 없습니다.');
      return { data, literal, start, end: index + 1 };
    }
  }
  throw new Error('미해소 레벨 D 데이터의 끝을 찾을 수 없습니다.');
}

/** Reapply the desk presentation after copying a fresh raw artifact. D is untouched. */
export function enhanceSopHtml(html) {
  const before = extractSopData(html).literal;
  if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) throw new Error('미해소 레벨 HTML의 head/body 경계를 찾을 수 없습니다.');
  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '<title>미해소 레벨 · PNL404</title>');
  if (!/name=["']viewport["']/i.test(html)) html = html.replace(/<\/head>/i, '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>');
  if (!html.includes('id="pnl404-sop-view-style"')) html = html.replace(/<\/head>/i, '<link id="pnl404-sop-view-style" rel="stylesheet" href="./levels-view.css">\n</head>');
  if (!html.includes('id="pnl404-sop-view-script"')) html = html.replace(/<\/body>/i, '<script id="pnl404-sop-view-script" type="module" src="./levels-view.mjs"></script>\n</body>');
  if (extractSopData(html).literal !== before) throw new Error('미해소 레벨 표시 확장 중 원본 데이터가 변경되었습니다.');
  return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../public/modules/sop/index.html');
  writeFileSync(file, enhanceSopHtml(readFileSync(file, 'utf8')));
  console.log('미해소 레벨 화면 연결 완료 · 원본 D 보존');
}
