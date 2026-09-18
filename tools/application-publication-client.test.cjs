const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/index.html','utf8');
const c={console,Date,Map,Set,Number,window:{},applicationResidentDataState:{uploads:[]},csvError:'',renderTab(){},normalizeApplicationResidentUpload:x=>x,getApplicationResidentCommunityIdForAtlasName:()=> 'LOCAL_A'};
vm.createContext(c);
c.scheduleAtlasSharedRender = () => c.renderTab();
vm.runInContext('let atlasApplicationHydrationEpoch=0; let atlasApplicationSessionUser=null;',c);
for (const name of ['atlasApplicationPublicationEnabled','applicationUploadFromCentral','clearAtlasSharedApplications','hydrateAtlasSharedApplications','reviseAtlasSharedApplication']) {
 const match=[...html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)].find(m=>m[0].startsWith('function '+name+'(')||m[0].startsWith('async function '+name+'('));
 vm.runInContext(match[0],c);
}
const row={import_id:'id1',community_id:'uuid-a',version:1,source_metadata:{fileName:'synthetic.xlsx',sourceAsOf:'2026-09-16',reportPeriodKey:'2026-09'},records:[{applicationId:'a',atlasName:'Test A',communityId:'uuid-a',propertySource:'Test A'}],created_at:'2026-09-17T00:00:00Z',deleted_at:null};
let user='one',response=[row];
c.window.ATLAS_CENTRAL={getConfig:()=>({applicationPublication:true}),getSession:()=>user?{user:{id:user}}:null,readApplicationImports:async()=>response,reviseApplicationImport:async(id,version,action)=>{assert.equal(version,1);return {...row,version:2,deleted_at:'2026-09-17T01:00:00Z'}}};
(async()=>{
 c.applicationResidentDataState.uploads=[{batchId:'legacy'},{centralImportId:'stale'}];
 await c.hydrateAtlasSharedApplications();
 assert.equal(c.applicationResidentDataState.uploads.length,2);
 const shared=c.applicationResidentDataState.uploads[0];
 assert.equal(shared.records[0].communityId,'LOCAL_A');
 assert.equal(shared.records[0].canonicalCommunityId,'uuid-a');
 assert.equal(shared.centralVersion,1);
 await c.reviseAtlasSharedApplication(shared,'delete','test');
 assert.equal(c.applicationResidentDataState.uploads[0].validationStatus,'deleted');
 assert.equal(c.applicationResidentDataState.lastDeletedUpload.centralVersion,2);
 let resolve; c.window.ATLAS_CENTRAL.readApplicationImports=()=>new Promise(r=>resolve=r);
 const pending=c.hydrateAtlasSharedApplications(); user='two'; c.clearAtlasSharedApplications(); resolve([row]); await pending;
 assert.equal(c.applicationResidentDataState.uploads.length,1,'Previous user response cannot repopulate session');
 c.window.ATLAS_CENTRAL.readApplicationImports=async()=>{throw new Error('denied')};
 c.applicationResidentDataState.uploads.push(shared); await c.hydrateAtlasSharedApplications();
 assert.equal(c.applicationResidentDataState.uploads.length,1,'Failed read clears stale shared records');
 assert.match(c.csvError,/denied/);
 user=null; await c.hydrateAtlasSharedApplications();
 assert.equal(c.applicationResidentDataState.lastDeletedUpload,null);
 console.log('PASS client hydration, canonical identity, server versions, delete tombstone, session race, sign-out and failed read.');
})().catch(e=>{console.error(e);process.exitCode=1});
