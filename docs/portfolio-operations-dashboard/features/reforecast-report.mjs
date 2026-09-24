import {forecastSnapshot,retainedSnapshot,lineageColumns} from './financial-snapshot.mjs?v=e84268921f32df41';
import {snapshotPdf} from './snapshot-pdf.mjs?v=b614627cd7378375';
// Every screen/export projection starts from a retained calculation snapshot.
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const money=v=>finite(v)?v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'Unavailable';
const round=v=>finite(v)?Math.sign(v)*Math.round((Math.abs(v)+Number.EPSILON)*100)/100:null;
export const sum=values=>values.length&&values.every(finite)?round(values.reduce((a,b)=>a+b,0)):null;
const difference=(a,b)=>finite(a)&&finite(b)?round(a-b):null;
const has=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const groupPeriod=(period,grain)=>grain==='year'?period.slice(0,4):grain==='quarter'?period.slice(0,4)+' Q'+Math.ceil(Number(period.slice(5))/3):period;
const reportPeriods=(snapshot,options)=>options.periods?.length?options.periods:snapshot?.identity?.periods||snapshot?.periods||[];
const amountKey=r=>r.period+'|'+r.accountCode;
export function reportSnapshot(snapshot,source,options={}){const retained=forecastSnapshot(snapshot);return options.actualsMode==='latest'?retainedSnapshot({kind:'reforecast_vintage_with_latest_actuals',identity:{...retained.identity,vintageSnapshot:retained.fingerprint,actualCutoff:source?.actuals?.cutoffPeriod||null,actualCloseVersions:source?.actuals?.closeVersions||[]},values:{...retained.values,latestActuals:source?.actuals||null}}):retained;}
export function snapshotLines(snapshot){return snapshot?.lines||snapshot?.gl||[];}
function latestEvidence(source){
 const closes=new Map((source?.actuals?.closeVersions||[]).map(row=>[row.period,row.versionId]));
 const cutoff=source?.actuals?.cutoffPeriod;
 return {closes,cutoff,lines:new Map((source?.actuals?.lines||[]).filter(row=>cutoff&&row.period<=cutoff&&closes.has(row.period)).map(row=>[amountKey(row),row.amount])),monthly:new Map((source?.actuals?.monthly||[]).filter(row=>cutoff&&row.period<=cutoff&&closes.get(row.period)===row.closeVersionId&&row.source==='governed_close_controls').map(row=>[row.period,row]))};
}
function projectionLines(snapshot,source,options={}){
 const selected=reportPeriods(snapshot,options),evidence=options.actualsMode==='latest'?latestEvidence(source):null;
 return snapshotLines(snapshot).filter(row=>(!selected.length||selected.includes(row.period))&&(!options.account||row.accountCode===options.account)&&(!options.category||row.category===options.category)&&(!options.placement||row.placement===options.placement)).map(row=>({...row,
  budget:has(row,'originalBudget')?row.originalBudget:null,forecast:has(row,'forecast')?row.forecast:null,
  actual:evidence?(evidence.lines.has(amountKey(row))?evidence.lines.get(amountKey(row)):null):has(row,'actual')?row.actual:null,
  actualCloseVersionId:evidence?evidence.closes.get(row.period)||null:row.closeVersionId||null
 }));
}
export function gapRows(snapshot,source,options={}){
 const {grain='month'}=options,groups=new Map(),snapshotVersion=reportSnapshot(snapshot,source,options).fingerprint;
 for(const row of projectionLines(snapshot,source,options)){
  const period=groupPeriod(row.period,grain),id=[period,row.accountCode,row.department||''].join('|');
  const g=groups.get(id)||{period,accountCode:row.accountCode,name:row.accountName||row.name||'',category:row.category||'Unmapped',nature:row.nature||'',placement:row.placement||'Unmapped',department:row.department||'',budget:[],forecast:[],actual:[],periods:[],closeVersions:[]};
  for(const key of ['budget','forecast','actual'])g[key].push(row[key]);g.periods.push(row.period);
  if(row.actualCloseVersionId)g.closeVersions.push({period:row.period,versionId:row.actualCloseVersionId});groups.set(id,g);
 }
 return [...groups.values()].map(g=>{const budget=sum(g.budget),forecast=sum(g.forecast),actual=sum(g.actual);return {...g,budget,forecast,actual,budgetToForecast:difference(forecast,budget),forecastToActual:difference(actual,forecast),snapshotVersion,actualCutoff:options.actualsMode==='latest'?source?.actuals?.cutoffPeriod||null:snapshot.identity?.actualCutoff||null,actualsMode:options.actualsMode||'snapshot'};}).sort((a,b)=>a.period.localeCompare(b.period)||a.accountCode.localeCompare(b.accountCode));
}
function factor(row,metric){
 const income=['income','contra_income'].includes(row.nature),above=row.placement==='above_noi',expense=row.nature==='expense';
 if(metric==='revenue')return income&&above?1:0;
 if(metric==='opex'||metric==='expenses')return expense&&above?1:0;
 if(metric==='noi'||metric==='margin')return above?(income?1:expense?-1:0):0;
 if(metric==='cashFlow')return income?1:['expense','below_noi','capital','debt'].includes(row.nature)?-1:0;
 return 1;
}
function glMetric(rows,field,metric){
 const selected=rows.filter(row=>factor(row,metric)!==0);
 if(!selected.length)return 0;
 const value=sum(selected.map(row=>finite(row[field])?row[field]*factor(row,metric):null));
 if(metric!=='margin')return value;
 const revenue=glMetric(rows,field,'revenue');return finite(value)&&finite(revenue)&&revenue!==0?value/revenue:null;
}
export function trendRows(snapshot,source,options={}){
 const {metric='noi',grain='month'}=options,selected=reportPeriods(snapshot,options),filtered=Boolean(options.account||options.category||options.placement),evidence=options.actualsMode==='latest'?latestEvidence(source):null;
 const lineRows=projectionLines(snapshot,source,options);
 const monthly=(snapshot.monthly||[]).filter(row=>(!selected.length||selected.includes(row.period))&&row.applicable!==false).map(row=>{
  const lines=lineRows.filter(line=>line.period===row.period),control=evidence?.monthly.get(row.period);
  let actual=filtered?glMetric(lines,'actual',metric):row.actuals?.[metric]??null;
  if(evidence&&!filtered)actual=control?(control[metric==='expenses'?'opex':metric]??null):glMetric(lines,'actual',metric);
  if(evidence?!evidence.closes.has(row.period):!row.closed)actual=null;
  return {period:row.period,budget:filtered?glMetric(lines,'budget',metric):row.originalBudget?.[metric]??null,forecast:filtered?glMetric(lines,'forecast',metric):row.reforecast?.[metric]??null,actual,
   budgetRevenue:filtered?glMetric(lines,'budget','revenue'):row.originalBudget?.revenue??null,forecastRevenue:filtered?glMetric(lines,'forecast','revenue'):row.reforecast?.revenue??null,actualRevenue:filtered?glMetric(lines,'actual','revenue'):evidence?(control?.revenue??glMetric(lines,'actual','revenue')):row.actuals?.revenue??null,
   budgetNoi:filtered?glMetric(lines,'budget','noi'):row.originalBudget?.noi??null,forecastNoi:filtered?glMetric(lines,'forecast','noi'):row.reforecast?.noi??null,actualNoi:filtered?glMetric(lines,'actual','noi'):evidence?(control?.noi??glMetric(lines,'actual','noi')):row.actuals?.noi??null};
 });
 if(grain==='month')return monthly;
 const groups=new Map();for(const row of monthly){const key=groupPeriod(row.period,grain);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups].map(([period,rows])=>{const out={period};for(const key of ['budget','forecast','actual']){if(metric==='margin'){const numerator=sum(rows.map(row=>row[key+'Noi'])),denominator=sum(rows.map(row=>row[key+'Revenue']));out[key]=finite(numerator)&&finite(denominator)&&denominator!==0?numerator/denominator:null;}else out[key]=sum(rows.map(row=>row[key]));}return out;});
}
export function trendPoints(rows,{cumulative=false,metric='noi'}={}){
 const keys=['budget','forecast','actual'],totals={budget:0,forecast:0,actual:0},revenue={...totals},noi={...totals};
 return rows.map(row=>{const out={period:row.period};for(const key of keys){
  totals[key]=finite(totals[key])&&finite(row[key])?totals[key]+row[key]:null;
  if(cumulative&&metric==='margin'){revenue[key]=finite(revenue[key])&&finite(row[key+'Revenue'])?revenue[key]+row[key+'Revenue']:null;noi[key]=finite(noi[key])&&finite(row[key+'Noi'])?noi[key]+row[key+'Noi']:null;out[key]=finite(revenue[key])&&revenue[key]!==0&&finite(noi[key])?noi[key]/revenue[key]:null;}
  else out[key]=cumulative?totals[key]:row[key];
 }return out;});
}
export function trendSvg(rows,{cumulative=false,metric='noi'}={}){
 const keys=['budget','forecast','actual'],colors=['#52667a','#126f8a','#b56b21'],points=trendPoints(rows,{cumulative,metric});
 const values=points.flatMap(row=>keys.map(key=>row[key])).filter(finite);if(!values.length)return '<p>No complete values are available for this trend.</p>';
 const low=Math.min(0,...values),high=Math.max(metric==='margin'?.01:1,...values),x=i=>60+i*760/Math.max(1,rows.length-1),y=value=>225-(value-low)/(high-low)*180,format=v=>metric==='margin'?(100*v).toFixed(2)+'%':money(v);
 return `<svg viewBox="0 0 880 280" role="img" aria-label="${cumulative?'Cumulative':'Monthly'} original budget, reforecast and governed actuals trend"><text x="5" y="30" font-size="11">${esc(format(high))}</text><text x="5" y="228" font-size="11">${esc(format(low))}</text>${keys.map((key,j)=>{let path='',drawing=false;points.forEach((row,i)=>{if(!finite(row[key])){drawing=false;return;}path+=(drawing?'L':'M')+x(i)+' '+y(row[key])+' ';drawing=true;});return `<path d="${path}" fill="none" stroke="${colors[j]}" stroke-width="3"/><text x="${80+j*250}" y="275" fill="${colors[j]}" font-size="13">${['Original budget','Reforecast','Governed actuals'][j]}</text>`;}).join('')}${rows.map((row,i)=>`<text x="${x(i)}" y="245" text-anchor="middle" font-size="10">${esc(row.period)}</text>`).join('')}</svg>`;
}
export function contributionRows(snapshot,source,options={}){
 const metric=options.metric==='margin'?'noi':options.metric||'noi',rows=gapRows(snapshot,source,options);
 return rows.map(row=>({...row,metric,budgetToForecastContribution:finite(row.budgetToForecast)?round(row.budgetToForecast*factor(row,metric)):null,forecastToActualContribution:finite(row.forecastToActual)?round(row.forecastToActual*factor(row,metric)):null}));
}
export function bridgeRows(snapshot,source,options={}){
 const series=Object.fromEntries(['revenue','expenses','noi','margin'].map(metric=>[metric,trendRows(snapshot,source,{...options,metric})]));
 const keys=series.noi.map(row=>row.period);
 return keys.map((period,i)=>{const pick=(metric,key)=>series[metric][i]?.[key]??null,result={period};
  for(const [bridge,from,to] of [['budgetToForecast','budget','forecast'],['forecastToActual','forecast','actual']]){
   const start=pick('noi',from),end=pick('noi',to),income=difference(pick('revenue',to),pick('revenue',from)),expenses=difference(pick('expenses',from),pick('expenses',to));
   const originalMargin=pick('margin',from),newRevenue=pick('revenue',to),oldExpense=pick('expenses',from);
   const middleMargin=finite(newRevenue)&&newRevenue!==0&&finite(oldExpense)?(newRevenue-oldExpense)/newRevenue:null;
   result[bridge]={startNoi:start,revenueEffect:income,expenseEffect:expenses,endNoi:end,reconciles:finite(start)&&finite(income)&&finite(expenses)&&finite(end)?Math.abs(start+income+expenses-end)<.02:false,startMargin:originalMargin,revenueMarginEffect:finite(middleMargin)&&finite(originalMargin)?middleMargin-originalMargin:null,expenseMarginEffect:finite(middleMargin)&&finite(pick('margin',to))?pick('margin',to)-middleMargin:null,endMargin:pick('margin',to)};
  }return result;
 });
}
export function forecastAccuracyByVintage(vintages,latestSource,options={}){
 const evidence=latestEvidence(latestSource),metric=options.metric||'noi',rows=[];
 for(const vintage of vintages||[]){
  const snapshot=vintage.snapshot;if(!snapshot||!(vintage.publicationId||vintage.publication_id||vintage.publishedAt||vintage.status==='published'))continue;
  const candidates=trendRows(snapshot,latestSource,{...options,metric,grain:'month',actualsMode:'latest'});
  for(const point of candidates){const month=(snapshot.monthly||[]).find(row=>row.period===point.period);if(month?.closed||month?.applicable===false||!evidence.closes.has(point.period)||!finite(point.actual)||!finite(point.forecast))continue;
   const error=point.forecast-point.actual;rows.push({vintage:vintage.publicationId||vintage.publication_id||snapshot.fingerprint,publishedAt:vintage.publishedAt||vintage.created_at||null,snapshotVersion:snapshot.fingerprint,period:point.period,metric,forecast:point.forecast,actual:point.actual,error,absoluteError:Math.abs(error),absolutePercentError:point.actual===0?null:Math.abs(error/point.actual)*100,actualCloseVersionId:evidence.closes.get(point.period)});
  }
 }
 const summaries=[...new Set(rows.map(row=>row.vintage))].map(vintage=>{const points=rows.filter(row=>row.vintage===vintage),percent=points.map(row=>row.absolutePercentError).filter(finite);return {vintage,periodCount:points.length,mae:points.reduce((total,row)=>total+row.absoluteError,0)/points.length,mape:percent.length?percent.reduce((a,b)=>a+b,0)/percent.length:null,percentagePeriodCount:percent.length};});
 return {rows,summaries};
}
export function gapTable(rows){return `<div class="rf-scroll"><table><thead><tr><th>Period</th><th>GL</th><th>Category / placement</th><th>Original budget</th><th>Reforecast</th><th>Governed actuals</th><th>Budget → reforecast</th><th>Reforecast → actual</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.period)}</td><td>${esc(row.accountCode)} ${esc(row.name)}<details><summary>Version and source periods</summary><p>${esc(row.snapshotVersion)}</p><p>${esc(row.periods.join(', '))}</p><p>Actual closes: ${esc(JSON.stringify(row.closeVersions))}</p></details></td><td>${esc(row.category)} / ${esc(row.placement)}</td>${[row.budget,row.forecast,row.actual,row.budgetToForecast,row.forecastToActual].map(v=>`<td class="n">${money(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function heatmapHtml(rows){
 const periods=[...new Set(rows.map(row=>row.period))],accounts=[...new Set(rows.map(row=>row.accountCode))];
 return ['budgetToForecastContribution','forecastToActualContribution'].map((field,index)=>`<h4>${index?'Reforecast → actual':'Budget → reforecast'} contribution heatmap</h4><div class="rf-scroll"><table><thead><tr><th>GL</th>${periods.map(period=>`<th>${esc(period)}</th>`).join('')}</tr></thead><tbody>${accounts.map(code=>`<tr><th>${esc(code)}</th>${periods.map(period=>{const values=rows.filter(row=>row.period===period&&row.accountCode===code).map(row=>row[field]),value=sum(values);return `<td style="background:${value===null?'#f1f3f5':(rows[0]?.metric==='expenses'||rows[0]?.metric==='opex'?-value:value)>0?'#e5f2ec':value!==0?'#fae5e2':'white'}">${money(value)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
}
const pct=v=>finite(v)?(v*100).toFixed(2)+'%':'Unavailable';
function bridgesHtml(rows){return ['budgetToForecast','forecastToActual'].map((key,index)=>`<h4>${index?'Reforecast → governed actuals':'Original budget → reforecast'} NOI and margin bridge</h4><div class="rf-scroll"><table><thead><tr><th>Period</th><th>Starting NOI</th><th>Income effect</th><th>OPEX effect</th><th>Ending NOI</th><th>Starting margin</th><th>Income margin effect</th><th>OPEX margin effect</th><th>Ending margin</th></tr></thead><tbody>${rows.map(row=>{const b=row[key];return `<tr><td>${esc(row.period)}</td>${[b.startNoi,b.revenueEffect,b.expenseEffect,b.endNoi].map(v=>`<td>${money(v)}</td>`).join('')}${[b.startMargin,b.revenueMarginEffect,b.expenseMarginEffect,b.endMargin].map(v=>`<td>${pct(v)}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div>`).join('');}
function accuracyHtml(accuracy){if(!accuracy.rows.length)return '<p>No eligible published forecast vintage has subsequently closed actuals in this scope. Periods already closed in a vintage are excluded from accuracy.</p>';return `<p>Only forecasts frozen before the month closed are scored. Missing actuals are excluded. Zero actuals retain absolute error; percentage error is unavailable.</p><table><thead><tr><th>Published vintage</th><th>Eligible months</th><th>Mean absolute error</th><th>Mean absolute percentage error</th></tr></thead><tbody>${accuracy.summaries.map(row=>`<tr><td>${esc(row.vintage)}</td><td>${row.periodCount}</td><td>${accuracy.rows[0]?.metric==='margin'?pct(row.mae):money(row.mae)}</td><td>${finite(row.mape)?row.mape.toFixed(2)+'%':'Unavailable'}</td></tr>`).join('')}</tbody></table><details><summary>Accuracy evidence by month and close version</summary><pre>${esc(JSON.stringify(accuracy.rows,null,2))}</pre></details>`;}
export function reportHtml(snapshot,source,options={}){
 const rows=gapRows(snapshot,source,options),trend=trendRows(snapshot,source,{...options,grain:'month'}),contributions=contributionRows(snapshot,source,options),bridges=bridgeRows(snapshot,source,options),accuracy=forecastAccuracyByVintage(options.vintages,options.latestSource||source,options);
 const lineage=snapshot.identity||{},metric=options.metric||'noi';
 return `<h2>Reforecast to Budget Target Gap Report</h2><p>${esc(options.communityName||lineage.communityId)} · ${esc(options.scenarioName||'Reforecast')} · ${esc(options.status||'Draft preview')}</p><p>Snapshot ${esc(reportSnapshot(snapshot,source,options).fingerprint)} · Original budget ${(lineage.baselineVersionIds||[lineage.baselineVersionId]).filter(Boolean).map(esc).join(', ')||'Missing'} · Snapshot actual cutoff ${esc(lineage.actualCutoff||'None')} · Mapping ${esc(lineage.mappingRegistryVersion||'Missing')}</p><p>Trend: ${esc(metric)}. Filter: ${esc(options.account||'All GLs')} / ${esc(options.category||'All categories')} / ${esc(options.placement||'All placements')}. Amounts are signed; a positive gap is not always favorable. Future and missing actuals remain unavailable. Financial control totals may be complete when GL detail is unavailable; these remain explicitly distinct.</p><h3>Three-way monthly trend</h3>${trendSvg(trend,{metric})}${options.cumulative?'<h3>Three-way cumulative trend</h3>'+trendSvg(trend,{cumulative:true,metric}):''}<h3>Account detail</h3>${gapTable(rows)}<details><summary>NOI and margin bridges</summary>${bridgesHtml(bridges)}</details><details><summary>Account contribution and variance heatmaps</summary><p>Contributions use the selected metric and statement placement. For margin, the contribution heatmap shows NOI amounts; ratio effects appear in the margin bridge.</p>${heatmapHtml(contributions)}</details><details><summary>Forecast accuracy by published vintage</summary>${accuracyHtml(accuracy)}</details>`;
}
export function exportRows(snapshot,source,options={}){const lineage=lineageColumns(reportSnapshot(snapshot,source,options));return gapRows(snapshot,source,options).map(row=>({...lineage,Community:snapshot.identity?.communityId,Period:row.period,GL:row.accountCode,Account:row.name,Department:row.department,Category:row.category,Placement:row.placement,Original_budget:row.budget,Reforecast:row.forecast,Governed_actuals:row.actual,Budget_to_reforecast:row.budgetToForecast,Reforecast_to_actual:row.forecastToActual,Snapshot:row.snapshotVersion,Actual_cutoff:row.actualCutoff,Actuals_mode:row.actualsMode,Baseline_versions:(snapshot.identity?.baselineVersionIds||[snapshot.identity?.baselineVersionId]).filter(Boolean).join(';'),Close_versions:JSON.stringify(row.closeVersions),Mapping_version:snapshot.identity?.mappingRegistryVersion||''}));}
export function analyticalExportRows(snapshot,source,options={}){const lineage=lineageColumns(reportSnapshot(snapshot,source,options)),result={monthly:trendRows(snapshot,source,{...options,grain:'month'}),cumulative:trendPoints(trendRows(snapshot,source,{...options,grain:'month'}),{cumulative:true,metric:options.metric||'noi'}),contributions:contributionRows(snapshot,source,options),bridges:bridgeRows(snapshot,source,options).flatMap(row=>['budgetToForecast','forecastToActual'].map(kind=>({period:row.period,kind,...row[kind]}))),accuracy:forecastAccuracyByVintage(options.vintages,options.latestSource||source,options).rows};return Object.fromEntries(Object.entries(result).map(([key,rows])=>[key,rows.map(row=>({...row,...lineage}))]));}
export function csv(rows){const quote=value=>'"'+String(typeof value==='string'&&/^[=+@\-]/.test(value)?"'"+value:value??'').replaceAll('"','""')+'"',keys=Object.keys(rows[0]||{});return [keys,...rows.map(row=>keys.map(key=>row[key]))].map(row=>row.map(quote).join(',')).join('\r\n');}
export function download(content,name,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function reportPdf(snapshot,source,options={}){const retained=reportSnapshot(snapshot,source,options);return snapshotPdf({title:'ATLAS Reforecast to Budget Target Gap Report',subtitle:[options.communityName||snapshot.identity?.communityId,options.scenarioName||'Reforecast',options.status||'Draft preview'].filter(Boolean).join(' / '),snapshot:retained,rows:exportRows(snapshot,source,options),columns:[['Period','Period',65],['GL','GL',55],['Account','Account',205],['Original_budget','Budget',90],['Reforecast','Reforecast',90],['Governed_actuals','Actuals',90]]});}
