import {computeReforecast,fingerprint} from './reforecast-engine.mjs?v=addea678a6fc086d';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const sum=values=>values.some(value=>!finite(value))?null:values.reduce((a,b)=>a+b,0);
const period=(year,month)=>`${year}-${String(month+1).padStart(2,'0')}`;
const naturePlacement=nature=>['capital','debt','below_noi'].includes(nature)?'below_noi':'above_noi';
const snapshots=new Map();
export function clearLegacyReforecastCache(){snapshots.clear();}
if(typeof window!=='undefined')window.addEventListener('pagehide',clearLegacyReforecastCache);
/* Compatibility for existing scenario views. The original workbook and locked budget are never edited.
   These local scenarios remain illustrative drafts; the governed publication workflow is separate. */
export function legacyScenarioDraftInput({R,state,propertyId,year,scenario,baselineCalc,scenarioCalc,sources}){
 const periods=Array.from({length:12},(_,month)=>period(year,month)),baseResults=Object.values(baselineCalc.results),allLines=new Map(),accounts=new Map();
 for(const result of baseResults){
  const code=String(result.line.gl),classification=R.gl(code),nature=classification.nature;
  accounts.set(code,{accountCode:code,name:classification.name||result.line.name,category:classification.group||result.line.coaGroup||'UNMAPPED',nature,placement:naturePlacement(nature)});
  for(let month=0;month<12;month++){
   const key=periods[month]+'|'+code,existing=allLines.get(key),v=finite(result.monthly[month])?result.monthly[month]:null;
   allLines.set(key,{period:periods[month],accountCode:code,amount:existing?sum([existing.amount,v]):v,source:{file:result.line.sourceFile||'Legacy approved workbook',lineId:result.line.id,year}});
  }
 }
 // Mapped approved workbooks deliberately calculate as fixed manual lines. Their
 // retained imported values and workbook provenance still identify imported GLs.
 const importedLine=line=>line.method==='imported'||Array.isArray(line.importedMonthly)&&line.importedMonthly.length===12&&Boolean(line.sourceFile||line.sourceSheet||String(line.id).startsWith('approved-import-'));
 const importedCodes=[...new Set(baseResults.filter(result=>importedLine(result.line)).map(result=>String(result.line.gl)))];
 const drivers=[],baseAssumptions=R.engine.resolver(state,propertyId,baselineCalc.scenario);
 const add=(type,operation,value,codes,extra={})=>drivers.push({id:`legacy-${type}-${drivers.length+1}`,type,operation,value,accountCodes:codes,periods,source:{scenarioId:scenario.id,assumption:type,basis:'Explicit browser draft overlay'},reason:'Scenario assumption applied to mapped imported accounts; original workbook retained.',...extra});
 const is=(code,names)=>names.includes(accounts.get(code)?.category);
 const resolvedCodes=new Map();
 const resolveCodes=key=>{if(resolvedCodes.has(key))return resolvedCodes.get(key);const codes=importedCodes.filter(code=>{
  const related=baseResults.filter(row=>String(row.line.gl)===code);
  if(key==='concession_pct')return code==='5250';
  if(key==='bad_debt_pct')return code==='5255';
  if(key==='rent_growth')return code==='5120';
  if(key==='payroll_increase')return is(code,['PAYROLL & RELATED EXPENSES']);
  if(key==='utility_rate_increase')return is(code,['COMMON AREA UTILITIES EXPENSE','UNIT UTILITIES EXPENSE']);
  if(key==='insurance_increase')return is(code,['INSURANCE'])||['6719','6720','6721','6800'].includes(code);
  if(key==='re_tax_increase')return is(code,['REAL ESTATE TAXES','PROPERTY TAXES'])||['6710','6715','6750','6810','6820','6830'].includes(code);
  if(key==='contract_escalation')return is(code,['CONTRACT SERVICES'])||related.some(row=>row.line.behavior==='fixed_contract');
  if(key==='inflation_general')return accounts.get(code)?.nature==='expense'&&related.some(row=>row.line.behavior==='fixed_noncontract'||row.line.behavior==='fixed'&&importedLine(row.line))&&!['payroll_increase','utility_rate_increase','insurance_increase','re_tax_increase','contract_escalation'].some(special=>resolveCodes(special).includes(code));
  return false;
 });resolvedCodes.set(key,codes);return codes;};
 // Preserve scenario-specific manual/formula/line overrides as explicit amounts before assumption overlays.
 for(const result of Object.values(scenarioCalc.results)){
  const original=baselineCalc.results[result.line.id];
  if(!original)continue;
  if(result.line.method==='imported'&&!scenario.lineOverrides?.[result.line.id])continue;
  if(baseResults.filter(row=>row.line.gl===result.line.gl).length!==1)continue;
  for(let month=0;month<12;month++)if(result.monthly[month]!==original.monthly[month])add('line_override','amount',result.monthly[month],[String(result.line.gl)],{periods:[periods[month]],source:{scenarioId:scenario.id,lineId:result.line.id,method:result.line.method}});
 }
 for(const [rawKey,rawValue] of Object.entries(scenario.assumptionOverrides||{})){
  if(rawKey.includes('.')&&!rawKey.startsWith(propertyId+'.'))continue;
  if(!rawKey.includes('.')&&Object.hasOwn(scenario.assumptionOverrides,propertyId+'.'+rawKey))continue;
  const key=rawKey.startsWith(propertyId+'.')?rawKey.slice(propertyId.length+1):rawKey,value=rawValue&&typeof rawValue==='object'?rawValue.value:rawValue;
  if(!finite(value))continue;
  const codes=resolveCodes(key);
  if(['concession_pct','bad_debt_pct'].includes(key))add(key,'percent_of_account',-Math.abs(value),codes,{baseAccountCode:'5120'});
  else {const original=baseAssumptions.val(key,null),change=finite(original)&&original!==-1?(1+value)/(1+original)-1:value;add(key,'percent_change',change,codes);}
 }
 if(scenario.occupancyDelta!==undefined||scenario.occupancyMode==='delayed_leaseup'||scenario.occupancyMode==='flat'){
  const codes=importedCodes.filter(code=>code==='5220'),occupancy=scenarioCalc.ctx.occTotals.occPctAll;
  for(let month=0;month<12;month++)add('occupancy','occupancy_vacancy',occupancy[month],codes,{periods:[periods[month]],baseAccountCode:'5120',source:{scenarioId:scenario.id,occupancyDelta:scenario.occupancyDelta??null,mode:scenario.occupancyMode||null,leaseUpDelayMonths:scenario.leaseUpDelayMonths??0}});
 }
 const baseline={versionId:fingerprint({propertyId,year,lines:[...allLines.values()]}),lines:[...allLines.values()],leasing:periods.map((p,m)=>({period:p,units:baselineCalc.ctx.occTotals.revUnits,occupiedUnits:baselineCalc.ctx.occTotals.occUnitsAll[m],moveOuts:baselineCalc.ctx.occTotals.turnsAll[m],moveIns:null,marketRent:null,source:'Legacy budget occupancy schedule'}))};
 const identityVersion=fingerprint({scenario,propertyId,year});
 const input={communityId:sources?.communityId||propertyId,periods,baseline:sources?.baseline||baseline,actuals:sources?.actuals||{},registry:sources?.registry||{version:'legacy-coa-draft-'+fingerprint([...accounts.values()]),accounts:[...accounts.values()]},scenario:{versionId:identityVersion,driverVersion:fingerprint(drivers),drivers,overrides:scenario.forecastOverrides||[]}};
 return input;
}
export function bridgeLegacyScenario(options){
 const input=legacyScenarioDraftInput(options),periods=input.periods;
 const cacheKey=fingerprint({communityId:input.communityId,periods,baseline:input.baseline.versionId||input.baseline.versionIds,baselineLeasing:fingerprint(input.baseline.leasing||[]),sourceVersion:options.sources?.sourceVersion||null,closes:input.actuals.closeVersions||[],cutoff:input.actuals.cutoffPeriod||null,scenario:input.scenario.versionId,drivers:input.scenario.driverVersion,registry:input.registry.version});
 if(snapshots.has(cacheKey)){const cached=snapshots.get(cacheKey);snapshots.delete(cacheKey);snapshots.set(cacheKey,cached);return cached;}
 const snapshot=computeReforecast(input);snapshots.set(cacheKey,snapshot);if(snapshots.size>24)snapshots.delete(snapshots.keys().next().value);return snapshot;
}
export function installLegacyReforecastBridge(R){
 if(!R?.engine||R.engine._reforecastBridge)return;
 const original=R.engine.computeProperty;
 R.engine._reforecastBridge={version:'atlas-reforecast-v1',original};
 R.engine.computeProperty=function(state,propertyId,scenarioId,year){
  const raw=original.call(this,state,propertyId,scenarioId,year);year=raw.ctx.year;
  const scenario=raw.scenario,approved=state.scenarios.find(row=>row.type==='approved'&&row.locked);
  if(!approved)return raw;
  const baselineCalc=scenario.id===approved.id?raw:original.call(this,state,propertyId,approved.id,year);
  R.reforecastMissingBudgets ||= {};
  if(!Object.keys(baselineCalc.results).length){
   const explanation='No approved budget rows are available for this community and year. Import or load its approved baseline before comparing scenarios.';
   R.reforecastMissingBudgets[propertyId+'|'+year]=explanation;
   for(const [key,value] of Object.entries(raw.rollup))if(Array.isArray(value))raw.rollup[key]=value.map(()=>null);
   for(const key of Object.keys(raw.rollup.annual))raw.rollup.annual[key]=null;
   raw.reforecastUnavailable=explanation;raw.scenarioDiagnostics=[{status:'unavailable',explanation}];
   R.reforecastDiagnostics ||= {};R.reforecastDiagnostics[propertyId+'|'+scenario.id+'|'+year]={fingerprint:'Unavailable',baselineVersion:'No approved source rows',diagnostics:raw.scenarioDiagnostics};
   return raw;
  }
  delete R.reforecastMissingBudgets[propertyId+'|'+year];
  if(scenario.id===approved.id)return raw;
  const snapshot=bridgeLegacyScenario({R,state,propertyId,year,scenario,baselineCalc,scenarioCalc:raw,sources:R.reforecastSources?.[propertyId+'|'+year]});
  const byCode=new Map();for(const result of Object.values(raw.results)){const code=String(result.line.gl);if(!byCode.has(code))byCode.set(code,[]);byCode.get(code).push(result);}
  for(const row of snapshot.lines){
   const related=byCode.get(row.accountCode)||[],month=Number(row.period.slice(5))-1;
   if(related.length===1){related[0].monthly[month]=row.forecast;continue;}
   if(!related.length)continue;
   const total=sum(related.map(result=>result.monthly[month]));
   if(row.forecast===total)continue;
   // Preserve a GL total without falsely inventing a split across source lines.
   if(row.forecast===null||total===0){related.forEach(result=>{result.monthly[month]=null;});continue;}
   related.forEach(result=>{result.monthly[month]=row.forecast*(result.monthly[month]/total);});
  }
  for(const result of Object.values(raw.results)){result.annual=sum(result.monthly);result.audit={...result.audit,reforecastFingerprint:snapshot.fingerprint,scenarioVersion:snapshot.identity.reforecastVersion,origin:'scenario_driver_snapshot'};}
  raw.rollup=R.engine.rollup(raw.results,raw.property);
  const fields={grossIncome:'grossIncome',contra:'contraRevenue',egi:'revenue',expense:'opex',capital:'capital',debt:'debt',belowNoi:'belowNoi',noi:'noi',cfAfterCapital:'cashFlow'};
  for(const [legacy,current] of Object.entries(fields)){raw.rollup[legacy]=snapshot.monthly.map(row=>row.reforecast[current]);raw.rollup.annual[legacy]=snapshot.totals.reforecast[current];}
  raw.rollup.cfBeforeDebt=snapshot.monthly.map(row=>finite(row.reforecast.noi)&&finite(row.reforecast.belowNoi)?row.reforecast.noi-row.reforecast.belowNoi:null);
  raw.rollup.cfAfterDebt=snapshot.monthly.map((row,i)=>finite(raw.rollup.cfBeforeDebt[i])&&finite(row.reforecast.debt)?raw.rollup.cfBeforeDebt[i]-row.reforecast.debt:null);
  raw.rollup.annual.cfBeforeDebt=sum(raw.rollup.cfBeforeDebt);raw.rollup.annual.cfAfterDebt=sum(raw.rollup.cfAfterDebt);raw.rollup.annual.noiMargin=snapshot.totals.reforecast.margin;
  raw.reforecastSnapshot=snapshot;raw.scenarioDiagnostics=[...snapshot.driverImpacts.filter(row=>row.status!=='applied'),...snapshot.diagnostics.map(row=>({status:row.severity==='blocking'?'unavailable':'no_impact',explanation:row.message}))];
  R.reforecastDiagnostics ||= {};R.reforecastDiagnostics[propertyId+'|'+scenario.id+'|'+year]={fingerprint:snapshot.fingerprint,baselineVersion:snapshot.identity.baselineVersionId,diagnostics:raw.scenarioDiagnostics};
  return raw;
 };
 const computeAll=R.engine.computeAll;
 R.engine.computeAll=function(state,scenarioId,year){const result=computeAll.call(this,state,scenarioId,year),missing=Object.values(result.byProperty).filter(row=>row.reforecastUnavailable);result.sourceCoverage={complete:missing.length===0,missingProperties:missing.map(row=>row.property.id)};if(missing.length&&missing.length===Object.keys(result.byProperty).length){for(const [key,value] of Object.entries(result.portfolio))if(Array.isArray(value))result.portfolio[key]=value.map(()=>null);for(const key of Object.keys(result.portfolio.annual))result.portfolio.annual[key]=null;}return result;};
 if(R.exporter?.scenarioComparison&&R.importer?.parseCsv){const previous=R.exporter.scenarioComparison;R.exporter.scenarioComparison=function(state,scenarioIds,year){const csv=previous.apply(this,arguments),scopeYear=year||state.budgetYear||R.BUDGET_YEAR,missing=state.properties.filter(p=>R.reforecastMissingBudgets?.[p.id+'|'+scopeYear]);if(!missing.length)return csv;const names=new Set(missing.map(p=>p.name)),rows=R.importer.parseCsv(csv);for(const row of rows)if(['EGI','EXPENSE','NOI'].includes(row[1])){if(names.has(row[0])||row[0]==='PORTFOLIO'&&missing.length===state.properties.length)for(let i=2;i<row.length;i++)row[i]='Unavailable';if(row[0]==='PORTFOLIO')row[0]='PORTFOLIO (available budgets only)';}rows.push([],['Budget coverage',...missing.map(p=>p.name+': no approved source rows for '+scopeYear)]);return R.u.toCsv(rows);};}
 if(R.views?.scenarios){const previous=R.views.scenarios;R.views.scenarios=function(){let html=previous.apply(this,arguments);const state=R.app.state,property=state.activeProperty,year=state.budgetYear,esc=R.app.h.esc,missing=state.properties.filter(p=>R.reforecastMissingBudgets?.[p.id+'|'+year]);if(missing.length&&missing.length===state.properties.length)return '<div class="h1">Scenario comparison</div><section class="card"><h3>Financial comparison unavailable</h3><p>No approved budget rows are available for '+esc(year)+': '+missing.map(p=>esc(p.name)).join(', ')+'. Load an approved baseline before comparing scenarios. Explicitly populated zero budgets remain valid sources.</p></section>';if(missing.length){html=html.replace('Portfolio comparison','Available-budget comparison');for(const p of missing){const start=html.indexOf('<tr><td>'+esc(p.name)+'</td>',html.indexOf('NOI by property and scenario')),end=html.indexOf('</tr>',start);if(start>=0&&end>=0)html=html.slice(0,start)+'<tr><td>'+esc(p.name)+'<br><small>No approved budget source</small></td>'+Array.from({length:R.app.compareScenarios.length+3},()=>'<td class="n tiny">Unavailable</td>').join('')+'</tr>'+html.slice(end+5);}html='<p class="note">Budget coverage is incomplete. '+missing.map(p=>esc(p.name)).join(', ')+': no approved budget rows for '+esc(year)+'. Portfolio totals include available budgets only.</p>'+html;}return html+'<section class="card"><h3>Scenario calculation evidence</h3><p>These browser scenarios are draft illustrations. Only a separately approved, locked and activated shared reforecast is an operating benchmark.</p>'+state.scenarios.filter(s=>s.type!=='approved').map(s=>{const row=R.reforecastDiagnostics?.[property+'|'+s.id+'|'+year];return row?'<details><summary>'+esc(s.name)+' · '+esc(row.fingerprint)+'</summary><p>Original source reference: '+esc(row.baselineVersion)+'</p>'+row.diagnostics.map(d=>'<p>'+esc(d.status)+': '+esc(d.explanation)+'</p>').join('')+'</details>':'';}).join('')+'</section>';};}
 if(R.app?.state){R.app.cache=null;R.app.recalc();R.app.render();}
}
