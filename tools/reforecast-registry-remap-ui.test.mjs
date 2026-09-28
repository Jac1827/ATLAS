import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {reforecastImportMappingReview} from '../docs/portfolio-operations-dashboard/features/reforecast-ui.mjs';
import {reviewNoncashClassification} from '../docs/portfolio-operations-dashboard/features/reforecast-noncash.mjs';
const code=await fs.readFile(new URL('../docs/portfolio-operations-dashboard/features/reforecast-ui.mjs',import.meta.url),'utf8');
const fixture=()=>({actor:'reviewer',cid:'community',scenarioId:'draft',epoch:1,dirty:true,central:{getStoredProfile:()=>({role:'admin'})},source:{communityId:'community',sourceVersion:'retained-source',registry:{version:'v1',accounts:[{accountCode:'8000',name:'Depreciation',nature:'below_noi',placement:'below_noi',nonCash:true}],driverMappings:{}},baseline:{versionIds:['original']}},record:{head:{revision:3},snapshot:{fingerprint:'historical'}},edit:{name:'Edited imported budget',baselineType:'initial_workbook',uploadId:'workbook',registryVersionId:'v1',importMapping:{version:'v1',sourceScenario:'Reviewed',selectedLineIds:['one','two']},overrides:[{period:'2026-09',accountCode:'8000',amount:1.005},{period:'2026-10',accountCode:'8000',amount:0},{period:'2026-11',accountCode:'8000',amount:null}],history:[{action:'manual_edit'}]},pendingCells:{unexplained:'17.25'},pendingRequest:{id:'retained-request'},mappingRequest:'mapping-request',mappingRequestKey:'old'});
function harness(s,{afterWrite=()=>{}}={}){
 const controls=new Map(),effects={registryWrites:0,sourceReads:0,marked:0,rendered:0,expectedRegistry:null};
 const control=(selector,value='')=>{const x={value,checked:true,disabled:false,addEventListener(_event,handler){x.handler=handler;}};controls.set(selector,x);return x;};
 for(const name of ['[data-body]','[data-status]','[data-save]','[data-add-account]','[data-utility-candidates]','[data-confirm]'])control(name);
 control('[data-relationships]','[]');control('[data-effective]','2026-01-01');control('[data-reason]','Explicit source classifications reviewed');
 const el={open:true,isConnected:true,querySelector:selector=>controls.get(selector)||null,querySelectorAll:()=>[],close(){el.open=false;}};
 const actor=s.actor,cid=s.cid,guard=()=>{if(s.actor!==actor||s.cid!==cid)throw Error('Session or community changed');};
 const ctx=vm.createContext({s,structuredClone,clone:structuredClone,forecastSourceReviewAllowed:()=>true,permissions:()=>({edit:true}),editable:()=>true,captureForecastSaveContext:()=>guard,dialog:()=>el,esc:String,options:()=>'',driverTypes:[],UTILITY_RELATIONSHIP_CANDIDATES:[],reviewNoncashClassification,uuid:()=> 'new-request',periodsFor:()=>['2026-09'],eventMeta:()=>({actor:s.actor,timestamp:'2026-09-28'}),mark:()=>effects.marked++,render:()=>effects.rendered++,store:{async saveRegistry(_central,args){args.beforeWrite();effects.registryWrites++;effects.expectedRegistry=args.expectedVersionId;afterWrite();return {version_id:'v2'};},async readBuilderSource(){effects.sourceReads++;return {...structuredClone(s.source),registry:{...s.source.registry,version:'v2'}};}}});
 vm.runInContext(code.match(/async function mappingDialog\([\s\S]*?(?=\nexport function newForecastFromImport)/)[0],ctx);
 return {effects,el,controls,async run(reviewSource=null){ctx.reviewSource=reviewSource;await vm.runInContext('mappingDialog(s,null,reviewSource)',ctx);const button=controls.get('[data-save]');await button.handler({target:button});}};
}
test('canonical mapping save keeps all imported financial edits, pending request and original source immutable; no automatic draft save',async()=>{
 const s=fixture(),retained=JSON.stringify({edit:s.edit,source:s.source,record:s.record,pendingCells:s.pendingCells,pendingRequest:s.pendingRequest,dirty:s.dirty}),h=harness(s);await h.run();
 assert.equal(h.effects.registryWrites,1);assert.equal(h.effects.sourceReads,0,'No new registry is spliced into a pinned imported source');assert.equal(h.effects.marked,0,'Mapping save does not schedule an invalid autosave');assert.equal(h.el.open,false);
 assert.equal(JSON.stringify({edit:s.edit,source:s.source,record:s.record,pendingCells:s.pendingCells,pendingRequest:s.pendingRequest,dirty:s.dirty}),retained);
 const notice=reforecastImportMappingReview(s);assert.equal(notice.inconsistent,false);assert.match(notice.message,/Reload reviewed registry/);assert.match(notice.message,/Create New Draft preserves/);assert.match(notice.message,/Update Existing Draft replaces/);
 assert.equal(s.importRegistryReview.versionId,'v2');assert.equal(s.mappingRequest,null);
});
test('retained import review can save the latest registry without replacing the older draft source',async()=>{
 const s=fixture(),before=JSON.stringify({edit:s.edit,source:s.source}),reviewSource=structuredClone(s.source);reviewSource.registry.version='latest-reviewed';const h=harness(s);await h.run(reviewSource);assert.equal(h.effects.expectedRegistry,'latest-reviewed');assert.equal(h.effects.sourceReads,0);assert.equal(h.effects.marked,0);assert.equal(JSON.stringify({edit:s.edit,source:s.source}),before);
 assert.match(code,/if\(!s\.edit\?\.uploadId&&!s\.edit\?\.importMapping\)s\.source=source/,'Import mapping review must not splice its newly read registry into the current imported draft');
});
test('non-import mapping adoption keeps the existing behavior',async()=>{
 const s=fixture();delete s.edit.uploadId;delete s.edit.importMapping;s.edit.baselineType='original_budget';const h=harness(s);await h.run();assert.equal(s.edit.registryVersionId,'v2');assert.equal(s.source.registry.version,'v2');assert.equal(h.effects.marked,1);assert.equal(h.effects.sourceReads,1);assert.equal(reforecastImportMappingReview(s),null);
});
test('actor or community change during registry receipt cannot install a remap notice or alter the selected draft',async()=>{
 for(const field of ['actor','cid']){const s=fixture(),before=JSON.stringify({edit:s.edit,source:s.source}),h=harness(s,{afterWrite:()=>s[field]='other'});await h.run();assert.equal(s.importRegistryReview,undefined);assert.equal(h.effects.marked,0);assert.equal(h.effects.sourceReads,0);assert.equal(JSON.stringify({edit:s.edit,source:s.source}),before);assert.match(h.controls.get('[data-status]').textContent,/changed/);}
});
test('mismatch notice survives reload from payload alone; scoped notices clear after explicit reviewed remap',()=>{
 const s=fixture();s.edit.registryVersionId='v2';s.source.registry.version='v2';assert.equal(reforecastImportMappingReview(s).inconsistent,true);
 s.edit.importMapping.version='v2';s.importRegistryReview={actor:s.actor,communityId:s.cid,scenarioId:s.scenarioId,versionId:'v2'};assert.equal(reforecastImportMappingReview(s),null);
 s.importRegistryReview.versionId='v3';for(const field of ['actor','communityId','scenarioId']){const copy=structuredClone({...s,central:undefined});copy.importRegistryReview[field]='other';assert.equal(reforecastImportMappingReview(copy),null);}
});
test('inconsistent evidence blocks review submission/publication while ordinary draft saves remain permissible',async()=>{
 const s=fixture();s.edit.registryVersionId='v2';s.source.registry.version='v2';let renders=0;
 const ctx=vm.createContext({s,reforecastImportMappingReview,render:()=>renders++,clearTimeout,safeActor(){},captureForecastSaveContext(){throw Error('Reached permitted draft save');},reforecastSourceChanged:()=>false});
 vm.runInContext(code.match(/async function action\(s,kind\)\{[\s\S]*?(?=\nasync function selectLatestReceiptHead)/)[0],ctx);
 for(const kind of ['ready','ready_for_review','submit','approve','approve_lock','vp_approve','investor_approve']){await vm.runInContext(`action(s,${JSON.stringify(kind)})`,ctx);assert.match(s.error,/workbook review uses a different mapping/);}
 assert.equal(renders,7);await assert.rejects(()=>vm.runInContext("action(s,'save_draft')",ctx),/Reached permitted draft save/);
 assert.match(code,/data-review-import-mapping/);assert.match(code,/Save and verify the current working edits before reviewing another import/);
});
