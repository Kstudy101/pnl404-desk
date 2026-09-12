import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {handleRequest} from '../worker/index.mjs';

const root=resolve(new URL('../public/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const port=Number(process.env.PORT || 8787);
const entries=new Map();
const cache={async match(request){return entries.get(request.url)?.clone();},async put(request,response){entries.set(request.url,response.clone());}};
const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const ASSETS={async fetch(request){
  const url=new URL(request.url);
  let path;
  try {path=resolve(root,`.${decodeURIComponent(url.pathname)}`);}catch{return new Response('Bad path',{status:400});}
  if(path!==root && !path.startsWith(root+sep)) return new Response('Forbidden',{status:403});
  try {
    if((await stat(path)).isDirectory()) path=resolve(path,'index.html');
    return new Response(await readFile(path),{headers:{'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-store'}});
  }catch{return new Response('Not found',{status:404});}
}};
createServer(async(incoming,outgoing)=>{
  try {
    const request=new Request(`http://127.0.0.1:${port}${incoming.url}`,{method:incoming.method});
    if(new URL(request.url).pathname==='/_qa/mobile375') {
      outgoing.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      outgoing.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>375px 전광판 검증</title><style>body{margin:0;background:#171b22}iframe{display:block;width:375px;height:950px;border:0;margin:20px auto}</style><iframe src="/modules/board/index.html" title="375px 전광판"></iframe></html>');return;
    }
    const response=await handleRequest(request,{ASSETS},{},{cache});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){outgoing.writeHead(500);outgoing.end(error.message);}
}).listen(port,'127.0.0.1',()=>console.log(`PNL404 local market API: http://127.0.0.1:${port}`));
