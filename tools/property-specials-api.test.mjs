import assert from 'node:assert/strict';
import {loadWorker} from './load-worker-for-node-test.mjs';
const worker=await loadWorker(),original=globalThis.fetch;
let role='community_manager',calls=0,actor;
globalThis.fetch=async url=>{const u=new URL(url);let data;if(u.pathname==='/auth/v1/user')data={id:'verified-user'};else if(u.pathname.endsWith('/atlas_user_profiles'))data=[{role,status:'active',allowed_community_ids:['allowed-id']}];else if(u.pathname.endsWith('/atlas_communities'))data=[{community_id:u.searchParams.get('display_name')==='eq.Allowed Community'?'allowed-id':'other-id',display_name:'Allowed Community'}];else throw Error('Unexpected URL');return Response.json(data);};
const env={SUPABASE_SERVICE_ROLE_KEY:'mock-service-key',PROPERTY_SPECIALS:{getByName(id){return {async read(){calls++;return {ok:true,id};},async saveOffer(offer,user,admin){calls++;actor=user;assert.equal(admin,true);return {ok:true};}};}}};
const call=(action,communityName='Allowed Community',token=true)=>worker.fetch(new Request('https://test.invalid/api/atlas/property-specials',{method:'POST',headers:token?{authorization:'Bearer synthetic-token'}:{},body:JSON.stringify({communityName,action,offer:{},actor:'spoofed'})}),env);
try{
 assert.equal((await call('read','Allowed Community',false)).status,401);
 assert.equal((await call('read','Other Community')).status,403);assert.equal(calls,0);
 let r=await call('read');assert.equal(r.status,200);assert.equal((await r.json()).canManage,false);
 assert.equal((await call('saveOffer')).status,403);assert.equal(calls,1);
 role='admin';r=await call('saveOffer');assert.equal(r.status,200);assert.equal((await r.json()).canManage,true);assert.equal(actor,'verified-user');
 console.log('PASS special API authentication, community isolation, server-side admin permission and verified actor.');
}finally{globalThis.fetch=original;}
