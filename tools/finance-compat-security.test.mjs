// Credential-free review of the actual compatibility composition and canonical
// financial adapter. No production calls, shared saves, or baseline mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {composeFinanceCompatSource,OPERATIONAL_RELEASE,patchInvestorBudgetReaderCompatibility} from './compose-finance-compat-source.mjs';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
import {patchArchiveBuilderBoundary} from './archive-builder-compat.mjs';
import {patchReplayCheckpointBoundary} from './replay-checkpoint-compat.mjs';
import {patchReplayRefreshBoundary} from './replay-refresh-compat.mjs';
import {patchOccupancyGoalEditor} from './occupancy-goal-editor-compat.mjs';
import {patchPropertySpecialsClient,patchPropertySpecialsReferences,patchPropertySpecialsSettings,PROPERTY_SPECIALS_CLIENT,PROPERTY_SPECIALS_UI,PROPERTY_SPECIALS_ASSETS} from './property-specials-compat.mjs';

const repo=path.resolve(import.meta.dirname,'..'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-finance-security-'));
const roots=['canonical-finance.mjs','community-finance.mjs','financial-close.mjs','financial-comparison.mjs','reforecast-consumers.mjs','reforecast-store.mjs','financial-close-report.mjs','canonical-budget-report.mjs'];
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
try{
 const old=path.join(tmp,'old'),out=path.join(tmp,'composed');await fs.mkdir(old);
 execFileSync('git',['archive','--format=tar','--output='+path.join(tmp,'old.tar'),'origin/atlas-asset-releases:_atlas-assets/'+OPERATIONAL_RELEASE],{cwd:repo});
 execFileSync('tar',['-xf',path.join(tmp,'old.tar'),'-C',old]);
 const receipt=await composeFinanceCompatSource({operationalSource:old,financeSource:path.join(repo,'docs'),out});
 const allow=new Set(['portfolio-operations-dashboard/migration-archive.js','portfolio-operations-dashboard/index.html','portfolio-operations-dashboard/community-goal-editor.js','portfolio-operations-dashboard/RISE-Budget-Builder.html','portfolio-operations-dashboard/atlas-mounts.js','portfolio-operations-dashboard/reforecast-consumers.js','portfolio-operations-dashboard/investor-packet-ui.js',...roots.map(n=>'portfolio-operations-dashboard/features/'+n),...PROPERTY_SPECIALS_ASSETS.map(name=>'portfolio-operations-dashboard/'+name)]);
 assert.deepEqual(receipt.changedOperationalFiles.map(r=>r.path).sort(),[...allow].sort());
 const oldIndex=await fs.readFile(path.join(old,'portfolio-operations-dashboard/index.html'),'utf8');
 assert.equal(receipt.changedOperationalFiles.length,18);assert.equal(receipt.unchangedOperationalFileCount,237);
 for(const name of ['migration-archive.js'])assert.deepEqual(await fs.readFile(path.join(out,'portfolio-operations-dashboard',name)),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard',name)),'Only the exact reviewed archive transport is activated');
 for(const name of ['performance/feature-loader.js'])assert.deepEqual(await fs.readFile(path.join(out,'portfolio-operations-dashboard',name)),await fs.readFile(path.join(old,'portfolio-operations-dashboard',name)),'Archive activation preserves loader bytes');
 const websiteSources=Object.fromEntries(await Promise.all(PROPERTY_SPECIALS_ASSETS.map(async name=>[name,await fs.readFile(path.join(out,'portfolio-operations-dashboard',name),'utf8')])));
 for(const name of PROPERTY_SPECIALS_UI)assert.equal(websiteSources[name],await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard',name),'utf8'),'Only the exact reviewed website-special UI module is activated');
 assert.equal(websiteSources[PROPERTY_SPECIALS_CLIENT],patchPropertySpecialsClient(await fs.readFile(path.join(old,'portfolio-operations-dashboard',PROPERTY_SPECIALS_CLIENT),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard',PROPERTY_SPECIALS_CLIENT),'utf8')),'Every retained central-client byte outside propertySpecials remains unchanged');
 assert.deepEqual(receipt.websiteSpecials,{assets:PROPERTY_SPECIALS_ASSETS.map(name=>'portfolio-operations-dashboard/'+name),clientMethod:'propertySpecials',scriptReferenceCount:4,settingsRevisionFields:4});
 assert.equal(await fs.readFile(path.join(out,'portfolio-operations-dashboard/index.html'),'utf8'),patchReplayRefreshBoundary(patchPropertySpecialsReferences(patchPropertySpecialsSettings(patchArchiveBuilderBoundary(patchReplayCheckpointBoundary(patchOccupancyImportBoundary(oldIndex,await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/features/import-workspace.js'),'utf8')),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8')),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8')),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8')),websiteSources),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/features/import-workspace.js'),'utf8')),'Only reviewed archive/source/checkpoint boundaries, website settings revision fields and four website-special cache references change the retained inline index');
 assert.equal(await fs.readFile(path.join(out,'portfolio-operations-dashboard/community-goal-editor.js'),'utf8'),patchOccupancyGoalEditor(await fs.readFile(path.join(old,'portfolio-operations-dashboard/community-goal-editor.js'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/community-goal-editor.js'),'utf8')));
 assert.deepEqual(receipt.addedOperationalFiles,['portfolio-operations-dashboard/features/occupancy-source-evidence.mjs']);
 const manifest=JSON.parse(await fs.readFile(path.join(old,'.atlas-release.json'),'utf8'));
 for(const row of manifest.files)if(!allow.has(row.path))assert.deepEqual(await fs.readFile(path.join(out,row.path)),await fs.readFile(path.join(old,row.path)),row.path+' retains reviewed operational bytes');
 for(const root of roots){const relative='portfolio-operations-dashboard/features/'+root;assert.equal(await fs.readFile(path.join(out,relative),'utf8'),`// Reviewed financial-only compatibility route. Operational storage is untouched.\nexport * from '../../finance/${relative}';\n`);}
 const investorPath='portfolio-operations-dashboard/investor-packet-ui.js';
 const retainedInvestor=await fs.readFile(path.join(old,investorPath),'utf8'),updatedInvestor=await fs.readFile(path.join(out,investorPath),'utf8');
 const budgetHelper="\n  const budgetAutosaveKeys=['rise.budget.autosave.v2','rise.budget.autosave'];\n  function storedBudget(){try{const current=localStorage.getItem(budgetAutosaveKeys[0]);return current!==null?JSON.parse(current||'null'):stored(budgetAutosaveKeys[1]);}catch(error){return null;}}";
 const investorChanges=[
  ['',budgetHelper],
  ["event.key==='rise.budget.autosave'&&budgetReader","budgetAutosaveKeys.includes(event.key)&&budgetReader"],
  ["stored('rise.budget.autosave')?.investorPacketSources?.properties","storedBudget()?.investorPacketSources?.properties"],
  ["stored('rise.budget.autosave')?.state?.properties","storedBudget()?.state?.properties"],
  ["budgetReader.src='./RISE-Budget-Builder.html?investorReader=1'","budgetReader.src='../finance/portfolio-operations-dashboard/RISE-Budget-Builder.html?investorReader=1'"]
 ];
 let reversedInvestor=updatedInvestor;
 for(const [before,after] of investorChanges){assert.equal(reversedInvestor.split(after).length,2,'Exactly one allowed investor compatibility change: '+after);reversedInvestor=reversedInvestor.replace(after,before);}
 assert.equal(reversedInvestor,retainedInvestor,'Reversing only the helper, storage listener, two reads and existing iframe route restores every retained investor byte');
 assert((await fs.readFile(path.join(repo,'docs',investorPath),'utf8')).includes(budgetHelper),'Finance and retained investor UI use the identical reviewed storage helper');
 const storedAnchor="  function stored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(error){return null;}}";
 for(const anchor of [storedAnchor,...investorChanges.slice(1).map(([before])=>before)]){
  assert.throws(()=>patchInvestorBudgetReaderCompatibility(retainedInvestor.replace(anchor,'')),/boundary changed/,'Missing compatibility anchors fail closed');
  assert.throws(()=>patchInvestorBudgetReaderCompatibility(retainedInvestor+'\n'+anchor),/boundary changed/,'Duplicate compatibility anchors fail closed');
 }
 assert.throws(()=>patchInvestorBudgetReaderCompatibility(updatedInvestor),/boundary changed/,'Already composed input cannot acquire a second compatibility patch');
 const budgetStorage=new Map(),budgetContext={localStorage:{getItem:key=>budgetStorage.get(key)??null}};
 vm.createContext(budgetContext);vm.runInContext(storedAnchor+budgetHelper+'\nthis.readStoredBudget=storedBudget;',budgetContext);
 budgetStorage.set('rise.budget.autosave',JSON.stringify({kind:'legacy'}));assert.equal(budgetContext.readStoredBudget().kind,'legacy');
 budgetStorage.set('rise.budget.autosave.v2',JSON.stringify({kind:'current'}));assert.equal(budgetContext.readStoredBudget().kind,'current');
 for(const invalid of ['{','null','']){budgetStorage.set('rise.budget.autosave.v2',invalid);assert.equal(budgetContext.readStoredBudget(),null,'Unreadable current checkpoint cannot expose the older financial source');}
 assert.equal(budgetStorage.get('rise.budget.autosave'),JSON.stringify({kind:'legacy'}),'Compatibility reads preserve original browser data');
 const redirect=await fs.readFile(path.join(out,'portfolio-operations-dashboard/RISE-Budget-Builder.html'),'utf8');let destination;
 vm.runInNewContext(redirect.match(/<script>([\s\S]*?)<\/script>/)[1],{URL,document:{baseURI:'https://atlas.invalid/portfolio-operations-dashboard/RISE-Budget-Builder.html'},location:{search:'?investorReader=1&next=https%3A%2F%2Funtrusted.invalid',hash:'#reforecast',replace:href=>destination=href}});
 assert.equal(destination,'https://atlas.invalid/finance/portfolio-operations-dashboard/RISE-Budget-Builder.html?investorReader=1&next=https%3A%2F%2Funtrusted.invalid#reforecast','Query/hash cannot change the same-origin financial destination');
 const centralSource=await fs.readFile(path.join(out,'portfolio-operations-dashboard/centralization/atlas-central-client.js'),'utf8');
 for(const api of ['getSession','getStoredProfile','refreshSession','fetchJson','readCommunitiesForAccess','readUserProfiles'])assert.match(centralSource,new RegExp('function '+api+'\\('),'Retained parent provides '+api);
 const navigation=await fs.readFile(path.join(out,'finance/portfolio-operations-dashboard/reforecast-navigation.js'),'utf8');
 assert.match(navigation,/e\.origin!==location\.origin\|\|e\.source!==window\.parent/,'Navigation remains restricted to the same-origin parent');
 const direct=await import(pathToFileURL(path.join(out,'finance/portfolio-operations-dashboard/features/canonical-finance.mjs'))),forwarded=await import(pathToFileURL(path.join(out,'portfolio-operations-dashboard/features/canonical-finance.mjs')));
 assert.equal(forwarded.readFinance,direct.readFinance,'Retained consumers execute the exact current canonical adapter');
 let actor=id(1),profileVersion=1,delayed=null;const cid=id(2),period='2026-09',publication=id(3),revision=id(4),oldInvestor=id(5),close=id(6),hash='a'.repeat(64),requests=[];
 const baseline={communityId:cid,period,status:'available',verified:true,approved:true,locked:true,sourceType:'approved_reforecast',versionId:revision,publicationId:publication,contentHash:hash,investorStatus:'pending_investor_approval',lines:[{accountCode:'6200',nature:'expense',placement:'above_noi',period,amount:900}]};
 const summary={communityId:cid,period,registryVersion:'atlas-finance-v1',budgetVersion:oldInvestor,budgetContentHash:'b'.repeat(64),actualCloseVersion:close,actualContentHash:'c'.repeat(64),effectiveBaseline:baseline,periodState:'reopened',periodWarning:'This period has been reopened and its financial data is under revision. Related dashboards and reports may change until the period is re-approved and locked.',expenses:{actual:910,budget:1000,originalBudget:1000,activeBaseline:900,baselineVersion:revision,baselineSourceType:'approved_reforecast',baselinePublicationId:publication}};
 const sourceRow={community_id:cid,period_key:period,summary};
 // This shape intentionally supplies only APIs available on the retained parent.
 const central={getSession:()=>({user:{id:actor}}),getStoredProfile:()=>({user_id:actor,role:'executive',status:'active',version:profileVersion}),async refreshSession(){},async fetchJson(url,options){
  requests.push({url,args:JSON.parse(options.body)});
  if(url==='/rpc/atlas_read_finance')return delayed?delayed():structuredClone([sourceRow]);
  if(url==='/rpc/atlas_verify_budget_consumer'){const args=JSON.parse(options.body);return {publication_id:args.p_publication_id,consumer_key:args.p_consumer_key,content_fingerprint:args.p_observed_fingerprint,delivery_status:'verified'};}
  throw Error('Unexpected transport '+url);
 }};
 const result=(await forwarded.readFinance(central,[cid],[period]))[0].summary;
 assert.equal(result.expenses.budget,900);assert.equal(result.expenses.originalBudget,1000);
 assert.equal(result.activeBaselineVersion,revision);assert.equal(result.activeBaselinePublicationId,publication);
 assert.equal(result.periodWarning,summary.periodWarning);assert.equal(result.financialSnapshot.identity.actualCloseVersion,close);
 assert.equal(result.financialSnapshot.identity.effectiveBaseline.publicationId,publication);
 const ack=requests.find(r=>r.url==='/rpc/atlas_verify_budget_consumer');assert(ack,'Actual financial read acknowledges the approved publication');
 assert.equal(ack.args.p_consumer_key,'finance_summary');assert.equal(ack.args.p_observed_revision_id,revision);assert.equal(ack.args.p_observed_fingerprint,hash);
 for(const change of [()=>{actor=id(7);},()=>{profileVersion++;}]){
  let release,started;const ready=new Promise(resolve=>started=resolve);delayed=()=>new Promise(resolve=>{release=resolve;started();});
  const read=forwarded.readFinance(central,[cid],[period]);await ready;change();release(structuredClone([sourceRow]));await assert.rejects(read,/Session.*changed|financial access changed/);
 }
 assert.equal(requests.filter(r=>r.url==='/rpc/atlas_verify_budget_consumer').length,1,'No stale session claims an additional verified consumer delivery');
 console.log('PASS exact operational preservation, eight reviewed financial forwarders, retained parent API compatibility, current VP publication identity/ACK, actual-close lineage, reopened warning transport, and actor/access isolation.');
}finally{await fs.rm(tmp,{recursive:true,force:true});}
