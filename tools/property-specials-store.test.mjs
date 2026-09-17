import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,createFetchMock} from 'miniflare';
const bundle=await build({stdin:{contents:`export {PropertySpecialsState} from './src/property-specials-store.mjs';export default {async fetch(r,env){const {action,args}=await r.json();try{return Response.json(await env.SPECIALS.getByName('fixture')[action](...args));}catch(e){return Response.json({error:e.message},{status:400});}}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',external:['cloudflare:workers']});
const fetchMock=createFetchMock();fetchMock.disableNetConnect();
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',durableObjects:{SPECIALS:{className:'PropertySpecialsState',useSQLite:true}},fetchMock});
const call=async(action,...args)=>(await mf.dispatchFetch('https://test.invalid',{method:'POST',body:JSON.stringify({action,args})})).json();
const mock=(path,offer,status=200)=>fetchMock.get('https://property.example').intercept({path}).reply(status,`<html><body><h1>Our apartment community</h1><p>Welcome to our beautiful community. Find the perfect home, explore amenities, floor plans and the neighborhood, or contact our leasing team to arrange a visit.</p><div>${offer}</div></body></html>`,{headers:{'content-type':'text/html'}});
try{
 let s=await call('configure',{website:'https://property.example',floorplan:''},'admin');assert(s.settings.website);
 s=await call('saveOffer',{text:'Manual two months free',start:'2026-09-01',mode:'current'},'staff',false);assert.match(s.error,/admin/);
 s=await call('saveOffer',{text:'Manual two months free',start:'2026-09-01',mode:'current'},'admin',true);assert.equal(s.current.status,'manual');const manual=s.current.offerId;
 mock('/','One month free rent');s=await call('collect');assert.equal(s.current.status,'found');assert.notEqual(s.current.offerId,manual);const first=s.current.offerId;assert(s.offers.find(o=>o.id===manual).closedAt);
 mock('/','One month free rent');s=await call('collect');assert.equal(s.current.offerId,first);assert.equal(s.offers.filter(o=>o.source==='website').length,1);
 mock('/','',503);s=await call('collect');assert.equal(s.current.status,'failed');assert.equal(s.current.offerId,first);
 await call('configure',{website:'https://property.example',floorplan:'https://property.example/plans'},'admin');
 mock('/','One month free rent');mock('/plans','Two months free rent');s=await call('collect');assert.equal(s.current.status,'conflict');assert.equal(s.current.offerId,first);assert.equal(s.observations.at(-1).pages.length,2);
 mock('/','No current specials');mock('/plans','No current specials');s=await call('collect');assert.equal(s.current.status,'none');assert.equal(s.offers.find(o=>o.id===s.current.offerId).text,'No special listed');
 const saved=await call('read');assert(saved.offers.length>=3);assert(saved.audit.length>=4);
 s=await call('removeOffer',manual,'staff',false);assert.match(s.error,/admin/);
 s=await call('removeOffer',manual,'admin',true);assert(s.offers.find(o=>o.id===manual).deletedAt);
 console.log('PASS real Durable Object storage: admin guard, manual replacement, stable history, failure/conflict carry-forward, confirmed no-offer and audit persistence.');
}finally{await mf.dispose();}
