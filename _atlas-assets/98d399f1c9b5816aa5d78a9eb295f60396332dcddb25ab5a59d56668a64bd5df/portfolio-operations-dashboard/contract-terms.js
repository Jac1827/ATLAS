/* Source excerpts, not inferred legal rights. Loaded only with Budget Builder. */
(function(R){
 'use strict';
 const esc=R.app.h.esc;
 function extract(text){
  const paragraphs=String(text||'').replace(/\r/g,'').split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map(s=>s.replace(/\s+/g,' ').trim());
  const selected=new Set();
  paragraphs.forEach((s,i)=>{if(/\b(?:terminat(?:e|ion|ing)|cancel(?:lation|led|ing)?|early exit)\b/i.test(s))for(let j=Math.max(0,i-1);j<=Math.min(paragraphs.length-1,i+2);j++)selected.add(j);});
  const relevant=paragraphs.filter((s,i)=>selected.has(i));
  return relevant.length?{summary:relevant.join(' ').slice(0,1800),excerpt:relevant.join('\n').slice(0,6000),status:relevant.join(' ').length>1800?'Partial excerpt — open full contract':'Source excerpt — verify conditions'}:null;
 }
 function cell(contract){
  const term=contract.earlyCancellation;
  if(!term?.summary)return '<span class="dim">Not recorded</span>';
  return '<details onclick="event.stopPropagation()"><summary>'+esc(term.summary.length>160?term.summary.slice(0,157)+'…':term.summary)+'</summary><p style="white-space:pre-wrap;min-width:240px;max-width:420px">'+esc(term.summary)+'</p><small>'+esc(term.sourceFile||contract.sourceFile||'Source not recorded')+' · '+esc(term.status||'Review required')+'</small>'+(term.excerpt?'<blockquote style="white-space:pre-wrap">'+esc(term.excerpt)+'</blockquote>':'')+'</details>';
 }
 R.contractTerms={extract,cell};
})(RBB);
