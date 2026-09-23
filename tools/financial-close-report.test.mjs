import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readCloseSnapshot,closeReportRows,closeReportHtml,closeReportCsv,closeReportWorkbook} from '../docs/portfolio-operations-dashboard/features/financial-close-report.mjs';
const require=createRequire(import.meta.url),XLSX=require('xlsx');
const cid='10000000-0000-0000-0000-000000000001',period='2028-04',version='close-version',hash='a'.repeat(64),pub='publication';
const close={version_id:version,community_id:cid,period_key:period,status:'closed',coverage:'full_month',content_hash:hash,source_hash:'b'.repeat(64),source_file:'synthetic.xlsx',row_count:3};
const rows=[{gl_code:'4110',account_name:'Rent',actual:0,ytd_actual:null},{gl_code:'4190',account_name:'Concessions',actual:-25,ytd_actual:-25},{gl_code:'6210',account_name:'Marketing',actual:50.12,ytd_actual:50.12}].map(r=>({...r,version_id:version,community_id:cid,source_location:{sheet:'BCR',row:1}}));
// atlas_read_finance projects selected fields and omits content_hash. The
// immutable version endpoint is the authority for the report/export lineage.
const {content_hash:omittedHash,...projection}=close;
const record={community_id:cid,period_key:period,publication_id:pub,summary:{registryVersion:'atlas-finance-v1',communityId:cid,period,actualCloseVersion:version,close:projection}};
const session=({finance=()=>record,versions=[close],detail=rows}={})=>({getSession:()=>({user:{id:'reader'}}),fetchJson:async path=>{
 if(path.includes('/rpc/'))return structuredClone([finance()]);
 if(path.startsWith('/atlas_financial_close_versions?'))return structuredClone(versions);
 if(path.startsWith('/atlas_financial_close_rows?'))return structuredClone(detail);
 throw Error('Unexpected fixture request '+path);
}});
const first=await readCloseSnapshot(session(),cid,period),second=await readCloseSnapshot(session(),cid,period);assert.deepEqual(first,second);assert.ok(Object.isFrozen(first.rows[0]));
const data=closeReportRows(first);assert.equal(data[0].Actual,0);assert.equal(data[0].Source_YTD,null);assert.equal(data[1].Actual,-25);assert.ok(data.every(r=>r.Close_version===version&&r.Content_hash===hash&&r.Publication===pub));
const html=closeReportHtml(first),csv=closeReportCsv(first);assert.ok(html.includes(version)&&html.includes(hash)&&html.includes('Unavailable'));assert.ok(csv.includes('"0",""')&&csv.includes('"-25"'));
const wb=closeReportWorkbook(first,XLSX),bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),read=XLSX.read(bytes,{type:'buffer'}),excel=XLSX.utils.sheet_to_json(read.Sheets['Canonical actuals'],{defval:null});assert.deepEqual(excel,data);assert.equal(read.Sheets['Canonical actuals'].C2.v,'4110');
assert.equal(record.summary.close.content_hash,undefined);assert.equal(first.contentHash,hash,'Missing projected hash must come from the immutable close');
assert.deepEqual(await readCloseSnapshot(session({finance:()=>({...record,summary:{...record.summary,close}})}),cid,period),first,'Projection with a hash must produce the same snapshot');
let reads=0;await assert.rejects(readCloseSnapshot(session({finance:()=>({...record,publication_id:++reads===1?pub:'replaced'})}),cid,period),/version changed/);
await assert.rejects(readCloseSnapshot(session({detail:rows.map(r=>({...r,version_id:'wrong'}))}),cid,period),/detail version or community mismatch/);
await assert.rejects(readCloseSnapshot(session({detail:rows.map(r=>({...r,community_id:'wrong'}))}),cid,period),/detail version or community mismatch/);
for(const changed of [{community_id:'wrong'},{period_key:'2028-05'},{status:'draft'},{coverage:'partial_startup'}])await assert.rejects(readCloseSnapshot(session({versions:[{...close,...changed}]}),cid,period),/scope or status/);
await assert.rejects(readCloseSnapshot(session({versions:[]}),cid,period),/scope or status/);
for(const content_hash of [undefined,null,'','invalid'])await assert.rejects(readCloseSnapshot(session({versions:[{...close,content_hash}]}),cid,period),/hash or row count/);
await assert.rejects(readCloseSnapshot(session({finance:()=>({...record,summary:{...record.summary,close:{...projection,content_hash:'c'.repeat(64)}}})}),cid,period),/lineage does not match/);
await assert.rejects(readCloseSnapshot(session({finance:()=>({...record,summary:{...record.summary,actualCloseVersion:'wrong'}})}),cid,period),/close version mismatch/);
console.log('PASS immutable canonical snapshot with absent projected hash, reload/second-session parity, screen/print-PDF/CSV/XLSX same rows and version/hash, zero/missing/negative semantics, missing lineage/scope/status and concurrent-publication guards.');
