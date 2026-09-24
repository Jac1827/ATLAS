/* Read-only Budget Builder reporting adapter. Calculations run on a copy. */
(function () {
  'use strict';
  const R=window.RBB;
  if(!R?.persist?.serialize||!R.engine?.computeAll||!R.variance?.compute)return;
  const group=(...groups)=>r=>groups.includes(r.coaGroup);
  const gl=(...codes)=>r=>codes.includes(String(r.gl));
  const selectors={
    revenue:r=>['income','contra_income'].includes(r.nature),expenses:r=>r.nature==='expense',
    grossPotentialRent:gl('5120'),lossToLease:gl('5125'),vacancyLoss:gl('5220','5224'),
    concessions:gl('5250','5258'),employeeModelLoss:gl('5221','5222','5223'),badDebt:gl('5255'),
    rentalIncome:group('RENTAL INCOME','COST OF LEASING'),otherIncome:r=>r.coaGroup==='OTHER INCOME'&&r.nature==='income',
    utilityReimbursement:gl('5912','5915','5916','5917','5942','5943','5944','5956'),
    parkingIncome:gl('5170','5936'),storageIncome:gl('5175'),petIncome:gl('5952','5964'),amenityIncome:gl('5941'),
    payroll:group('PAYROLL & RELATED EXPENSES'),contractLabor:gl('6523'),repairs:group('REPAIRS & MAINTENANCE'),
    turnExpense:group('TURNOVER EXPENSE'),utilities:r=>r.nature==='expense'&&['COMMON AREA UTILITIES EXPENSE','UNIT UTILITIES EXPENSE'].includes(r.coaGroup),
    marketingExpense:group('MARKETING & ADVERTISING'),adminExpense:group('GENERAL & ADMINISTRATIVE'),
    security:gl('6530'),landscaping:gl('6537'),propertyTaxes:r=>r.nature==='expense'&&gl('6710','6715','6750','6810','6820','6830')(r),insurance:r=>r.nature==='expense'&&gl('6719','6720','6721','6800')(r),managementFees:group('MANAGEMENT FEES'),
    capexSpent:r=>r.nature==='capital',debtService:r=>r.nature==='debt'
  };
  const loss=new Set(['lossToLease','vacancyLoss','concessions','employeeModelLoss','badDebt']);
  const numeric=v=>typeof v==='number'&&Number.isFinite(v);
  R.investorSources=function(state,savedAt=new Date().toISOString(),options={}) {
    const sources={schemaVersion:2,savedAt,properties:{}};
    if(!state||state.demoActuals)return sources;
    const copy=JSON.parse(JSON.stringify(state));
    if(Array.isArray(options.names))copy.properties=copy.properties.filter(p=>options.names.includes(p.name));
    if(!copy.properties.length)return sources;
    const approved=copy.scenarios.find(s=>s.type==='approved'&&s.locked);
    if(!approved){sources.issue='No locked approved budget scenario is available.';return sources;}
    const active=copy.scenarios.find(s=>s.id===copy.activeScenario);
    const years=[...new Set([Number(copy.budgetYear),...Object.values(copy.actuals||{}).map(a=>Number(a.year)),...Object.values(copy.approvedBudgetImports||{}).map(a=>Number(a.year)),...copy.properties.flatMap(p=>Object.keys(p.occupancyByYear||{}).map(Number))])].filter(y=>y>=2000&&y<=2100);
    const calculations=new Map();
    for(const year of years)calculations.set(year,R.engine.computeAll(copy,approved.id,year));
    for(const property of copy.properties) {
      const files=[...new Set((copy.lines||[]).filter(l=>l.propertyId===property.id).map(l=>[l.sourceFile,l.sourceSheet].filter(Boolean).join(' / ')).filter(Boolean))].join('; ');
      const report={propertyId:property.id,code:property.code,name:property.name,periods:{},issues:[]};sources.properties[property.name]=report;
      if(property.fiscalYearBegins&&property.fiscalYearBegins!=='Jan'&&!Object.values(copy.approvedBudgetImports||{}).some(s=>s.propertyId===property.id&&s.coverage)){report.issues.push('Non-calendar fiscal year requires an explicit period mapping.');continue;}
      for(const year of years) {
        const imported=copy.approvedBudgetImports?.[property.id+'|'+year];
        if(property.budgetImportOnly&&!imported)continue;
        const sourceFiles=imported ? imported.sourceFile+' / '+imported.sourceSheet+' / approved '+imported.effectiveDate+' / '+imported.rows.map(r=>'GL '+r.gl+' row '+r.sourceRow).join('; ') : files;
        const calc=calculations.get(year),vr=R.variance.compute(copy,calc,property.id,year);
        const closed=Number(vr.closedThrough||0),canonical=R.closedFinancial?.caches.get(property.id+'|'+year),legacyActualSource=copy.periods?.[property.id+'|'+year]?.source;
        const forecast=!window.parent?.ATLAS_CENTRAL&&active?.type==='reforecast'&&Number(copy.budgetYear)===year?R.variance.compute(copy,R.engine.computeAll(copy,active.id,year),property.id,year):null;
        for(let month=0;month<12;month++) {
          if(imported?.coverage&&!imported.coverage.includes(month))continue;
          const key=year+'-'+String(month+1).padStart(2,'0');
          const close=canonical?.versions.find(v=>v.period_key===key),actualSource=canonical?(close?close.source_file+' / SHA-256 '+close.source_hash+' / closed version '+close.version_id:null):(window.parent?.ATLAS_CENTRAL?null:legacyActualSource);
          const period=report.periods[key]={source:`Budget Builder / ${property.name} / ${year} / ${approved.name} / GL detail${(imported?.periodSources?.[month]||sourceFiles)?' / '+(imported?.periodSources?.[month]||sourceFiles):''}`,savedAt,drivers:[],financialDetail:[]};
          if(close)period.closedFinancial={version:close.version_id,revision:close.revision,status:close.status,period:close.period_key,sourceHash:close.source_hash,approvedBy:close.approved_by,approvedAt:close.approved_at};
          const put=(id,basis,value,rows,detail='')=>{
            if(!numeric(value))return;
            const item=period[id] ||= {sources:{},definitions:{}};item[basis]=value;
            if(basis==='forecast')item.forecastBasis={kind:'legacy_full_year',year,scenarioId:active.id,scenarioName:active.name};
            item.sources[basis]=`${period.source} / ${basis} / month ${month+1} / ${rows.map(r=>r.gl+' '+r.name).join('; ')}${basis==='actual'?' / '+actualSource:''}${detail?' / '+detail:''}`;
            item.definitions[basis]=`${id}: ${loss.has(id)?'loss shown as positive; gains negative; ':''}${detail||'signed GL sum from Budget Builder'}; same community and calendar period.`;
          };
          for(const [id,select] of Object.entries(selectors)) {
            const rows=vr.rows.filter(select);if(!rows.length)continue;
            const sign=loss.has(id)?-1:1;
            const budgetComplete=rows.every(r=>Array.isArray(r.budget)&&numeric(r.budget[month]));
            if(budgetComplete)put(id,'budget',sign*rows.reduce((s,r)=>s+r.budget[month],0),rows);
            const actualComplete=month<closed&&actualSource&&rows.every(r=>r.hasActual&&numeric(r.actual?.[month]));
            if(actualComplete)put(id,'actual',sign*rows.reduce((s,r)=>s+r.actual[month],0),rows);
            if(month<closed&&actualSource&&!actualComplete)report.issues.push(`${key} ${id}: actuals missing for ${rows.filter(r=>!r.hasActual).map(r=>r.gl).join(', ')}; no zero assumption made.`);
            if(forecast&&key===savedAt.slice(0,7)) {
              const fr=forecast.rows.filter(select);
              if(fr.length&&fr.every(r=>(closed===0||r.hasActual)&&numeric(r.projection)))put(id,'forecast',sign*fr.reduce((s,r)=>s+r.projection,0),fr,`${active.name}; full-year forecast vintage ${key}; closed actuals plus remaining plan`);
            }
          }
          if(close){for(const [id,key] of [['revenue','totalIncome'],['expenses','operatingExpenses'],['grossPotentialRent','grossPotentialRent'],['rentalIncome','netRentalIncome']])put(id,'actual',Number(close.metrics[key]),[],actualSource);}
          for(const basis of ['actual','budget','forecast']) {
            const revenue=period.revenue?.[basis],expense=period.expenses?.[basis];
            if(numeric(revenue)&&numeric(expense)) {
              put('noi',basis,revenue-expense,[],`${period.revenue.sources[basis]}; less ${period.expenses.sources[basis]}`);
              if(revenue>0)put('noiMargin',basis,(revenue-expense)/revenue*100,[],'NOI divided by operating revenue × 100; '+period.noi.sources[basis]);
            }
          }
          if(numeric(property.totalUnits))put('totalUnits','budget',property.totalUnits,[],'Budget setup inventory; not a historical actual inventory snapshot');
          const capital=vr.rows.filter(r=>r.nature==='capital');
          if(capital.length&&capital.every(r=>numeric(r.fullYearBudget))){
            const approvedCapital=capital.reduce((s,r)=>s+r.fullYearBudget,0);
            put('capexBudget','actual',approvedCapital,capital,'Approved full-year capital budget, not actual spend');
            if(month<closed&&actualSource&&capital.every(r=>r.hasActual&&r.actual.slice(0,month+1).every(numeric)))put('capexRemaining','actual',approvedCapital-capital.reduce((s,r)=>s+r.actual.slice(0,month+1).reduce((a,b)=>a+b,0),0),capital,'Approved annual capital budget less verified YTD spend');
          }
          if(numeric(period.noi?.forecast))put('forecastNOI','actual',period.noi.forecast,[],period.noi.sources.forecast);
          if(numeric(period.capexSpent?.forecast))put('capexForecast','actual',period.capexSpent.forecast,[],period.capexSpent.sources.forecast);
          const occ=property.occupancyByYear?.[year]?.[month];
          if(numeric(occ))put('physicalOccupancy','budget',occ*100,[],'Budget Summary / physical occupancy, decimal rate × 100');
          const eco=property.economicOccupancy?.[year]?.[month];
          if(numeric(eco))put('economicOccupancy','budget',eco*100,[],'Budget Summary / economic occupancy, decimal rate × 100');
          // Account commentary is a source note, not automatic proof of causation.
          for(const row of vr.rows) {
            if(month>=closed||!actualSource||!row.hasActual||!numeric(row.actual?.[month]))continue;
            const note=copy.varianceNotes?.[property.id+'|'+row.gl+'|'+year];
            const evidence=`${period.source} / GL ${row.gl} ${row.name} / ${actualSource} / ${key}`;
            period.financialDetail.push({gl:row.gl,name:row.name,actual:row.actual[month],budget:row.budget[month],variance:row.actual[month]-row.budget[month],source:evidence});
            if(note)period.drivers.push({id:'budget-note-'+row.gl,metric:Object.entries(selectors).find(([id,sel])=>!['revenue','expenses','rentalIncome','otherIncome'].includes(id)&&sel(row))?.[0]|| (row.nature==='expense'?'expenses':'revenue'),classification:'hypothesis',explanation:String(note),owner:row.department||'Finance',evidence:evidence+' / annual variance note; applicability to this month requires review',action:'Validate the source explanation against this month’s account detail.'});
          }
        }
      }
    }
    return sources;
  };
  // A publication supplies only the forecast comparison. Canonical actuals and the
  // approved original budget already on the report remain separate authorities.
  function applyActiveForecast(report,communityId,publications,store) {
    const candidates=publications.filter(p=>p.communityId===communityId&&p.publicationId&&p.snapshot);
    const projections=new Map(candidates.map(p=>[p.publicationId,store.effectiveActiveSnapshot(p)]));
    for(const [key,period] of Object.entries(report.periods)) {
      period.forecastAuthority='canonical_active';
      const matches=candidates.filter(p=>p.activePeriods?.includes(key));
      if(matches.length!==1){period.activeReforecast={status:'unavailable',reason:matches.length?'Conflicting active publications require reconciliation.':'No Active Reforecast has been published for this month.'};continue;}
      const publication=matches[0],snapshot=projections.get(publication.publicationId),month=snapshot.monthly?.find(m=>m.period===key);
      if(!month||month.applicable===false){period.activeReforecast={status:'unavailable',reason:'Active Reforecast does not contain an applicable reporting month.'};continue;}
      const lineage={kind:'monthly_active_reforecast',period:key,communityId,publicationId:publication.publicationId,scenarioId:publication.scenarioId,revisionId:publication.revisionId,version:publication.version,publishedAt:publication.publishedAt,publishedBy:publication.publishedBy,publishedFingerprint:publication.snapshot.fingerprint,projectionFingerprint:snapshot.fingerprint,sourceVersion:publication.source?.sourceVersion,actualCutoff:snapshot.identity?.actualCutoff,closeVersionId:month.closeVersionId||null,sourceKind:'locked_published_baseline'};
      period.activeReforecast={status:'available',...lineage};
      const source=`Active Reforecast / publication ${lineage.publicationId} / revision ${lineage.revisionId} / version ${lineage.version} / published ${lineage.publishedAt} by ${lineage.publishedBy} / ${key} / fingerprint ${lineage.publishedFingerprint} / projection ${lineage.projectionFingerprint}${lineage.closeVersionId?' / governed close '+lineage.closeVersionId:''}`;
      const put=(id,value,detail)=>{if(!numeric(value))return;const item=period[id]||={sources:{},definitions:{}};item.sources||={};item.definitions||={};item.forecast=value;item.forecastBasis={...lineage};item.sources.forecast=source+' / '+detail;item.definitions.forecast=`${id}: monthly Active Reforecast for ${key}; ${detail}; immutable published baseline, governed actuals are shown separately.`;};
      const amounts=month.reforecast||{};
      for(const [id,metric] of Object.entries({revenue:'revenue',expenses:'expenses',noi:'noi',noiMargin:'margin',cashFlow:'cashFlow',capexSpent:'capital',debtService:'debt'}))put(id,id==='noiMargin'&&numeric(amounts[metric])?amounts[metric]*100:amounts[metric],'governed monthly '+metric);
      const rows=(snapshot.lines||[]).filter(r=>r.period===key).map(r=>({...r,gl:r.accountCode,coaGroup:r.category}));
      for(const [id,select] of Object.entries(selectors)){
        if(['revenue','expenses','capexSpent','debtService'].includes(id))continue;
        const selected=rows.filter(r=>r.placement==='above_noi'&&select(r));
        if(selected.length&&selected.every(r=>r.mappingValid&&numeric(r.forecast)))put(id,(loss.has(id)?-1:1)*selected.reduce((sum,r)=>sum+r.forecast,0),'mapped GL '+selected.map(r=>r.accountCode).join(', '));
      }
      for(const row of rows){
        let detail=period.financialDetail.find(r=>String(r.gl)===String(row.accountCode));
        if(!detail){detail={gl:row.accountCode,name:row.accountName,actual:null,budget:null,variance:null,source:''};period.financialDetail.push(detail);}
        detail.forecast=numeric(row.forecast)?row.forecast:null;detail.forecastSource=source+' / GL '+row.accountCode;detail.forecastBasis={...lineage};
        detail.forecastEvidence={category:row.category,nature:row.nature,placement:row.placement,sourceKind:row.sourceKind,closeVersionId:row.closeVersionId,driverIds:row.driverIds||[],driverSources:row.driverSources||[],source:row.source};
      }
    }
  }
  if(new URLSearchParams(location.search).get('investorReader')==='1') {
    window.addEventListener('message',async event=>{
      if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='atlas-investor-read-budget')return;
      try {
        const central=window.parent.ATLAS_CENTRAL,actor=central?.getSession()?.user?.id;
        if(!actor||!window.parent.atlasAccessDecision?.(12)?.ok)throw Error('Authorized canonical financial access required');
        const [adapter,matcher,communities,aliases,forecastStore]=await Promise.all([import('./features/canonical-finance.mjs?v=6fd3f2a1967abe60'),import('./features/financial-package.mjs?v=a378a0cb25083758'),central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000'),import('./features/reforecast-store.mjs?v=8a0011d1c194257e')]);
        const year=Number(event.data.year)||new Date().getFullYear(),sources={schemaVersion:3,savedAt:new Date().toISOString(),properties:{}},seen=new Set();
        const selected=[];for(const name of event.data.names||[]){const cid=matcher.resolveCommunity(name,communities,aliases).communityId;if(cid&&!seen.has(cid)){seen.add(cid);selected.push(communities.find(c=>c.community_id===cid));}}
        const periods=Array.from({length:12},(_,m)=>year+'-'+String(m+1).padStart(2,'0'));
        const [records,activeResult]=await Promise.all([adapter.readFinance(central,selected.map(c=>c.community_id),periods),forecastStore.readActive(central,{communityIds:selected.map(c=>c.community_id),periods}).then(publications=>({publications}),error=>({publications:[],error:String(error.message||error)}))]);
        for(const community of selected){
          const report={name:community.display_name,periods:{},issues:[]};sources.properties[community.display_name]=report;
          for(const row of records.filter(r=>r.community_id===community.community_id)){
            const s=row.summary,period=report.periods[row.period_key]={source:s.actualSource||s.budgetSource||'Canonical finance',savedAt:s.publishedAt,drivers:[],financialDetail:[],coverage:{completeYtd:s.completeYtd,missingPeriods:s.missingPeriods,latestClosedPeriod:s.latestClosedPeriod},budgetVersion:s.budgetVersion,registryVersion:s.registryVersion};
            if(s.close)period.closedFinancial={version:s.close.version_id,revision:s.close.revision,status:s.close.status,period:s.close.period_key,sourceHash:s.close.source_hash,approvedBy:s.close.approved_by,approvedAt:s.close.approved_at};
            for(const [key,value] of Object.entries(s)){
              if(!value||typeof value!=='object'||!('actual' in value)||!('budget' in value))continue;
              const id=({gpr:'grossPotentialRent',netRentalIncome:'rentalIncome',capital:'capexSpent',debt:'debtService'})[key]||key;
              const item=period[id] ||= {sources:{},definitions:{},availability:value.availability,approvedTargetVersion:s.budgetVersion,targetApprovalStatus:s.targetApprovalStatus,actualCloseVersions:s.actualCloseVersion?[s.actualCloseVersion]:[]};
              for(const basis of ['actual','budget']){const amount=basis==='budget'&&Object.hasOwn(value,'originalBudget')?value.originalBudget:value[basis];if(adapter.number(amount)!==null){item[basis]=adapter.number(amount);item.sources[basis]=`${basis==='actual'?s.actualSource:s.budgetSource} / version ${basis==='actual'?s.actualCloseVersion:s.budgetVersion} / ${s.registryVersion} / ${row.period_key}`;item.definitions[basis]=key+' / approved canonical metric registry';}}
            }
            if(!s.budgetVersion)report.issues.push(row.period_key+': Approved original budget unavailable.');
            if(row.period_key===event.data.period&&s.actualCloseVersion){
              const detail=await adapter.readDetail(central,s),b=s.budgetVersion?(await central.fetchJson(`/atlas_approved_budget_versions?version_id=eq.${s.budgetVersion}&select=*&limit=1`))[0]:null;
              period.financialDetail=detail.map(r=>{const budget=b?.payload.rows.find(x=>x.glCode===r.gl_code)?.monthly[Number(row.period_key.slice(5))-1]??null,actual=adapter.number(r.actual);return {gl:r.gl_code,name:r.account_name,actual,budget,variance:budget===null||actual===null?null:actual-budget,source:period.source+' / close '+s.actualCloseVersion+' / budget '+(s.budgetVersion||'unavailable')+' / '+JSON.stringify(r.source_location)};});
            }
          }
          applyActiveForecast(report,community.community_id,activeResult.publications,forecastStore);
          if(activeResult.error)for(const key of Object.keys(report.periods))report.issues.push(key+': Active Reforecast unavailable: '+activeResult.error);
        }
        if(central.getSession()?.user?.id!==actor)throw Error('Session changed while preparing the financial report');
        window.parent.postMessage({type:'atlas-investor-budget-sources',sources},location.origin);
      }catch(e){window.parent.postMessage({type:'atlas-investor-budget-sources',error:String(e.message||e)},location.origin);}
    });
  }
})();
