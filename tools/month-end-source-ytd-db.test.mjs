import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseComparisonSheet,reconcileComparison,finalizeFinancialPackageEvidence} from '../docs/portfolio-operations-dashboard/features/financial-package.mjs';
import {parseFinancialWorkbook} from '../docs/portfolio-operations-dashboard/features/financial-workbook-parser.mjs';
import {compactWorkbookAudit} from '../docs/portfolio-operations-dashboard/features/workbook-audit-store.mjs';
import {auditWorkbook,workbookEvidenceHash} from '../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs';
import {suggestMonthlyMappings,confirmMonthlyGovernance} from '../docs/portfolio-operations-dashboard/features/financial-workbook-governance.mjs';
const require=createRequire(import.meta.url),{fixture}=require('./financial-intake-fixture.cjs'),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const {db,cid,signIn}=await fixture(),actor='00000000-0000-0000-0000-000000000001';
const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const nextMigration='20260929145201_month_end_accounting_source_fiscal_ytd.sql';
const call=async(name,args)=>(await db.query(`select to_jsonb(${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;
const values=(a,b,y=a,yb=b)=>[a,b,a-b,b?(a-b)/b:null,y,yb,y-yb,yb?(y-yb)/yb:null,b*12];
async function build({expense=800,ytdExpense=2500,ytdIncome=60000,extra=null,start=1,pdf=true}={}){
 const matrix=[['Budget Comparison - Income Statement'],['Doro'],['Aug 2026'],['Accrual Basis'],[],[null,null,'Aug 2026',null,null,null,`YTD ( ${start===8?'Aug':'Jan'} 2026 - Aug 2026 )`],['Account','Account Name','Actual','Budget','$ Variance','% Variance','Actual','Budget','$ Variance','% Variance','Annual Budget'],['Income'],['5120','Gross Potential Rent',...values(10000,10000,ytdIncome,99999)],['','Net Rental Income',...values(10000,10000,ytdIncome,99999)],['','Total Income',...values(10000,10000,ytdIncome,99999)],['Expenses'],['6100','Maintenance',...values(expense,9999,ytdExpense,99999)]];
 if(extra!==null)matrix.push(['6110','Additional reviewed expense',...values(extra,9999,extra,99999)]);
 const totalRow=matrix.length+1,totalExpense=expense+(extra??0),totalYtd=ytdExpense+(extra??0);
 matrix.push(['','Total Expenses',...values(totalExpense,19998,totalYtd,199998)],['','Net Operating Income',...values(10000-totalExpense,-9998,ytdIncome-totalYtd,-99999)]);
 const cells={C9:{v:10000},C10:{v:10000,f:'C9'},C11:{v:10000,f:'C9'},C13:{v:expense},['C'+totalRow]:{v:totalExpense,f:`SUM(C13:C${totalRow-1})`},['C'+(totalRow+1)]:{v:10000-totalExpense,f:`C11-C${totalRow}`}};
 if(extra!==null)cells.C14={v:extra};
 const sourceHash=createHash('sha256').update(JSON.stringify(matrix)).digest('hex');
 let c=reconcileComparison([parseComparisonSheet(matrix,'BCR',{cells,sourceHash})]);Object.assign(c,{sourceFile:'Synthetic August.pdf',sourceHash});
 // Exercise the exact retained PDF YTD mapping, without parsing a PDF fixture.
 if(pdf)for(const row of c.rows){
  const inventory=c.intakeEvidence.rowInventory.find(i=>i.id===row.source.rowId),raw=inventory.rawCells.find(v=>v.address===row.source.cells.ytdActual);
  const mapping={sheet:'BCR',column:'text-column-5',index:4,type:'ytd_supporting',header:'ytdActual',period:null,method:'printed_nine_column_budget_comparison'};
  row.columnMapping.ytdActual=mapping;inventory.columnMapping.ytdActual=structuredClone(mapping);
  row.source.cells.ytdActual=`text-column-5-line-${row.source.row}`;raw.address=row.source.cells.ytdActual;raw.column='text-column-5';
 }
 const mappings=suggestMonthlyMappings(c).map(m=>({...m,category:m.nature==='expense'?'Maintenance':'Rent'}));
 const governance=confirmMonthlyGovernance(c,{reportingBasis:start===8?'fiscal':'calendar',fiscalStartMonth:start,currency:'USD',reason:'Synthetic exact Accounting package mapping',mappings,actor});
 c=await finalizeFinancialPackageEvidence(c,{communityId:cid,period:'2026-08',actor,exclusionsReviewed:true,governance});
 assert.equal(c.safeToImport,true,JSON.stringify(c.safetyIssues));return c;
}
async function workbookFixture(){
 const matrix=[['Budget Comparison - Income Statement'],['Doro'],['Aug 2026'],['Accrual Basis'],[],[null,null,'Aug 2026',null,null,null,'YTD ( Jan 2026 - Aug 2026 )'],['Account','Account Name','Actual','Budget','$ Variance','% Variance','Actual','Budget','$ Variance','% Variance','Annual Budget'],['Income'],['5120','Gross Potential Rent',...values(10000,10000,60000,99999)],['','Net Rental Income',...values(10000,10000,60000,99999)],['','Total Income',...values(10000,10000,60000,99999)],['Expenses'],['6100','Maintenance',...values(-800,-1000,-2500,-8000)],['','Total Expenses',...values(800,1000,2500,8000)],['','Net Operating Income',...values(9200,9000,57500,91999)]];
 const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(matrix);
 for(const [cell,formula] of Object.entries({C10:'C9',C11:'C9',C14:'-C13',C15:'C11-C14',G10:'G9',G11:'G9',G13:'-M13',G14:'-G13',G15:'G11-G14'}))sheet[cell].f=formula;
 sheet.M13={t:'n',v:2500};sheet['!ref']='A1:M15';
 XLSX.utils.book_append_sheet(wb,sheet,'BCR');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),sourceHash=createHash('sha256').update(bytes).digest('hex');
 let c=await parseFinancialWorkbook(bytes,{XLSX,sourceHash,sourceFile:'Signed expense BCR.xlsx'});const audit=c.intakeEvidence.workbookAudit;
 assert.equal(audit.summary.blocking,0,JSON.stringify(audit.findings));
 for(const row of c.rows){assert(audit.authorityScope.selectedCells.includes('BCR!'+row.source.cells.ytdActual));assert(audit.authorityScope.requiredNodes.includes('BCR!'+row.source.cells.ytdActual));}
 assert.equal(c.intakeEvidence.selectedActualColumns.length,1);assert.equal(c.intakeEvidence.selectedActualColumns[0].period,'2026-08','YTD audit does not invent monthly actual periods');
 await signIn(1);const stored=await call('atlas_save_workbook_audit',[cid,sourceHash,audit,randomUUID()]);c.intakeEvidence.workbookAudit=compactWorkbookAudit(audit,stored);
 const governance=confirmMonthlyGovernance(c,{reportingBasis:'calendar',fiscalStartMonth:1,currency:'USD',reason:'Exact retained workbook cells, headers, signs and dependencies reviewed',mappings:suggestMonthlyMappings(c).map(m=>({...m,category:m.nature==='expense'?'Maintenance':'Rent'})),findingsReviewed:true,actor});
 c=await finalizeFinancialPackageEvidence(c,{communityId:cid,period:'2026-08',actor,exclusionsReviewed:true,governance});
 assert.equal(c.safeToImport,true,JSON.stringify(c.safetyIssues));return {c,audit,stored,wb:XLSX.read(bytes,{type:'buffer',cellFormula:true,cellNF:true,cellStyles:true,raw:true,sheetStubs:true,bookFiles:true})};
}
async function finalize(c){return finalizeFinancialPackageEvidence(c,{communityId:cid,period:'2026-08',actor,exclusionsReviewed:true,governance:c.intakeEvidence.governance});}
async function save(c){
 let stage;for(const state of ['uploaded','classified','community_period_confirmed','fully_mapped','reconciled'])stage=await call('atlas_record_financial_intake',[stage?.workflow.workflow_id||null,randomUUID(),stage?.receipt.receipt_id||null,state,['uploaded','classified'].includes(state)?null:cid,{sourceHash:c.sourceHash,sourceFile:c.sourceFile,certificate:c}]);
 return (await call('atlas_save_financial_review_governed',[stage.workflow.workflow_id,stage.receipt.receipt_id,randomUUID(),c])).review;
}
async function attest(r){return call('atlas_confirm_month_end_close',[r.review_id,'2026-09-14T19:00:00Z','2026-09-14T18:00:00Z','Fixture verified actual Accounting close']);}
async function evidence(c){await signIn(1);const r=await save(c);await attest(r);return {r,e:await call('atlas_read_month_end_review',[r.review_id])};}
async function baseline(config={}){await db.exec('reset role');await db.query('update ytd_test_baseline set config=$1',[config]);await signIn(1);}
try{
 await db.exec('reset role');
 for(const file of ['20260924121641_planning_cell_workbook_integrity_governance.sql','20260924121647_immutable_workbook_audits_and_monthly_governance.sql'])await db.exec(migration(file));
 await db.exec(`create table ytd_test_baseline(config jsonb);insert into ytd_test_baseline values('{}');
 create function atlas_private.budget_calendar(uuid) returns jsonb language sql as $$select jsonb_build_object('basis',case when config->>'start'='8' then 'fiscal' else 'calendar' end,'startMonth',coalesce((config->>'start')::int,1),'classification','Fixture','verified',true) from public.ytd_test_baseline$$;
 create function public.atlas_reforecast_effective_baseline(uuid[],text[]) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_agg(jsonb_build_object('communityId',$1[1],'period',p,'status',case when config->>'unavailable'=p then 'unavailable' else 'available' end,'verified',true,'approved',true,'locked',true,'sourceType','approved_reforecast','versionId',coalesce(config->>'version','baseline-1'),'publicationId','publication-1','contentHash',coalesce(config->>'version','baseline-1'),
 'lines',jsonb_build_array(jsonb_build_object('accountCode','5120','period',p,'amount',10000,'nature','income','placement','above_noi','category','Rent','mappingValid',true),jsonb_build_object('accountCode','6100','period',p,'amount',case when config->>'blank'=p or config->>'unknown'=p then null else coalesce((config->>'expense')::numeric,1000) end,'nature','expense','placement','above_noi','category','Maintenance','mappingValid',true,'legitimateBlank',config->>'blank'=p,'disposition',case when config->>'blank'=p then 'workbook_blank' else 'included' end))
 ||case when config->>'baselineOnly'='true' then jsonb_build_array(jsonb_build_object('accountCode','6120','period',p,'amount',100,'nature','expense','placement','above_noi','category','Maintenance','mappingValid',true)) else '[]'::jsonb end)) from unnest($2)p cross join public.ytd_test_baseline where p is distinct from config->>'omit'$$;`);
 // This small fixture starts before the existing legitimate-blank migrations.
 // Apply their exact metric rewrites (no substitute calculation or mock metric).
 for(const [file,varName] of [['20260925162050_budget_governed_draft_investor_lifecycle.sql','definition'],['20260928210158_verified_workbook_blank_forecast_semantics.sql','d']]){
  const sql=migration(file),start=sql.indexOf(`${varName}:=pg_get_functiondef('atlas_private.reforecast_metric(jsonb,text)'::regprocedure);`);assert(start>=0);
  const block=sql.slice(start,sql.indexOf(`execute ${varName};`,start)),match=block.match(/\$a\$([\s\S]*?)\$a\$,\s*\$b\$([\s\S]*?)\$b\$/);assert(match);
  const def=(await db.query("select pg_get_functiondef('atlas_private.reforecast_metric(jsonb,text)'::regprocedure) body")).rows[0].body;
  assert.equal(def.split(match[1]).length,2,'Exact existing metric dependency anchor');await db.exec(def.replace(match[1],match[2]));
 }
 await db.exec(migration('20260925161938_governed_month_end_operational_review.sql'));
 await db.query('update atlas_communities set first_expected_financial_period=$1 where community_id=$2',['2026-03',cid]);
 const historyBefore=(await db.query('select to_jsonb(c) value from atlas_communities c where community_id=$1',[cid])).rows[0].value;
 await signIn(1);const c=await build(),prior=await save(c);await attest(prior);
 assert((await call('atlas_read_month_end_review',[prior.review_id])).blockers.some(x=>x.includes('Prior fiscal YTD')),'Old implementation incorrectly requires missing early monthly closes');
 const immutableBefore=(await db.query('select certificate from atlas_financial_package_reviews where review_id=$1',[prior.review_id])).rows[0].certificate;
 await db.exec('reset role');await db.exec(migration(nextMigration));await signIn(1);
 let e=await call('atlas_read_month_end_review',[prior.review_id]);
 assert.deepEqual(e.blockers,[]);assert.equal(e.actualBasis,'accounting_source_fiscal_ytd');assert.equal(e.rows.find(r=>r.glCode==='6100').actual,2500);assert.equal(e.rows.find(r=>r.glCode==='6100').budget,8000);
 assert.equal(e.expenseActual,2500);assert.equal(e.expenseBudget,8000);assert.equal(e.sourceYtd.ready,true);assert(e.sourceYtd.checks.every(x=>x.passed));assert.equal(e.expenseActualSource.ytdStart,'2026-01');assert.deepEqual(e.expenseBudgetSource.periods,e.periods);assert.equal(e.expenseActualSource.sourceHash,c.sourceHash);
 assert.equal((await db.query('select count(*)::int n from atlas_financial_close_versions')).rows[0].n,0,'No monthly closes synthesized');
 assert.deepEqual((await db.query('select certificate from atlas_financial_package_reviews where review_id=$1',[prior.review_id])).rows[0].certificate,immutableBefore);
 const pdf=await evidence(await build({pdf:true}));assert.deepEqual(pdf.e.blockers,[]);assert.equal(pdf.e.expenseActual,2500);
 await baseline({baselineOnly:true});e=await call('atlas_read_month_end_review',[prior.review_id]);assert.equal(e.rows.find(r=>r.glCode==='6120').actual,null);assert.equal(e.expenseActual,2500);assert.equal(e.expenseBudget,8800,'Full same-period approved baseline is compared even when GL absent from source');
 await baseline({blank:'2026-01'});e=await call('atlas_read_month_end_review',[prior.review_id]);assert.deepEqual(e.blockers,[]);assert.equal(e.rows.find(r=>r.glCode==='6100').budget,null);assert.equal(e.baselines[0].lines.find(r=>r.accountCode==='6100').amount,null);assert.equal(e.expenseBudget,7000);assert.equal(e.baselineCoverage.intentionalBlankCellCount,1);assert.equal(e.baselineCoverage.complete,true);
 for(const config of [{omit:'2026-01'},{unknown:'2026-01'},{unavailable:'2026-01'}]){await baseline(config);e=await call('atlas_read_month_end_review',[prior.review_id]);assert(e.blockers.length);assert.equal(e.expenseBudget,null);assert.equal(e.baselineCoverage.complete,false);}
 await baseline();
 const sourceOnly=await evidence(await build({extra:600}));const extra=sourceOnly.e.rows.find(r=>r.glCode==='6110');assert.deepEqual(sourceOnly.e.blockers,[]);assert.equal(extra.actual,600);assert.equal(extra.budget,null);assert.equal(extra.category,'Maintenance');assert.equal(extra.unbudgetedExpense,true);assert.equal(extra.concernFlag,true);
 const unmapped=await build({extra:601});delete unmapped.intakeEvidence.governance.mappings.find(m=>m.glCode==='6110').category;
 const unmappedResult=await evidence(await finalize(unmapped));assert(unmappedResult.e.blockers.some(x=>x.includes('category required for GL 6110')));assert.equal(unmappedResult.e.rows.find(r=>r.glCode==='6110').actual,null);
 for(const [amount,expected] of [[10800,false],[10800.01,true]]){const v=await evidence(await build({ytdExpense:amount}));assert.equal(v.e.reforecastRecommended,expected,'Strict 35% summary threshold');}
 const zero=await evidence(await build({expense:0,ytdExpense:0}));assert.deepEqual(zero.e.blockers,[]);assert.equal(zero.e.expenseActual,0);assert.equal(zero.e.rows.find(r=>r.glCode==='6100').actual,0);
 // Tamper only cumulative evidence: unchanged monthly evidence still saves, but
 // the new source-YTD gate must prevent review decisions and close publication.
 for(const mode of ['missing','changed','raw','control','wrong_column','duplicate_raw','formula_error']){
  let bad=await build();const row=bad.rows.find(r=>r.glCode==='6100'),inv=bad.intakeEvidence.rowInventory.find(i=>i.id===row.source.rowId),raw=inv.rawCells.find(v=>v.address===row.source.cells.ytdActual);
  if(mode==='missing')row.values.ytdActual=null;
  if(mode==='changed')row.values.ytdActual++;
  if(mode==='raw')raw.value++;
  if(mode==='control')bad.rows.find(r=>r.accountName==='Total Expenses').values.ytdActual++;
  if(mode==='wrong_column'){row.columnMapping.ytdActual.type='monthly_actual';inv.columnMapping.ytdActual.type='monthly_actual';}
  if(mode==='duplicate_raw')inv.rawCells.push(structuredClone(raw));
  if(mode==='formula_error')Object.assign(raw,{formula:'BROKEN()',hasCachedValue:false,type:'e'});
  bad=await finalize(bad);const x=await evidence(bad);assert.equal(x.e.sourceYtd.ready,false,mode);assert.equal(x.e.expenseActual,null,mode);
  await assert.rejects(()=>call('atlas_save_month_end_decision',[x.r.review_id,x.e.fingerprint,{}, {},randomUUID()]),/unreconciled|incomplete|blocked|required/i);
 }
 // Run the actual production XLSX governance wrapper, retained audit resolver,
 // scope table and dependency validator rather than a renamed worksheet/PDF.
 const wf=await workbookFixture(),wx=await evidence(wf.c);
 assert.deepEqual(wx.e.blockers,[]);assert.equal(wx.e.rows.find(r=>r.glCode==='6100').actual,2500,'Reviewed negative source expense applies exact -1 sign');assert.equal(wx.e.expenseActual,2500);
 assert.equal(wf.c.intakeEvidence.governance.mappings.find(m=>m.glCode==='6100').signMultiplier,-1);
 const retainedBefore=(await db.query('select evidence from atlas_workbook_audits where audit_id=$1',[wf.stored.audit_id])).rows[0].evidence;
 const inspectYtd=async c=>{await db.exec('reset role');return (await db.query('select atlas_private.month_end_source_ytd($1) y',[c])).rows[0].y;};
 const checkBad=async(c,code)=>{c=await finalize(c);const result=await inspectYtd(c);assert.equal(result.ready,false,code);assert(result.issues.some(i=>i.code===code),JSON.stringify(result.issues));return result;};
 let bad=structuredClone(wf.c);
 for(const row of bad.rows){if(row.glCode==='6100')row.values.ytdActual=-2600;else if(row.accountName==='Total Expenses')row.values.ytdActual=2600;else if(row.accountName==='Net Operating Income')row.values.ytdActual=57400;const inv=bad.intakeEvidence.rowInventory.find(i=>i.id===row.source.rowId);inv.rawCells.find(v=>v.address===row.source.cells.ytdActual).value=row.values.ytdActual;}
 let result=await checkBad(bad,'source_ytd_audit_cell_mismatch');assert(result.checks.every(c=>c.passed),'Internally consistent changed YTD values/control/raw cells still fail the immutable audit');
 for(const mode of ['forged_header','forged_period','other_column','other_row','row_identity','formula','renamed_file']){
  bad=structuredClone(wf.c);const row=bad.rows.find(r=>r.glCode==='6100'),inv=bad.intakeEvidence.rowInventory.find(i=>i.id===row.source.rowId),raw=inv.rawCells.find(v=>v.address===row.source.cells.ytdActual);
  let code='source_ytd_audit_header_scope_mismatch';
  if(mode==='forged_header'){row.columnMapping.ytdActual.groupHeader='YTD ( Feb 2026 - Aug 2026 )';inv.columnMapping.ytdActual=structuredClone(row.columnMapping.ytdActual);}
  if(mode==='forged_period')bad.metadata.ytdStart='2026-02';
  if(mode==='other_column'){row.columnMapping.ytdActual.column='H';inv.columnMapping.ytdActual=structuredClone(row.columnMapping.ytdActual);row.source.cells.ytdActual='H13';row.values.ytdActual=-8000;}
  if(mode==='other_row'){row.source.cells.ytdActual='G9';row.values.ytdActual=60000;code='source_ytd_audit_cell_mismatch';}
  if(mode==='row_identity'){row.glCode='6101';inv.glCode='6101';bad.intakeEvidence.governance.mappings.find(m=>m.glCode==='6100').glCode='6101';code='source_ytd_audit_row_identity_mismatch';}
  if(mode==='formula'){raw.formula='G9';raw.hasCachedValue=true;code='source_ytd_audit_cell_mismatch';}
  if(mode==='renamed_file'){bad.sourceFile='Spoofed.pdf';row.values.ytdActual=-2600;raw.value=-2600;code='source_ytd_audit_cell_mismatch';}
  await checkBad(bad,code);
 }
 bad=structuredClone(wf.c);bad.intakeEvidence.governance.mappings.find(m=>m.glCode==='6100').signMultiplier=1;
 result=await checkBad(bad,'monthly_source_evidence_invalid');assert(result.issues[0].issues.some(i=>i.code==='mapping_sign_does_not_reconcile'));
 bad=structuredClone(wf.c);bad.intakeEvidence.workbookAudit=structuredClone(wf.audit);await checkBad(bad,'source_ytd_retained_audit_required');
 bad=structuredClone(wf.c);bad.sourceFile='Renamed worksheet.pdf';delete bad.intakeEvidence.workbookAudit;await checkBad(bad,'source_ytd_retained_audit_required');
 // Even the authorized audit owner cannot reuse a community-specific source
 // as this review's authority without an immutable assignment to this community.
 const unboundAudit=structuredClone(wf.audit);unboundAudit.previousFingerprint='a'.repeat(64);delete unboundAudit.fingerprint;unboundAudit.fingerprint=workbookEvidenceHash(unboundAudit);
 await signIn(1);const unboundStored=await call('atlas_save_workbook_audit',['10000000-0000-0000-0000-000000000002',wf.c.sourceHash,unboundAudit,randomUUID()]);
 bad=structuredClone(wf.c);bad.intakeEvidence.workbookAudit=compactWorkbookAudit(unboundAudit,unboundStored);bad.intakeEvidence.governance.auditFingerprint=unboundAudit.fingerprint;await checkBad(bad,'source_ytd_audit_community_scope_required');
 bad=structuredClone(wf.c);bad.intakeEvidence.workbookAudit.fingerprint='f'.repeat(64);await assert.rejects(()=>inspectYtd(bad),/fingerprint/);
 bad=structuredClone(wf.c);bad.sourceHash='f'.repeat(64);await assert.rejects(()=>inspectYtd(bad),/source/);
 // A valid old audit remains immutable and usable for its monthly scope, but
 // it cannot silently acquire YTD financial authority after this migration.
 const oldAudit=auditWorkbook(wf.wb,{sourceHash:wf.c.sourceHash,authoritativeCells:wf.audit.authorityScope.selectedCells.filter(id=>!/^BCR!G(?:9|10|11|13|14|15)$/.test(id)),rowDispositions:Object.fromEntries(wf.c.intakeEvidence.rowInventory.map(row=>[row.id,{disposition:row.disposition,reason:row.reason}])),requireRowDispositions:true});
 await signIn(1);const oldStored=await call('atlas_save_workbook_audit',[cid,wf.c.sourceHash,oldAudit,randomUUID()]);bad=structuredClone(wf.c);bad.intakeEvidence.workbookAudit=compactWorkbookAudit(oldAudit,oldStored);bad.intakeEvidence.governance.auditFingerprint=oldAudit.fingerprint;
 result=await checkBad(bad,'source_ytd_audit_cell_mismatch');assert(!result.issues.some(i=>i.code==='monthly_source_evidence_invalid'),'Old exact monthly audit still validates monthly inputs');
 const incomplete=structuredClone(wf.audit);incomplete.authorityScope.requiredNodes=incomplete.authorityScope.requiredNodes.filter(id=>id!=='BCR!G13');delete incomplete.fingerprint;incomplete.fingerprint=workbookEvidenceHash(incomplete);
 await signIn(1);const incompleteStored=await call('atlas_save_workbook_audit',[cid,wf.c.sourceHash,incomplete,randomUUID()]);bad=structuredClone(wf.c);bad.intakeEvidence.workbookAudit=compactWorkbookAudit(incomplete,incompleteStored);bad.intakeEvidence.governance.auditFingerprint=incomplete.fingerprint;
 result=await checkBad(bad,'monthly_source_evidence_invalid');assert(result.issues[0].issues.some(i=>/scope/.test(i.code)),'Immutable server validation rejects missing formula dependency even with matching recomputed client fingerprint');
 const missingSupport=structuredClone(wf.audit);missingSupport.authorityScope.requiredNodes=missingSupport.authorityScope.requiredNodes.filter(id=>id!=='BCR!M13');delete missingSupport.fingerprint;missingSupport.fingerprint=workbookEvidenceHash(missingSupport);
 assert(wf.audit.authorityScope.requiredNodes.includes('BCR!M13'));assert(!wf.audit.authorityScope.selectedCells.includes('BCR!M13'),'Supporting dependency is distinct from selected source roots');
 await signIn(1);const missingSupportStored=await call('atlas_save_workbook_audit',[cid,wf.c.sourceHash,missingSupport,randomUUID()]);
 bad=structuredClone(wf.c);bad.sourceFile='Renamed worksheet.pdf';bad.intakeEvidence.workbookAudit=compactWorkbookAudit(missingSupport,missingSupportStored);bad.intakeEvidence.governance.auditFingerprint=missingSupport.fingerprint;
 result=await checkBad(bad,'source_ytd_audit_dependency_invalid');assert(!result.issues.some(i=>i.code==='source_ytd_audit_cell_mismatch'),'All audited roots still match; the absent transitive dependency is the blocker');assert(result.issues.some(i=>i.code==='source_ytd_audit_dependency_invalid'&&i.issues.some(j=>j.code==='workbook_scope_incomplete')));
 bad=structuredClone(wf.c);bad.sourceFile='Renamed worksheet.pdf';bad.intakeEvidence.governance.auditFingerprint='f'.repeat(64);await checkBad(bad,'source_ytd_audit_review_required');
 const findingsAudit=structuredClone(wf.audit);findingsAudit.findings.push({code:'fixture_review',severity:'review',message:'Review retained supporting evidence'});delete findingsAudit.fingerprint;findingsAudit.fingerprint=workbookEvidenceHash(findingsAudit);
 await signIn(1);const findingsStored=await call('atlas_save_workbook_audit',[cid,wf.c.sourceHash,findingsAudit,randomUUID()]);bad=structuredClone(wf.c);bad.sourceFile='Renamed worksheet.pdf';bad.intakeEvidence.workbookAudit=compactWorkbookAudit(findingsAudit,findingsStored);bad.intakeEvidence.governance.auditFingerprint=findingsAudit.fingerprint;bad.intakeEvidence.governance.findingsReviewed=false;await checkBad(bad,'source_ytd_audit_review_required');
 // Exact stored audit bytes and existing Accounting source remain untouched.
 await db.exec('reset role');assert.deepEqual((await db.query('select evidence from atlas_workbook_audits where audit_id=$1',[wf.stored.audit_id])).rows[0].evidence,retainedBefore);
 assert.equal((await db.query("select provolatile from pg_proc where oid='atlas_private.month_end_source_ytd(jsonb)'::regprocedure")).rows[0].provolatile,'s');
 await signIn(1);
 // A new latest approved baseline invalidates a prepared review fingerprint.
 const fresh=await call('atlas_read_month_end_review',[prior.review_id]);await baseline({version:'baseline-2'});
 await assert.rejects(()=>call('atlas_save_month_end_decision',[prior.review_id,fresh.fingerprint,{}, {},randomUUID()]),/changed|fingerprint/i);
 await baseline({start:8});const student=await evidence(await build({start:8,ytdExpense:800,ytdIncome:10000}));assert.deepEqual(student.e.periods,['2026-08']);assert.deepEqual(student.e.blockers,[]);assert.equal(student.e.expenseActual,800);assert.equal(student.e.expenseBudget,1000);
 await signIn(3);await assert.rejects(()=>call('atlas_read_month_end_review',[prior.review_id]),/access denied/);await signIn(1);
 await assert.rejects(()=>call('atlas_private.month_end_source_ytd',[c]),/permission denied/);
 await db.exec('reset role');assert.deepEqual((await db.query('select to_jsonb(c) value from atlas_communities c where community_id=$1',[cid])).rows[0].value,historyBefore,'Approved March operational start unchanged');
 assert.equal((await db.query('select count(*)::int n from atlas_financial_close_versions')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from atlas_month_end_decisions')).rows[0].n,0,'Rejected decisions never append');
 console.log('PASS source fiscal YTD, production XLSX immutable audit/value/header/identity/dependency/scope binding, signed expense governance, retained PDF mapping, same-period approved budget, intentional blanks, source-only mapping, missing/raw/control/formula failures, strict35%, Student fiscal start, permissions and immutable monthly history.');
}finally{await db.close();}
