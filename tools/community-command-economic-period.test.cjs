// Genuine Community Command selectors and the shared cache, synthetic read-only
// finance responses. No browser session, production API, or financial writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../docs/portfolio-operations-dashboard');
const source=fs.readFileSync(path.join(root,'workspace-core.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const communities=[
 {community_id:'synthetic-alpha',display_name:'Synthetic Alpha',canonical_name:'synthetic-alpha'},
 {community_id:'synthetic-beta',display_name:'Synthetic Beta',canonical_name:'synthetic-beta'},
 {community_id:'synthetic-gamma',display_name:'Synthetic Gamma',canonical_name:'synthetic-gamma'}
];
function envelope(communityId,period,netRentalIncome=75,grossPotentialRent=100){
 const version='close-'+communityId+'-'+period;
 return {registryVersion:'atlas-finance-v1',communityId,period,periodState:'locked',actualCloseVersion:version,
  effectiveBaseline:{communityId,period,status:'unavailable',reason:'No synthetic budget needed'},
  close:{community_id:communityId,period_key:period,version_id:version,revision:1,status:'closed',coverage:'full_month',accounting_basis:'accrual',
   source_file:communityId+'-'+period+'-BCR.xlsx',source_hash:'hash-'+communityId+'-'+period,
   approved_by:'synthetic-accounting-approver',approved_at:'2026-09-03T12:00:00Z',metrics:{netRentalIncome,grossPotentialRent}}};
}

(async()=>{
 const {createCache}=await import('../docs/portfolio-operations-dashboard/features/financial-close.mjs');
 function fixture(today='2026-09-28'){
  const values=new Map(),calls=[],queued=[],state={today,fail:false,actor:'synthetic-reader'};
  const central={getSession:()=>({user:{id:state.actor}}),getConfig:()=>({enabled:true,supabaseUrl:'https://synthetic.invalid'}),readCommunitiesForAccess:async()=>communities,
   fetchJson:async(route,options)=>{
    assert.equal(route,'/rpc/atlas_read_finance','Only the synthetic read transport is available');
    const args=JSON.parse(options.body);calls.push(args);if(state.fail)throw Error('Synthetic finance read failed');
    return args.p_community_ids.flatMap(community_id=>args.p_periods.map(period_key=>({community_id,period_key,summary:values.get(community_id+'|'+period_key)||{registryVersion:'atlas-finance-v1',communityId:community_id,period:period_key,periodState:'open',actualCloseVersion:null,close:null,effectiveBaseline:{communityId:community_id,period:period_key,status:'unavailable',reason:'Synthetic source absent'}}})));
   }};
  const cache=createCache(central),ctx=vm.createContext({console,Date,Map,Set,window:{ATLAS_CENTRAL:central,AtlasClosedFinancialCache:cache},MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],FULL_MONTHS:['January','February','March','April','May','June','July','August','September','October','November','December']});
  for(const match of source.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(match[0],ctx);
  Object.assign(ctx,{getAtlasTodayISODate:()=>state.today,getAtlasAccessProfile:()=>({community_access_records:communities}),getAtlasCommunityAccessRecord:name=>{const row=communities.find(c=>[c.community_id,c.display_name,c.canonical_name].includes(name))||(name==='Alpha Mapped Alias'?communities[0]:null);return row?{atlasCommunityId:row.community_id}:null;},queueAtlasFinancialScope:(name,periods)=>queued.push({name,periods:plain(periods)}),getRecordMonthlyDataForYear:()=>Array.from({length:12},()=>({})),getCommunityCommandDashboardOverride:()=>null,communityCommandCanOverrideDashboard:()=>false,dataImport2State:{lineage:[]}});
  const record=community=>({propertyName:community.display_name,communityId:community.community_id,reportYear:2026,monthlyData:Array.from({length:12},()=>({actualCharges:999999,grossPotentialRent:1,economicOccupancyPct:999999,closedFinancialActuals:{status:'closed',netRentalIncome:999999,grossPotentialRent:1}}))});
  const set=(community,period,nri=75,gpr=100)=>{const row=envelope(community.community_id,period,nri,gpr);values.set(community.community_id+'|'+period,row);return row;};
  const read=(community,month=8,year=2026)=>plain(ctx.getCommunityCommandEconomicOccupancyData(record(community),month,year));
  const scope=(month=8,year=2026)=>plain(ctx.resolveCommunityCommandCloseScope(month,year));
  const load=async(periods,selected=communities)=>cache.refreshScope({communityIds:selected.map(c=>c.community_id),periods,communities,force:true});
  return {ctx,cache,values,calls,queued,state,record,set,read,scope,load};
 }
 function installRefresh(f,{importFails=false}={}){
  const state={importFails,imports:0,renders:0,timers:[],cancelledTimers:new Set(),events:[]};
  Object.assign(f.ctx,{activeTab:'community-command',AbortController,Event,
   atlasAccessDecision:()=>({ok:true}),getAtlasRenderContextKey:()=>f.state.context||f.state.actor,
   scheduleAtlasSharedRender:()=>state.renders++,setTimeout:fn=>{state.timers.push(fn);return state.timers.length;},clearTimeout:id=>state.cancelledTimers.add(id),
   __loadFinancialCloseModule:async()=>{state.imports++;if(state.importFails)throw Error('Synthetic module unavailable');return {createCache};}});
  f.ctx.window.dispatchEvent=event=>state.events.push(event.type);
  // Run the actual queue/refresh code and state declarations. The sole import
  // boundary is injected so its network failure can be exercised deterministically.
  const block=source.slice(source.indexOf('let atlasFinanceRequestController = null;'),source.indexOf('\nfunction shiftAccountingPeriod('));
  const importPattern=/import\("\.\/features\/financial-close\.mjs\?v=[^"\n]+"\)/g;
  assert.equal([...block.matchAll(importPattern)].length,1,'The finance-module boundary must stay explicit');
  vm.runInContext(block.replace(importPattern,'__loadFinancialCloseModule()'),f.ctx);
  return state;
 }
 const [alpha,beta,gamma]=communities;
 const f=fixture();
 const current=f.scope();
 assert.equal(current.selectedPeriod,'2026-09');assert.equal(current.currentPeriod,'2026-09');assert.equal(current.eligibleThrough,'2026-08');assert.equal(current.isOpenSelection,true);
 assert.equal(current.requestedPeriods.length,12);
 assert.deepEqual([...current.requestedPeriods].sort(),['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']);
 assert.deepEqual(current.requestedPeriods,[...current.requestedPeriods].sort().reverse(),'The requested close window is newest first');
 assert.deepEqual(f.scope(7).requestedPeriods,['2026-08'],'A historical selection requests its exact month only');
 assert.equal(f.scope(7).isOpenSelection,false);
 assert.equal(f.scope(11).eligibleThrough,'2026-08','Future selections cannot pull a current or future-month close');
 const a=f.set(alpha,'2026-08',75),b=f.set(beta,'2026-07',40),g=f.set(gamma,'2026-08',0);
 f.set(alpha,'2026-07',70);f.set(alpha,'2026-09',999);f.set(beta,'2026-08',99).close.status='reopened';
 await f.load([...current.requestedPeriods,'2026-09']);
 const before=JSON.stringify([...f.values]);
 const result=f.read(alpha);
 assert.equal(result.selectedPeriod,'2026-09');assert.equal(result.displayedClosePeriod,'2026-08');
 assert.equal(result.state,'open_month_latest_close');
 assert.equal(result.closedPct,75);assert.equal(result.mtdPct,result.closedPct,'Compatibility alias agrees with explicit closed-month percentage');
 assert.equal(result.netRentalIncome,75);assert.equal(result.grossPotentialRent,100);assert.equal(result.collected,75);assert.equal(result.grossCharges,100);
 assert.equal(result.priorPct,70);assert.equal(result.variance,5);
 assert.equal(result.source,a.close.source_file);assert.equal(result.sourceHash,a.close.source_hash);assert.equal(result.version,a.close.version_id);assert.equal(result.closeVersionId,a.close.version_id);assert.equal(result.approvedBy,a.close.approved_by);assert.equal(result.approvedAt,a.close.approved_at);
 assert.equal(f.read(beta).displayedClosePeriod,'2026-07','Each community chooses its own valid latest close');assert.equal(f.read(beta).closedPct,40);
 assert.equal(f.read(gamma).closedPct,0,'Approved explicit zero remains a measured value');
 assert.equal(f.read(gamma).displayedClosePeriod,g.period);
 assert.equal(JSON.stringify([...f.values]),before,'Economic display does not mutate retained source envelopes');
 assert(f.queued.every(row=>communities.some(c=>c.community_id===row.name)),'Requests use canonical community IDs');
 for(const propertyName of ['SYNTHETIC ALPHA','Synthetic-Alpha','Alpha Mapped Alias']){
  const resolved=plain(f.ctx.getCommunityCommandEconomicOccupancyData({propertyName},8,2026));
  assert.equal(resolved.closedPct,result.closedPct,propertyName+' resolves the same governed community close');
  assert.equal(resolved.closeVersionId,result.closeVersionId);
  assert.equal(f.queued.at(-1).name,alpha.community_id);
 }
 console.log('PASS portfolio-wide current-period resolver, bounded prior months, independent community closes, zero and exact approval/source/version provenance');

 const historical=f.read(beta,7);
 assert.equal(historical.closedPct,null,'Historical August never substitutes the available July close');
 assert.equal(historical.state,'reopened_or_superseded');
 assert.notEqual(historical.displayedClosePeriod,'2026-07');
 assert.deepEqual(f.queued.at(-1).periods,['2026-08']);
 const isolated=f.read({community_id:'absent-community',display_name:'Absent Community'},7);
 assert.equal(isolated.closedPct,null,'An unrequested community cannot reuse another community close');
 const noPrior=fixture();noPrior.set(alpha,'2026-08',65);await noPrior.load(noPrior.scope().requestedPeriods,[alpha]);
 assert.equal(noPrior.read(alpha).priorPct,null);assert.equal(noPrior.read(alpha).variance,null,'Missing exact preceding month does not become zero variance');
 assert.equal(noPrior.read(alpha,7).state,'closed_exact');
 assert.equal(noPrior.read(alpha,6).state,'missing_historical_close');
 const freshHistorical=fixture();freshHistorical.set(alpha,'2026-08',75);await freshHistorical.load(freshHistorical.scope(7).requestedPeriods,[alpha]);
 const historicalFresh=freshHistorical.read(alpha,7),historicalWarm=f.read(alpha,7);
 assert.equal(freshHistorical.cache.envelope(alpha.community_id,'2026-07'),null);
 assert.equal(f.cache.get(alpha.community_id,'2026-07').metrics.netRentalIncome,70,'The warm fixture retains an actual July close');
 for(const economic of [historicalFresh,historicalWarm]){
  assert.equal(economic.closedPct,75);assert.equal(economic.displayedClosePeriod,'2026-08');
  assert.equal(economic.priorPct,null,'Historical August cannot compare to July outside its exact requested scope');
  assert.equal(economic.priorClosePeriod,null);assert.equal(economic.variance,null,'Historical variance is independent of previous navigation');
 }
 assert.deepEqual(freshHistorical.queued.at(-1).periods,['2026-08']);assert.deepEqual(f.queued.at(-1).periods,['2026-08']);
 const boundary=fixture(),boundaryScope=boundary.scope(),oldestPeriod=boundaryScope.requestedPeriods.at(-1),outsidePeriod=boundary.ctx.shiftAccountingPeriod(oldestPeriod,-1);
 boundary.set(alpha,oldestPeriod,20);boundary.set(alpha,outsidePeriod,10);await boundary.load(boundaryScope.requestedPeriods,[alpha]);
 const boundaryFresh=boundary.read(alpha);
 await boundary.load([outsidePeriod],[alpha]);
 assert.equal(boundary.cache.get(alpha.community_id,outsidePeriod).metrics.netRentalIncome,10,'An earlier visit has warmed the month outside the window');
 const boundaryWarm=boundary.read(alpha);
 for(const economic of [boundaryFresh,boundaryWarm]){
  assert.equal(economic.displayedClosePeriod,oldestPeriod);assert.equal(economic.closedPct,20);
  assert.equal(economic.priorPct,null,'The oldest eligible close cannot compare beyond the 12-month requested window');
  assert.equal(economic.priorClosePeriod,null);assert.equal(economic.variance,null);
 }
 assert.deepEqual(boundary.queued.at(-1).periods,boundaryScope.requestedPeriods);assert.equal(boundaryScope.requestedPeriods.length,12);assert(!boundaryScope.requestedPeriods.includes(outsidePeriod));
 console.log('PASS historical and 12-month-boundary comparisons are identical with fresh and previously warmed caches');
 const january=fixture('2026-01-12');january.set(alpha,'2025-12',33);january.set(alpha,'2025-11',30);
 assert.equal(january.scope(0).eligibleThrough,'2025-12');assert(january.scope(0).requestedPeriods.includes('2025-12'));
 await january.load(january.scope(0).requestedPeriods,[alpha]);
 assert.equal(january.read(alpha,0).displayedClosePeriod,'2025-12');assert.equal(january.read(alpha,0).closedPct,33);assert.equal(january.read(alpha,0).priorPct,30);assert.equal(january.read(alpha,0).variance,3);
 console.log('PASS historical exact month/no July substitution, no cross-community fallback, missing exact prior comparison and January-to-December boundary');

 const invalidCases=[
  ['open status',e=>e.close.status='open'],['partial coverage',e=>e.close.coverage='mtd'],
  ['reopened publication',e=>e.periodState='reopened'],['superseded publication',e=>e.status='superseded'],
  ['wrong close community',e=>e.close.community_id=beta.community_id],['wrong close month',e=>e.close.period_key='2026-07'],['wrong current version',e=>e.actualCloseVersion='another-version'],
  ['missing source',e=>e.close.source_file=''],['missing approver',e=>e.close.approved_by=''],['missing approval date',e=>e.close.approved_at=''],
  ['missing numerator',e=>e.close.metrics.netRentalIncome=null],['blank numerator',e=>e.close.metrics.netRentalIncome=' '],['zero denominator',e=>e.close.metrics.grossPotentialRent=0],['negative denominator',e=>e.close.metrics.grossPotentialRent=-100]
 ];
 for(const [name,mutate]of invalidCases){
  const test=fixture();test.set(alpha,'2026-07',60);mutate(test.set(alpha,'2026-08',80));await test.load(test.scope().requestedPeriods,[alpha]);
  assert.equal(test.read(alpha).displayedClosePeriod,'2026-07',name+' is excluded from current latest-close selection');
  assert.equal(test.read(alpha,7).closedPct,null,name+' remains unavailable for exact historical August');
 }
 const signed=fixture();signed.set(alpha,'2026-08',-5);await signed.load(signed.scope().requestedPeriods,[alpha]);assert.equal(signed.read(alpha).closedPct,-5,'Signed approved rental income is retained');
 console.log('PASS invalid close exclusion (status, coverage, scope, version, source, approval, numerator and denominator), zero and signed ratios');

 // Explicit state and screen/export parity assertions follow the production
 // presentation contract, with the real renderer and immutable row builder.
 const pending=fixture();const pendingResult=pending.read(alpha);assert.equal(pendingResult.closedPct,null);assert.equal(pendingResult.state,'loading');
 await pending.load(pending.scope().requestedPeriods,[alpha]);const unavailable=pending.read(alpha);assert.equal(unavailable.closedPct,null);assert.equal(unavailable.state,'open_month_no_prior_close');
 pending.state.fail=true;await assert.rejects(pending.load(pending.scope().requestedPeriods,[alpha]),/Synthetic finance read failed/);const failed=pending.read(alpha);assert.equal(failed.closedPct,null);assert.equal(failed.state,'failed');
 console.log('PASS separate loading, no-close and failed-read states without operational-value substitution');

 const refresh=fixture();refresh.set(alpha,'2026-08',75);refresh.set(beta,'2026-07',40);
 const refreshState=installRefresh(refresh);
 const distinctGroups=new Map([[alpha.community_id,new Set(['2026-08'])],[beta.community_id,new Set(['2026-07'])]]);
 assert.equal(await refresh.ctx.refreshAtlasClosedFinancials(undefined,true,distinctGroups),true);
 assert.equal(refresh.cache.get(alpha.community_id,'2026-08')?.metrics.netRentalIncome,75,'Force-refreshing a second group must retain the first group');
 assert.equal(refresh.cache.get(beta.community_id,'2026-07')?.metrics.netRentalIncome,40);
 assert.equal(refresh.cache.scopeState(alpha.community_id,['2026-08']),'ready');assert.equal(refresh.cache.scopeState(beta.community_id,['2026-07']),'ready');
 assert.equal(refresh.calls.length,2,'Distinct selections remain separately scoped');
 assert.deepEqual(refresh.calls.map(call=>call.p_periods),[['2026-08'],['2026-07']]);
 assert.equal(refreshState.events.filter(type=>type==='atlas-finance-updated').length,1);
 console.log('PASS real refresh function retains every forced community group without cross-product reads');

 const switched=fixture(),queueState=installRefresh(switched),requests=[];
 switched.ctx.refreshAtlasClosedFinancials=async(year,force,requested)=>requests.push([...requested].map(([id,periods])=>({id,periods:[...periods]})));
 switched.ctx.queueAtlasFinancialScope(alpha.community_id,['2026-08']);
 assert.equal(queueState.timers.length,1);
 switched.state.context='new-community-selection';
 switched.ctx.queueAtlasFinancialScope(beta.community_id,['2026-07']);
 assert(queueState.cancelledTimers.has(1),'Changing context cancels the previous scheduled queue');
 assert.equal(queueState.timers.length,2,'The new selection receives its own scheduled request');
 queueState.timers[0]();
 assert.equal(requests.length,0,'A stale timer cannot dispatch or empty the new selection queue');
 queueState.timers[1]();
 assert.deepEqual(requests,[[{id:beta.community_id,periods:['2026-07']}]]);
 console.log('PASS context changes preserve the new selection request and stale timers cannot drain it');

 const missingModule=fixture();missingModule.set(alpha,'2026-08',75);delete missingModule.ctx.window.AtlasClosedFinancialCache;
 const moduleState=installRefresh(missingModule,{importFails:true}),moduleScope=new Map([[alpha.community_id,new Set(['2026-08'])]]);
 await assert.rejects(missingModule.ctx.refreshAtlasClosedFinancials(undefined,false,moduleScope),/Synthetic module unavailable/);
 assert.equal(missingModule.read(alpha,7).state,'failed','An import failure must show a failed state rather than endless loading');
 const failureRenders=moduleState.renders;
 await missingModule.ctx.refreshAtlasClosedFinancials(undefined,false,moduleScope);
 assert.equal(moduleState.imports,1,'Automatic renders do not immediately retry the failed module');
 assert.equal(moduleState.renders,failureRenders,'A failed module cannot trigger a render retry loop');
 moduleState.importFails=false;
 assert.equal(await missingModule.ctx.refreshAtlasClosedFinancials(undefined,true,moduleScope),true,'An explicit refresh can recover from an import failure');
 assert.equal(missingModule.read(alpha,7).closedPct,75);assert.equal(missingModule.read(alpha,7).state,'closed_exact');
 console.log('PASS failed-module display, retry-loop guard and explicit recovery');

 const {closedEconomicOccupancyRows,reportHtml}=await import('../docs/portfolio-operations-dashboard/features/community-plan-report.mjs');
 Object.assign(f.ctx,{getApplicationApprovalCohortDisplay:()=>({subtext:'Synthetic activity'}),getEffectiveMoveOutsForMonth:()=>({effective:0})});
 const model={propName:alpha.display_name,record:f.record(alpha),monthIdx:8,year:2026,economic:{...result,mtdPct:999},physicalPct:90,leasedPct:95,occupied:9,leased:10,totalUnits:10,occupancyBaseUnits:10,budgetOccPct:0,budgetLeasedPct:0,trendingPct:null,trendingLabel:'Unavailable',appMetrics:{applications:0,approvals:0,denials:0,cancelled:0,pendingDecision:0},plan:{},monthEntry:{},monthlyData:[],netLeasesMtd:0,renewal:{expirations:0}};
 const screen=f.ctx.renderCommunityCommandHealthSnapshot(model);
 assert(screen.includes('75.0%'),'The screen uses closedPct rather than a stale mtdPct compatibility field');
 assert(!screen.includes('999.0%'));
 f.ctx.getCommunityCommandDashboardOverride=()=>({overrideValue:999});
 assert.equal(f.ctx.communityCommandMetricValue(model,'economic_occupancy',result.closedPct).value,75,'A legacy operational override cannot replace governed close evidence');
 const label=f.ctx.communityCommandEconomicOccupancyLabel(result);
 assert(label.includes('Closed 2026-08'));assert(label.includes('selected 2026-09'));assert(screen.includes(label));
 const report={report_id:'synthetic-report',plan_version:1,created_at:'2026-09-28T12:00:00Z',executive_note:'Synthetic economic period parity',snapshot:{community:alpha.display_name,period:'2026-09',sourceUpdatedAt:'2026-09-28',plan:{tasks:[]},closedEconomicOccupancy:result}};
 const row=closedEconomicOccupancyRows(report)[0];
 assert.equal(row.Closed_economic_occupancy_pct,result.closedPct);assert.equal(row.Selected_period,result.selectedPeriod);assert.equal(row.Displayed_close_period,result.displayedClosePeriod);assert.equal(row.State,result.state);
 assert.equal(row.Close_version_ID,result.closeVersionId);assert.equal(row.Source,result.source);assert.equal(row.Source_hash,result.sourceHash);assert.equal(row.Approved_by,result.approvedBy);assert.equal(row.Approved_at,result.approvedAt);assert.equal(row.Net_rental_income,result.netRentalIncome);assert.equal(row.Gross_potential_rent,result.grossPotentialRent);
 const html=reportHtml(report);assert(html.includes('75.0%'));assert(html.includes('2026-08'));assert(html.includes('2026-09'));assert(html.includes(result.source));assert(html.includes(result.closeVersionId));
 console.log('PASS explicit closedPct screen/HTML/PDF/XLSX model parity, selected-vs-displayed period labels and approval/source/version evidence');

 // Render the actual mixed-community roster from independent governed closes.
 const portfolio=fixture(),portfolioModels=new Map();
 const expectedPortfolio=[{community:alpha,period:'2026-08',pct:75},{community:beta,period:'2026-07',pct:40},{community:gamma,period:'2026-06',pct:0}];
 for(const item of expectedPortfolio)portfolio.set(item.community,item.period,item.pct);
 await portfolio.load(portfolio.scope().requestedPeriods);
 Object.assign(portfolio.ctx,{
  communityCommandPortfolioRosterFilter:'all',getSelectedDashboardMonthIndex:()=>8,
  getWorkspaceScopedDetails:(month,options)=>{assert.equal(month,8);assert.equal(options.includeRecommendations,false);assert.equal(options.includeSummary,false);return [...communities].reverse().map(community=>({name:community.display_name,record:portfolio.record(community)}));},
  isCommunityStatusActive:()=>true,atlasDashboardUserCanSeeCommunityName:()=>true,
  buildCommunityCommandModel:(propName,record)=>{const economic=portfolio.ctx.getCommunityCommandEconomicOccupancyData(record,8,2026);portfolioModels.set(propName,economic);return {...model,propName,record,economic:{...economic,mtdPct:999},grossLeasesMtd:0};},
  buildCommunityCommandAlerts:()=>[],getCommunityCommandPlanSuggestion:()=>null,
  queueCommunityRosterFinancials:()=>{},renderCommunityCommandPlanSummaryStat:()=>'',statBox:()=>'',
  renderPortfolioScopePanel:(title,description,cards,body)=>cards+body
 });
 const portfolioHtml=portfolio.ctx.renderPortfolioScopedCommunityCommandTab();
 const renderedRows=new Map([...portfolioHtml.matchAll(/<tr data-command-finance="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map(match=>[decodeURIComponent(match[1]),match[2]]));
 assert.equal(renderedRows.size,3,'All three arbitrary communities appear in the actual portfolio table');
 for(const item of expectedPortfolio){
  const name=item.community.display_name,economic=portfolioModels.get(name),renderedRow=renderedRows.get(name);
  assert(renderedRow,name+' has its own portfolio row');
  const cell=renderedRow.match(/<td data-closed-economic-state="([^"]+)">([\s\S]*?)<\/td>/);
  assert(cell,name+' exposes the machine-readable economic state');
  assert.equal(cell[1],economic.state);assert.equal(cell[1],'open_month_latest_close');
  assert.equal(cell[2],item.pct.toFixed(1)+'%<br><small>Closed '+item.period+' · selected 2026-09</small>',name+' retains its own percentage and selected/displayed periods');
  assert.equal(economic.closedPct,item.pct);assert.equal(economic.displayedClosePeriod,item.period);
  const exportRow=closedEconomicOccupancyRows({...report,snapshot:{...report.snapshot,community:name,closedEconomicOccupancy:economic}})[0];
  assert.equal(exportRow.Closed_economic_occupancy_pct,item.pct);assert.equal(exportRow.Displayed_close_period,item.period);assert.equal(exportRow.Selected_period,'2026-09');assert.equal(exportRow.State,cell[1]);
 }
 assert(!portfolioHtml.includes('999.0%'),'The portfolio renderer ignores the poisoned MTD compatibility alias');
 console.log('PASS actual mixed-community portfolio rows preserve independent closed percentages, zero, machine states, selected/displayed periods and export parity');
})().catch(error=>{console.error(error);process.exitCode=1;});
