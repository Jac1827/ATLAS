/* Derived reporting snapshot only; budget inputs, scenarios and actuals remain untouched. */
(function () {
  'use strict';
  const R=window.RBB;
  if(!R?.persist?.serialize||!R.engine?.computeAll||!R.variance?.compute) return;
  const serialize=R.persist.serialize;
  R.persist.serialize=function(state,meta) {
    const payload=serialize.call(this,state,meta);
    try {
      if(state.demoActuals) return payload;
      const copy=JSON.parse(JSON.stringify(state));
      const approved=copy.scenarios.find(s=>s.type==='approved'&&s.locked);
      if(!approved) return payload;
      const year=Number(copy.budgetYear);
      const calc=R.engine.computeAll(copy,approved.id,year);
      const active=copy.scenarios.find(s=>s.id===copy.activeScenario);
      const forecastCalc=active?.type==='reforecast'?R.engine.computeAll(copy,active.id,year):null;
      const sources={schemaVersion:1,savedAt:payload.savedAt,properties:{}};
      for(const property of copy.properties) {
        if(property.fiscalYearBegins&&property.fiscalYearBegins!=='Jan') continue;
        const vr=R.variance.compute(copy,calc,property.id,year);
        const periods={};
        const closed=Number(vr.closedThrough||0);
        const actualSource=copy.periods?.[property.id+'|'+year]?.source;
        for(let month=0;month<12;month++) {
          const key=year+'-'+String(month+1).padStart(2,'0');
          const relevant=vr.rows.filter(r=>['income','contra_income','expense'].includes(r.nature));
          // No blank account is silently promoted to a zero actual.
          const complete=month<closed&&Boolean(actualSource)&&relevant.length>0&&relevant.every(r=>r.hasActual);
          const total=(nature,basis)=>{
            const rows=vr.rows.filter(r=>nature.includes(r.nature));
            if(!rows.length)return null;
            if(basis==='actual'&&!complete)return null;
            if(rows.some(r=>!Array.isArray(r[basis])||!Number.isFinite(r[basis][month])))return null;
            return rows.reduce((s,r)=>s+r[basis][month],0);
          };
          const metric=(natures)=>({actual:total(natures,'actual'),budget:total(natures,'budget')});
          const revenue=metric(['income','contra_income']),expenses=metric(['expense']);
          const noi=Object.fromEntries(['actual','budget'].map(b=>[b,revenue[b]===null||expenses[b]===null?null:revenue[b]-expenses[b]]));
          const noiMargin=Object.fromEntries(['actual','budget'].map(b=>[b,noi[b]===null||!revenue[b]?null:noi[b]/revenue[b]*100]));
          periods[key]={revenue,expenses,noi,noiMargin,capexSpent:metric(['capital']),debtService:metric(['debt']),source:`Budget Builder / ${property.name} / ${year} / approved scenario ${approved.name} / month ${month+1} / actual source: ${actualSource||'not loaded'} / budget source: ${[...new Set(copy.lines.filter(l=>l.propertyId===property.id).map(l=>l.sourceFile).filter(Boolean))].join(', ')}`,savedAt:payload.savedAt};
        }
        const vintage=payload.savedAt.slice(0,7);
        if(forecastCalc&&periods[vintage]) {
          const fvr=R.variance.compute(copy,forecastCalc,property.id,year);
          const f=R.financialReview.build(fvr,copy,forecastCalc,{period:'ytd'});
          for(const [id,key] of [['revenue','revenue'],['expenses','expense'],['noi','noi']]) {
            const value=f.summary[key]?.projected;
            if(Number.isFinite(value)) periods[vintage][id].forecast=value;
          }
          periods[vintage].source+=` / forecast vintage ${vintage}: ${active.name}, actuals plus remaining scenario plan`;
        }
        sources.properties[property.name]={propertyId:property.id,periods};
      }
      payload.investorPacketSources=sources;
    }catch(error){payload.investorPacketSourceError='Financial reporting bridge unavailable: '+String(error.message||error);}
    return payload;
  };
})();
