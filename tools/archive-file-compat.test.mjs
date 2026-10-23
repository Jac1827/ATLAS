// Exercise the actual minimally patched retained rollback function, with no real storage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {patchArchiveFileBoundary} from './archive-file-compat.mjs';
import {OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';
const repo=path.resolve(import.meta.dirname,'..');
const original=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/'+OPERATIONAL_RELEASE+'/portfolio-operations-dashboard/index.html'],{cwd:repo,encoding:'utf8',maxBuffer:20*1024*1024});
const current=await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8');
const patched=patchArchiveFileBoundary(original,current);
const rollback=patched.match(/^async function testAtlasCentralRollbackSnapshot\([^\n]*\) \{[\s\S]*?^\}/m)[0];
for(const change of ['none','timestamp_refresh','actor','profile','database','replay','abort']){
 let begin,finish,encoderOptions,downloads=0,renders=0,alerts=0,messages=0;
 const entered=new Promise(resolve=>begin=resolve),pending=new Promise(resolve=>finish=resolve);
 const ctx={Blob,JSON,Date,Error,JSZip:{},ATLAS_STATE_DB_NAME:'isolated-synthetic',atlasCentralRuntimeMeta:{},
  actor:'original',profile:{role:'vice_president',access_verified_at:'2026-10-23T10:00:00Z'},
  window:{AtlasReplayGeneration:3,AtlasFeatures:{load:async()=>{}},AtlasMigrationArchive:{verifyRestore:async()=>({passed:true,recordsRestored:4}),toJsonBlob:async(value,options)=>{encoderOptions=options;begin();await pending;if(change==='abort'){const error=new Error('cancelled');error.name='AbortError';throw error;}return new Blob(['synthetic']);}}},
  buildAtlasCentralAppStatePayload:async()=>({bundle:{dataBlob:new Blob(['archive'])},reconciliation:{synthetic:true}}),
  downloadAtlasJsonFile:payload=>{assert(payload instanceof Blob);downloads++;},setAtlasCentralRuntimeMessage:()=>messages++,renderTab:()=>renders++,alert:()=>alerts++};
 ctx.window.ATLAS_CENTRAL={getSession:()=>({user:{id:ctx.actor}}),getStoredProfile:()=>ctx.profile};
 vm.createContext(ctx);vm.runInContext(rollback,ctx);const operation=ctx.testAtlasCentralRollbackSnapshot();await entered;
 assert.equal(typeof encoderOptions.isCurrent,'function');assert.equal(encoderOptions.isCurrent(),true);assert.equal(ctx.atlasCentralRuntimeMeta.rollbackTestedAt,undefined,'Gate must stay closed while encoding');
 if(change==='timestamp_refresh')ctx.profile={...ctx.profile,access_verified_at:'2026-10-23T10:15:00Z'};
 if(change==='actor')ctx.actor='different';
 if(change==='profile')ctx.profile={role:'property_manager'};
 if(change==='database')ctx.ATLAS_STATE_DB_NAME='different-isolated-db';
 if(change==='replay')ctx.window.AtlasReplayGeneration++;
 if(!['none','timestamp_refresh','abort'].includes(change))assert.equal(encoderOptions.isCurrent(),false,'Encoder must see changed context');
 finish();await operation;
 if(['none','timestamp_refresh'].includes(change)){assert.equal(downloads,1);assert(ctx.atlasCentralRuntimeMeta.rollbackTestedAt);assert.equal(renders,1);assert.equal(messages,1);}
 else{assert.equal(downloads,0,'Changed or cancelled context must not download');assert.equal(ctx.atlasCentralRuntimeMeta.rollbackTestedAt,undefined,'Changed or cancelled context must not pass gate');assert.equal(renders,0);assert.equal(messages,0);}
 assert.equal(alerts,0);
}
assert.throws(()=>patchArchiveFileBoundary(original.replace('function downloadAtlasJsonFile(', 'function changedDownload('),current),/boundary/);
console.log('PASS retained rollback bounded Blob conversion, encoder context guard, access timestamp refresh, actor/profile/database/replay cancellation, AbortError refusal, no false gate and exact patch boundaries.');
