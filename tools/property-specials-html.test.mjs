// Exercise the actual Workers HTML parser. Removing a node and collecting body
// text in one pass still exposes removed script/style text to ancestor callbacks.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,createFetchMock} from 'miniflare';

const bundle=await build({stdin:{contents:`
  import {extractHtmlPage,reconcilePages} from './src/property-specials-core.mjs';
  import {PropertySpecialsState} from './src/property-specials-store.mjs';
  export class HtmlFixtureState extends PropertySpecialsState {
    async seedPollutedForTest(){
      const at='2026-01-01T00:00:00.000Z';
      this.put('offer','polluted',{id:'polluted',source:'website',text:'} {"@context":"https://schema.org","name":"Ten weeks free rent","description":"Studio and 3 bedroom apartments"}',firstObservedAt:at,lastVerifiedAt:at,observedStart:at.slice(0,10),components:[],pages:[]});
      this.put('current','current',{offerId:'polluted',status:'found',lastCheckedAt:at,lastVerifiedAt:at});
      this.put('observation',at,{at,status:'found',pages:[{url:'https://property.example/',status:'found',evidence:'Original unmodified source observation'}]});
      return this.read();
    }
  }
  export default {async fetch(request,env){
    const input=await request.json();
    if(input.action)return Response.json(await env.SPECIALS.getByName('fixture')[input.action](...(input.args||[])));
    const page=await extractHtmlPage(new Response(input.html,{headers:{'content-type':'text/html'}}),input.url||'https://property.example/',input.at||'2026-09-28T16:00:00.000Z');
    return Response.json(input.reconcile?reconcilePages([page]):page);
  }};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',external:['cloudflare:workers']});
const fetchMock=createFetchMock();fetchMock.disableNetConnect();
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',durableObjects:{SPECIALS:{className:'HtmlFixtureState',useSQLite:true}},fetchMock});
const invoke=async input=>(await mf.dispatchFetch('https://fixture.invalid',{method:'POST',body:JSON.stringify(input)})).json();
const call=(action,...args)=>invoke({action,args});
const padding='<p>Welcome to our community. Explore apartments and floor plans, amenities, neighborhood and contact information. Our leasing team is available to answer your questions.</p>';
const html=(body,scripts='')=>'<html><head></head><body>'+padding+body+scripts+'</body></html>';
const ld=value=>'<script type="application/ld+json">'+JSON.stringify(value)+'</script>';
const announcement=(name='Ten weeks free rent',description='Available on select floorplans with a 14+ month lease when you lease within 48 hours of touring.')=>({'vendor:name':name,'vendor:description':description,'vendor:url':'/floorplans/','vendor:validFrom':'2026-01-09','vendor:validThrough':'2050-01-31'});
const schema=(announcements=[announcement()],extra={})=>({'@context':{'@vocab':'https://schema.org/','vendor':'https://schema.example/'},'@graph':[
  {'@type':['ApartmentComplex','LocalBusiness'],url:'https://property.example/',description:'Studio, one bedroom and three bedroom apartments.',accommodationFloorPlan:[{name:'Studio'},{name:'Three bedroom'}],'vendor:announcements':announcements,...extra}
]});
try {
  // Scripts and generated CSS may contain offer-like text, but are never prose.
  const noise='<script>window.special="Twelve months free rent";</script><style>.x:after{content:"Six months free rent"}</style><noscript>Eight weeks free rent</noscript><svg><text>Four months free rent</text></svg><template><div>Three months free rent</div></template>';
  let page=await invoke({html:html('<h2>One month free rent</h2><p>Available on two-bedroom apartments.</p>',noise)});
  assert.equal(page.status,'found');
  assert.equal(page.components.length,1);
  assert.equal(page.components[0].text,'One month free rent');
  assert.doesNotMatch(page.text,/window\.|content:|Twelve|Six|Eight|Four|Three months/);
  page=await invoke({html:html('<p>No current specials.</p>',noise+ld({description:'Two months free rent',floorplans:'Studio'}))});
  assert.equal(page.status,'none','Ordinary scripts and unrecognized JSON metadata cannot create offers');
  assert.doesNotMatch(page.evidence,/window\.|Two months free|@context/);

  // This generic namespaced announcement shape matches the real failing site,
  // with every business name, URL, inventory item and concession value synthetic.
  const published=html('',ld(schema()));
  page=await invoke({html:published});
  assert.equal(page.status,'found');
  assert.equal(page.evidenceType,'structured_announcement');
  assert.equal(page.text,'Ten weeks free rent Available on select floorplans with a 14+ month lease when you lease within 48 hours of touring.');
  assert.doesNotMatch(page.text,/[{}]|@context|ApartmentComplex|Studio|three bedroom|2050/);
  assert.deepEqual(page.eligibility,[],'Property inventory does not become offer eligibility');
  assert.deepEqual(page.publishedDates,[],'Schema validity dates are provenance, not advertised prose');
  assert.equal(page.structuredEvidence[0].property,'vendor:announcements');
  assert.equal(page.structuredEvidence[0].url,'https://property.example/floorplans/');
  assert.equal(page.structuredEvidence[0].validThrough,'2050-01-31');

  for(const data of [
    schema([{...announcement(),'vendor:validThrough':'2020-01-01'}]),
    schema([{...announcement(),'vendor:validFrom':'2099-01-01'}]),
    schema([{...announcement(),'vendor:validThrough':'not-a-date'}]),
    schema([{...announcement(),'vendor:validThrough':'2026-02-30'}]),
    schema([{...announcement(),'vendor:validThrough':'2020-01-01',validThrough:'2020-01-01'}]),
    schema([{...announcement(),'vendor:validFrom':'2099-01-01',validFrom:'2020-01-01'}]),
    schema([{...announcement(),name:'One month free rent'}]),
    schema([{...announcement(),description:'Another description'}]),
    schema([{...announcement(),url:'/other/'}]),
    schema([{...announcement(),'vendor:url':'https://other.example/floorplans/'}]),
    schema([{...announcement(),'vendor:url':''}]),
    schema([announcement()],{url:'https://other.example/'}),
    schema([announcement()],{url:''}),
    schema([announcement()],{'vendor:url':'/'}),
    schema([announcement()],{announcements:[announcement()]}),
    schema([{...announcement(),'vendor:name':{text:'One month free rent'}}]),
    schema([{...announcement(),'vendor:description':'<script>Two months free rent</script>'}]),
    schema([announcement()],{'@type':'Product'})
  ])assert.equal((await invoke({html:html('',ld(data))})).status,'none','Inactive, foreign or malformed announcements are ignored');
  assert.equal((await invoke({html:html('','<script type="application/ld+json">{"malformed":"Two months free rent"</script>')})).status,'none');
  assert.equal((await invoke({html:html('','<template>'+ld(schema())+'</template>')})).status,'none','Template metadata is not an active property announcement');
  assert.equal((await invoke({html:html('',ld(schema([{...announcement(),'vendor:validThrough':'2026-09-28'}])))})).status,'found','A date-only end includes the entire final calendar day');
  assert.equal((await invoke({html:html('',ld(schema([announcement()],{url:'/property-b/'}))),url:'https://property.example/property-a/'})).status,'none','Same-host sibling property announcements are not evidence for this property');
  assert.equal((await invoke({html:html('',ld(schema([{...announcement(),'vendor:url':'/property-a/floorplans/'}],{url:'/property-a/'}))),url:'https://property.example/property-a/floorplans/'})).status,'found','Property-root announcements apply to its child floor-plan page');
  assert.equal((await invoke({html:html('',ld(schema([{...announcement(),'vendor:url':'/property-b/'}],{url:'/property-a/'}))),url:'https://property.example/property-a/'})).status,'none','Announcements cannot point to a sibling community on the same host');
  assert.equal((await invoke({html:html('',ld(schema([{...announcement(),'vendor:url':'/property-b/'}],{url:'./'}))),url:'https://property.example/property-a/index.html'})).status,'none','Relative property identity is resolved against the fetched page once, never against a foreign announcement path');
  const oversized=await invoke({html:html('',ld(schema(Array.from({length:101},(_,i)=>announcement('One month free rent','Offer '+i)))))});
  assert.equal(oversized.status,'failed');
  assert.equal(oversized.code,'OFFER_EXTRACTION_LIMIT','Excessive structured offers fail for review without verifying a truncated subset');
  const manyScripts=await invoke({html:html('',Array.from({length:65},()=>ld(schema())).join(''))});
  assert.equal(manyScripts.code,'OFFER_EXTRACTION_LIMIT');
  const manyAccepted=await invoke({html:html('',Array.from({length:11},(_,i)=>ld(schema(Array.from({length:10},(_,j)=>announcement('One month free rent','Offer '+i+' '+j))))).join(''))});
  assert.equal(manyAccepted.code,'OFFER_EXTRACTION_LIMIT','Accepted-offer limit is global across scripts and schema nodes');

  const conflict=await invoke({html:html('<h2>One month free rent</h2>',ld(schema())),reconcile:true});
  assert.equal(conflict.status,'conflict','Visible and structured contradictory offers require review');
  assert.equal(conflict.pages[0].status,'conflict');
  assert.match(conflict.pages[0].text,/One month free rent/);
  assert.match(conflict.pages[0].text,/Ten weeks free rent/);
  const noneConflict=await invoke({html:html('<p>No current specials.</p>',ld(schema())),reconcile:true});
  assert.equal(noneConflict.status,'conflict','Explicit visible no-offer prose cannot be overridden by a hidden announcement');
  assert.match(noneConflict.pages[0].evidence,/No current specials/);
  page=await invoke({html:html('',ld(schema([announcement('One month free rent','For studio apartments.'),announcement('Two months free rent','For three-bedroom apartments.')]))),reconcile:true});
  assert.equal(page.status,'found');
  assert.deepEqual(page.components.map(part=>part.eligibility),['studio','3bed'],'Each announcement keeps its own eligibility across page reconciliation');
  const multi=await invoke({html:html('',ld(schema([announcement('One month free rent','For studio apartments.'),announcement('Two months free rent','For three-bedroom apartments.'),announcement('Three months free rent','For studio apartments.')]))),reconcile:true});
  assert.equal(multi.status,'conflict','Every structured offer pair is checked, not just the first two');

  await call('configure',{communityId:'fixture',website:'https://property.example/'},'fixture-admin');
  const before=await call('seedPollutedForTest');
  const collect=async()=>{
    fetchMock.get('https://property.example').intercept({path:'/'}).reply(200,published,{headers:{'content-type':'text/html'}});
    return call('collect');
  };
  const corrected=await collect();
  assert.equal(corrected.current.status,'found');
  assert.notEqual(corrected.current.offerId,'polluted');
  assert.equal(corrected.offers.length,2);
  const old=corrected.offers.find(offer=>offer.id==='polluted');
  assert.equal(old.text,before.offers[0].text,'Previously recorded polluted offer text is not rewritten');
  assert(old.closedAt,'Next valid collection closes the prior observed offer normally');
  assert.deepEqual(corrected.observations[0],before.observations[0],'Original evidence remains unchanged');
  assert.equal(corrected.observations.at(-1).pages[0].structuredEvidence[0].format,'json-ld');
  assert.equal(corrected.offers.find(offer=>offer.id===corrected.current.offerId).pages[0].evidenceType,'structured_announcement');
  const unchanged=await collect();
  assert.equal(unchanged.offers.length,2,'Repeating clean structured evidence does not duplicate the corrected offer');
  assert.equal(unchanged.current.offerId,corrected.current.offerId);
  console.log('PASS real HTMLRewriter sanitization, bounded JSON-LD announcement prose/provenance, foreign/inactive/malformed rejection, conflicts and history-preserving correction.');
} finally {await mf.dispose();}
