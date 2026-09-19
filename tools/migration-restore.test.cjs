const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/index.html','utf8');
const code=source.slice(source.indexOf('async function applyDashboardStorageBundle(bundle) {'),source.indexOf('async function importDashboardStorageBundleFromClipboard()'));
(async()=>{
 const db=new Map([['community_data',{key:'community_data',value:{Test:{occupied:1}}}]]),transactions=[];
 const context={console,window:{},savedData:{Test:{occupied:1}},ATLAS_STATE_COMMUNITY_KEY:'community_data',ATLAS_STATE_WEEKLY_SNAPSHOT_KEY:'weekly',OPS_GLOBAL_STORAGE_KEY:'global',localStorage:{setItem(){}},
 mergeDashboardCommunityDataMaps:(a,b)=>({...a,...b}),removeLegacyCommunityStorageKeys(){},removeLegacyDailyBackupStorageKeys(){},removeLegacyWeeklySnapshotStorageKey(){},markAtlasPersistenceError:e=>{throw e},
 atlasStateGetValue:async k=>db.get(k)?.value,
 withAtlasStateStore:async(mode,action)=>{const writes=[];const store={get:k=>{const r={result:db.get(k)};queueMicrotask(()=>r.onsuccess?.());return r;},put:r=>{writes.push(r.key);db.set(r.key,structuredClone(r));}};action(store);await new Promise(resolve=>setImmediate(resolve));transactions.push(writes);},
 atlasStateWritePromise:new Promise(resolve=>setTimeout(()=>{db.set('community_data',{key:'community_data',value:{Test:{occupied:2}}});resolve();},20))};
 vm.createContext(context);vm.runInContext(code,context);
 await context.applyDashboardStorageBundle({indexedDb:{communityData:{Test:{occupied:3,unrelated:'retained'}}}});
 assert.equal(db.get('community_data').value.Test.occupied,3);assert.equal(context.savedData.Test.unrelated,'retained');assert.equal(transactions.filter(t=>t.includes('community_data')).length,1);
 context.atlasStateGetValue=async()=>({corrupted:true});await assert.rejects(context.applyDashboardStorageBundle({indexedDb:{communityData:{Test:{occupied:4}}}}),/differs from the committed/);
 console.log('PASS migration restore: pending stale save drained, committed storage read back, mismatch blocks success');
})().catch(e=>{console.error(e);process.exit(1)});
