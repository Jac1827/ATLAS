// Read-only real-PDF acceptance. Source bytes/financial values stay outside git;
// confirmation and server validation run only in a disposable local database.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {finalizeFinancialPackageEvidence} from '../docs/portfolio-operations-dashboard/features/financial-package.mjs';
import {suggestMonthlyMappings,confirmMonthlyGovernance} from '../docs/portfolio-operations-dashboard/features/financial-workbook-governance.mjs';
const [input,fiscalStart,output]=process.argv.slice(2),startMonth=Number(fiscalStart);
if(!input||!output||!Number.isInteger(startMonth)||startMonth<1||startMonth>12)throw Error('Usage: ATLAS_PLAYWRIGHT=<module> node tools/financial-pdf-private-fixture.mjs <private PDF> <fixture fiscal start month> <private summary.json>');
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),{fixture}=require('./financial-intake-fixture.cjs'),root=path.resolve(new URL('..',import.meta.url).pathname),bytes=fs.readFileSync(input),hash=createHash('sha256').update(bytes).digest('hex');
const server=http.createServer((request,response)=>{try{const name=new URL(request.url,'http://fixture').pathname;if(name==='/'){response.setHeader('content-type','text/html');response.end('<!doctype html><title>Private PDF parser acceptance</title>');return;}const file=path.resolve(root,'.'+decodeURIComponent(name));if(!file.startsWith(root+path.sep))throw Error('Invalid local route');response.setHeader('content-type',/\.m?js$/.test(file)?'text/javascript':'application/octet-stream');response.end(fs.readFileSync(file));}catch{response.writeHead(404);response.end();}});
let browser,db;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const base=await page.evaluate(async({data,fileName})=>{const{readPackage}=await import('/docs/portfolio-operations-dashboard/features/financial-package-reader.mjs');return readPackage(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],fileName,{type:'application/pdf'}));},{data:bytes.toString('base64'),fileName:path.basename(input)});
 assert.equal(base.sourceHash,hash);assert.equal(base.technicalReconciled,true,JSON.stringify(base.exceptions));assert.equal(base.safeToImport,false,'Extraction does not approve an accounting close');assert.equal(base.unexaminedPages,0);assert(base.checks.every(check=>check.passed));
 const isolated=await fixture();db=isolated.db;const{cid,signIn}=isolated,actor='00000000-0000-0000-0000-000000000001';await db.exec('reset role');
 for(const name of ['20260924121641_planning_cell_workbook_integrity_governance.sql','20260924121647_immutable_workbook_audits_and_monthly_governance.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
 await db.query('insert into atlas_community_aliases values($1,$2,true,$3)',[cid,base.metadata.sourceProperty,'isolated-pdf-acceptance']);await signIn(1);
 const governance=confirmMonthlyGovernance(base,{reportingBasis:startMonth===1?'calendar':'fiscal',fiscalStartMonth:startMonth,currency:'USD',reason:'Disposable fixture validates retained printed dependencies; this is not production mapping or accounting approval.',mappings:suggestMonthlyMappings(base),findingsReviewed:true,actor});
 const certificate=await finalizeFinancialPackageEvidence(base,{communityId:cid,period:base.metadata.period,actor,exclusionsReviewed:true,governance});assert.equal(certificate.safeToImport,true,JSON.stringify(certificate.safetyIssues));
 await db.exec('reset role');const validation=(await db.query('select atlas_private.finance_intake_validation($1,$2) v',[certificate,cid])).rows[0].v;assert.equal(validation.reconciled,true,JSON.stringify(validation.issues));
 let changed=structuredClone(certificate);changed.rows.find(row=>row.kind==='posting').values.actual+=0.02;changed=await finalizeFinancialPackageEvidence(changed);const rejected=(await db.query('select atlas_private.finance_intake_validation($1,$2) v',[changed,cid])).rows[0].v;assert.equal(rejected.reconciled,false);
 assert.equal(createHash('sha256').update(fs.readFileSync(input)).digest('hex'),hash);
 const summary={testedAt:new Date().toISOString(),scope:'Real PDF through official browser reader and disposable local PostgreSQL validation. No production mapping, close, approval or publication.',file:path.basename(input),sourceHash:hash,parserVersion:certificate.intakeEvidence.parserVersion,mappingVersion:certificate.intakeEvidence.mappingVersion,pageCount:base.pageCount,metadata:base.metadata,fixtureFiscalStartMonth:startMonth,classifications:base.classifications.reduce((result,item)=>(result[item.type]=(result[item.type]||0)+1,result),{}),rowInventory:certificate.intakeEvidence.inventoryCounts,postingRows:validation.leafCount,controls:validation.controlCount,amountChecks:certificate.checks.length,allAmountColumnsReconciled:true,sourceValuesUnchanged:true,unresolved:certificate.exceptions.length,browserExtractionReconciled:base.technicalReconciled,uploadAloneApproved:false,isolatedServerValidationPassed:validation.reconciled,changedActualRejected:true,evidenceFingerprint:certificate.intakeEvidence.evidenceFingerprint,productionWrites:false};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{await db?.close();await browser?.close();server.close();}
