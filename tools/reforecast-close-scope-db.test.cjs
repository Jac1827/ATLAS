const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
(async()=>{const {db,A,BUDGET,signIn}=await fixture();
try{
 await db.exec('reset role');
 await db.exec(`create function atlas_private.reforecast_close_eligible(cid uuid,p text,h text) returns boolean language sql stable as $$select p<>'2026-09'$$`);
 for(const period of ['2026-07','2026-08','2026-09']){
  const version=randomUUID();await db.query('insert into atlas_financial_close_versions values($1,$2,$3,$4,now(),$5)',[version,A,period,'close-'+period,{totalIncome:100,operatingExpenses:20,netOperatingIncome:80}]);
  await db.query("insert into atlas_financial_close_heads values($1,$2,'accrual',$3)",[A,period,version]);
  await db.query('insert into atlas_financial_close_rows values($1,$2,$3,$4)',[version,'5120',123.45,{sheet:'Governed close',address:'C11'}]);
 }
 const ledger=async()=>(await db.query("select jsonb_agg(to_jsonb(r) order by version_id,gl_code) rows from atlas_financial_close_rows r")).rows[0].rows;
 const before=await ledger();
 await db.exec(fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/centralization/reforecast-governed-close-scope.sql','file://'+__filename),'utf8'));
 const read=async()=> (await db.query('select atlas_read_reforecast_source($1,$2,$3,null) source',[A,['2026-09','2026-10','2026-11','2026-12'],[BUDGET]])).rows[0].source;
 await signIn(1);const source=await read();assert.equal(source.actuals.cutoffPeriod,'2026-08');assert.deepEqual(source.actuals.closeVersions.map(c=>c.period),['2026-01','2026-07','2026-08']);assert.deepEqual(source.actuals.lines,[]);
 await signIn(2);assert.deepEqual(await read(),source,'authorized readers receive exact close versions and values');
 await db.exec('reset role');
 const uploadId=randomUUID(),selected=['Input!AU95','Input!AV95','Input!AW95'];
 const lines=['2026-07','2026-08','2026-09'].map((period,i)=>({id:selected[i],period,scenario:'Plan',sourceKind:'workbook_forecast_evidence',accountCode:'5144',sheet:'Input',department:null,amount:100}));
 // Isolated test data only; production source records are never fabricated.
 await db.query("insert into atlas_reforecast_uploads(community_id,source_hash,content_hash,request_id,payload,created_by,upload_id,created_role) values($1,$2,$3,$4,$5,$6,$7,'admin')",[A,'a'.repeat(64),'b'.repeat(64),randomUUID(),{lines},'00000000-0000-0000-0000-000000000001',uploadId]);
 const config={uploadId,importMapping:{confirmed:true,version:'registry',propertyAssignment:{communityId:A},sourceScenario:'Plan',currency:'USD',reason:'Selected source values',selectedLineIds:selected,periods:['2026-07','2026-08','2026-09'],accountMappings:[]}};
 const inputSource={...source,periods:['2026-07','2026-08','2026-09'],registry:{version:'registry',accounts:[]}};
 const issues=(await db.query('select atlas_private.reforecast_import_issues($1,$2) issues',[inputSource,config])).rows[0].issues;
 assert.deepEqual(issues.filter(i=>i.code==='governed_forecast_overlap').map(i=>i.period),['2026-07','2026-08']);
 assert.deepEqual(await ledger(),before,'actual source rows remain byte-for-byte unchanged');
 await db.query("update atlas_financial_close_versions set source_hash='revised-july-evidence' where community_id=$1 and period_key='2026-07'",[A]);await signIn(1);
 assert.notEqual((await read()).sourceVersion,source.sourceVersion,'an out-of-selection close correction changes the forecast source version');
 console.log('PASS eligible August cutoff, complete close ancestry for Sep-Dec, overlap rejection, unchanged actual rows and two scoped readers');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
