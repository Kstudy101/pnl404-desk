/** Collect prepared raw outputs. --deploy validates before uploading this checkout. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveSources} from './source-paths.mjs';
import {enhanceFibHtml} from './enhance-fib.mjs';
import {enhanceSopHtml} from './enhance-sop.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function atomicWrite(path,value){mkdirSync(dirname(path),{recursive:true});const temporary=`${path}.tmp`;writeFileSync(temporary,value);renameSync(temporary,path);}
function run(command,args,cwd){const result=spawnSync(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:true});if(result.error||result.status!==0)throw new Error(`${command}: ${result.error?.message||`exit ${result.status}`}`);}

export function publish({root=ROOT,outputRoot=root,fibInput,sopInput,legacyPython,runSnapshot=run,log=console.log}={}){
  const sources=resolveSources(root);
  const fib=enhanceFibHtml(readFileSync(fibInput||sources.fibHtml,'utf8'));
  const sop=enhanceSopHtml(readFileSync(sopInput||sources.sopHtml,'utf8'));
  const config=readFileSync(sources.signalConfig,'utf8');JSON.parse(config);
  const board=resolve(outputRoot,'public/modules/board'),out=resolve(board,'data.json');
  const temporary=resolve(board,'data.snapshot.tmp.json');
  mkdirSync(board,{recursive:true});
  let partial=false,legacyStatus='refreshed';
  try{
    const python=legacyPython||sources.python;
    if(!existsSync(python))throw new Error(`Legacy Python missing: ${python}`);
    runSnapshot(python,[resolve(root,'scripts/snapshot-board.py'),temporary],sources.backend);
    const snapshot=JSON.parse(readFileSync(temporary,'utf8'));
    if(!Array.isArray(snapshot.items)||!Number.isFinite(Date.parse(snapshot.generated_at)))throw new Error('Invalid legacy snapshot');
    renameSync(temporary,out);
  }catch(error){
    if(existsSync(temporary))unlinkSync(temporary);
    if(!existsSync(out))throw new Error(`Legacy refresh failed with no prior snapshot: ${error.message}`);
    partial=true;legacyStatus='retained';log(`PARTIAL legacy: previous data.json retained; ${error.message}`);
  }
  atomicWrite(resolve(outputRoot,'public/modules/fib/index.html'),fib);
  atomicWrite(resolve(outputRoot,'public/modules/sop/index.html'),sop);
  atomicWrite(resolve(board,'signal_config.json'),config);
  const result={status:partial?'partial':'complete',exitCode:partial?2:0,legacy:legacyStatus,outputRoot};
  log(JSON.stringify(result));return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};let deploy=false;
    const keys={'--output-root':'outputRoot','--fib-input':'fibInput','--sop-input':'sopInput','--legacy-python':'legacyPython'};
    for(let index=0;index<args.length;index++){
      const arg=args[index];if(arg==='--deploy'){deploy=true;continue;}
      if(!keys[arg]||!args[index+1])throw new Error(`Unknown or incomplete argument: ${arg}`);
      options[keys[arg]]=resolve(args[++index]);
    }
    if(deploy&&options.outputRoot&&options.outputRoot!==ROOT)throw new Error('Deploy only accepts the actual checkout output');
    const result=publish(options);
    if(deploy){
      run(process.execPath,[resolve(ROOT,'scripts/check.mjs')],ROOT);
      run(process.execPath,[resolve(ROOT,'scripts/check-market-artifacts.mjs')],ROOT);
      // Invoke npm's JS entry directly: no Windows cmd quoting or credential copy.
      const npx=resolve(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
      if(!existsSync(npx))throw new Error(`npx CLI not found beside Node: ${npx}`);
      run(process.execPath,[npx,'--yes','wrangler@4.131.1','deploy'],ROOT);
    }
    process.exitCode=result.exitCode;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
