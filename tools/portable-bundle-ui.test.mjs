import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as portable from '../docs/portfolio-operations-dashboard/features/portable-bundle-file.mjs';
const require=createRequire(import.meta.url),api=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const source=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const extract=name=>source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
function fixture(){
 const calls={applied:[],downloads:[],alerts:[],reloads:0};
 const c={Blob,DOMException,context:'same',ATLAS_STATE_DB_NAME:'scoped',atlasWorkspaceAccess:{epoch:1},getAtlasRenderContextKey:()=>c.context,alert:text=>calls.alerts.push(text),closeModal:()=>{},portable,
  applyDashboardStorageBundle:async value=>{calls.applied.push(value);return 1;},
  window:{AtlasFeatures:{load:async()=>{}},AtlasMigrationArchive:api,location:{reload:()=>calls.reloads++}},
  URL:{createObjectURL:blob=>{calls.downloads.push(blob);return 'blob:fixture';},revokeObjectURL:()=>{}},document:{createElement:()=>({click(){}})}};
 vm.createContext(c);vm.runInContext(extract('downloadAtlasJsonFile')+'\n'+extract('importDashboardStorageBundleFromFile').replace(/await import\('\.\/features\/portable-bundle-file\.mjs(?:\?v=[^']+)?'\)/,'portable'),c);
 return {c,calls};
}
test('actual file importer restores the portable Blob transport and download helper preserves complete JSON bytes',async()=>{
 const archive=await api.pack({keys:{zero:'0'},indexedDb:{communityData:{Example:{missing:null,zero:0}}}},[{key:'source',value:new Blob(['original'])}],Zip,{inlineLimit:0});
 const file=await api.toJsonBlob(archive),f=fixture();
 f.c.downloadAtlasJsonFile(file,'rollback.json');assert.equal(f.calls.downloads[0],file);
 // Reading the whole file is precisely the old allocation boundary.
 file.text=async()=>{throw Error('Whole portable file read forbidden');};
 await f.c.importDashboardStorageBundleFromFile(file);
 assert.equal(f.calls.applied.length,1);assert(f.calls.applied[0].dataBlob instanceof Blob);assert.equal(f.calls.applied[0].data,undefined);
 assert.equal(f.calls.applied[0].sha256,archive.sha256);assert.equal(f.calls.reloads,1);
 const restored=await api.unpack(f.calls.applied[0],Zip);assert.equal(await restored.records[0].value.text(),'original');assert.equal(restored.bundle.indexedDb.communityData.Example.missing,null);
});
test('malformed files and changed workspaces cannot reach the restore operation',async()=>{
 for(const text of ['', '{"a":', '{"a":1,"a":2}']){
  const f=fixture();await f.c.importDashboardStorageBundleFromFile(new Blob([text]));assert.equal(f.calls.applied.length,0);assert.equal(f.calls.reloads,0);assert.equal(f.calls.alerts.length,1);
 }
 const f=fixture();f.c.window.AtlasFeatures.load=async()=>{f.c.context='other';};
 await f.c.importDashboardStorageBundleFromFile(new Blob(['{"keys":{"keep":"value"}}']));assert.equal(f.calls.applied.length,0);assert.equal(f.calls.alerts.length,0);
});
