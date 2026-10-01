const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{fixture}=require('./reforecast-fixture.cjs');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
(async()=>{
 const {calculateLeasingSchedule,prepareBudgetLeasingDrivers}=await import('../docs/portfolio-operations-dashboard/features/budget-leasing-drivers.mjs');
 const {db,A,signIn}=await fixture();try{
  await db.exec('reset role');await db.exec("alter table atlas_approved_budget_versions add column content_hash text,add column fiscal_year integer,add column fiscal_start_month integer,add column scenario_version text;create function atlas_private.resolve_workbook_audit(a jsonb,h text) returns jsonb language sql as $$select a$$;");await db.exec(read('20260924121641_planning_cell_workbook_integrity_governance.sql'));
  for(const file of ['reforecast-builder.sql','reforecast-report-receipts.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization',file),'utf8'));
  await db.exec(read('20260929154018_budget_export_integrity_history.sql'));await db.exec(read('20260929154033_budget_leasing_driver_authority.sql'));await signIn(1);await db.exec('reset role');
  const scenarios=[
   {name:'Lease-up',monthly:[{period:'2026-08',units:100,beginningOccupiedUnits:50,moveIns:10,moveOuts:0,marketRent:1000,concessions:0,badDebtPercent:0},{period:'2026-09',units:100,moveIns:15,moveOuts:0,marketRent:1000,concessions:100,badDebtPercent:.01}]},
   {name:'Half-cent decimal products',monthly:[{period:'2026-08',units:23,beginningOccupiedUnits:11,moveIns:1,moveOuts:0,marketRent:.35,concessionPerMoveIn:1.005,badDebtPercent:.035,rentGrowth:.025,lossToLeasePercent:.075},{period:'2026-09',units:23,beginningOccupiedUnits:12,moveIns:0,moveOuts:1,marketRent:1599.995,concessions:0,badDebtPercent:0,rentGrowth:.01,lossToLeasePercent:.01}]},
   {name:'Missing and reviewed zero',monthly:[{period:'2026-08',units:0,beginningOccupiedUnits:0,moveIns:0,moveOuts:0,leasedUnits:0,marketRent:1000,concessions:0,badDebtPercent:0},{period:'2026-09',units:100,beginningOccupiedUnits:null,endingOccupiedUnits:null,marketRent:null,rentGrowth:null,concessions:null,badDebtPercent:null}]},
   {name:'Count and occupancy conflict',monthly:[{period:'2026-08',units:100,beginningOccupiedUnits:50,moveIns:10,moveOuts:0,endingOccupiedUnits:90,budgetedOccupancy:.9,marketRent:1000},{period:'2026-09',units:100,beginningOccupiedUnits:80,moveIns:0,moveOuts:0,marketRent:1000}]}
  ];
  const fields=['units','beginningOccupiedUnits','endingOccupiedUnits','averageOccupiedUnits','physicalOccupancy','leasedOccupancy','budgetedOccupancy','grossPotentialRent','rentalIncome','vacancy','concessions','badDebt','netRentalIncome'];
  const compare=(actual,expected,label)=>{if(typeof actual==='number'&&typeof expected==='number')assert(Math.abs(actual-expected)<1e-8,label+' '+actual+' vs '+expected);else assert.equal(actual??null,expected??null,label);};
  for(const config of scenarios){const periods=config.monthly.map(row=>row.period),source={communityId:A,periods,baseline:{leasing:[],lines:[]},actuals:{},lockedPeriods:[]},scenario={leasingSchedule:{monthly:config.monthly},accountDrivers:[{id:'rent',accountCode:'5120',type:'OCCUPANCY-DRIVEN',metric:'rentalIncome'},{id:'turn',accountCode:'6500',type:'VARIABLE',metric:'moveOuts',rate:115.35,baseAmount:10},{id:'fixed',accountCode:'6300',type:'FIXED',amount:1.005},{id:'fee',accountCode:'6501',type:'REVENUE-DRIVEN',baseAccountCode:'5120',rate:.05}]},js=prepareBudgetLeasingDrivers({...source,scenario}),sql=(await db.query('select atlas_private.prepare_budget_account_drivers($1,$2) result',[source,scenario])).rows[0].result;
   for(let i=0;i<periods.length;i++)for(const key of fields)compare(sql.leasingSchedule.monthly[i][key],js.leasingSchedule.monthly[i][key],config.name+' '+periods[i]+' '+key);
   for(const key of Object.keys(js.leasingSchedule.totals))compare(sql.leasingSchedule.totals[key],js.leasingSchedule.totals[key],config.name+' total '+key);
   assert.deepEqual(sql.amounts,JSON.parse(JSON.stringify(js.amounts)),config.name+' compiled monthly amount-driver parity');
   assert.deepEqual([...new Set(sql.issues.map(row=>row.code))].sort(),[...new Set(js.issues.map(row=>row.code))].sort(),config.name+' issue parity');
  }
  console.log('PASS independent JS/PostgreSQL parity: lease-up, non-calendar periods, half-cent products, fixed/variable/revenue-linked accounts, missing versus zero, weighted totals, and count/occupancy conflicts.');
 }finally{await db.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
