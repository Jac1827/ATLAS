import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';import {patchReplayCheckpointBoundary} from './replay-checkpoint-compat.mjs';
const old=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df/portfolio-operations-dashboard/index.html'],{encoding:'utf8',maxBuffer:10*1024*1024});
const current=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8'),archiveUi=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/features/import-workspace.js',import.meta.url),'utf8');
const prior=patchOccupancyImportBoundary(old,current,archiveUi);const patched=patchReplayCheckpointBoundary(prior,current);
const fn=(source,name)=>source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
test('retained checkpoint composition changes only reversible guarded blocks and preserves host queue callback',()=>{
 assert.equal(fn(patched,'dataImportCreateReplayCheckpoint'),fn(current,'dataImportCreateReplayCheckpoint'));
 assert(fn(patched,'queueAtlasStateWrite').includes('if (isCurrent && !isCurrent()) return;'),'existing retained queue callback remains');
 assert(fn(patched,'persistDataImportPublication').includes('replay.assertRecord?.(DATA_IMPORT_2_STATE_KEY,request.result)'));
 assert(fn(patched,'persistDataImportPublication').includes('if(!publicationCommitted)throw'));
 assert(fn(patched,'persistDataImportPublication').includes('sourceRequest.onsuccess'));
 assert(fn(patched,'reprocessDataImportBoxScore').includes('checkpoint=await dataImportCreateReplayCheckpoint(entry)'));
 assert.equal(fn(patched,'initializeAtlasDashboard'),fn(old,'initializeAtlasDashboard'),'retained startup remains exact');
 assert.throws(()=>patchReplayCheckpointBoundary(patched,current),/boundary changed|Ambiguous/);
 assert.throws(()=>patchReplayCheckpointBoundary(prior.replace(fn(prior,'persistDataImportPublication'),fn(prior,'persistDataImportPublication').replace('      removeLegacyCommunityStorageKeys();','      unsafeStorageMigration();')),current),/Ambiguous/);
});
