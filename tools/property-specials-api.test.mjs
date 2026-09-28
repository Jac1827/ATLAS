import assert from 'node:assert/strict';
import {loadWorker} from './load-worker-for-node-test.mjs';
const worker=await loadWorker(),original=globalThis.fetch;
const allowed='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const communities=[{community_id:allowed,display_name:'Allowed Community',canonical_name:'allowed-community'},{community_id:other,display_name:'Other Community',canonical_name:'other-community'}];
let role='community_manager',calls=0,actor,projectionAvailable=true,ambiguous=false,settings=null,configured,sourceToken;
globalThis.fetch=async (url,options)=>{
 const u=new URL(url);let data;
 if(u.pathname==='/auth/v1/user')data={id:'verified-user'};
 else if(u.pathname.endsWith('/atlas_user_profiles'))data=[{role,status:'active',allowed_community_ids:[allowed]}];
 else if(u.pathname.endsWith('/atlas_communities')) {
  data=communities.filter(c=>['community_id','display_name','canonical_name','source_identifier'].some(k=>u.searchParams.get(k)==='eq.'+c[k]));
  if(ambiguous&&data.length)data=[...data,{...data[0],community_id:other}];
 } else if(u.pathname.endsWith('/rpc/atlas_read_workspace_projection')) {
  sourceToken=options.headers.get('authorization');
  data=projectionAvailable?{status:'available',projection:{communityData:{'Allowed Community':{communityId:allowed,communityWebsiteUrl:'https://allowed.example.com/',floorPlanRatesPageUrl:'https://allowed.example.com/rates'},'Other Community':{communityId:other,communityWebsiteUrl:'https://other.example.com/'}}}}:{status:'unavailable'};
 } else throw Error('Unexpected URL '+url);
 return Response.json(data);
};
const env={SUPABASE_SERVICE_ROLE_KEY:'mock-service-key',PROPERTY_SPECIALS:{getByName(id){calls++;assert.equal(id,allowed);return {
 async read(){return {ok:true,settings};},
 async reconcileSettings(value,user){actor=user;configured=value;settings={...value,website:value.communityWebsiteUrl||settings?.website,floorplan:value.floorPlanRatesPageUrl||settings?.floorplan};return {ok:true,settings};},
 async configure(value,user){actor=user;configured=value;return {ok:true,settings:value};},
 async saveOffer(offer,user,admin){actor=user;assert.equal(admin,true);return {ok:true};},
 async collect(){return {ok:true,observations:[{status:'none',pages:[]}]};}
};}}};
const call=(action,extra={},customEnv=env,token=true)=>worker.fetch(new Request('https://test.invalid/api/atlas/property-specials',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer synthetic-token'}:{})},body:JSON.stringify({communityName:'Allowed Community',action,offer:{},actor:'spoofed',...extra})}),customEnv);
try{
 let r=await worker.fetch(new Request('https://test.invalid/api/atlas/property-specials',{method:'OPTIONS',headers:{Origin:'https://frontend.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}}),{});
 assert.equal(r.status,204);assert.equal(await r.text(),'');assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.match(r.headers.get('access-control-allow-methods'),/POST/);assert.match(r.headers.get('access-control-allow-headers'),/authorization/);assert.match(r.headers.get('access-control-allow-headers'),/content-type/);assert.equal(calls,0);
 r=await call('read',{},env,false);assert.equal(r.status,401);assert.equal((await r.json()).stage,'authorization');
 r=await call('read',{communityName:'Other Community'});assert.equal(r.status,403);assert.equal(calls,0);
 r=await call('read',{communityId:other});assert.equal(r.status,409);assert.equal((await r.json()).code,'COMMUNITY_ID_MISMATCH');
 r=await call('read',{communityId:'33333333-3333-4333-8333-333333333333'});assert.equal(r.status,404);assert.equal(calls,0);
 r=await call('read',{communityId:'local-name'});assert.equal(r.status,400);assert.equal((await r.json()).stage,'community_mapping');
 ambiguous=true;r=await call('read');assert.equal(r.status,404);ambiguous=false;
 r=await call('read');assert.equal(r.status,200);let result=await r.json();assert.equal(result.communityId,allowed);assert.equal(result.canManage,false);assert.equal(configured.communityWebsiteUrl,'https://allowed.example.com/');assert.equal(configured.floorPlanRatesPageUrl,'https://allowed.example.com/rates');assert.equal(sourceToken,'Bearer synthetic-token');assert.equal(actor,'verified-user');
 assert.equal((await call('saveOffer')).status,403);
 role='admin';r=await call('saveOffer');assert.equal(r.status,200);assert.equal((await r.json()).canManage,true);assert.equal(actor,'verified-user');
 r=await call('configure',{communityWebsiteUrl:'https://new.example.com/',floorPlanRatesPageUrl:'https://new.example.com/plans',websiteSettingsUpdatedAt:'2026-09-28T12:00:00Z'});assert.equal(r.status,200);assert.equal(configured.communityId,allowed);assert.equal(configured.sourceUpdatedAt,'2026-09-28T12:00:00Z');
 r=await call('read',{}, {...env,PROPERTY_SPECIALS:null});assert.equal(r.status,503);assert.equal((await r.json()).stage,'storage_unavailable');
 settings=null;projectionAvailable=false;r=await call('reconcile');assert.equal(r.status,503);assert.equal((await r.json()).code,'SAVED_SETTINGS_UNAVAILABLE');
 r=await call('read',{savedSettings:{communityId:other,communityWebsiteUrl:'https://saved.example.com/',floorPlanRatesPageUrl:'https://saved.example.com/plans',websiteSettingsUpdatedAt:'2026-09-28T13:00:00Z'}});assert.equal(r.status,200);assert.equal(configured.communityId,allowed);assert.equal(configured.configurationSource,'saved_community_data');assert.equal(configured.sourceUpdatedAt,'2026-09-28T13:00:00Z');assert.equal(configured.floorPlanRatesPageUrl,'https://saved.example.com/plans');
 r=await call('configure',{}, {...env,PROPERTY_SPECIALS:{getByName(){return {configure:async()=>({ok:false,status:409,stage:'configuration',code:'STALE_WEBSITE_SETTINGS',error:'Saved URLs changed.'})};}}});assert.equal(r.status,409);assert.equal((await r.json()).code,'STALE_WEBSITE_SETTINGS');
 r=await call('collect', {savedSettings:{}}, {...env,PROPERTY_SPECIALS:{getByName(){return {read:async()=>({ok:true}),reconcileSettings:async()=>({ok:false,status:400,stage:'configuration',code:'INVALID_URL',error:'Invalid URL'}),collect:async()=>{throw Error('Must not collect after recovery failure');}};}}});assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_URL');
 r=await call('read',{}, {...env,PROPERTY_SPECIALS:{getByName(){throw Error('Object unavailable');}}});assert.equal(r.status,503);assert.equal((await r.json()).stage,'storage_unavailable');
 console.log('PASS property-specials preflight headers, auth, canonical mapping, no name fallback, scope isolation, persisted URL recovery, storage diagnostics and verified actor.');
}finally{globalThis.fetch=original;}
