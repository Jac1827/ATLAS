const assert=require('node:assert/strict'),vm=require('node:vm');
const {readDashboardSource}=require('./dashboard-source.cjs');
const source=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const begin=source.indexOf('let atlasCanonicalImportEvidencePromise = null;'),end=source.indexOf('\nasync function initializeAtlasDashboard()',begin);
assert(begin>=0&&end>begin);
const block=source.slice(begin,end).replace(/const \{historyOperation\}=await import\('\.\/features\/import-history\.mjs(?:\?v=[^']+)?'\);/g,'const {historyOperation}=historyFixture;');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){const actorAbort=new AbortController(),held=deferred(),c={AbortController,DOMException,structuredClone,window:{AtlasStartupImportProjection:{historyStorage:{view:'remote',archiveHash:'source-a'}}},dataImport2State:{historyStorage:{view:'remote'}},atlasWorkspaceAccess:{epoch:1,controller:actorAbort},ATLAS_STATE_DB_NAME:'actor-a',ATLAS_STATE_STORE_NAME:'records',DATA_IMPORT_2_STATE_KEY:'imports',context:'a',getAtlasRenderContextKey(){return c.context;},atlasStateGetValue:async key=>key==='imports'?{__atlasImportHistory:2}:{archiveHash:c.window.AtlasStartupImportProjection.historyStorage.archiveHash},historyFixture:{historyOperation:async()=>held.promise},normalizeDataImport2State:x=>x,rememberDataImportHistoryState(){c.remembered=(c.remembered||0)+1;}};vm.createContext(c);vm.runInContext(block,c);return {c,held};}
(async()=>{
 const {c,held}=fixture();const old=c.ensureAtlasCanonicalImportEvidence();await new Promise(r=>setImmediate(r));
 c.context='b';c.ATLAS_STATE_DB_NAME='actor-b';c.atlasWorkspaceAccess.epoch=2;c.atlasWorkspaceAccess.controller=new AbortController();c.window.AtlasStartupImportProjection={historyStorage:{view:'remote',archiveHash:'source-b'}};c.dataImport2State={historyStorage:{view:'remote'},owner:'actor-b'};
 let newReads=0;c.historyFixture.historyOperation=async()=>{newReads++;return {historyStorage:{view:'current'},owner:'actor-b'};};
 await c.ensureAtlasCanonicalImportEvidence();assert.equal(newReads,1,'New actor does not adopt the old actor promise');assert.equal(c.dataImport2State.owner,'actor-b');
 held.resolve({historyStorage:{view:'current'},owner:'actor-a'});await assert.rejects(old,{name:'AbortError'});assert.equal(c.dataImport2State.owner,'actor-b');assert.equal(c.remembered,1);
 const next=fixture(),external=new AbortController(),pending=next.c.ensureAtlasCanonicalImportEvidence({signal:external.signal});await new Promise(r=>setImmediate(r));external.abort();next.held.resolve({owner:'must-not-display'});await assert.rejects(pending,{name:'AbortError'});assert.equal(next.c.window.AtlasStartupImportProjection.historyStorage.archiveHash,'source-a');assert.equal(next.c.remembered,undefined);
 console.log('PASS canonical import evidence: actor/db/epoch scoped pending work, denied old-worker global assignment, no cross-actor promise adoption, and explicit read cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
