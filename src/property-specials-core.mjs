// Validation and collection rules, shared by the service and its tests.
export const fail = (message, status = 400, stage, code) => Object.assign(new Error(message), {status,...(stage?{stage}:{}),...(code?{code}:{})});
export const nextCollection = (now = Date.now()) => {
  const d = new Date(now); d.setUTCHours(11, 0, 0, 0);
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime(); // Fixed 06:00 EST, including weekends.
};
export function publicUrl(value) {
  if (!value) return '';
  let u; try { u = new URL(String(value).trim()); } catch { throw fail('Enter a complete http:// or https:// website address.'); }
  const h = u.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.port && !['80','443'].includes(u.port)) ||
      !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)) throw fail('Use a public property website address.');
  u.hash = ''; return u.href;
}
export const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
export const signature = v => clean(v).toLowerCase().replace(/[.!]/g, '');
export function components(text) {
  return [...text.matchAll(/(?:up to\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|six|eight|ten|twelve)\s*(?:months?|weeks?)\s*(?:of\s+)?free(?:\s+rent)?|\$[\d,]+\s*(?:gift\s*card|off(?:\s+rent)?|(?:application|admin(?:istration)?)\s*fee)|(?:free|waived)\s+(?:parking|storage|application\s*fees?|admin(?:istration)?\s*fees?)/gi)]
    .map(m => ({text:clean(m[0]),type:/gift/i.test(m[0])?'gift_card':/parking/i.test(m[0])?'parking':/storage/i.test(m[0])?'storage':/fee/i.test(m[0])?'fees':'rent'}));
}
export function extractPage(text, url, at) {
  const body = String(text || '');
  if (body.length < 150 || /verify you are human|checking your browser|access denied|enable javascript to (?:continue|run)|just a moment/i.test(body)) return {url,at,status:'failed',stage:'blocked_dynamic_website',code:'WEBSITE_BLOCKED_OR_DYNAMIC',error:'Website blocked or did not provide readable content.',evidence:body.slice(0,3000)};
  const lines = body.split(/\n+/).map(clean).filter(Boolean);
  const offers = lines.flatMap((line,i) => components(line).length ? [clean([lines[i-1] || '',line,lines[i+1] || ''].join(' ')).slice(0,2500)] : []);
  if (!offers.length && /special|concession|limited.time|leasing.offer/i.test(body) && !/no (?:current |active )?(?:specials?|offers?)/i.test(body)) return {url,at,status:'failed',stage:'extraction',code:'OFFER_EXTRACTION_FAILED',error:'Offer language requires review; no reliable offer terms were extracted.',text:body.slice(0,3000),evidence:body.slice(0,3000)};
  const offer = [...new Set(offers)].join('\n').slice(0,12000);
  return {...offerPage(offer,url,at),evidence:offer || body.slice(0,3000)};
}
function offerPage(offer,url,at) {
  const publishedDates=[...offer.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g)].map(m=>m[0]);
  const eligibility=[...offer.matchAll(/\b(?:studios?|one[- ]bed(?:room)?|two[- ]bed(?:room)?|three[- ]bed(?:room)?|[123][- ]bed(?:room)?|[A-D]\d(?:-\d)?\s*(?:floor\s*plans?)?)\b/gi)].map(m=>signature(m[0]).replace(/one/g,'1').replace(/two/g,'2').replace(/three/g,'3').replace(/bedroom/g,'bed').replace(/[ -]/g,'').replace(/^studios$/,'studio'));
  const leaseTerms=[...offer.matchAll(/\b(\d{1,2})(?:[- ]to[- ]|\s*[-–]\s*)?(\d{1,2})?[- ]months?\s+leases?\b/gi)].map(m=>m[1]+(m[2]?'-'+m[2]:''));
  return {url,at,status:offer?'found':'none',text:offer,components:components(offer),publishedDates,leaseTerms,eligibility:[...new Set(eligibility)]};
}
const schemaName=value=>String(value).split(/[:/#]/).at(-1);
const ambiguousSchemaField=Symbol('ambiguous schema field');
function schemaField(object,name) {
  const values=Object.entries(object).filter(([key])=>schemaName(key)===name).map(([,value])=>value);
  return values.length>1?ambiguousSchemaField:values[0];
}
function sameOriginAddress(value,base) {
  if(typeof value!=='string'||!value.trim())return '';
  try {const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)&&url.origin===new URL(base).origin&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function ownsPage(owner,page) {
  const address=sameOriginAddress(owner,page);if(!address)return false;
  const path=new URL(address).pathname.replace(/\/$/,''),pagePath=new URL(page).pathname.replace(/\/$/,'');
  return !path||pagePath===path||pagePath.startsWith(path+'/');
}
const announcementLimit=()=>fail('Website announcements exceed the review limit.',502,'extraction','OFFER_EXTRACTION_LIMIT');
// Deliberately read announcement prose only. A property's description, unit mix,
// amenities and inventory are not offer terms or eligibility restrictions.
export function structuredAnnouncements(payloads,url,at) {
  const result=[],seen=new Set(),observed=Date.parse(at);let totalText=0;
  if(payloads.length>64)throw announcementLimit();
  for(const payload of payloads){
    let document;try{document=JSON.parse(payload);}catch{continue;}
    const roots=Array.isArray(document)?document:[document];
    const nodes=roots.flatMap(node=>node&&typeof node==='object'?[node,...(Array.isArray(node['@graph'])?node['@graph']:[])]:[]);
    if(nodes.length>1000)throw announcementLimit();
    for(const node of nodes){
      if(!node||typeof node!=='object'||Array.isArray(node))continue;
      const types=[].concat(node['@type']||[]).map(schemaName);
      if(!types.some(type=>['ApartmentComplex','LocalBusiness'].includes(type)))continue;
      const propertyUrl=sameOriginAddress(schemaField(node,'url'),url);
      if(!propertyUrl||!ownsPage(propertyUrl,url))continue;
      const fields=Object.entries(node).filter(([key])=>schemaName(key)==='announcements');
      if(fields.length!==1)continue;
      for(const [property,value] of fields){
        const entries=[].concat(value||[]);if(entries.length>100)throw announcementLimit();
        for(const announcement of entries){
          if(!announcement||typeof announcement!=='object'||Array.isArray(announcement))continue;
          const name=schemaField(announcement,'name'),description=schemaField(announcement,'description');
          if((name!==undefined&&typeof name!=='string')||(description!==undefined&&typeof description!=='string'))continue;
          // Supported structured fields are plain prose. Do not render embedded
          // markup or accidentally reinterpret nested JSON as offer evidence.
          const text=clean([name,description].filter(Boolean).join(' '));
          if(!text||text.length>6000||/<[^>]*>|[{}]/.test(text)||!components(text).length)continue;
          const address=schemaField(announcement,'url');
          if(address!==undefined&&(typeof address!=='string'||!sameOriginAddress(address,url)||!ownsPage(propertyUrl,sameOriginAddress(address,url))))continue;
          const validFrom=schemaField(announcement,'validFrom'),validThrough=schemaField(announcement,'validThrough');
          if([validFrom,validThrough].some(value=>value!==undefined&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)||!validDate(value.slice(0,10))||!Number.isFinite(Date.parse(value)))))continue;
          const starts=validFrom?Date.parse(validFrom):-Infinity;
          const ends=validThrough?Date.parse(validThrough)+(/^\d{4}-\d{2}-\d{2}$/.test(validThrough)?86400000-1:0):Infinity;
          if(starts>ends||!Number.isFinite(observed)||observed<starts||observed>ends)continue;
          const key=signature(text);if(seen.has(key))continue;seen.add(key);
          totalText+=text.length;if(result.length>=100||totalText>24000)throw announcementLimit();
          const structuredSource={format:'json-ld',property,propertyUrl,name:clean(name),description:clean(description),
            ...(address?{url:sameOriginAddress(address,url)}:{}),...(validFrom?{validFrom}:{}),...(validThrough?{validThrough}:{})};
          result.push({...offerPage(text,url,at),evidence:text,structuredSource});
        }
      }
    }
  }
  return result;
}
export async function extractHtmlPage(response,url,at) {
  let text='',activeScript=null,ignoredDepth=0;const payloads=[];
  // Removal affects the output stream, not ancestor text callbacks in the same
  // pass. Feed the sanitized output to a second parser before collecting prose.
  const sanitized=new HTMLRewriter()
    .on('script',{element(element){
      activeScript=null;
      if(!ignoredDepth&&String(element.getAttribute('type')||'').split(';')[0].trim().toLowerCase()==='application/ld+json'&&payloads.length<65){activeScript={text:''};payloads.push(activeScript);}
      element.onEndTag(()=>{activeScript=null;});element.remove();
    },text(chunk){if(activeScript)activeScript.text+=chunk.text;}})
    .on('noscript,svg,template',{element(element){ignoredDepth++;element.onEndTag(()=>{ignoredDepth--;});element.remove();}})
    .on('style',{element(element){element.remove();}}).transform(response);
  const rewritten=new HTMLRewriter().on('body',{text(chunk){text+=chunk.text;}})
    .on('p,div,li,h1,h2,h3,br',{element(){text+='\n';}})
    .on('img',{element(element){const alt=element.getAttribute('alt');if(alt)text+='\n'+alt+'\n';}}).transform(sanitized);
  await rewritten.text();
  const visible=extractPage(text,url,at);let announcements;
  try{announcements=structuredAnnouncements(payloads.map(item=>item.text),url,at);}
  catch(error){return {url,at,status:'failed',stage:'extraction',code:error.code||'OFFER_EXTRACTION_FAILED',error:error.message,evidence:visible.evidence};}
  if(!announcements.length||visible.stage==='blocked_dynamic_website')return visible;
  const candidates=[...(visible.status==='found'?[visible]:[]),...announcements];
  const {pages,...reconciled}=reconcilePages(candidates);
  const noOffer=text.match(/\bno (?:current |active )?(?:specials?|offers?)\b/i)?.[0];
  const combined=noOffer?{status:'conflict',stage:'conflicting_offers',code:'CONFLICTING_OFFERS',error:'Visible no-offer notice conflicts with a structured announcement.'}:reconciled;
  const evidence=combined.text||[noOffer,...candidates.map(page=>page.text)].filter(Boolean).join('\n');
  return {...combined,url,at,text:evidence,evidence,evidenceType:visible.status==='found'?'visible_and_structured':'structured_announcement',
    structuredEvidence:announcements.map(page=>page.structuredSource),
    publishedDates:[...new Set(candidates.flatMap(page=>page.publishedDates||[]))],
    leaseTerms:[...new Set(candidates.flatMap(page=>page.leaseTerms||[]))],
    eligibility:[...new Set(candidates.flatMap(page=>page.eligibility||[]))]};
}
export function reconcilePages(pages) {
  if (!pages.length) return {status:'failed',pages,stage:'configuration',code:'WEBSITE_URL_MISSING',error:'No website URL configured.'};
  const failed=pages.find(p=>p.status==='failed');
  if (failed) return {status:'failed',pages,stage:failed.stage||'website_retrieval',code:failed.code||'WEBSITE_RETRIEVAL_FAILED',error:failed.error||'Website retrieval failed.'};
  const conflict=pages.find(p=>p.status==='conflict');
  if(conflict)return {status:'conflict',pages,stage:'conflicting_offers',code:'CONFLICTING_OFFERS',error:conflict.error||'Conflicting website offers—review required.'};
  const found = pages.filter(p=>p.status==='found');
  if (!found.length) return {status:'none',text:'No special listed',components:[],pages};
  // An offer on a main page and no offer on a pricing page is not contradictory.
  // Different eligibility is retained; incompatible terms for the same offer type require review.
  for(let i=0;i<found.length;i++)for(let j=i+1;j<found.length;j++){
    const a=found[i],b=found[j];
    const sharedTypes = a.components.map(c=>c.type).filter(t=>b.components.some(c=>c.type===t));
    const differing = sharedTypes.some(t=>signature(a.components.filter(c=>c.type===t).map(c=>c.text).sort().join('|')) !== signature(b.components.filter(c=>c.type===t).map(c=>c.text).sort().join('|')));
    const floorplansDiffer=a.eligibility?.length&&b.eligibility?.length&&!a.eligibility.some(v=>b.eligibility.includes(v));
    const leaseWindows=p=>(p.leaseTerms||[]).flatMap(term=>{const [lo,hi=lo]=term.split('-').map(Number);return Array.from({length:Math.max(0,hi-lo+1)},(_,i)=>lo+i);});
    const al=leaseWindows(a),bl=leaseWindows(b),leaseTermsDiffer=al.length&&bl.length&&!al.some(v=>bl.includes(v));
    const distinctEligibility=floorplansDiffer||leaseTermsDiffer;
    if (!distinctEligibility && (differing || (signature(a.text)!==signature(b.text) && /restrictions?|lease terms?|select (?:units|floor)|only|move.in by/i.test(a.text+b.text)))) return {status:'conflict',pages,stage:'conflicting_offers',code:'CONFLICTING_OFFERS',error:'Conflicting website offers—review required.'};
  }
  return {status:'found',text:[...new Set(found.map(p=>p.text))].join('\n'),components:[...new Map(found.flatMap(p=>p.components.map(c=>({...c,eligibility:c.eligibility??[...(p.eligibility||[]),...(p.leaseTerms||[]).map(t=>t+' month lease')].join(', '),terms:c.terms||p.text}))).map(c=>[signature(c.text+' '+c.eligibility),c])).values()],pages};
}
export function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
export function manualOffer(input, at, actor) {
  if (!validDate(input.start) || (input.end && (!validDate(input.end) || input.end<input.start))) throw fail('Enter valid start and end dates.');
  const text=clean(input.text); if (!text || text.length>12000) throw fail('Enter an offer description of up to 12,000 characters.');
  const parts=Array.isArray(input.components)?input.components:components(text);
  if (parts.length>30) throw fail('Use at most 30 offer components.');
  for(const p of parts){if(!p||!clean(p.text))throw fail('Each component needs a description.');if((p.start&&!validDate(p.start))||(p.end&&!validDate(p.end))||(p.start&&p.end&&p.end<p.start))throw fail('Enter valid component start and end dates.');}
  return {id:input.id || crypto.randomUUID(),source:'manual',text,start:input.start,end:input.end || '',
    components:parts.map(p=>({text:clean(p.text).slice(0,1000),type:clean(p.type).slice(0,100),eligibility:clean(p.eligibility).slice(0,1000),start:validDate(p.start)?p.start:'',end:validDate(p.end)?p.end:''})),
    restrictions:clean(input.restrictions).slice(0,4000),notes:clean(input.notes).slice(0,4000),updatedAt:at,updatedBy:actor,mode:input.mode==='current'?'current':'historical'};
}
