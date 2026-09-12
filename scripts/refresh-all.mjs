/** Hourly local collection -> staged validation -> generated assets -> optional deploy. */
import {spawn} from 'node:child_process';
import {appendFileSync,closeSync,copyFileSync,cpSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveSources} from './source-paths.mjs';
import {checkProject} from './check.mjs';
import {validateMarketArtifacts} from './check-market-artifacts.mjs';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const RUN_TIMEOUT_MS=55*60*1000;
export const WRANGLER_VERSION='4.131.1';
const stamp=value=>new Date(value).toISOString();
const writeJson=(file,value)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(`${file}.tmp`,JSON.stringify(value,null,2)+'\n');renameSync(`${file}.tmp`,file);};

export function acquireLock(root,metadata){
  const file=resolve(root,'_workspace/hourly-refresh/refresh.lock');mkdirSync(dirname(file),{recursive:true});
  let descriptor;
  try{descriptor=openSync(file,'wx');}catch(error){
    if(error.code!=='EEXIST')throw error;
    let prior;try{prior=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Refresh lock exists and cannot be verified');}
    if(!Number.isInteger(prior.pid)||prior.pid<1)throw new Error('Refresh lock has invalid owner');
    try{process.kill(prior.pid,0);throw new Error(`Refresh already running (PID ${prior.pid})`);}catch(probe){
      if(probe.code!=='ESRCH')throw probe;
    }
    // A confirmed dead owner can be replaced; never expire a live run by age.
    unlinkSync(file);descriptor=openSync(file,'wx');
  }
  writeFileSync(descriptor,JSON.stringify({...metadata,pid:process.pid}));closeSync(descriptor);
  return ()=>{const current=JSON.parse(readFileSync(file,'utf8'));if(current.pid===process.pid&&current.runId===metadata.runId)unlinkSync(file);};
}

export function buildRefreshPlan({root=ROOT,stageRoot,sources=resolveSources(root),node=process.execPath,python,legacyPython,deploy=false}){
  python=python||process.env.PNL404_PYTHON||resolve(root,'.venv-market',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const raw=resolve(stageRoot,'raw'),board=resolve(stageRoot,'public/modules/board');
  const step=(id,args,cwd,minutes,allowedCodes=[0],command=node)=>({id,command,args,cwd,timeoutMs:minutes*60*1000,allowedCodes});
  const plan=[
    step('sources',[resolve(root,'scripts/check.mjs'),'--sources'],root,1),
    step('fib',[resolve(sources.pivot,'src/fibdash.ts'),`--out=${resolve(raw,'fib.html')}`],sources.pivot,3),
    step('sop',[resolve(sources.pivot,'src/sopdash.ts'),`--out=${resolve(raw,'sop.html')}`],sources.pivot,8),
    step('markets',[resolve(root,'scripts/market-refresh.py'),'--catalogue',resolve(root,'public/modules/board/markets.json'),'--output',resolve(board,'markets.json'),'--history-dir',resolve(board,'history'),'--crypto-history-budget','100','--crypto-min-interval','16'],root,35,[0,2],python),
    step('publish',[resolve(root,'scripts/publish.mjs'),'--output-root',stageRoot,'--fib-input',resolve(raw,'fib.html'),'--sop-input',resolve(raw,'sop.html'),'--legacy-python',legacyPython||sources.python],root,8,[0,2]),
  ];
  if(deploy)plan.push(step('deploy',[resolve(dirname(node),'node_modules/npm/bin/npx-cli.js'),'--yes',`wrangler@${WRANGLER_VERSION}`,'deploy'],root,4));
  return plan;
}

export function executeStep(step,{log=console.log,timeoutMs=step.timeoutMs}={}){
  return new Promise(resolveResult=>{
    const child=spawn(step.command,step.args,{cwd:step.cwd,env:{...process.env,PATH:`${dirname(process.execPath)}${process.platform==='win32'?';':':'}${process.env.PATH||''}`},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let timedOut=false,errorMessage;
    const timer=setTimeout(()=>{
      timedOut=true;log(`TIMEOUT ${step.id}: ${timeoutMs}ms`);
      if(process.platform==='win32'&&child.pid){
        const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});
        killer.on('error',()=>child.kill());
      }else child.kill('SIGKILL');
    },timeoutMs);
    child.stdout.on('data',chunk=>log(chunk.toString()));child.stderr.on('data',chunk=>log(chunk.toString()));
    child.on('error',error=>{errorMessage=error.message;});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolveResult({code:code??1,signal,timedOut,error:errorMessage});});
  });
}

export function prepareStaging({root,stageRoot}){
  mkdirSync(resolve(stageRoot,'raw'),{recursive:true});
  cpSync(resolve(root,'public'),resolve(stageRoot,'public'),{recursive:true});
}

export function validateStaged({root,stageRoot,startedAt}){
  if(startedAt!==undefined){
    for(const [name,module] of [['fib.html','fib'],['sop.html','sop']]){
      const file=resolve(stageRoot,'raw',name);
      if(!existsSync(file)||statSync(file).mtimeMs<startedAt-1000)throw new Error(`Raw ${name} was not generated by this run`);
      const parseData=path=>{
        const match=readFileSync(path,'utf8').match(/\bconst\s+D\s*=\s*(\{[^\r\n]*\});/);
        if(!match)throw new Error(`Missing raw data object: ${path}`);
        return JSON.parse(match[1]);
      };
      const data=parseData(file),published=parseData(resolve(stageRoot,'public/modules',module,'index.html'));
      const sourceTimes=module==='fib'?[data.now]:(data.symbols||[]).map(item=>item.now);
      if(!sourceTimes.length||sourceTimes.some(value=>!Number.isFinite(value)||value<startedAt-60_000))throw new Error(`Raw ${name} contains stale source timestamps`);
      if(JSON.stringify(data)!==JSON.stringify(published))throw new Error(`Published ${module} data differs from this run's raw data`);
    }
  }
  const results=[checkProject(root,{harness:true,assets:false}),checkProject(stageRoot,{harness:false,assets:true})];
  const board=resolve(stageRoot,'public/modules/board'),snapshot=JSON.parse(readFileSync(resolve(board,'markets.json'),'utf8'));
  const errors=results.flatMap(result=>result.errors);
  if(startedAt!==undefined&&Date.parse(snapshot.generated_at)<startedAt-1000)errors.push('Market snapshot was not generated by this run');
  errors.push(...validateMarketArtifacts(snapshot,name=>JSON.parse(readFileSync(resolve(board,'history',name),'utf8')),{requireMomentum:true}));
  if(errors.length)throw new Error(errors.slice(0,25).join('\n'));
  return {items:snapshot.items.length,generated_at:snapshot.generated_at,price_collection:snapshot.collection,momentum_collection:snapshot.momentum_collection};
}

function generatedPaths(stageRoot){
  const fixed=['modules/fib/index.html','modules/sop/index.html','modules/board/signal_config.json','modules/board/data.json','modules/board/markets.json'];
  const history=resolve(stageRoot,'public/modules/board/history');
  return [...fixed,...readdirSync(history).filter(name=>name.endsWith('.json')&&statSync(join(history,name)).isFile()).map(name=>`modules/board/history/${name}`)];
}
export function promoteGenerated({root,stageRoot,runDirectory}){
  const applied=[];
  try{
    for(const name of generatedPaths(stageRoot)){
      const target=resolve(root,'public',name),backup=resolve(runDirectory,'previous',name);
      if(!target.startsWith(resolve(root,'public')+sep))throw new Error('Generated output escaped public');
      const existed=existsSync(target);if(existed){mkdirSync(dirname(backup),{recursive:true});copyFileSync(target,backup);}
      mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(stageRoot,'public',name),`${target}.hourly.tmp`);renameSync(`${target}.hourly.tmp`,target);
      applied.push({target,backup,existed});
    }
  }catch(error){
    for(const entry of applied.reverse()){if(entry.existed)copyFileSync(entry.backup,entry.target);else unlinkSync(entry.target);}
    throw error;
  }
  return {files:applied.length};
}

export function pruneRunArtifacts({root,activeRunId,keep=3,log=()=>{}}){
  if(!Number.isInteger(keep)||keep<1)throw new Error('Artifact retention must keep at least one completed run');
  const runs=resolve(root,'_workspace/hourly-refresh/runs');if(!existsSync(runs))return {removed:[],retained:[]};
  const rootReal=realpathSync(root),runsReal=realpathSync(runs);
  if(!runsReal.startsWith(rootReal+sep))throw new Error('Run directory resolves outside the workspace');
  const finished=[];
  for(const entry of readdirSync(runs,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue;
    const directory=resolve(runs,entry.name);
    if(lstatSync(directory).isSymbolicLink()||!realpathSync(directory).startsWith(runsReal+sep))continue;
    try{
      const status=JSON.parse(readFileSync(resolve(directory,'status.json'),'utf8'));
      if(status.runId!==entry.name||!['complete','partial','failed'].includes(status.status)||!Number.isFinite(Date.parse(status.finished_at)))continue;
      finished.push({name:entry.name,directory,finishedAt:Date.parse(status.finished_at)});
    }catch{}
  }
  finished.sort((a,b)=>b.finishedAt-a.finishedAt);
  const retained=finished.slice(0,keep).map(entry=>entry.name),removed=[];
  for(const entry of finished.slice(keep)){
    if(entry.name===activeRunId)continue;
    const runReal=realpathSync(entry.directory);
    for(const folder of ['staged','previous']){
      const target=resolve(entry.directory,folder);if(!existsSync(target))continue;
      // Verify every absolute recursive-deletion target immediately beforehand.
      // Logs/status and any symlinks/junctions are deliberately left untouched.
      if(lstatSync(target).isSymbolicLink())continue;
      const targetReal=realpathSync(target);
      if(dirname(targetReal)!==runReal||!targetReal.startsWith(runsReal+sep))throw new Error(`Unsafe artifact cleanup target: ${target}`);
      rmSync(target,{recursive:true});removed.push(target);log(`CLEANUP ${target}`);
    }
  }
  return {removed,retained};
}

export async function runRefresh({root=ROOT,deploy=false,sources,execute=executeStep,now=Date.now,log:externalLog,
  acquire=acquireLock,prepare=prepareStaging,validate=validateStaged,promote=promoteGenerated,cleanup=pruneRunArtifacts,timeoutMs=RUN_TIMEOUT_MS}={}){
  const started=now(),runId=`${stamp(started).replace(/[:.]/g,'-')}-${process.pid}`;
  const runDirectory=resolve(root,'_workspace/hourly-refresh/runs',runId),stageRoot=resolve(runDirectory,'staged');
  const state={runId,root,started_at:stamp(started),status:'running',deploy_requested:deploy,deployed:false,exitCode:null,steps:[]};
  let release;
  try{release=acquire(root,{runId,started_at:state.started_at});}catch(error){return {...state,status:'skipped',exitCode:3,error:error.message};}
  const log=value=>{const message=`${stamp(now())} ${String(value).trimEnd()}\n`;try{appendFileSync(resolve(runDirectory,'run.log'),message);}catch{}(externalLog||console.log)(message.trimEnd());};
  const persist=()=>{writeJson(resolve(runDirectory,'status.json'),state);writeJson(resolve(root,'_workspace/hourly-refresh/latest.json'),state);};
  try{
    mkdirSync(runDirectory,{recursive:true});
    persist();prepare({root,stageRoot,runDirectory});
    const plan=buildRefreshPlan({root,stageRoot,sources,deploy});
    let partial=false;
    for(const step of plan.filter(step=>step.id!=='deploy')){
      const remaining=timeoutMs-(now()-started);if(remaining<=0)throw new Error('Hourly run exceeded its total timeout');
      log(`START ${step.id}`);state.current_step=step.id;persist();
      const result=await execute(step,{log,timeoutMs:Math.min(step.timeoutMs,remaining)});
      state.steps.push({id:step.id,...result,finished_at:stamp(now())});persist();
      if(result.timedOut||result.signal||result.error||!step.allowedCodes.includes(result.code))throw new Error(`${step.id} failed: ${result.error||result.signal||`exit ${result.code}`}`);
      if(result.code===2){partial=true;log(`PARTIAL ${step.id}: retained previous values or deferred inputs; validation is still required`);}else log(`OK ${step.id}`);
    }
    log('START validate');state.current_step='validate';persist();
    state.validation=await validate({root,stageRoot,runDirectory,startedAt:started});state.steps.push({id:'validate',code:0,finished_at:stamp(now())});
    if(now()-started>=timeoutMs)throw new Error('Hourly run exceeded its total timeout before publication');
    log('START promote');state.current_step='promote';persist();
    state.promotion=await promote({root,stageRoot,runDirectory});state.steps.push({id:'promote',code:0,finished_at:stamp(now())});
    if(deploy){
      const step=plan.find(step=>step.id==='deploy'),remaining=timeoutMs-(now()-started);
      if(remaining<=0)throw new Error('Hourly run exceeded its timeout before deployment');
      log('START deploy');state.current_step='deploy';persist();
      const result=await execute(step,{log,timeoutMs:Math.min(step.timeoutMs,remaining)});
      state.steps.push({id:'deploy',...result,finished_at:stamp(now())});
      if(result.code!==0||result.timedOut||result.signal||result.error)throw new Error(`deploy failed: ${result.error||result.signal||`exit ${result.code}`}`);
      state.deployed=true;
    }
    state.status=partial?'partial':'complete';state.exitCode=partial?2:0;
  }catch(error){state.status='failed';state.exitCode=1;state.error=error.message;log(`FAIL ${state.current_step||'prepare'}: ${error.message}`);
  }finally{
    state.finished_at=stamp(now());state.duration_seconds=(now()-started)/1000;delete state.current_step;
    try{
      persist();
      try{state.retention=cleanup({root,activeRunId:runId,keep:3,log});}catch(error){state.retention_error=error.message;log(`WARN artifact cleanup: ${error.message}`);}
      persist();log(`RESULT ${state.status}; exit ${state.exitCode}; deployed=${state.deployed}`);
    }
    catch(error){state.status='failed';state.exitCode=1;state.error=`Status persistence failed: ${error.message}`;}
    finally{release();}
  }
  return state;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.some(arg=>!['--deploy','--plan'].includes(arg))){console.error('Usage: node scripts/refresh-all.mjs [--deploy] [--plan]');process.exitCode=1;}
  else if(args.includes('--plan'))console.log(JSON.stringify(buildRefreshPlan({stageRoot:resolve(ROOT,'_workspace/hourly-refresh/PLAN'),deploy:args.includes('--deploy')}),null,2));
  else{const result=await runRefresh({deploy:args.includes('--deploy')});console.log(JSON.stringify(result));process.exitCode=result.exitCode;}
}
