const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root='docs/portfolio-operations-dashboard/';
const source=fs.readFileSync(root+'centralization/atlas-central-client.js','utf8');
const method=source.slice(source.indexOf('    async propertySpecials('),source.indexOf('    async evictionCase('));
function client(fetch){const c={fetch,accessApiUrl:p=>'https://central.test'+p,baseHeaders:()=>({authorization:'Bearer test','content-type':'application/json'}),getConfig:()=>({})};vm.createContext(c);vm.runInContext('client={'+method+'};',c);return c.client;}
function fixture(){
  const calls=[],events=new Map();let access='account-A',handler=async(action,body)=>({ok:true,communityId:body.communityId,settings:null,offers:[],observations:[]}),stored;
  const record={communityId:'11111111-1111-4111-8111-111111111111',communityWebsiteUrl:'https://subject.test/',floorPlanRatesPageUrl:'https://subject.test/floorplans'};
  const c={window:{AtlasPropertyIntelligence:{},addEventListener:(key,fn)=>events.set(key,fn),ATLAS_CENTRAL:{getAccessContextKey:()=>access,propertySpecials:(action,body)=>{calls.push({action,body});return handler(action,body);}}},Map,Set,Date,URL,Promise,setInterval:()=>{},document:{hidden:true},getProp:()=>({name:'Subject'}),savedData:{Subject:record},getCurrentCommunityRecord:()=>({...c.savedData.Subject,communityWebsiteUrl:c.communityWebsiteUrl,floorPlanRatesPageUrl:c.floorPlanRatesPageUrl}),normalizeSavedCommunityRecord:(_,r)=>({...r}),persistSaved:()=>{stored=JSON.stringify(c.savedData);},atlasStateWritePromise:Promise.resolve(),atlasStateGetValue:async()=>stored,ATLAS_STATE_COMMUNITY_KEY:'communities',queueAtlasCentralDocumentPush:()=>{},renderTab:()=>{},communityWebsiteUrl:record.communityWebsiteUrl,floorPlanRatesPageUrl:record.floorPlanRatesPageUrl};
  vm.createContext(c);vm.runInContext(fs.readFileSync(root+'property-organization.js','utf8'),c);
  return {c,calls,service:c.window.AtlasPropertyService,detail:()=>({name:'Subject',record:c.savedData.Subject}),setHandler:fn=>handler=fn,setAccess:value=>{access=value;events.get('atlas-central-auth-change')?.();}};
}
(async()=>{
  const transport=client(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(transport.propertySpecials('configure',{}),e=>e.stage==='configuration_transport'&&e.message.includes('configuration transport failure')&&!e.message.includes('Failed to fetch'));
  for(const [status,stage,error] of [[401,'authorization','Login required'],[403,'authorization','Not authorized'],[404,'community_mapping','Community missing'],[503,'storage_unavailable','Storage is unavailable']]){
    await assert.rejects(client(async()=>({ok:false,status,json:async()=>({ok:false,error})})).propertySpecials('read'),e=>e.status===status&&e.stage===stage&&e.message.includes(error));
  }
  for(const stage of ['website_retrieval','blocked_dynamic_website','extraction','conflicting_offers']){
    await assert.rejects(client(async()=>({ok:false,status:422,json:async()=>({ok:false,stage,code:'detail_code',error:'Page evidence'})})).propertySpecials('collect'),e=>e.stage===stage&&e.code==='detail_code'&&e.result.error==='Page evidence');
  }
  await assert.rejects(client(async()=>({ok:true,status:200,json:async()=>{throw Error('bad json');}})).propertySpecials('read'),e=>e.stage==='configuration_transport'&&e.message.includes('unreadable'));
  const f=fixture();await f.service.load(f.detail());assert.deepEqual(f.calls.map(c=>c.action),['read'],'Saved URLs are reconciled on the authorized server without a second configure request.');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body.savedSettings)),{communityWebsiteUrl:'https://subject.test/',floorPlanRatesPageUrl:'https://subject.test/floorplans',websiteSettingsUpdatedAt:''});
  const empty=fixture();Object.assign(empty.c.savedData.Subject,{communityWebsiteUrl:'',floorPlanRatesPageUrl:''});await empty.service.load(empty.detail());assert(!Object.hasOwn(empty.calls[0].body,'savedSettings'),'Empty unconfigured records do not submit reconciliation input.');
  empty.c.savedData.Subject.websiteSettingsUpdatedAt='2026-09-28T00:00:00Z';await empty.service.load(empty.detail(),true);assert.equal(empty.calls.at(-1).body.savedSettings.websiteSettingsUpdatedAt,'2026-09-28T00:00:00Z');assert.equal(empty.calls.at(-1).body.savedSettings.communityWebsiteUrl,'','A timestamped clear is preserved.');
  const queued=fixture(),queuedRead=queued.service.load(queued.detail());queued.setAccess('account-B');await queuedRead;assert.equal(queued.calls.length,0,'A queued read carrying saved configuration must not run under a later login.');
  await f.service.action('Subject','collect');assert.equal(f.calls.at(-1).body.communityId,'11111111-1111-4111-8111-111111111111');
  const legacy=fixture();legacy.c.savedData.Subject.communityId='community:bartram-park';
  legacy.setHandler(async()=>({ok:true,communityId:'11111111-1111-4111-8111-111111111111',offers:[],settings:null}));
  assert(!(await legacy.service.load(legacy.detail())).error);assert.equal(legacy.calls.at(-1).body.communityId,undefined,'A local graph identity is never sent as a registry identity.');
  await legacy.service.action('Subject','collect');assert.equal(legacy.calls.at(-1).body.communityId,'11111111-1111-4111-8111-111111111111','The resolved canonical identity is retained for later actions.');
  legacy.c.savedData.Subject.sourceIds={atlasCommunityId:'11111111-1111-4111-8111-111111111111'};await legacy.service.load(legacy.detail(),true);assert.equal(legacy.calls.at(-1).body.communityId,'11111111-1111-4111-8111-111111111111');
  const recovered=fixture();recovered.c.savedData.Subject.websiteSettingsUpdatedAt='2026-09-27T00:00:00Z';
  recovered.setHandler(async()=>({ok:true,communityId:'11111111-1111-4111-8111-111111111111',offers:[],settings:{website:'https://old.test/',floorplan:'https://old.test/rates',sourceUpdatedAt:'',updatedAt:'2026-09-28T00:00:00Z'}}));
  recovered.c.window.atlasLoadWebsiteSettings();await new Promise(setImmediate);assert.equal(recovered.c.savedData.Subject.communityWebsiteUrl,'https://subject.test/','A recovery timestamp does not supersede a local URL edit.');
  const reordered=fixture();let releaseRead;
  reordered.setHandler((action,body)=>action==='read'?new Promise(resolve=>releaseRead=resolve):Promise.resolve({ok:true,communityId:body.communityId,settings:{communityWebsiteUrl:body.communityWebsiteUrl,floorPlanRatesPageUrl:body.floorPlanRatesPageUrl,sourceUpdatedAt:body.websiteSettingsUpdatedAt},offers:[{id:'newer'}]}));
  const oldRead=reordered.service.load(reordered.detail());await new Promise(setImmediate);
  await reordered.c.window.atlasSaveWebsiteField('floorPlanRatesPageUrl','https://subject.test/new-rates');
  releaseRead({ok:true,communityId:'11111111-1111-4111-8111-111111111111',settings:{floorPlanRatesPageUrl:'https://subject.test/old-rates'},offers:[{id:'older'}]});await oldRead;
  assert.equal(reordered.service.cache.get('Subject').settings.floorPlanRatesPageUrl,'https://subject.test/new-rates','A read begun before configure cannot replace the newer settings.');assert.equal(reordered.service.cache.get('Subject').offers[0].id,'newer');assert.match(reordered.c.window.atlasWebsiteSaveStatus(),/URL saved centrally/);
  f.setHandler(async(action,body)=>({ok:true,communityId:body.communityId,settings:{communityId:body.communityId},current:{offerId:'verified',status:'found'},offers:[{id:'verified',text:'One month free'}],observations:[{status:'found'}]}));
  await f.service.load(f.detail(),true);
  f.setHandler(async()=>{throw Object.assign(Error('Website history transport failure.'),{stage:'configuration_transport'});});
  const failed=await f.service.load(f.detail(),true);assert.equal(failed.offers[0].id,'verified');assert.equal(failed.observations.length,1);assert.equal(failed.stage,'configuration_transport');
  await f.c.window.atlasSaveWebsiteField('floorPlanRatesPageUrl','https://subject.test/rates');
  assert.equal(f.c.savedData.Subject.floorPlanRatesPageUrl,'https://subject.test/rates');
  assert.match(f.c.window.atlasWebsiteSaveStatus(),/URL saved in community data; central website checks are not confirmed/);
  const configure=f.calls.at(-1);assert.equal(configure.action,'configure');assert.equal(configure.body.communityWebsiteUrl,'https://subject.test/');assert.equal(configure.body.floorPlanRatesPageUrl,'https://subject.test/rates');assert(configure.body.websiteSettingsUpdatedAt);assert.equal(configure.body.communityId,'11111111-1111-4111-8111-111111111111');assert(!Object.hasOwn(configure.body,'website'));
  f.setHandler(async(_,body)=>({ok:true,communityId:body.communityId,offers:[{id:'verified'}]}));
  await f.c.window.atlasRetryWebsiteSettings();assert.equal(f.calls.at(-1).action,'configure');assert.equal(f.calls.at(-1).body.websiteSettingsUpdatedAt,configure.body.websiteSettingsUpdatedAt,'Retry keeps the original URL edit revision.');assert.equal(f.calls.at(-1).body.floorPlanRatesPageUrl,'https://subject.test/rates');assert.equal(f.service.cache.get('Subject').offers[0].id,'verified');assert(!f.service.cache.get('Subject').error);assert.match(f.c.window.atlasWebsiteSaveStatus(),/URL saved centrally/);
  const retryCount=f.calls.length;f.c.savedData.Subject.floorPlanRatesPageUrl='https://subject.test/unsaved';await f.c.window.atlasRetryWebsiteSettings();assert.equal(f.calls.length,retryCount,'Retry cannot send unverified local values.');f.c.savedData.Subject.floorPlanRatesPageUrl='https://subject.test/rates';
  f.setHandler(async()=>{throw Object.assign(Error('No community access'),{stage:'authorization'});});
  assert.equal((await f.service.load(f.detail(),true)).offers.length,0,'Denied access cannot retain cached history.');
  f.setHandler(async()=>({ok:true,communityId:'22222222-2222-4222-8222-222222222222',offers:[{id:'other'}]}));
  const mismatch=await f.service.load(f.detail(),true);assert.equal(mismatch.stage,'community_mapping');assert.equal(mismatch.offers.length,0);
  let release;f.setHandler(()=>new Promise(r=>release=r));const pending=f.service.load(f.detail(),true);await new Promise(setImmediate);f.setAccess('account-B');assert.equal(f.service.cache.size,0);release({ok:true,communityId:'11111111-1111-4111-8111-111111111111',offers:[{id:'private-A'}]});await pending;assert.equal(f.service.cache.size,0,'A response from the previous login cannot repopulate the cache.');
  f.setHandler(()=>{throw Error('Synchronous connector failure');});const sync=await f.service.load(f.detail(),true);assert.equal(sync.error,'Synchronous connector failure');
  const P=require('../'+root+'property-intelligence.js'),w=f.c.window;
  Object.assign(w,{AtlasPropertyIntelligence:P,getCompCalculatorScopeMeta:()=>({marketArea:'Test market'}),getSelectedDashboardPeriodKey:()=> '2026-09',getWorkspaceScopedDetails:()=>[f.detail()],atlasPropertyMetrics:(_,range)=>P.metrics([],range),renderTab:()=>{}});
  vm.runInContext(fs.readFileSync(root+'concession-insights.js','utf8'),f.c);
  for(const [stage,label] of [['website_retrieval','Website retrieval failure'],['blocked_dynamic_website','Website blocked or requires browser rendering'],['extraction','Offer extraction failure'],['conflicting_offers','Conflicting website offers']]){
    f.service.cache.set('Subject',{_loadedAt:Date.now(),communityId:'11111111-1111-4111-8111-111111111111',current:{offerId:'verified',status:stage==='conflicting_offers'?'conflict':'failed',stage},offers:[{id:'verified',source:'website',text:'One month free',observedStart:'2026-09-01'}],observations:[{status:'failed',at:'2026-09-28',stage,pages:[{status:'failed',stage,code:'test_code',requestedUrl:'https://subject.test/floorplans',url:'https://subject.test/rates',httpStatus:403,error:'Access blocked <test>',text:'Page evidence <test>'}]}]});
    const html=w.AtlasConcessionInsights.render();assert(html.includes(label));assert(html.includes('One month free'));assert(html.includes('Access blocked &lt;test&gt;'));assert(html.includes('Page evidence &lt;test&gt;'));assert(html.includes('HTTP 403'));assert(html.includes('Retrieved: https://subject.test/rates'));
  }
  const before=f.calls.length;f.setHandler(async()=>{throw Object.assign(Error('Authorization failure'),{stage:'authorization'});});await w.atlasOfferRefresh('Subject');assert.deepEqual(f.calls.slice(before).map(c=>c.action),['read'],'Check now must not collect after failed history authorization.');
  console.log('PASS property-specials client diagnostics, canonical URL saves and identity, partial save, retained history, server reconciliation, and login isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
