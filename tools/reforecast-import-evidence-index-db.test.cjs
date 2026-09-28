const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..'),migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
(async()=>{
 const {db,A,B,BUDGET,CLOSE,signIn}=await fixture();await db.exec('reset role');
 await db.exec(migration('20260924121641_planning_cell_workbook_integrity_governance.sql'));
 await db.exec(migration('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]);
 for(const name of ['20260924165534_reforecast_builder_governance.sql','20260924165542_reforecast_report_receipts.sql','20260924232842_reforecast_governed_close_scope.sql','20260924232853_reforecast_str_overlay_isolation.sql','20260924235553_reforecast_active_import_close_scope.sql','20260925012933_reforecast_atomic_create_from_import.sql','20260925020220_reforecast_import_source_relationships.sql','20260925020222_reforecast_saved_json_str_programme.sql','20260925020226_reforecast_import_source_occurrence_index.sql','20260925071533_reforecast_request_identity_consistency.sql','20260925162050_budget_governed_draft_investor_lifecycle.sql'])await db.exec(migration(name));
 await db.exec("create function atlas_private.budget_calendar(cid uuid) returns jsonb language sql as $$select '{\"verified\":true,\"basis\":\"calendar\",\"startMonth\":1}'::jsonb$$");

 await db.exec(migration('20260928141143_reviewed_noncash_forecast_presentation.sql'));
 const original=(await db.query("select pg_get_functiondef('atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(original.replace('atlas_private.reforecast_import_issues_before_source_relationships(', 'atlas_private.reforecast_import_issues_unindexed_test('));
 const metadata=async()=>(await db.query("select proowner,prosecdef,provolatile,proconfig,proacl from pg_proc where oid='atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure")).rows[0];
 const before=await metadata();await db.exec(migration('20260928142628_indexed_import_validation_evidence.sql'));assert.deepEqual(await metadata(),before,'no ownership, stability, search_path or grant change');
 const registry=randomUUID(),line={id:'Input!B9',sheet:'Input',address:'B9',row:9,column:2,accountCode:'6100',period:'2026-09',scenario:'Plan',currency:'USD',amount:12,formula:null,cellType:'n',periodBasis:'header'};
 const account={accountCode:'6100',nature:'expense',category:'Operations',placement:'above_noi',effectiveFrom:'2026-01'};
 const source={communityId:A,periods:['2026-09'],actuals:{cutoffPeriod:null},registry:{version:registry,accounts:[account]}};
 const mapping={confirmed:true,version:registry,propertyAssignment:{communityId:A},sourceScenario:'Plan',currency:'USD',periods:['2026-09'],reason:'Explicit evidence review',selectedLineIds:[line.id],accountMappings:[{...account,sourceAccountCode:'6100',signMultiplier:1}]};
 async function compare({issues=[],reconciliation=[],lines=[line],selectedMapping=mapping,selectedSource=source,expectedErrors=null,label=''}){
  const id=randomUUID();await db.query("insert into atlas_reforecast_uploads(upload_id,community_id,request_id,source_hash,content_hash,payload,created_by,created_role) values($1,$2,$3,'test-source','test-content',$4,'00000000-0000-0000-0000-000000000001','admin')",[id,A,randomUUID(),{lines,issues,reconciliation}]);
  const config={uploadId:id,importMapping:selectedMapping,overrides:[],importIssues:[]};
  const check=async functionName=>{const start=performance.now(),result=(await db.query(`select atlas_private.${functionName}($1,$2) result`,[selectedSource,config])).rows[0].result;return {result,durationMs:Math.round(performance.now()-start)}};
  const old=await check('reforecast_import_issues_unindexed_test'),next=await check('reforecast_import_issues_before_source_relationships');assert.deepEqual(next.result,old.result,label);
  const errors=next.result.filter(i=>i.code==='import_source_unreconciled');if(expectedErrors!==null)assert.equal(errors.length,expectedErrors,label);return {oldMs:old.durationMs,indexedMs:next.durationMs,diagnostics:next.result.length};
 }
 const errorCodes=['excel_error','broken_formula_reference','external_formula_reference','missing_formula_sheet','broken_named_formula_reference'];
 for(const code of errorCodes)await compare({label:code,issues:[{sheet:'Input',address:'B9',code}],expectedErrors:1});
 await compare({label:'warnings are nonblocking',issues:[{sheet:'Input',address:'B9',code:'supporting_formula'},{sheet:'Other',address:'B9',code:'excel_error'},{sheet:'Input',address:'B10',code:'excel_error'}],expectedErrors:0});
 await compare({label:'duplicate errors retain single rejection',issues:[{sheet:'Input',address:'B9',code:'excel_error'},{sheet:'Input',address:'B9',code:'broken_formula_reference'}],expectedErrors:1});
 for(const periods of [['2026-09'],{'2026-09':false},'2026-09',null,7,false,{},[],['2026-10']])await compare({label:'period JSON '+JSON.stringify(periods),reconciliation:[{sheet:'Input',row:9,status:'mismatch',periods}],expectedErrors:Array.isArray(periods)&&periods.includes('2026-09')||periods==='2026-09'||periods&&typeof periods==='object'&&Object.hasOwn(periods,'2026-09')?1:0});
 await compare({label:'duplicate rows distinct periods',reconciliation:[{sheet:'Input',row:9,status:'mismatch',periods:['2026-10']},{sheet:'Input',row:9,status:'mismatch',periods:['2026-09']},{sheet:'Input',row:9,status:'balanced',periods:['2026-09']}],expectedErrors:1});
 await compare({label:'missing period or nonmatching coordinates',reconciliation:[{sheet:'Input',row:9,status:'mismatch'},{sheet:'Other',row:9,status:'mismatch',periods:['2026-09']},{sheet:'Input',row:10,status:'mismatch',periods:['2026-09']}],expectedErrors:0});
 await compare({label:'null equality never matches',lines:[{...line,sheet:null,address:null,row:null}],issues:[{sheet:null,address:null,code:'excel_error'}],reconciliation:[{sheet:null,row:null,status:'mismatch',periods:['2026-09']}],expectedErrors:0});
 await compare({label:'structured coordinates avoid delimiter collision',lines:[{...line,sheet:'A|B',address:'C'}],issues:[{sheet:'A',address:'B|C',code:'excel_error'}],expectedErrors:0});
 const selected=Array.from({length:455},(_,i)=>({...line,id:'Input!B'+(i+9),address:'B'+(i+9),row:i+9,accountCode:String(6100+i)}));
 const accounts=selected.map(l=>({...account,accountCode:l.accountCode}));const volumeMapping={...mapping,selectedLineIds:selected.map(l=>l.id),accountMappings:accounts.map(a=>({...a,sourceAccountCode:a.accountCode,signMultiplier:1}))};
 const volumeLines=[...selected,...Array.from({length:10249},(_,i)=>({...line,id:'Support!B'+(i+9),sheet:'Support',address:'B'+(i+9),row:i+9,scenario:'Prior',identifiers:Array.from({length:4},(_,j)=>({name:'source '+j,value:'Retained source evidence',address:String(j)}))}))];
 const volumeIssues=Array.from({length:2406},(_,i)=>({sheet:'Other',address:'B'+(i+9),code:errorCodes[i%5],message:'Retained source formula evidence'}));
 const volumeReconciliation=Array.from({length:892},(_,i)=>({sheet:'Other',row:i+9,status:'mismatch',periods:['2026-09','2026-10','2026-11','2026-12']}));
 const performanceProof=await compare({label:'10704-line volume with 455 selected, 2406 errors and 892 controls',lines:volumeLines,issues:volumeIssues,reconciliation:volumeReconciliation,selectedMapping:volumeMapping,selectedSource:{...source,registry:{version:registry,accounts}},expectedErrors:0});
 const optimized=(await db.query("select prosrc from pg_proc where oid='atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure")).rows[0].prosrc;
 assert.equal((optimized.match(/jsonb_array_elements\(coalesce\(upload->'issues'/g)||[]).length,1);assert.equal((optimized.match(/jsonb_array_elements\(coalesce\(upload->'reconciliation'/g)||[]).length,1);
 await assert.rejects(()=>db.exec(migration('20260928142628_indexed_import_validation_evidence.sql')),/differs; review installed prerequisite/,'unexpected prerequisite fails closed');
 await db.exec('rollback');await db.close();console.log('PASS indexed import evidence equivalence, corrupt-source rejection, null/period semantics, preserved permissions and volume '+JSON.stringify(performanceProof));
})().catch(error=>{console.error(error);process.exit(1)});
