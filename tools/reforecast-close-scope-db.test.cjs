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
 // Replacing an import clears its overrides but keeps its original mapping as
 // audit history. A closed old selection must stop blocking the new authority.
 const replacementId=randomUUID(),replacementLine={...lines[2],id:'Replacement!AW95',amount:200};
 await db.query("insert into atlas_reforecast_uploads(community_id,source_hash,content_hash,request_id,payload,created_by,upload_id,created_role) values($1,$2,$3,$4,$5,$6,$7,'admin')",[A,'c'.repeat(64),'d'.repeat(64),randomUUID(),{lines:[replacementLine]},'00000000-0000-0000-0000-000000000001',replacementId]);
 const account={accountCode:'5144',nature:'income',category:'income',placement:'revenue'},accountMapping={...account,sourceAccountCode:'5144',signMultiplier:1};
 const priorMapping={...config.importMapping,accountMappings:[accountMapping]},history=[{uploadId,mapping:priorMapping,issues:[]}];
 const historicalBytes=JSON.stringify(history),replacement={uploadId:replacementId,importMapping:{...priorMapping,selectedLineIds:[replacementLine.id],periods:['2026-09']},importIssues:[],importHistory:history,overrides:[{uploadId:replacementId,sourceLineId:replacementLine.id,period:'2026-09',accountCode:'5144',amount:200}]};
 const reviewedSource={...inputSource,registry:{version:'registry',accounts:[account]}};
 const validate=async draft=>(await db.query('select atlas_private.reforecast_import_issues($1,$2) issues',[reviewedSource,draft])).rows[0].issues;
 assert.deepEqual((await validate(replacement)).filter(i=>i.code==='governed_forecast_overlap').map(i=>i.period),['2026-07','2026-08'],'reproduces the original retained-history blocker before the additive fix');
 await db.exec(fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/centralization/reforecast-active-import-close-scope.sql','file://'+__filename),'utf8'));
 assert.deepEqual(await validate(replacement),[],'replacement clears inactive historical authority without deleting history');
 assert.equal(JSON.stringify(replacement.importHistory),historicalBytes,'the retained review history is unchanged');
 assert.deepEqual((await db.query('select payload from atlas_reforecast_uploads where upload_id=$1',[uploadId])).rows[0].payload,{lines},'the original immutable upload remains unchanged');
 const overlap=async draft=>(await validate(draft)).filter(i=>i.code==='governed_forecast_overlap').map(i=>i.period);
 assert.deepEqual(await overlap({...config,importMapping:priorMapping}),['2026-07','2026-08'],'current imports remain blocked without overrides');
 assert.deepEqual(await overlap({...replacement,overrides:[...replacement.overrides,{uploadId,sourceLineId:lines[2].id,period:'2026-09',accountCode:'5144',amount:100}]}),['2026-07','2026-08'],'reactivating a historical upload restores its reviewed overlap check exactly once');
 assert.deepEqual(await validate({importHistory:history,overrides:[]}),[],'history without a current upload or active reference is evidence only');
 assert.deepEqual(await overlap({importHistory:history,overrides:[{uploadId,sourceLineId:lines[2].id,period:'2026-09',accountCode:'5144',amount:100}]}),['2026-07','2026-08'],'a referenced historical upload is checked even without a current upload');
 const corrected={...replacement,uploadId,importMapping:{...priorMapping,selectedLineIds:[lines[2].id],periods:['2026-09']},overrides:[{sourceLineId:lines[2].id,period:'2026-09',accountCode:'5144',amount:100}]};
 assert.deepEqual(await validate(corrected),[],'the current corrected mapping supersedes older history for the same upload');
 assert((await validate({...replacement,overrides:[{uploadId:randomUUID(),sourceLineId:'unknown',period:'2026-09',accountCode:'5144',amount:100}]})).some(i=>i.code==='import_upload_unreviewed'),'orphan workbook authority remains blocked');
 assert.deepEqual(await ledger(),before,'actual source rows remain byte-for-byte unchanged');
 await db.query("update atlas_financial_close_versions set source_hash='revised-july-evidence' where community_id=$1 and period_key='2026-07'",[A]);await signIn(1);
 assert.notEqual((await read()).sourceVersion,source.sourceVersion,'an out-of-selection close correction changes the forecast source version');
 console.log('PASS eligible August cutoff, complete close ancestry for Sep-Dec, active/current overlap rejection, inactive history preservation, referenced-history reactivation, unchanged actual rows and two scoped readers');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
