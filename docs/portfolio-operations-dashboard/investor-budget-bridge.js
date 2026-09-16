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
        const closed=Number(vr.closedThrough||0),actualSource=copy.periods?.[property.id+'|'+year]?.source;
        const forecast=active?.type==='reforecast'&&Number(copy.budgetYear)===year?R.variance.compute(copy,R.engine.computeAll(copy,active.id,year),property.id,year):null;
        for(let month=0;month<12;month++) {
          if(imported?.coverage&&!imported.coverage.includes(month))continue;
          const key=year+'-'+String(month+1).padStart(2,'0');
          const period=report.periods[key]={source:`Budget Builder / ${property.name} / ${year} / ${approved.name} / GL detail${(imported?.periodSources?.[month]||sourceFiles)?' / '+(imported?.periodSources?.[month]||sourceFiles):''}`,savedAt,drivers:[],financialDetail:[]};
          const put=(id,basis,value,rows,detail='')=>{
            if(!numeric(value))return;
            const item=period[id] ||= {sources:{},definitions:{}};item[basis]=value;
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
            if(month>=closed||!actualSource||!row.hasActual)continue;
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
  if(new URLSearchParams(location.search).get('investorReader')==='1') {
    window.addEventListener('message',event=>{
      if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='atlas-investor-read-budget')return;
      try {
        const raw=localStorage.getItem(R.persist.AUTOSAVE_KEY);
        if(!raw)return window.parent.postMessage({type:'atlas-investor-budget-sources',sources:{schemaVersion:2,properties:{}}},location.origin);
        const payload=R.persist.parse(raw);
        R.persist.apply(JSON.parse(JSON.stringify(payload))); // isolated frame only; no save or app boot
        const sources=R.investorSources(R.app.state,payload.savedAt,{names:event.data.names});
        window.parent.postMessage({type:'atlas-investor-budget-sources',sources},location.origin);
      }catch(e){window.parent.postMessage({type:'atlas-investor-budget-sources',error:String(e.message||e)},location.origin);}
    });
  }
})();
