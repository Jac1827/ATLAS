/* Calendar-keyed source records; fiscal labels never shift accounting months. */
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
export function fiscalPeriods(year,month,start='Jan') {
 const first=months.indexOf(start||'Jan');
 if(first<0||!Number.isInteger(year)||year<2000||year>2099||!Number.isInteger(month)||month<0||month>11)throw Error('Invalid fiscal start or accounting period');
 const startYear=month<first?year-1:year,result=[];
 for(let y=startYear,m=first;y<year||m<=month;){result.push({year:y,month:m,period:`${y}-${String(m+1).padStart(2,'0')}`});if(++m===12){m=0;y++;}if(result.length===12)break;}
 return result;
}
export function fiscalLine(state,propertyId,gl,periods,getActual) {
 const evidence=periods.map(p=>{
  const b=state.approvedBudgetImports?.[propertyId+'|'+p.year],a=state.periods?.[propertyId+'|'+p.year];
  const matches=(b?.rows||[]).filter(r=>String(r.gl)===String(gl));
  const budgetReady=!!(b?.effectiveDate&&b?.sourceFile&&(!b.coverage||b.coverage.includes(p.month))&&matches.length===1);
  const actualReady=!!(a?.source&&a?.loadedAt&&Number(a.closedThrough)>p.month&&!state.demoActuals);
  const values=getActual(state,propertyId,gl,p.year);
  return {period:p.period,budget:budgetReady&&numeric(matches[0]?.monthly?.[p.month])?Math.round(matches[0].monthly[p.month]*100)/100:null,actual:actualReady&&numeric(values?.[p.month])?Math.round(values[p.month]*100)/100:null,budgetSource:budgetReady?b.sourceFile:null,budgetEffectiveDate:budgetReady?b.effectiveDate:null,actualSource:actualReady?a.source:null,sourceTimestamp:actualReady?a.loadedAt:null};
 });
 const sum=key=>evidence.every(e=>numeric(e[key]))?Math.round(evidence.reduce((v,e)=>v+e[key],0)*100)/100:null;
 return {ytdBudget:sum('budget'),ytdActual:sum('actual'),fiscalEvidence:evidence};
}
