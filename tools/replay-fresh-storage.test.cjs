const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('tools/performance/workspace-replay-benchmark.mjs','utf8');
const reset=source.match(/^async function resetIsolatedReplayStorage\([^]*?^\}/m)[0];
const shell=source.match(/^function readReplayShellObservation\([^]*?^\}/m)[0];
function fixture(){const databases=new Set(['scoped-synthetic','history-synthetic']),removed=[];const c={location:{origin:'http://127.0.0.1:1234',hostname:'127.0.0.1'},cleared:[],performance:{getEntriesByName:()=>[]},localStorage:{clear:()=>c.cleared.push('local')},sessionStorage:{clear:()=>c.cleared.push('session')},indexedDB:{databases:async()=>[...databases].map(name=>({name})),deleteDatabase(name){const request={};queueMicrotask(()=>{databases.delete(name);removed.push(name);request.onsuccess();});return request;}}};vm.createContext(c);vm.runInContext(reset+'\n'+shell,c);return {c,removed};}
(async()=>{
 let {c,removed}=fixture();assert.deepEqual(JSON.parse(JSON.stringify(await c.resetIsolatedReplayStorage(c.location.origin))),{storageInitiallyEmpty:true,initialDatabaseCount:0});assert.equal(removed.length,2);assert.deepEqual(c.cleared,['local','session']);
 for(const [origin,hostname,expected]of [['https://atlas.example','atlas.example','https://atlas.example'],['http://127.0.0.1:1234','127.0.0.1','http://127.0.0.1:9999']]){({c,removed}=fixture());Object.assign(c.location,{origin,hostname});await assert.rejects(c.resetIsolatedReplayStorage(expected),/outside the isolated replay origin/);assert.equal(removed.length,0);assert.equal(c.cleared.length,0);}
 ({c}=fixture());delete c.indexedDB.databases;await assert.rejects(c.resetIsolatedReplayStorage(c.location.origin),/Cannot prove empty/);
 ({c}=fixture());c.indexedDB.deleteDatabase=()=>{const request={};queueMicrotask(()=>request.onblocked());return request;};await assert.rejects(c.resetIsolatedReplayStorage(c.location.origin),/open connection/);assert.equal(c.cleared.length,0);
 ({c}=fixture());assert.equal(c.readReplayShellObservation().authenticatedShellMs,null,'Earlier builds remain explicitly unmeasured');c.performance.getEntriesByName=name=>name==='atlas:time-to-authenticated-shell'?[{duration:777}]:[];assert.equal(c.readReplayShellObservation().authenticatedShellMs,777);
 assert.match(source,/if\(config\.freshAuthorized && build==='repaired'\)/,'No historical/control storage is cleared');
 assert.match(source,/await page\.goto\(origin\+'\/seed\.html'\);\s+const storage=await page\.evaluate\(resetIsolatedReplayStorage,origin\);\s+await seedPage\(false\)/);
 assert.match(source,/if\(seedData\)\{[^]*?indexedDB\.open[^]*?\}\s+localStorage\.setItem\('atlas_central_runtime_config_v1'/,'Auth-only setup cannot seed cached community/projection rows');
 console.log('PASS isolated fresh-origin reset, no external/control reset, blocked connection fail-closed, auth-only seed contract, absent-shell null and real-shell timing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
