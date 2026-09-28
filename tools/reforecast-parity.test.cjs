const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
(async()=>{
 const {computeReforecast,roundMoney,sumMoney,aggregateForecastLines}=await import('../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs');
 const {db,A,BUDGET,signIn}=await fixture();
 for(const value of [10.075,-10.075,1.005,-1.005,.005,-.005,10.074999999999998,10.075000000000001,1e-7,-1e-7,0])assert.equal(roundMoney(value),Number((await db.query('select round($1::numeric,2) amount',[String(value)])).rows[0].amount),'Browser money must match the independent PostgreSQL numeric oracle');
 for(const values of [[.06,.045],[-.06,-.045],[1e20,-1e20,.105]])assert.equal(sumMoney(values),Number((await db.query('select round(sum(value),2) amount from unnest($1::numeric[]) value',[values.map(String)])).rows[0].amount),'Accumulate decimal source values before one rounding');
 const decimalLines=[{nature:'income',placement:'above_noi',forecast:100.004},{nature:'expense',placement:'above_noi',forecast:10.009},{nature:'income',placement:'below_noi',forecast:.004},{nature:'expense',placement:'below_noi',forecast:.009}].map(row=>({...row,mappingValid:true}));await db.exec('reset role');const decimalMetrics=(await db.query("select atlas_private.reforecast_metric($1,'forecast') metrics",[decimalLines])).rows[0].metrics;const decimalClient=aggregateForecastLines(decimalLines,'forecast');assert.deepEqual({...decimalClient,margin:null},{...decimalMetrics,margin:null},'Category rounding and below-NOI signed accumulation follow PostgreSQL exactly');assert(Math.abs(decimalClient.margin-decimalMetrics.margin)<1e-12); await signIn(1);
 await db.exec('reset role');await db.query("update atlas_communities set units=240,updated_at='2026-09-01T00:00:00Z' where community_id=$1",[A]);await db.query("update atlas_approved_budget_versions set payload=payload||$1::jsonb where version_id=$2",[JSON.stringify({occupancyPct:[90,0,95,95,95,95,95,95,95,95,95,95],occupancySource:'Approved leasing assumption'}),BUDGET]);await signIn(1);
 const call=async(name,args)=>(await db.query(`select to_jsonb(${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as result`,args)).rows[0].result;
 const accounts=[['5120','Rent','income','above_noi'],['5220','Vacancy','contra_income','above_noi'],['6100','Payroll','expense','above_noi'],['6200','Utilities','expense','above_noi'],['8100','Capital','capital','below_noi']].map(([accountCode,category,nature,placement])=>({accountCode,category,nature,placement,effectiveFrom:'2026-01'}));
 let registry=await call('atlas_save_reforecast_registry',[A,null,randomUUID(),JSON.stringify({accounts,driverMappings:{payroll:['6100'],utilities:['6200'],occupancy:['5220']},reason:'Parity fixture',effectiveDate:'2026-01-01'})]);
 let periods=['2026-01','2026-02','2026-03'],baselineId=BUDGET;
 const compare=(actual,expected,label)=>{if(expected===null){assert.equal(actual,null,label);return;}assert.equal(typeof actual,'number',label+' numeric field missing');assert(Math.abs(actual-expected)<.000001,`${label}: SQL ${actual} vs browser ${expected}`);};
 let scenarios=0;
 const verify=async(name,drivers=[],overrides=[],registryVersionId=registry.version_id)=>{
  const payload={name,model:'conventional',periods,baselineVersionIds:[baselineId],registryVersionId,ownerId:'00000000-0000-0000-0000-000000000001',reviewerId:'00000000-0000-0000-0000-000000000002',drivers,overrides,reason:'Deterministic parity test'};
  const source=await call('atlas_read_reforecast_source',[A,periods,[baselineId],registryVersionId]);
  const result=await call('atlas_save_reforecast_scenario',[A,randomUUID(),0,randomUUID(),'save_draft',JSON.stringify(payload)]);
  const client=computeReforecast({...source,scenario:{...payload,versionId:result.revision.revision_id,driverVersion:'parity-drivers'}}),server=result.snapshot;
  const key=row=>row.period+'|'+row.accountCode;
  assert.equal(server.lines.length,client.lines.length,name+' line count');
  for(const row of client.lines){const actual=server.lines.find(item=>key(item)===key(row));assert(actual,name+' line '+key(row));for(const field of ['forecast','originalBudget','actual'])compare(actual[field],row[field],`${name} ${key(row)} ${field}`);assert.equal(actual.placement,row.placement);assert.deepEqual(actual.driverIds,row.driverIds,`${name} ${key(row)} driver IDs`);assert.deepEqual(actual.driverSources,row.driverSources,`${name} ${key(row)} driver provenance`);}
  for(const row of client.monthly){const actual=server.monthly.find(item=>item.period===row.period);assert(actual,name+' monthly '+row.period);for(const series of ['reforecast','originalBudget','actuals'])for(const [metric,value]of Object.entries(row[series]))compare(actual[series]?.[metric],value,`${name} ${row.period} ${series}.${metric}`);}
  for(const [series,metrics]of Object.entries(client.totals))for(const [metric,value]of Object.entries(metrics))compare(server.totals?.[series]?.[metric],value,`${name} totals.${series}.${metric}`);
  for(const row of client.leasing){const actual=server.leasing.find(item=>item.period===row.period);for(const field of ['units','occupiedUnits','moveIns','moveOuts','marketRent','occupancy'])compare(actual[field],row[field],`${name} leasing ${row.period} ${field}`);assert.equal(actual.sourceKind,row.sourceKind);assert.deepEqual(actual.source,row.source);}
  assert.equal(server.driverImpacts.length,client.driverImpacts.length,name+' driver impact count');for(const [i,row]of client.driverImpacts.entries()){const actual=server.driverImpacts[i];for(const field of ['id','type','operation','value','source','reason','changed','skippedClosed','unavailable','status','explanation'])assert.deepEqual(actual[field],row[field],`${name} driver ${row.id} ${field}`);}
  assert.equal(server.status,client.status,name+' blocker status');scenarios++;return {client,server,source};
 };
 const initial=await verify('Original unchanged');assert.equal(initial.server.leasing[0].occupiedUnits,null);assert.equal(initial.server.leasing[1].occupancy,0);assert.equal(initial.source.baseline.leasing[1].source.unitInventory.units,240);
 await verify('Closed-only occupancy driver',[{id:'closed',type:'occupancy',operation:'occupancy_vacancy',value:.3,accountCodes:['5220'],baseAccountCode:'5120',periods:['2026-01']}]);
 await verify('Unmapped occupancy driver',[{id:'missing',type:'occupancy',operation:'occupancy_vacancy',value:.3,accountCodes:['unknown'],baseAccountCode:'5120'}]);
 await verify('Unassigned driver',[{id:'unmapped',type:'absent',operation:'add',value:10}]);
 await verify('Duplicate scopes apply once',[{id:'duplicate',type:'payroll',operation:'add',value:10,periods:['2026-02','2026-01','2026-02'],accountCodes:['6200','6100','6100']}]);
 await verify('Driver outside reporting period',[{id:'outside',type:'payroll',operation:'add',value:10,periods:['2027-01']}]);
 for(const [operation,value,code,baseAccountCode] of [['percent_change',.13,'6100'],['amount',0,'6100'],['add',-10,'6200'],['percent_of_account',-.075,'5220','5120'],['occupancy_vacancy',.975,'5220','5120']])await verify(operation,[{id:operation,type:'test',operation,value,accountCodes:[code],baseAccountCode,periods}]);
 await verify('Ordered dependencies',[{id:'rent',type:'new_lease_growth',operation:'percent_change',value:.1,accountCodes:['5120']},{id:'vacancy',type:'occupancy',operation:'occupancy_vacancy',value:.95,accountCodes:['5220'],baseAccountCode:'5120'}]);
 await verify('Explicit override after driver',[{id:'payroll',type:'payroll',operation:'percent_change',value:.1}],[{period:'2026-02',accountCode:'6100',amount:0,reason:'Explicit zero'},{period:'2026-01',accountCode:'6100',amount:999,reason:'Closed month must stay immutable'}]);
 await verify('Null override unavailable',[],[{period:'2026-02',accountCode:'6100',amount:null,reason:'Missing data'}]);
 await verify('Negative half-cent rounding',[{id:'negative',type:'test',operation:'amount',value:-1.005,accountCodes:['5220'],periods:['2026-02']}]);
 for(const [operation,value,code,baseAccountCode] of [['amount',10.075,'6100'],['amount',-10.075,'5220'],['add',-39.925,'6200'],['percent_change',-.949625,'6100'],['percent_of_account',.010075,'6100','5120'],['occupancy_vacancy',.989925,'5220','5120']])await verify('Decimal tie '+operation+' '+value,[{id:'decimal-tie',type:'test',operation,value,accountCodes:[code],baseAccountCode,periods:['2026-02']}]);
 const placements=accounts.map(row=>row.accountCode==='5120'?{...row,placement:'below_noi'}:row);
 registry=await call('atlas_save_reforecast_registry',[A,registry.version_id,randomUUID(),JSON.stringify({accounts:placements,driverMappings:{},reason:'Owner-specific below-NOI income classification',effectiveDate:'2026-01-01'})]);
 await verify('Below-NOI income affects cash only',[],[],registry.version_id);
 const year=new Date().getUTCFullYear()+1;
 periods=[`${year}-01`,`${year}-02`,`${year}-03`];baselineId=randomUUID();
 await db.exec('reset role');
 await db.query("insert into atlas_approved_budget_versions select $1,community_id,$2,status,covered_months,payload,source_file,source_hash from atlas_approved_budget_versions where version_id=$3",[baselineId,year,BUDGET]);
 await db.exec('set role authenticated');
 const prospective=accounts.map(row=>row.accountCode==='6200'?{...row,retiredAfter:`${year}-01`}:row).concat({accountCode:'7000',category:'New reviewed category',nature:'expense',placement:'above_noi',effectiveFrom:`${year}-03`});
 registry=await call('atlas_save_reforecast_registry',[A,registry.version_id,randomUUID(),JSON.stringify({accounts:prospective,driverMappings:{utilities:['6200']},reason:'Prospective retirement and addition',effectiveDate:`${year}-01-01`})]);
 await verify('Prospective GL addition and retirement',[{id:'new-gl',type:'test',operation:'amount',value:15,accountCodes:['7000'],periods:[`${year}-03`]},{id:'retired-utility',type:'utilities',operation:'percent_change',value:.2}],[],registry.version_id);
 await db.close();console.log('PASS browser/PostgreSQL parity for '+scenarios+' scenario calculations, every monthly/GL/total metric, ordered drivers, actual protection, null/zero, rounding, statement placement, leasing, and complete driver impact/provenance metadata');
})().catch(error=>{console.error(error);process.exitCode=1;});
