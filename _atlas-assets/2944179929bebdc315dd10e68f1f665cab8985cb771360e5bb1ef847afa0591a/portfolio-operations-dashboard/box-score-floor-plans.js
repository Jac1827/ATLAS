/* Label-based Box Score floor plans. Monetary totals are never per-unit rents. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.AtlasBoxScoreFloorPlans=api;})(typeof window==='object'?window:globalThis,function(){
  const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const number=v=>v===null||v===undefined||String(v).trim()===''||/^#|^n\/?a$|^[-–—]$/i.test(String(v).trim())?null:(Number.isFinite(Number(String(v).replace(/[$,%\s,]/g,'')))?Number(String(v).replace(/[$,%\s,]/g,'')):null);
  const add=(...values)=>values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;
  const ratio=(total,denominator)=>total!==null&&denominator>0?total/denominator:null;
  const round=v=>v===null?null:Math.round(v*100)/100;
  const percent=v=>{const n=number(v);return n===null?null:String(v).includes('%')?n:n<=1?n*100:n;};
  function parse(rows,fileName='',sourceSheet=''){
    const at=rows.findIndex(r=>/^availability\s*\(as of/i.test(String(r?.[0]||'').trim()));if(at<0)return [];
    const date=String(rows[at][0]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const asOf=date?`${date[3]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}`:'';
    const header=rows.findIndex((r,i)=>i>at&&i<at+8&&norm(r[0])==='unit type');if(header<0)return [];
    const headers=rows[header].map(h=>norm(String(h).split(':').pop()));
    const indices=label=>headers.map((h,i)=>h===label?i:-1).filter(i=>i>=0);
    const pulse=new Map();const p=rows.findIndex(r=>/^property pulse\b/i.test(String(r?.[0]||'')));
    if(p>=0){const h=rows.findIndex((r,i)=>i>p&&i<p+8&&norm(r[0])==='unit type');if(h>=0){const u=rows[h].findIndex(c=>norm(c)==='units');for(let i=h+1;i<rows.length;i++){if(/^total|^lead |^make ready/i.test(String(rows[i]?.[0]||'')))break;if(rows[i]?.[0])pulse.set(norm(rows[i][0]),number(rows[i][u]));}}}
    const out=[];
    for(let i=header+1;i<rows.length;i++){
      const row=rows[i],code=String(row?.[0]||'').trim();if(!code)continue;if(/^total:?$|^(property pulse|lead activity|lead conversions|make ready)\b/i.test(code))break;
      const get=label=>number(row[indices(label)[0]]);
      const rentable=get('rentable units'),excluded=get('excluded');
      const units=get('units')??pulse.get(norm(code))??add(rentable,excluded);
      const occupied=get('occupied')??add(get('occupied no notice'),get('notice rented'),get('notice unrented'));
      const vacantRented=get('vacant rented')??add(get('vacant rented ready units'),get('vacant rented not ready units'));
      const leased=get('leased units')??add(occupied,vacantRented);
      const sqft=get('avg sqft')??ratio(get('total square feet'),units);
      const budgetRent=get('avg market rent budgeted')??ratio(get('total budgeted rent'),units);
      const marketedRent=get('avg market rent')??ratio(get('total market rent'),units);
      const leasedPct=percent(row[indices('leased')[0]])??(ratio(leased,rentable??units)===null?null:ratio(leased,rentable??units)*100);
      if(units===null&&sqft===null&&budgetRent===null&&marketedRent===null)continue;
      out.push({name:code,sourcePlanCode:code,sourceAsOf:asOf,sqft:round(sqft),units,budgetRent:round(budgetRent),marketedRent:round(marketedRent),leasedPct:round(leasedPct),occupancyPct:round(ratio(occupied,rentable??units)===null?null:ratio(occupied,rentable??units)*100),boxScoreManaged:true,marketedRentSource:'Box Score report',budgetRentSource:fileName,budgetRentBasis:'box_score_budgeted_average',sourceFileName:fileName,sourceSheet,sourceRow:i+1});
    }
    return out;
  }
  function merge(existing,incoming,makeId,at=new Date().toISOString()){
    const plans=(existing||[]).map(p=>({...p}));
    for(const rate of incoming){
      const key=norm(rate.sourcePlanCode||rate.name);const matches=plans.filter(p=>norm(p.sourcePlanCode||p.name)===key||(!p.sourcePlanCode&&norm(p.name)===norm(rate.name)));
      if(matches.length>1)continue; // An ambiguous identity needs admin resolution, never a fuzzy match.
      const old=matches[0];if(old?.sourceAsOf&&(!rate.sourceAsOf||rate.sourceAsOf<old.sourceAsOf))continue;
      const approved=old?.approvalStatus==='approved'&&old.approvedForReporting!==false;
      const next={...old,...rate,id:old?.id||makeId(),name:old?.name||rate.name,approvalStatus:approved?'approved':'needs_review',approvedForReporting:!!approved,approvedAt:approved?old.approvedAt:'',approvedBy:approved?old.approvedBy:''};
      const fingerprint=JSON.stringify(rate);if(old?.boxScoreFingerprint===fingerprint)continue;
      next.boxScoreFingerprint=fingerprint;next.boxScoreUpdatedAt=at;
      next.boxScoreHistory=[...(old?.boxScoreHistory||[]),{...rate,importedAt:at}];
      if(old)Object.assign(old,next);else plans.push(next);
    }
    return plans;
  }
  function approvedRates(plans){return (plans||[]).filter(p=>p.approvalStatus==='approved'&&p.approvedForReporting!==false).map(p=>({...p,marketRent:p.marketedRent,sourceSheet:p.boxScoreManaged?'Box Score report':p.marketedRentSource}));}
  return {parse,merge,approvedRates,norm};
});
