// Pure validation and collection rules, shared by the service and its tests.
export const fail = (message, status = 400) => Object.assign(new Error(message), {status});
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
  if (body.length < 150 || /verify you are human|checking your browser|access denied|enable javascript to (?:continue|run)|just a moment/i.test(body)) return {url,at,status:'failed',error:'Website blocked or did not provide readable content.'};
  const lines = body.split(/\n+/).map(clean).filter(Boolean);
  const offers = lines.flatMap((line,i) => components(line).length ? [clean([lines[i-1] || '',line,lines[i+1] || ''].join(' ')).slice(0,2500)] : []);
  if (!offers.length && /special|concession|limited.time|leasing.offer/i.test(body) && !/no (?:current |active )?(?:specials?|offers?)/i.test(body)) return {url,at,status:'failed',error:'Offer language requires review; no reliable offer terms were extracted.',text:body.slice(0,3000)};
  const offer = [...new Set(offers)].join('\n').slice(0,12000);
  const publishedDates=[...offer.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g)].map(m=>m[0]);
  const eligibility=[...offer.matchAll(/\b(?:studios?|one[- ]bed(?:room)?|two[- ]bed(?:room)?|three[- ]bed(?:room)?|[123][- ]bed(?:room)?|[A-D]\d(?:-\d)?\s*(?:floor\s*plans?)?)\b/gi)].map(m=>signature(m[0]).replace(/one/g,'1').replace(/two/g,'2').replace(/three/g,'3').replace(/bedroom/g,'bed').replace(/[ -]/g,'').replace(/^studios$/,'studio'));
  const leaseTerms=[...offer.matchAll(/\b(\d{1,2})(?:[- ]to[- ]|\s*[-–]\s*)?(\d{1,2})?[- ]months?\s+leases?\b/gi)].map(m=>m[1]+(m[2]?'-'+m[2]:''));
  return {url,at,status:offer?'found':'none',text:offer,components:components(offer),publishedDates,leaseTerms,eligibility:[...new Set(eligibility)],evidence:offer || body.slice(0,3000)};
}
export function reconcilePages(pages) {
  if (!pages.length || pages.some(p=>p.status==='failed')) return {status:'failed',pages,error:pages.find(p=>p.error)?.error || 'No website URL configured.'};
  const found = pages.filter(p=>p.status==='found');
  if (!found.length) return {status:'none',text:'No special listed',components:[],pages};
  // An offer on a main page and no offer on a pricing page is not contradictory.
  // Different eligibility is retained; incompatible terms for the same offer type require review.
  if (found.length > 1) {
    const a=found[0],b=found[1];
    const sharedTypes = a.components.map(c=>c.type).filter(t=>b.components.some(c=>c.type===t));
    const differing = sharedTypes.some(t=>signature(a.components.filter(c=>c.type===t).map(c=>c.text).sort().join('|')) !== signature(b.components.filter(c=>c.type===t).map(c=>c.text).sort().join('|')));
    const floorplansDiffer=a.eligibility?.length&&b.eligibility?.length&&!a.eligibility.some(v=>b.eligibility.includes(v));
    const leaseWindows=p=>(p.leaseTerms||[]).flatMap(term=>{const [lo,hi=lo]=term.split('-').map(Number);return Array.from({length:Math.max(0,hi-lo+1)},(_,i)=>lo+i);});
    const al=leaseWindows(a),bl=leaseWindows(b),leaseTermsDiffer=al.length&&bl.length&&!al.some(v=>bl.includes(v));
    const distinctEligibility=floorplansDiffer||leaseTermsDiffer;
    if (!distinctEligibility && (differing || (signature(a.text)!==signature(b.text) && /restrictions?|lease terms?|select (?:units|floor)|only|move.in by/i.test(a.text+b.text)))) return {status:'conflict',pages,error:'Conflicting website offers—review required.'};
  }
  return {status:'found',text:[...new Set(found.map(p=>p.text))].join('\n'),components:[...new Map(found.flatMap(p=>p.components.map(c=>({...c,eligibility:[...(p.eligibility||[]),...(p.leaseTerms||[]).map(t=>t+' month lease')].join(', '),terms:p.text}))).map(c=>[signature(c.text+' '+c.eligibility),c])).values()],pages};
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
