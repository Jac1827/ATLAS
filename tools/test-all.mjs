// Discover the complete local suite; stdout/results contain names and statuses only.
// Detailed logs remain in ignored output. No hosted test URL is accepted by this runner.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const privateFixtures=new Map([
  ['tools/budget-workbook-import.test.cjs','ATLAS_FISCAL_BUDGET_FIXTURE'],
  ['tools/collections-import.test.cjs','ATLAS_DELINQUENCY_FIXTURE']
]);
export async function discoverTests(directory=root) {
  const tests=(await fs.readdir(path.join(directory,'tools'))).filter(name=>/\.test\.(?:cjs|mjs)$/.test(name)).sort().map(name=>'tools/'+name);
  if(await fs.access(path.join(directory,'test-ticker.mjs')).then(()=>true,()=>false))tests.push('test-ticker.mjs');
  return tests;
}
async function sourceFingerprint() {
  const hash=crypto.createHash('sha256');
  async function walk(relative){
    // Published measurements include this runner's output. Excluding that
    // non-executable directory avoids a self-referential results fingerprint.
    if(relative==='docs/portfolio-operations-dashboard/performance/evidence')return;
    const entries=await fs.readdir(path.join(root,relative),{withFileTypes:true});
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const name=path.posix.join(relative,entry.name);
      if(entry.isDirectory()&&!['node_modules','.temp','spreadsheet_staffing','wrangler-cli'].includes(entry.name))await walk(name);
      else if(entry.isFile()&&/\.(?:[cm]?js|html|css|json|sql)$/.test(name)){hash.update(name+'\0');hash.update(await fs.readFile(path.join(root,name)));hash.update('\0');}
    }
  }
  for(const directory of ['docs','tools','src','supabase/migrations'])await walk(directory);
  for(const name of ['test-ticker.mjs','package.json','package-lock.json','wrangler.jsonc','.github/workflows/deploy-cloudflare.yml']){
    hash.update(name+'\0');hash.update(await fs.readFile(path.join(root,name)));hash.update('\0');
  }
  return hash.digest('hex');
}
function stop(child,signal='SIGTERM') {
  if(!child?.pid)return;
  try{process.platform==='win32'?child.kill(signal):process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
}
async function isolatedBuilder(env,log) {
  const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});
  const child=spawn(process.execPath,['tools/reforecast-harness-server.cjs'],{cwd:root,env:{...env,PORT:String(port)},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(Error('Isolated builder fixture startup timed out')),30000);
      const done=error=>{clearTimeout(timer);error?reject(error):resolve();};
      child.once('error',done);child.once('exit',code=>done(Error('Isolated builder fixture exited '+code)));
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log.write(chunk);text=(text+chunk).slice(-4096);if(text.includes('Reforecast acceptance http://127.0.0.1:'+port))done();});
    });
    return {child,url:'http://127.0.0.1:'+port};
  }catch(error){stop(child);throw error;}
}
async function runOne(file,index,{env,directory,timeoutMs,strictFixtures}) {
  const started=Date.now(),result={test:file,status:'failed',elapsedMs:0,exitCode:null,signal:null,log:String(index+1).padStart(3,'0')+'-'+path.basename(file)+'.log'};
  const required=privateFixtures.get(file);
  if(required&&(!env[required]||!await fs.access(env[required]).then(()=>true,()=>false))){
    result.status=strictFixtures?'failed':'skipped';result.reason='Required private fixture is unavailable: '+required;result.elapsedMs=Date.now()-started;
    await fs.writeFile(path.join(directory,result.log),result.reason+'\n',{mode:0o600});return result;
  }
  const {createWriteStream}=await import('node:fs'),log=createWriteStream(path.join(directory,result.log),{mode:0o600});let fixture,child,timer,killTimer;
  try{
    const childEnv={...env};
    // Browser tests either create their own disposable fixture or use this owned one.
    for(const key of ['ATLAS_FORECAST_TEST_URL','ATLAS_PROVIDER_TEST_URL','ATLAS_UI_TEST_URL'])delete childEnv[key];
    if(file==='tools/reforecast-builder-browser.test.mjs'){childEnv.ATLAS_GOVERNED_WORKFLOW_TEST='1';fixture=await isolatedBuilder(childEnv,log);childEnv.ATLAS_FORECAST_TEST_URL=fixture.url;}
    child=spawn(process.execPath,[file],{cwd:root,env:childEnv,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log.write(chunk));
    const outcome=await new Promise(resolve=>{
      child.once('error',error=>resolve({error}));child.once('close',(code,signal)=>resolve({code,signal}));
      timer=setTimeout(()=>{result.reason='Test exceeded '+timeoutMs+' ms';result.timedOut=true;stop(child);killTimer=setTimeout(()=>stop(child,'SIGKILL'),2000);},timeoutMs);
    });
    result.exitCode=outcome.code??null;result.signal=outcome.signal??null;
    result.status=!result.timedOut&&!outcome.error&&outcome.code===0?'passed':'failed';
    if(outcome.error)result.reason='Test process could not start';
  }catch(error){result.reason='Test fixture setup failed';log.write(String(error?.stack||error)+'\n');}
  finally{clearTimeout(timer);clearTimeout(killTimer);stop(child,result.timedOut?'SIGKILL':'SIGTERM');stop(fixture?.child);await new Promise(resolve=>log.end(resolve));result.elapsedMs=Date.now()-started;}
  return result;
}
async function main(){
  const args=process.argv.slice(2);let list=false,strictFixtures=false,timeoutMs=180000,output;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--list')list=true;
    else if(args[i]==='--strict-fixtures')strictFixtures=true;
    else if(args[i]==='--output'&&args[i+1])output=args[++i];
    else if(args[i]==='--timeout-ms'&&args[i+1])timeoutMs=Number(args[++i]);
    else throw Error('Unknown or incomplete option: '+args[i]);
  }
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000)throw Error('Invalid test timeout');
  const tests=await discoverTests();
  if(list){console.log(JSON.stringify({count:tests.length,tests},null,2));return;}
  const directory=path.resolve(root,output||'output/test-all/'+new Date().toISOString().replaceAll(':','-'));
  if(!directory.startsWith(path.join(root,'output')+path.sep))throw Error('Test logs must stay inside ignored output/');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  // A fresh directory retains prior runs rather than overwriting their evidence.
  if(await fs.access(path.join(directory,'results.json')).then(()=>true,()=>false))throw Error('This test output already contains a run; choose a new output directory');
  const env={...process.env,ATLAS_XLSX:process.env.ATLAS_XLSX||path.join(root,'docs/portfolio-operations-dashboard/assets/xlsx.full.min.js')};
  const report={format:1,startedAt:new Date().toISOString(),node:process.version,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),inputFingerprint:await sourceFingerprint(),discovered:tests.length,strictFixtures,tests:[]};
  const save=async()=>{report.passed=report.tests.filter(row=>row.status==='passed').length;report.failed=report.tests.filter(row=>row.status==='failed').length;report.skipped=report.tests.filter(row=>row.status==='skipped').length;await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});};
  await save();
  for(let index=0;index<tests.length;index++){
    const result=await runOne(tests[index],index,{env,directory,timeoutMs,strictFixtures});report.tests.push(result);await save();
    console.log(`${index+1}/${tests.length} ${result.status.toUpperCase()} ${result.test} (${result.elapsedMs} ms)`);
  }
  report.finishedAt=new Date().toISOString();report.finalInputFingerprint=await sourceFingerprint();report.sourceChangedDuringRun=report.inputFingerprint!==report.finalInputFingerprint;await save();
  console.log(JSON.stringify({discovered:report.discovered,passed:report.passed,failed:report.failed,skipped:report.skipped,sourceChangedDuringRun:report.sourceChangedDuringRun,results:path.relative(root,path.join(directory,'results.json'))}));
  if(report.failed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
