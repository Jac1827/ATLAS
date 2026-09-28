import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,createFetchMock} from 'miniflare';
const bundle=await build({stdin:{contents:`import {PropertySpecialsState} from './src/property-specials-store.mjs';export class FixtureState extends PropertySpecialsState {async seedLegacyForTest(settings){this.put('settings','current',settings);return this.read();}async clearAlarmForTest(){await this.ctx.storage.deleteAlarm();return this.read();}}export default {async fetch(r,env){const {action,args,community='fixture'}=await r.json();try{return Response.json(await env.SPECIALS.getByName(community)[action](...args));}catch(e){return Response.json({error:e.message,stage:e.stage,code:e.code},{status:e.status||400});}}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',external:['cloudflare:workers']});
const fetchMock=createFetchMock();fetchMock.disableNetConnect();
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',durableObjects:{SPECIALS:{className:'FixtureState',useSQLite:true}},fetchMock});
const callFor=async(community,action,...args)=>(await mf.dispatchFetch('https://test.invalid',{method:'POST',body:JSON.stringify({community,action,args})})).json();
const call=(action,...args)=>callFor('fixture',action,...args);
const mock=(path,offer,status=200)=>fetchMock.get('https://property.example').intercept({path}).reply(status,`<html><body><h1>Our apartment community</h1><p>Welcome to our beautiful community. Find the perfect home, explore amenities, floor plans and the neighborhood, or contact our leasing team to arrange a visit.</p><div>${offer}</div></body></html>`,{headers:{'content-type':'text/html'}});
try{
 let s=await call('configure',{website:'https://property.example',floorplan:''},'admin');assert(s.settings.website);assert(s.nextCollectionAt>Date.now());assert.equal(s.settings.authoritativeSettings,true);
 s=await call('saveOffer',{text:'Manual two months free',start:'2026-09-01',mode:'current'},'staff',false);assert.match(s.error,/admin/);assert.equal(s.status,403);assert.equal(s.stage,'authorization');
 s=await call('saveOffer',{text:'Manual two months free',start:'2026-09-01',mode:'current'},'admin',true);assert.equal(s.current.status,'manual');const manual=s.current.offerId;
 const manualState=s;
 s=await call('saveOffer',{text:'Invalid manual dates',start:'2026-02-31'},'admin',true);assert.equal(s.status,400);assert.equal(s.stage,'configuration');assert.equal(s.code,'OFFER_VALIDATION_FAILED');assert.deepEqual(await call('read'),manualState);
 s=await call('saveOffer',{id:manual,text:'Stale edit',start:'2026-09-01',expectedUpdatedAt:'2026-01-01T00:00:00.000Z'},'admin',true);assert.equal(s.status,409);assert.equal(s.stage,'configuration');assert.deepEqual(await call('read'),manualState);
 mock('/','One month free rent');s=await call('collect');assert.equal(s.current.status,'found');assert.notEqual(s.current.offerId,manual);const first=s.current.offerId;assert(s.offers.find(o=>o.id===manual).closedAt);
 const websiteState=s;s=await call('removeOffer',first,'admin',true);assert.equal(s.status,400);assert.equal(s.stage,'configuration');assert.deepEqual(await call('read'),websiteState);
 mock('/','One month free rent');s=await call('collect');assert.equal(s.current.offerId,first);assert.equal(s.offers.filter(o=>o.source==='website').length,1);
 mock('/','',503);s=await call('collect');assert.equal(s.current.status,'failed');assert.equal(s.current.offerId,first);assert.equal(s.current.stage,'website_retrieval');assert.equal(s.observations.at(-1).pages[0].httpStatus,503);assert(s.observations.at(-1).pages[0].evidence);
 mock('/','Access denied',403);s=await call('collect');assert.equal(s.current.stage,'blocked_dynamic_website');assert.equal(s.current.offerId,first);
 mock('/','Contact us about our special offer');s=await call('collect');assert.equal(s.current.stage,'extraction');assert.equal(s.current.offerId,first);assert(s.observations.at(-1).pages[0].evidence);
 await call('configure',{website:'https://property.example',floorplan:'https://property.example/plans'},'admin');
 mock('/','One month free rent');mock('/plans','Two months free rent');s=await call('collect');assert.equal(s.current.status,'conflict');assert.equal(s.current.offerId,first);assert.equal(s.current.stage,'conflicting_offers');assert.equal(s.observations.at(-1).pages.length,2);assert.deepEqual(s.observations.at(-1).pages.map(p=>p.requestedUrl),['https://property.example/','https://property.example/plans']);
 const websiteCount=s.offers.filter(o=>o.source==='website').length;
 mock('/','Two months free rent');mock('/plans','Two months free rent');s=await call('collect');assert.equal(s.current.status,'found');assert.equal(s.current.stage,undefined);assert.equal(s.offers.filter(o=>o.source==='website').length,websiteCount+1);const changed=s.current.offerId;
 mock('/','Two months free rent');mock('/plans','Two months free rent');s=await call('collect');assert.equal(s.current.offerId,changed);assert.equal(s.offers.filter(o=>o.source==='website').length,websiteCount+1);
 mock('/','No current specials');mock('/plans','No current specials');s=await call('collect');assert.equal(s.current.status,'none');assert.equal(s.offers.find(o=>o.id===s.current.offerId).text,'No special listed');
 const saved=await call('read');assert(saved.offers.length>=3);assert(saved.audit.length>=4);
 s=await call('removeOffer',manual,'staff',false);assert.match(s.error,/admin/);
 s=await call('removeOffer',manual,'admin',true);assert(s.offers.find(o=>o.id===manual).deletedAt);
 // A canonical community snapshot repairs missing settings and scheduling, but is
 // never allowed to mutate verified evidence or cross the community boundary.
 const canonical={communityId:'bartram-park',communityName:'Bartram Park',communityWebsiteUrl:'https://property.example/',floorPlanRatesPageUrl:'https://property.example/plans',websiteSettingsUpdatedAt:'2026-09-17T10:00:00.000Z'};
 const bartram=(action,...args)=>callFor('bartram-park',action,...args);
 s=await bartram('seedLegacyForTest',{communityId:canonical.communityId,website:canonical.communityWebsiteUrl,floorplan:'',updatedAt:'2026-09-16T10:00:00.000Z'});
 mock('/','One month free rent');s=await bartram('collect');const verified=s;
 s=await bartram('reconcileSettings',{...canonical,communityWebsiteUrl:'https://different.example/'},'admin');assert.equal(s.settings.website,canonical.communityWebsiteUrl);assert.equal(s.settings.floorplan,canonical.floorPlanRatesPageUrl);assert.equal(s.settings.sourceUpdatedAt,canonical.websiteSettingsUpdatedAt);assert.equal(s.reconciliation.settingsChanged,true);assert.equal(s.reconciliation.alarmRepaired,true);assert.deepEqual(s.offers,verified.offers);assert.deepEqual(s.observations,verified.observations);assert.deepEqual(s.current,verified.current);const reconciled=s;
 s=await bartram('reconcileSettings',canonical,'admin');assert.deepEqual(s.reconciliation,{settingsChanged:false,alarmRepaired:false});assert.equal(s.nextCollectionAt,reconciled.nextCollectionAt);assert.deepEqual(s.audit,reconciled.audit);
 await bartram('clearAlarmForTest');s=await bartram('reconcileSettings',canonical,'admin');assert.equal(s.reconciliation.alarmRepaired,true);assert.equal(s.reconciliation.settingsChanged,false);assert.deepEqual(s.offers,verified.offers);
 s=await bartram('configure',{...canonical,communityWebsiteUrl:'',floorPlanRatesPageUrl:''},'admin');assert.equal(s.nextCollectionAt,null);s=await bartram('reconcileSettings',canonical,'admin');assert.equal(s.settings.website,'');assert.equal(s.settings.floorplan,'');assert.equal(s.nextCollectionAt,null);assert.deepEqual(s.offers,verified.offers);
 s=await bartram('reconcileSettings',{...canonical,communityId:'another-community'},'admin');assert.match(s.error,/another community/);assert.equal(s.stage,'community_mapping');assert.equal(s.status,409);
 const beforeStale=await bartram('read');s=await bartram('configure',{...canonical,websiteSettingsUpdatedAt:'2026-09-16T10:00:00.000Z'},'admin');assert.equal(s.ok,false);assert.equal(s.status,409);assert.equal(s.code,'STALE_WEBSITE_SETTINGS');assert.deepEqual(await bartram('read'),beforeStale);
 s=await bartram('configure',{...canonical,communityWebsiteUrl:'http://127.0.0.1'},'admin');assert.equal(s.ok,false);assert.equal(s.stage,'configuration');assert.equal(s.status,400);assert.deepEqual(await bartram('read'),beforeStale);
 // Explicit recovery may trust a newer saved source revision even after an older
 // configuration succeeded. Replays and stale snapshots cannot resurrect URLs.
 s=await bartram('reconcileSettings',{...canonical,websiteSettingsUpdatedAt:'2026-09-16T10:00:00.000Z'},'admin');assert.equal(s.settings.website,'');assert.equal(s.nextCollectionAt,null);
 s=await bartram('reconcileSettings',{...canonical,websiteSettingsUpdatedAt:'2026-09-18T10:00:00.000Z'},'admin');assert.equal(s.settings.website,canonical.communityWebsiteUrl);assert.equal(s.settings.floorplan,canonical.floorPlanRatesPageUrl);assert.equal(s.settings.authoritativeSettings,true);assert(s.nextCollectionAt>Date.now());assert.deepEqual(s.offers,verified.offers);assert.deepEqual(s.observations,verified.observations);const recovered=s;
 s=await bartram('reconcileSettings',{...canonical,websiteSettingsUpdatedAt:'2026-09-18T10:00:00.000Z'},'admin');assert.equal(s.reconciliation.settingsChanged,false);assert.deepEqual(s.audit,recovered.audit);
 s=await bartram('reconcileSettings',{communityId:canonical.communityId,communityWebsiteUrl:'https://updated.example/',floorPlanRatesPageUrl:undefined,sourceUpdatedAt:'2026-09-19T10:00:00.000Z'},'admin');assert.equal(s.settings.website,'https://updated.example/');assert.equal(s.settings.floorplan,canonical.floorPlanRatesPageUrl);
 s=await bartram('reconcileSettings',{...canonical,communityWebsiteUrl:'',floorPlanRatesPageUrl:'',websiteSettingsUpdatedAt:'2026-09-20T10:00:00.000Z'},'admin');assert.equal(s.settings.website,'');assert.equal(s.settings.floorplan,'');assert.equal(s.nextCollectionAt,null);assert.equal(s.reconciliation.alarmRepaired,true);
 s=await bartram('reconcileSettings',canonical,'admin');assert.equal(s.settings.website,'');assert.equal(s.nextCollectionAt,null);assert.deepEqual(s.offers,verified.offers);
 s=await callFor('second-community','reconcileSettings',{communityId:'second-community',communityWebsiteUrl:'https://second.example/'},'admin');assert.equal(s.settings.communityId,'second-community');assert.equal(s.settings.sourceUpdatedAt,'');assert.equal(s.offers.length,0);assert.equal(s.observations.length,0);assert(s.nextCollectionAt>Date.now());
 const isolated=await bartram('read');assert.equal(isolated.settings.communityId,'bartram-park');assert.deepEqual(isolated.offers,verified.offers);
 console.log('PASS real Durable Object storage: admin guard, manual replacement, stable history, failure/conflict carry-forward, confirmed no-offer and audit persistence.');
 console.log('PASS canonical settings reconciliation: missing-only URL recovery, alarm repair, intentional clearing, verified history preservation, idempotence, diagnostics and community isolation.');
}finally{await mf.dispose();}
