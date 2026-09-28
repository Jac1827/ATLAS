// Credential-free review of the actual compatibility composition and canonical
// financial adapter. No production calls, shared saves, or baseline mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {composeFinanceCompatSource,OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
import {patchReplayCheckpointBoundary} from './replay-checkpoint-compat.mjs';
import {patchOccupancyGoalEditor} from './occupancy-goal-editor-compat.mjs';
import {patchPropertySpecialsClient,patchPropertySpecialsReferences,PROPERTY_SPECIALS_CLIENT,PROPERTY_SPECIALS_UI,PROPERTY_SPECIALS_ASSETS} from './property-specials-compat.mjs';

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
 assert.deepEqual(receipt.websiteSpecials,{assets:PROPERTY_SPECIALS_ASSETS.map(name=>'portfolio-operations-dashboard/'+name),clientMethod:'propertySpecials',scriptReferenceCount:4});
 assert.equal(await fs.readFile(path.join(out,'portfolio-operations-dashboard/index.html'),'utf8'),patchPropertySpecialsReferences(patchReplayCheckpointBoundary(patchOccupancyImportBoundary(oldIndex,await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/features/import-workspace.js'),'utf8')),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8')),websiteSources),'Only reviewed source/checkpoint boundaries and four website-special cache references change the retained inline index');
 assert.equal(await fs.readFile(path.join(out,'portfolio-operations-dashboard/community-goal-editor.js'),'utf8'),patchOccupancyGoalEditor(await fs.readFile(path.join(old,'portfolio-operations-dashboard/community-goal-editor.js'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/community-goal-editor.js'),'utf8')));
 assert.deepEqual(receipt.addedOperationalFiles,['portfolio-operations-dashboard/features/occupancy-source-evidence.mjs']);
 const manifest=JSON.parse(await fs.readFile(path.join(old,'.atlas-release.json'),'utf8'));
 for(const row of manifest.files)if(!allow.has(row.path))assert.deepEqual(await fs.readFile(path.join(out,row.path)),await fs.readFile(path.join(old,row.path)),row.path+' retains reviewed operational bytes');
 for(const root of roots){const relative='portfolio-operations-dashboard/features/'+root;assert.equal(await fs.readFile(path.join(out,relative),'utf8'),`// Reviewed financial-only compatibility route. Operational storage is untouched.\nexport * from '../../finance/${relative}';\n`);}
 const investorPath='portfolio-operations-dashboard/investor-packet-ui.js';assert.equal(await fs.readFile(path.join(out,investorPath),'utf8'),(await fs.readFile(path.join(old,investorPath),'utf8')).replace("budgetReader.src='./RISE-Budget-Builder.html?investorReader=1'","budgetReader.src='../finance/portfolio-operations-dashboard/RISE-Budget-Builder.html?investorReader=1'"),'Only the exact hidden financial reader route changes');
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
