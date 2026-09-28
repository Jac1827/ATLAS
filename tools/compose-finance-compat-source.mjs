// An explicit compatibility source, never a projection publisher. The retained
// operational startup stays intact; the current finance tree is isolated.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyRelease} from './package-atlas-assets.mjs';
import {patchOccupancyGoalEditor} from './occupancy-goal-editor-compat.mjs';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
import {patchArchiveBuilderBoundary,ARCHIVE_BUILDER_BOUNDARY_COUNT} from './archive-builder-compat.mjs';
import {patchReplayCheckpointBoundary,REPLAY_CHECKPOINT_BOUNDARY_COUNT} from './replay-checkpoint-compat.mjs';
import {patchReplayRefreshBoundary,REPLAY_REFRESH_BOUNDARY_COUNT} from './replay-refresh-compat.mjs';
import {patchPropertySpecialsClient,patchPropertySpecialsReferences,patchPropertySpecialsSettings,PROPERTY_SPECIALS_CLIENT,PROPERTY_SPECIALS_ASSETS} from './property-specials-compat.mjs';

export const OPERATIONAL_RELEASE='774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df';
export const OCCUPANCY_FORWARDERS=['occupancy-source-evidence.mjs'];
export const FINANCIAL_FORWARDERS=['canonical-finance.mjs','community-finance.mjs','financial-close.mjs','financial-comparison.mjs','reforecast-consumers.mjs','reforecast-store.mjs','financial-close-report.mjs','canonical-budget-report.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(parent,child)=>child===parent||child.startsWith(parent+path.sep);
async function inventory(root,prefix=''){
 const rows=[];
 for(const item of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
  const relative=prefix?prefix+'/'+item.name:item.name;
  if(item.isSymbolicLink())throw Error('Compatibility source cannot contain symlinks: '+relative);
  if(item.isDirectory())rows.push(...await inventory(root,relative));
  else if(item.isFile()&&relative!=='.atlas-release.json'){const bytes=await fs.readFile(path.join(root,relative));rows.push({path:relative,sha256:sha(bytes),bytes:bytes.length});}
 }
 return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
const sourceId=files=>sha(JSON.stringify({schemaVersion:1,packagerVersion:1,files}));
const financePrefix='../finance/portfolio-operations-dashboard/';
// Only the persisted-budget read boundary moves forward. Keep every other byte
// of the retained investor presentation, transport and approval flow unchanged.
export function patchInvestorBudgetReaderCompatibility(source){
 const stored="  function stored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(error){return null;}}";
 const helper="\n  const budgetAutosaveKeys=['rise.budget.autosave.v2','rise.budget.autosave'];\n  function storedBudget(){try{const current=localStorage.getItem(budgetAutosaveKeys[0]);return current!==null?JSON.parse(current||'null'):stored(budgetAutosaveKeys[1]);}catch(error){return null;}}";
 const changes=[
  [stored,stored+helper],
  ["event.key==='rise.budget.autosave'&&budgetReader","budgetAutosaveKeys.includes(event.key)&&budgetReader"],
  ["stored('rise.budget.autosave')?.investorPacketSources?.properties","storedBudget()?.investorPacketSources?.properties"],
  ["stored('rise.budget.autosave')?.state?.properties","storedBudget()?.state?.properties"],
  ["budgetReader.src='./RISE-Budget-Builder.html?investorReader=1'","budgetReader.src='"+financePrefix+"RISE-Budget-Builder.html?investorReader=1'"]
 ];
 let updated=source;
 for(const [before,after] of changes){
  if(source.split(before).length!==2||source.includes(after)&&after!==before)throw Error('The retained investor budget-reader boundary changed: '+before);
  updated=updated.replace(before,after);
 }
 return updated;
}
// A wrapper around rendering adds one independently authorized task list. It
// does not call a save, hydration, source replacement or operational data API.
const homeHook=`
/* Audited finance compatibility hook: retained operational render is unchanged. */
(function(){
 function install(){
  const original=window.renderTab;if(typeof original!=='function'||original.atlasFinanceCompatibility)return;
  function render(){const result=original.apply(this,arguments);if(typeof activeTab!=='undefined'&&activeTab===0&&!window.shouldBlockAtlasSensitiveAccess?.())void window.AtlasBudgetApprovalTasks?.mount(document.getElementById('tab-panel-0'));return result;}
  render.atlasFinanceCompatibility=true;window.renderTab=render;
  if(typeof activeTab!=='undefined'&&activeTab===0&&window.atlasDashboardInitializationComplete)void window.AtlasBudgetApprovalTasks?.mount(document.getElementById('tab-panel-0'));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
`;

export async function composeFinanceCompatSource({operationalSource,financeSource,out}={}){
 if(!operationalSource||!financeSource||!out)throw Error('Explicit operationalSource, financeSource and out are required.');
 operationalSource=await fs.realpath(operationalSource);financeSource=await fs.realpath(financeSource);out=path.resolve(out);
 for(const source of [operationalSource,financeSource])if(inside(source,out)||inside(out,source))throw Error('Output must be separate from both source trees.');
 const parent=await fs.realpath(path.dirname(out));out=path.join(parent,path.basename(out));
 for(const source of [operationalSource,financeSource])if(inside(source,out)||inside(out,source))throw Error('Output resolves inside a source tree.');
 try{await fs.lstat(out);throw Error('Compatibility output must not already exist.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const operationalManifest=await verifyRelease(operationalSource,OPERATIONAL_RELEASE),financeFiles=await inventory(financeSource);
 if(financeFiles.some(row=>row.path==='finance'||row.path.startsWith('finance/')||row.path.startsWith('_atlas-assets/')))throw Error('Use an uncomposed current docs source.');
 const currentFinanceId=sourceId(financeFiles),operationalFiles=operationalManifest.files;
 const mountsPath='portfolio-operations-dashboard/atlas-mounts.js',consumersPath='portfolio-operations-dashboard/reforecast-consumers.js';
 const mounts=await fs.readFile(path.join(operationalSource,mountsPath),'utf8');
 const target=/src: "RISE-Budget-Builder\.html(?:\?[^"\n]*)?"/g;
 if([...mounts.matchAll(target)].length!==1)throw Error('The retained Budget Builder mount boundary changed.');
 const currentMounts=await fs.readFile(path.join(financeSource,mountsPath),'utf8');
 // Import only presentation up to the iframe. Its retained load/context
 // behavior belongs to the operational host and must not acquire new globals.
 const budgetBlock=/    if \(key === "budget"\) \{\n      return \[[\s\S]*?(?=        '    <iframe src=)/g;
 const budgetNavigation=/  window\.navigateAtlasBudgetMount = function \(view\) \{[\s\S]*?\n  \};/g;
 for(const boundary of [budgetBlock,budgetNavigation])if([...mounts.matchAll(boundary)].length!==1||[...currentMounts.matchAll(boundary)].length!==1)throw Error('The reviewed financial mount render/navigation boundary changed.');
 const updatedMounts=mounts.replace(target,'src: "'+financePrefix+'RISE-Budget-Builder.html"').replace(budgetBlock,currentMounts.match(budgetBlock)[0]).replace(budgetNavigation,currentMounts.match(budgetNavigation)[0]);
 const currentConsumers=await fs.readFile(path.join(financeSource,consumersPath),'utf8');
 const imports=[...currentConsumers.matchAll(/import\('\.\/features\/([^']+)'\)/g)];
 if(imports.length!==2||!currentConsumers.includes('window.AtlasBudgetApprovalTasks=')||!currentConsumers.includes('window.AtlasActiveReforecast='))throw Error('Review the current finance consumer integration boundary.');
 const updatedConsumers=currentConsumers.replace(/import\('\.\/features\//g,"import('"+financePrefix+'features/')+homeHook;
 const indexPath='portfolio-operations-dashboard/index.html',editorPath='portfolio-operations-dashboard/community-goal-editor.js';
 const oldIndex=await fs.readFile(path.join(operationalSource,indexPath),'utf8'),currentCore=await fs.readFile(path.join(financeSource,'portfolio-operations-dashboard/workspace-core.js'),'utf8');
 const websiteSources=Object.fromEntries(await Promise.all(PROPERTY_SPECIALS_ASSETS.map(async name=>[name,await fs.readFile(path.join(financeSource,'portfolio-operations-dashboard',name),'utf8')])));
 websiteSources[PROPERTY_SPECIALS_CLIENT]=patchPropertySpecialsClient(await fs.readFile(path.join(operationalSource,'portfolio-operations-dashboard',PROPERTY_SPECIALS_CLIENT),'utf8'),websiteSources[PROPERTY_SPECIALS_CLIENT]);
 const updatedIndex=patchReplayRefreshBoundary(patchPropertySpecialsReferences(patchPropertySpecialsSettings(patchArchiveBuilderBoundary(patchReplayCheckpointBoundary(patchOccupancyImportBoundary(oldIndex,currentCore,await fs.readFile(path.join(financeSource,'portfolio-operations-dashboard/features/import-workspace.js'),'utf8')),currentCore),currentCore),currentCore),websiteSources),currentCore,await fs.readFile(path.join(financeSource,'portfolio-operations-dashboard/features/import-workspace.js'),'utf8'));
 const updatedEditor=patchOccupancyGoalEditor(await fs.readFile(path.join(operationalSource,editorPath),'utf8'),await fs.readFile(path.join(financeSource,editorPath),'utf8'));
 await fs.mkdir(out);
 try{
  for(const row of operationalFiles){const destination=path.join(out,row.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(operationalSource,row.path),destination);}
  for(const row of financeFiles){const destination=path.join(out,'finance',row.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(financeSource,row.path),destination);}
  await fs.writeFile(path.join(out,mountsPath),updatedMounts);await fs.writeFile(path.join(out,consumersPath),updatedConsumers);
  const investorPath='portfolio-operations-dashboard/investor-packet-ui.js',investor=await fs.readFile(path.join(operationalSource,investorPath),'utf8');
  await fs.writeFile(path.join(out,investorPath),patchInvestorBudgetReaderCompatibility(investor));
  const budgetPath='portfolio-operations-dashboard/RISE-Budget-Builder.html';
  await fs.writeFile(path.join(out,budgetPath),`<!doctype html><html><head><meta charset="utf-8"><title>RISE Budget Builder</title><script>const target=new URL('../finance/portfolio-operations-dashboard/RISE-Budget-Builder.html',document.baseURI);target.search=location.search;target.hash=location.hash;location.replace(target.href);</script></head><body><a href="../finance/portfolio-operations-dashboard/RISE-Budget-Builder.html">Open Budget Builder</a></body></html>\n`);
  await fs.writeFile(path.join(out,indexPath),updatedIndex);await fs.writeFile(path.join(out,editorPath),updatedEditor);
  const websitePaths=PROPERTY_SPECIALS_ASSETS.map(name=>'portfolio-operations-dashboard/'+name);
  for(const name of PROPERTY_SPECIALS_ASSETS)await fs.writeFile(path.join(out,'portfolio-operations-dashboard',name),websiteSources[name]);
  // Keep the retained lazy loader unchanged. Only the reviewed archive builder
  // uses bounded verification; public unpack and restore contracts are retained.
  const archivePath='portfolio-operations-dashboard/migration-archive.js';
  if(!operationalFiles.some(row=>row.path===archivePath)||!financeFiles.some(row=>row.path===archivePath))throw Error('The reviewed migration archive boundary is missing.');
  await fs.copyFile(path.join(financeSource,archivePath),path.join(out,archivePath));
  const occupancyForwarded=OCCUPANCY_FORWARDERS.map(name=>'portfolio-operations-dashboard/features/'+name);
  for(const relative of occupancyForwarded){await fs.mkdir(path.dirname(path.join(out,relative)),{recursive:true});await fs.writeFile(path.join(out,relative),`// Reviewed source evidence parser; no storage or publication side effects.\nexport * from '../../finance/${relative}';\n`);}
  const forwarded=FINANCIAL_FORWARDERS.map(name=>'portfolio-operations-dashboard/features/'+name);
  for(const relative of forwarded){
   const previous=await fs.readFile(path.join(operationalSource,relative),'utf8'),current=await fs.readFile(path.join(financeSource,relative),'utf8');
   if(/export\s+default\b/.test(previous)||/export\s+default\b/.test(current))throw Error('A financial root has a default export; review its forwarding contract: '+relative);
   await fs.writeFile(path.join(out,relative),`// Reviewed financial-only compatibility route. Operational storage is untouched.\nexport * from '../../finance/${relative}';\n`);
  }
  const changed=[];
  for(const row of operationalFiles){const hash=sha(await fs.readFile(path.join(out,row.path)));if(hash!==row.sha256)changed.push({path:row.path,beforeSha256:row.sha256,afterSha256:hash});}
  if(JSON.stringify(changed.map(row=>row.path).sort())!==JSON.stringify([mountsPath,consumersPath,investorPath,budgetPath,indexPath,editorPath,archivePath,...forwarded,...websitePaths].sort()))throw Error('An unapproved operational source changed.');
  for(const row of financeFiles)if(sha(await fs.readFile(path.join(out,'finance',row.path)))!==row.sha256)throw Error('Finance source changed during composition: '+row.path);
  const sourceFiles=await inventory(out);
  return {schemaVersion:1,mode:'preserve_operational_startup',out,operationalReleaseId:OPERATIONAL_RELEASE,financeSourceId:currentFinanceId,composedSourceId:sourceId(sourceFiles),operationalFileCount:operationalFiles.length,unchangedOperationalFileCount:operationalFiles.length-changed.length,financeFileCount:financeFiles.length,changedOperationalFiles:changed,financePrefix:'finance/',sourceFiles,
   preserved:['Operational startup/bootstrap and all index content outside eleven import boundaries, 36 reviewed checkpoint/save guards, three archive-builder boundaries and four website-special asset version references plus the URL draft revision fields','Operational IndexedDB/local-storage keys and hydration','Existing operational source records and import history','Parent authentication client outside the isolated propertySpecials request method, and normal Budget Builder access decision'],
   updated:['Budget Builder iframe, current governed header/navigation and direct document links use the complete isolated finance tree','Investor-packet hidden reader uses the same isolated current Budget Builder','Eight explicitly listed canonical financial roots forwarded to current finance adapters','Active-reforecast consumer adapter including publication delivery readbacks','Home approval tasks with direct exact-record Review links','Source-aware advisory occupancy planning with original goal persistence and approved history','Eleven guarded import boundaries retain source evidence and audited rent-roll period corrections; 36 checkpoint/save boundaries use native IndexedDB rollback for Rent Roll and Trending, protect queued/local/shared writes, and retain unresolved recovery evidence','Lossless bounded archive transport and three guarded builder boundaries; coherent native temporary capture, one-record packing, and every member verified sequentially; no startup or authorization change','Website settings recovery/retry and concession evidence diagnostics; only propertySpecials is patched in the retained central client, with three versioned assets refreshed'],
   replayRefresh:{boundaryCount:REPLAY_REFRESH_BOUNDARY_COUNT,inspection:'small_metadata_and_atomic_local_receipts_only'},replayCheckpoint:{boundaryCount:REPLAY_CHECKPOINT_BOUNDARY_COUNT,routes:['rent_roll','trending_occupancy'],storage:'temporary_native_indexeddb',unresolvedRecovery:'writes_blocked_until_coherent_reload'},financialForwarders:forwarded,occupancyForwarders:occupancyForwarded,archiveTransport:archivePath,archiveBuilder:{boundaryCount:ARCHIVE_BUILDER_BOUNDARY_COUNT,retainedRead:"coherent_native_temporary_snapshot_one_record_reads",verification:"all_members_sequential_bundle_only"},websiteSpecials:{assets:websitePaths,clientMethod:'propertySpecials',scriptReferenceCount:4,settingsRevisionFields:4},addedOperationalFiles:occupancyForwarded,
   limits:['Does not activate the new operational workspace/core or publish a startup projection.','Other nonfinancial operational readers and investor-packet presentation remain at the reviewed operational release.','Delivery status remains pending until each authorized consumer performs its actual verified readback.']};
 }catch(error){await fs.rm(out,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [operationalSource,financeSource,out]=process.argv.slice(2);
 composeFinanceCompatSource({operationalSource,financeSource,out}).then(receipt=>console.log(JSON.stringify(receipt,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
