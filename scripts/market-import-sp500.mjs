// Third-party membership data: datasets/s-and-p-500-companies (PDDL).
// https://github.com/datasets/s-and-p-500-companies
// Underlying membership is maintained from Wikipedia; it is not an official
// S&P index data licence. Re-run to update the dated discovery catalogue.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const source = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
const csv = process.argv[2] ? await readFile(resolve(process.argv[2]),'utf8') : await (await fetch(source)).text();
function parseRows(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"') {if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===',' && !quoted){row.push(cell);cell='';}
    else if(char==='\n' && !quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=char;
  }
  if(cell || row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows;
}
const rows=parseRows(csv);
if(rows[0]?.[0]!=='Symbol' || rows.length<490) throw new Error('Invalid S&P membership CSV; previous catalogue preserved');
const members=rows.slice(1).filter(row=>row[0]).map(([symbol,name])=>({symbol:symbol.replaceAll('.','-'),name}));
if(members.length<490 || members.length>520 || new Set(members.map(item=>item.symbol)).size!==members.length) throw new Error('Unexpected S&P membership size; previous catalogue preserved');
const output = new URL('../worker/sp500.mjs',import.meta.url);
await writeFile(output,`// Source: ${source}\n// datasets/s-and-p-500-companies, PDDL; third-party Wikipedia membership.\nexport const SP500_AS_OF = ${JSON.stringify(new Date().toISOString())};\nexport const SP500_MEMBERS = ${JSON.stringify(members,null,2)};\n`);
console.log(`Updated S&P membership: ${members.length} share classes`);
